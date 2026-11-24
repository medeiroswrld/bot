import { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Megaphone, Plus, X, Trash2, Send, ChevronRight, ChevronLeft,
    Users, CheckCircle2, AlertCircle, Loader2, FileText
} from 'lucide-react';
import { useAppContext } from '../context/AppContext.jsx';
import { supabase } from '../lib/supabase.js';
import { classificarIdade, DIAS_CLIENTE_NOVO } from '../lib/leads.js';

const CAMP_STATUS = {
    draft:     { label: 'Rascunho',   color: '#64748b', bg: '#f1f5f9' },
    scheduled: { label: 'Agendada',   color: '#2563eb', bg: '#eff6ff' },
    sending:   { label: 'Enviando',   color: '#d97706', bg: '#fff7ed' },
    completed: { label: 'Concluída',  color: '#059669', bg: '#ecfdf5' },
    failed:    { label: 'Falhou',     color: '#dc2626', bg: '#fef2f2' },
    cancelled: { label: 'Cancelada',  color: '#64748b', bg: '#f1f5f9' },
};

const LEAD_STATUSES = ['novo', 'atendimento', 'proposta', 'negociacao', 'vendido', 'perdido'];
const COST_PER_CONV = { MARKETING: 0.40, UTILITY: 0.15, AUTHENTICATION: 0.15 };
const fmtBRL = (n) => `R$ ${Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const varCount = (tpl) => (tpl?.body_variables?.length ?? 0);

// Telefone só com dígitos. Mesma função do `refinarPublico` no send-campaign,
// de propósito: "(15) 99999-9999" e "5515999999999" são a mesma pessoa, e a
// tela tem que contar igual ao que o servidor vai mandar.
const soDigitos = (p) => String(p ?? '').replace(/\D/g, '');

const StatusBadge = ({ status }) => {
    const c = CAMP_STATUS[status] ?? CAMP_STATUS.draft;
    return <span className="status-badge" style={{ background: c.bg, color: c.color }}>{c.label}</span>;
};

// ─── Wizard ───────────────────────────────────────────────────────────────────
const CampaignWizard = ({ onClose }) => {
    const navigate = useNavigate();
    const { messageTemplates, leads, vehicleInterests, appointments, createCampaign, sendCampaign } = useAppContext();
    const approvedTemplates = useMemo(() => (messageTemplates || []).filter(t => t.status === 'approved'), [messageTemplates]);

    const [step, setStep] = useState(1);
    const [name, setName] = useState('');
    const [templateId, setTemplateId] = useState('');
    const [vars, setVars] = useState({});
    const [audienceType, setAudienceType] = useState('all_leads');
    const [statuses, setStatuses] = useState([]);
    const [daysInactive, setDaysInactive] = useState(30);
    const [interestModel, setInterestModel] = useState('');
    const [customPhones, setCustomPhones] = useState('');
    const [sending, setSending] = useState(false);
    // Refinamentos: combinam com QUALQUER público acima, em vez de virarem
    // opções novas na lista (senão "base importada" × "antigos" × "não recebeu"
    // viraria uma dezena de radios).
    const [idade, setIdade] = useState('todos');            // todos | novos | antigos
    const [excluirJaRecebeu, setExcluirJaRecebeu] = useState('nenhum');
    const [excluirDias, setExcluirDias] = useState(7);
    // Teto por disparo. Existe por causa de número novo: recém-conectado começa
    // em 250 conversas iniciadas pela empresa por 24h na Meta, e mandar a base
    // inteira de uma vez é padrão de banimento. 0 = sem teto.
    const [limite, setLimite] = useState(0);
    // Arte deste disparo, quando o template tem cabeçalho de imagem. Vazio usa
    // a imagem de exemplo do próprio template — assim nunca sai sem imagem, que
    // é o que faria a Meta recusar a mensagem inteira.
    const [headerImage, setHeaderImage] = useState('');
    const [jaReceberam, setJaReceberam] = useState(new Set());

    const template = approvedTemplates.find(t => t.id === templateId) || null;

    // Telefones que já receberam, pro contador da tela bater com o que o
    // servidor vai fazer. Mesma regra do refinarPublico no send-campaign.
    useEffect(() => {
        if (excluirJaRecebeu === 'nenhum') { setJaReceberam(new Set()); return; }
        let cancelado = false;
        (async () => {
            let cq = supabase.from('campaigns').select('id');
            if (excluirJaRecebeu === 'este_template' && templateId) cq = cq.eq('template_id', templateId);
            const { data: camps } = await cq;
            const ids = (camps || []).map(c => c.id);
            if (!ids.length) { if (!cancelado) setJaReceberam(new Set()); return; }

            // `sent` é estado de PASSAGEM: o webhook promove pra `delivered` e
            // `read`. Perguntar só por ele encontrava quase ninguém — na
            // campanha de 23/11 eram 137 delivered, 34 read e 3 sent, então o
            // filtro reconheceu 3 de 174 e o disparo seguinte repetiu 129
            // pessoas. `failed` fica fora (não chegou) e `pending` também
            // (nem saiu — essa gente precisa entrar no próximo).
            let sq = supabase.from('campaign_sends')
                .select('customer_phone').in('campaign_id', ids)
                .in('status', ['sent', 'delivered', 'read']);
            if (excluirJaRecebeu === 'qualquer') {
                sq = sq.gte('sent_at', new Date(Date.now() - (Number(excluirDias) || 7) * 86400000).toISOString());
            }
            const { data } = await sq;
            // Por DÍGITOS, igual o servidor faz. Comparando a string crua, o
            // contador da tela divergia do que ia sair de verdade sempre que o
            // cadastro tinha máscara diferente do histórico.
            if (!cancelado) setJaReceberam(new Set((data || []).map(s => soDigitos(s.customer_phone))));
        })();
        return () => { cancelado = true; };
    }, [excluirJaRecebeu, excluirDias, templateId]);

    const audienceFilter = useMemo(() => {
        // Os refinamentos viajam junto com o filtro do público, pra qualquer tipo.
        const refino = {
            idade, excluir_ja_recebeu: excluirJaRecebeu, excluir_dias: Number(excluirDias) || 7,
            ...(Number(limite) > 0 ? { limite: Number(limite) } : {}),
        };
        switch (audienceType) {
            case 'leads_by_status': return { ...refino, statuses };
            case 'leads_inactive': return { ...refino, days_inactive: Number(daysInactive) || 30 };
            case 'leads_by_interest_vehicle': return { ...refino, model: interestModel };
            case 'leads_by_source': return { ...refino, sources: ['importacao'] };
            case 'evento_agendados': return { ...refino, so_futuras: true };
            case 'custom_phones': return { ...refino, phones: customPhones.split('\n').map(p => p.replace(/\D/g, '')).filter(Boolean) };
            default: return refino;
        }
    }, [audienceType, statuses, daysInactive, interestModel, customPhones, idade, excluirJaRecebeu, excluirDias, limite]);

    // Público base, antes dos refinamentos (client-side, a partir do context).
    const publicoBase = useMemo(() => {
        const withPhone = (leads || []).filter(l => l.phone);
        switch (audienceType) {
            case 'all_leads': return withPhone;
            case 'leads_by_status': return withPhone.filter(l => statuses.includes(l.status));
            case 'leads_inactive': {
                const cutoff = Date.now() - (Number(daysInactive) || 30) * 86400000;
                return withPhone.filter(l => new Date(l.date || 0).getTime() < cutoff);
            }
            case 'leads_by_source': return withPhone.filter(l => l.source === 'importacao');
            default: return [];
        }
    }, [audienceType, leads, statuses, daysInactive]);

    // Mesmas regras do refinarPublico no send-campaign — o contador tem que
    // bater com o que vai sair de verdade, senão o lojista dispara achando que
    // são 30 e saem 12.
    const publicoFinal = useMemo(() => publicoBase.filter(l => {
        if (idade !== 'todos' && classificarIdade(l) !== idade) return false;
        if (excluirJaRecebeu !== 'nenhum' && jaReceberam.has(soDigitos(l.phone))) return false;
        return true;
    }), [publicoBase, idade, excluirJaRecebeu, jaReceberam]);

    // Telefones do público, antes do dedup. Os três casos abaixo não vêm de
    // `leads`, então não passam pelos refinamentos de idade/já-recebeu.
    const telefonesDoPublico = useMemo(() => {
        if (audienceType === 'leads_by_interest_vehicle') {
            return (vehicleInterests || [])
                .filter(v => v.status === 'active' && (v.model || '').toLowerCase().includes(interestModel.toLowerCase()))
                .map(v => v.customer_phone);
        }
        if (audienceType === 'custom_phones') return audienceFilter.phones;
        if (audienceType === 'evento_agendados') {
            // Mesma regra do resolveAudience: visita de evento, não cancelada,
            // e só as que ainda vão acontecer (so_futuras).
            const hoje = new Date().toISOString().slice(0, 10);
            return (appointments || [])
                .filter(a => a.evento_id && ['agendado', 'confirmado'].includes(a.status) && a.date >= hoje)
                .map(a => a.phone);
        }
        return publicoFinal.map(l => l.phone);
    }, [audienceType, vehicleInterests, interestModel, audienceFilter, appointments, publicoFinal]);

    // Dedup por DÍGITOS — a MESMA regra do refinarPublico no send-campaign.
    //
    // Sem isto o contador mente, e mente para baixo do que importa: a base de
    // uma loja real tinha 1215 leads e 706 pessoas (509 repetidos, um número
    // aparecendo 304 vezes). O lojista dispararia achando que são 1215 e sairiam
    // 706 — exatamente o descasamento que esta tela foi feita pra evitar.
    // Isso é um telefone? MESMA regra do refinarPublico (10 a 13 dígitos).
    //
    // Lead de Instagram/Messenger guarda o IGSID no campo telefone, e IGSID tem
    // 16-17 dígitos. Mandar WhatsApp pra ele é falha garantida, e falha machuca
    // a qualidade do número. A tela tem que contar igual ao servidor, senão
    // volta a mentir.
    const comTelefoneReal = useMemo(() => telefonesDoPublico.filter((p) => {
        const d = String(p ?? '').replace(/\D/g, '');
        return d.length >= 10 && d.length <= 13;
    }), [telefonesDoPublico]);

    const semTelefoneReal = telefonesDoPublico.length - comTelefoneReal.length;

    const unicos = useMemo(() => {
        const vistos = new Set();
        return comTelefoneReal.filter((p) => {
            const chave = String(p ?? '').replace(/\D/g, '');
            if (!chave || vistos.has(chave)) return false;
            vistos.add(chave);
            return true;
        });
    }, [comTelefoneReal]);

    const duplicadosRemovidos = comTelefoneReal.length - unicos.length;

    const audienceCount = useMemo(() => {
        const teto = Number(limite) || 0;
        return teto > 0 ? Math.min(unicos.length, teto) : unicos.length;
    }, [unicos, limite]);

    const cortadosPeloTeto = Math.max(0, unicos.length - audienceCount);
    const removidosPeloRefino = publicoBase.length - publicoFinal.length;

    const estCost = audienceCount * (COST_PER_CONV[template?.category] ?? 0.15);

    const canNext = () => {
        if (step === 1) return !!templateId && !!name.trim();
        if (step === 2) return Array.from({ length: varCount(template) }).every((_, i) => (vars[i + 1] ?? '').trim());
        if (step === 3) return audienceCount > 0;
        return true;
    };

    const previewText = useMemo(() => {
        let txt = template?.body_text || '';
        for (let i = 1; i <= varCount(template); i++) {
            txt = txt.replaceAll(`{{${i}}}`, vars[i] || `{{${i}}}`);
        }
        return txt.replace(/\{\{primeiro_nome\}\}/g, 'João').replace(/\{\{nome_cliente\}\}/g, 'João Silva');
    }, [template, vars]);

    const handleFire = async () => {
        setSending(true);
        try {
            const camp = await createCampaign({
                name: name.trim(),
                template_id: templateId,
                audience_type: audienceType,
                audience_filter: audienceFilter,
                // `header_image` viaja junto com as variáveis numeradas. O
                // send-campaign filtra chaves não-numéricas antes de montar os
                // parâmetros do corpo, então ela não vira variável de corpo.
                template_variables: headerImage.trim()
                    ? { ...vars, header_image: headerImage.trim() }
                    : vars,
            });
            onClose();
            sendCampaign(camp.id); // dispara em background; status atualiza via realtime
            navigate(`/campanhas/${camp.id}`);
        } catch {
            setSending(false);
        }
    };

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 720 }}>
                <div className="modal-header">
                    <h2>Novo disparo — Passo {step} de 4</h2>
                    <button className="close-btn" onClick={onClose}><X size={24} /></button>
                </div>

                {/* STEP 1: template */}
                {step === 1 && (
                    <div className="settings-form">
                        <div className="form-group">
                            <label>Nome da campanha *</label>
                            <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Ex: Reativação outubro" />
                        </div>
                        <label style={{ fontWeight: 600, fontSize: '0.85rem' }}>Escolha um template aprovado</label>
                        {approvedTemplates.length === 0 ? (
                            <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-secondary)' }}>
                                <FileText size={36} style={{ opacity: 0.4, marginBottom: 8 }} />
                                <p>Você precisa de um template aprovado primeiro.</p>
                                <button className="btn-primary" style={{ marginTop: 8 }} onClick={() => { onClose(); navigate('/templates'); }}>Ir para Templates →</button>
                            </div>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
                                {approvedTemplates.map(t => (
                                    <button key={t.id} type="button" onClick={() => setTemplateId(t.id)}
                                        style={{ textAlign: 'left', padding: 12, borderRadius: 8, cursor: 'pointer',
                                            border: templateId === t.id ? '2px solid var(--primary)' : '1px solid var(--border)',
                                            background: templateId === t.id ? 'var(--bg-card)' : 'transparent' }}>
                                        <p style={{ margin: 0, fontWeight: 600 }}>{t.display_name}</p>
                                        <p style={{ margin: '2px 0 0', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>{t.category} • {t.body_text.slice(0, 80)}…</p>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {/* STEP 2: variáveis */}
                {step === 2 && (
                    <div className="settings-form">
                        {['IMAGE', 'VIDEO', 'DOCUMENT'].includes(String(template?.header_type || '').toUpperCase()) && (
                            <div className="form-group" style={{ marginBottom: 16 }}>
                                <label>Arte deste disparo (opcional)</label>
                                {template?.header_content && (
                                    <img src={headerImage.trim() || template.header_content} alt=""
                                        style={{ display: 'block', maxWidth: 220, borderRadius: 8, border: '1px solid var(--border)', marginBottom: 8 }} />
                                )}
                                <input type="text" value={headerImage}
                                    onChange={e => setHeaderImage(e.target.value)}
                                    placeholder="Cole a URL de outra imagem, ou deixe vazio" />
                                <small className="text-muted" style={{ fontSize: '0.78rem', lineHeight: 1.5, display: 'block' }}>
                                    Vazio usa a imagem aprovada do template (acima). Trocar a arte aqui
                                    <strong> não exige nova aprovação</strong> — é por isso que o template
                                    aprovado serve todo feirão.
                                </small>
                            </div>
                        )}
                        {varCount(template) === 0 ? (
                            <p className="text-muted">Esse template não tem variáveis. Pode seguir.</p>
                        ) : (
                            <>
                                <p className="text-muted" style={{ fontSize: '0.82rem' }}>
                                    Use texto fixo, ou os marcadores <code>{'{{primeiro_nome}}'}</code> / <code>{'{{nome_cliente}}'}</code> que são substituídos por destinatário.
                                </p>
                                {Array.from({ length: varCount(template) }).map((_, i) => {
                                    const v = template.body_variables[i];
                                    return (
                                        <div className="form-group" key={i}>
                                            <label>{`{{${i + 1}}} — ${v?.name || 'variável'}`}</label>
                                            <input type="text" value={vars[i + 1] ?? ''} onChange={e => setVars(p => ({ ...p, [i + 1]: e.target.value }))}
                                                placeholder={v?.example || `Valor para {{${i + 1}}}`} />
                                        </div>
                                    );
                                })}
                            </>
                        )}
                        <div style={{ marginTop: 12, background: '#e5ddd5', borderRadius: 10, padding: 12 }}>
                            <div style={{ background: '#fff', borderRadius: 8, padding: '8px 10px', maxWidth: 320 }}>
                                <p style={{ margin: 0, fontSize: '0.85rem', color: '#111', whiteSpace: 'pre-wrap' }}>{previewText}</p>
                            </div>
                        </div>
                    </div>
                )}

                {/* STEP 3: público */}
                {step === 3 && (
                    <div className="settings-form">
                        {[
                            ['all_leads', 'Todos os leads'],
                            ['leads_by_source', 'Base importada (clientes antigos)'],
                            ['leads_by_status', 'Leads em determinados status'],
                            ['leads_inactive', 'Leads inativos há X dias'],
                            ['leads_by_interest_vehicle', 'Lista de espera por modelo'],
                            ['evento_agendados', 'Quem agendou visita no feirão'],
                            ['custom_phones', 'Lista de números customizada'],
                        ].map(([val, label]) => (
                            <label key={val} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', cursor: 'pointer' }}>
                                <input type="radio" name="aud" checked={audienceType === val} onChange={() => setAudienceType(val)} />
                                <span>{label}</span>
                            </label>
                        ))}

                        {audienceType === 'leads_by_status' && (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                                {LEAD_STATUSES.map(s => (
                                    <button key={s} type="button" className={`inv-filter-btn ${statuses.includes(s) ? 'active' : ''}`}
                                        onClick={() => setStatuses(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s])}>
                                        {s}
                                    </button>
                                ))}
                            </div>
                        )}
                        {audienceType === 'leads_inactive' && (
                            <div className="form-group" style={{ marginTop: 8 }}>
                                <label>Dias sem interação</label>
                                <input type="number" value={daysInactive} onChange={e => setDaysInactive(e.target.value)} min={1} style={{ maxWidth: 120 }} />
                            </div>
                        )}
                        {audienceType === 'leads_by_interest_vehicle' && (
                            <div className="form-group" style={{ marginTop: 8 }}>
                                <label>Modelo procurado</label>
                                <input type="text" value={interestModel} onChange={e => setInterestModel(e.target.value)} placeholder="Ex: Civic" />
                            </div>
                        )}
                        {audienceType === 'evento_agendados' && (
                            <p className="text-muted" style={{ fontSize: '0.82rem', marginTop: 8, lineHeight: 1.5 }}>
                                Pega quem tem <strong>visita marcada</strong> num dia do evento e ainda
                                vai acontecer. O bot marca essas visitas sozinho, pela data. Use com um
                                template de <strong>lembrete</strong>, não com a peça promocional: quem
                                já agendou não precisa ser convidado de novo.
                            </p>
                        )}
                        {audienceType === 'custom_phones' && (
                            <div className="form-group" style={{ marginTop: 8 }}>
                                <label>Números (um por linha, com DDD)</label>
                                <textarea rows={4} value={customPhones} onChange={e => setCustomPhones(e.target.value)} placeholder={'5515999998888\n5511988887777'} style={{ fontFamily: 'monospace' }} />
                            </div>
                        )}

                        {/* Teto por disparo — proteção de número novo */}
                        <div className="form-group" style={{ marginTop: 16 }}>
                            <label>Enviar no máximo (0 = sem limite)</label>
                            <input type="number" value={limite} min={0}
                                onChange={e => setLimite(e.target.value)} style={{ maxWidth: 140 }} />
                            <small className="text-muted" style={{ fontSize: '0.78rem', lineHeight: 1.5, display: 'block' }}>
                                Número de WhatsApp <strong>recém-conectado</strong> começa em
                                <strong> 250 conversas por 24h</strong> na Meta. Mandar uma base grande de
                                uma vez num número novo estoura o teto e é padrão de banimento. Mande em
                                lotes (ex.: 100 por dia) e marque <em>“já recebeu”</em> abaixo pra não
                                repetir ninguém.
                            </small>
                        </div>

                        {/* Refinamentos — combinam com qualquer público acima */}
                        {audienceType !== 'custom_phones' && audienceType !== 'leads_by_interest_vehicle' && (
                            <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
                                <p style={{ margin: '0 0 8px', fontWeight: 600, fontSize: '0.85rem' }}>Refinar</p>

                                <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 4 }}>
                                    Tempo de cadastro
                                </label>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
                                    {[
                                        ['todos', 'Todos'],
                                        ['novos', `Novos (até ${DIAS_CLIENTE_NOVO} dias)`],
                                        ['antigos', `Antigos (+${DIAS_CLIENTE_NOVO} dias)`],
                                    ].map(([val, label]) => (
                                        <button key={val} type="button" className={`inv-filter-btn ${idade === val ? 'active' : ''}`} onClick={() => setIdade(val)}>
                                            {label}
                                        </button>
                                    ))}
                                </div>

                                <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 4 }}>
                                    Quem já recebeu
                                </label>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                    {[
                                        ['nenhum', 'Pode repetir'],
                                        ['este_template', 'Pular quem já recebeu ESTE template'],
                                        ['qualquer', 'Pular quem recebeu qualquer disparo recente'],
                                    ].map(([val, label]) => (
                                        <button key={val} type="button" className={`inv-filter-btn ${excluirJaRecebeu === val ? 'active' : ''}`} onClick={() => setExcluirJaRecebeu(val)}>
                                            {label}
                                        </button>
                                    ))}
                                </div>
                                {excluirJaRecebeu === 'qualquer' && (
                                    <div className="form-group" style={{ marginTop: 8 }}>
                                        <label>Últimos quantos dias</label>
                                        <input type="number" value={excluirDias} onChange={e => setExcluirDias(e.target.value)} min={1} style={{ maxWidth: 120 }} />
                                    </div>
                                )}
                            </div>
                        )}

                        <div style={{ marginTop: 12, padding: 12, borderRadius: 8, background: 'var(--bg-card)', display: 'flex', alignItems: 'center', gap: 8 }}>
                            <Users size={18} style={{ color: 'var(--primary)' }} />
                            <div>
                                <div><strong>{audienceCount}</strong> {audienceCount === 1 ? 'pessoa vai' : 'pessoas vão'} receber</div>
                                {removidosPeloRefino > 0 && (
                                    <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: 2 }}>
                                        {removidosPeloRefino} {removidosPeloRefino === 1 ? 'ficou' : 'ficaram'} de fora pelo refino
                                        {' '}(de {publicoBase.length} no total)
                                    </div>
                                )}
                                {/* Dizer POR QUE o número caiu. Sem isto parece que o sistema
                                    perdeu gente, e o lojista desconfia do contador. */}
                                {semTelefoneReal > 0 && (
                                    <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: 2 }}>
                                        {semTelefoneReal} sem telefone válido (contato de Instagram/Messenger
                                        ou cadastro errado) — WhatsApp não alcança
                                    </div>
                                )}
                                {duplicadosRemovidos > 0 && (
                                    <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: 2 }}>
                                        {duplicadosRemovidos} {duplicadosRemovidos === 1 ? 'cadastro repetido' : 'cadastros repetidos'} do mesmo telefone
                                        {' '}— cada pessoa recebe uma vez só
                                    </div>
                                )}
                                {cortadosPeloTeto > 0 && (
                                    <div style={{ fontSize: '0.78rem', color: '#d97706', marginTop: 2 }}>
                                        {cortadosPeloTeto} {cortadosPeloTeto === 1 ? 'fica' : 'ficam'} para o próximo lote (teto de {limite})
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                )}

                {/* STEP 4: revisão */}
                {step === 4 && (
                    <div className="settings-form">
                        <div style={{ background: '#e5ddd5', borderRadius: 10, padding: 12, marginBottom: 12 }}>
                            <div style={{ background: '#fff', borderRadius: 8, padding: '8px 10px', maxWidth: 320 }}>
                                <p style={{ margin: 0, fontSize: '0.85rem', color: '#111', whiteSpace: 'pre-wrap' }}>{previewText}</p>
                            </div>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                            <div><p className="text-muted" style={{ fontSize: '0.72rem' }}>DESTINATÁRIOS</p><p style={{ fontWeight: 700 }}>{audienceCount}</p></div>
                            <div><p className="text-muted" style={{ fontSize: '0.72rem' }}>CUSTO ESTIMADO</p><p style={{ fontWeight: 700, color: '#d97706' }}>{fmtBRL(estCost)}</p></div>
                        </div>
                        <p className="text-muted" style={{ fontSize: '0.75rem', marginTop: 8 }}>
                            {template?.category} ≈ {fmtBRL(COST_PER_CONV[template?.category] ?? 0.15)}/conversa. O custo real é cobrado pela Meta por conversa de 24h.
                        </p>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, color: '#d97706', fontSize: '0.8rem' }}>
                            <AlertCircle size={15} /> O envio respeita ~1s entre mensagens (limite Meta). {audienceCount} envios ≈ {Math.ceil(audienceCount * 1.1)}s.
                        </div>
                    </div>
                )}

                {/* Footer nav */}
                <div className="modal-footer" style={{ marginTop: 16, justifyContent: 'space-between' }}>
                    <button className="btn-secondary" onClick={() => step === 1 ? onClose() : setStep(step - 1)} disabled={sending}>
                        {step === 1 ? 'Cancelar' : <><ChevronLeft size={15} /> Voltar</>}
                    </button>
                    {step < 4 ? (
                        <button className="btn-primary" onClick={() => setStep(step + 1)} disabled={!canNext()} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            Próximo <ChevronRight size={15} />
                        </button>
                    ) : (
                        <button className="btn-primary" onClick={handleFire} disabled={sending || audienceCount === 0} style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#059669' }}>
                            {sending ? <Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} /> : <Send size={15} />} Disparar agora
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

const ConfirmModal = ({ message, onConfirm, onCancel }) => (
    <div className="modal-overlay" onClick={onCancel}>
        <div className="modal-content modal-sm" onClick={e => e.stopPropagation()}>
            <div style={{ padding: '1.5rem', textAlign: 'center' }}>
                <p style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '1.5rem', lineHeight: 1.4 }}>{message}</p>
                <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center' }}>
                    <button className="btn-secondary" onClick={onCancel}>Cancelar</button>
                    <button className="btn-primary" style={{ background: '#ef4444' }} onClick={onConfirm}>Excluir</button>
                </div>
            </div>
        </div>
    </div>
);

// ─── Página ───────────────────────────────────────────────────────────────────
const Campaigns = () => {
    const navigate = useNavigate();
    const { campaigns, deleteCampaign, companySettings } = useAppContext();
    const [wizard, setWizard] = useState(false);
    // Disparo nao entra no teste de 7 dias (migration 107). A trava de verdade
    // e no servidor; isto aqui so evita o beco sem saida de montar a campanha
    // inteira e descobrir no clique de enviar.
    const semDisparo = companySettings?.disparos_contratado === false;
    const emTeste = companySettings?.assinatura_status === 'trial';
    const [confirmDeleteId, setConfirmDeleteId] = useState(null);

    const fmtDate = (iso) => iso ? new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '';

    return (
        <div className="view-content">
            <header className="view-header-flex">
                <div className="view-header">
                    <h1>Disparos em massa</h1>
                    <p>Dispare mensagens em massa usando templates aprovados pela Meta.</p>
                </div>
                <button className="btn-primary" onClick={() => setWizard(true)}
                    disabled={semDisparo}
                    title={semDisparo ? 'Disparo em massa não está incluído neste momento.' : undefined}
                    style={{ display: 'flex', alignItems: 'center', gap: 6,
                             opacity: semDisparo ? 0.5 : 1,
                             cursor: semDisparo ? 'not-allowed' : 'pointer' }}>
                    <Plus size={18} /> Novo disparo
                </button>
            </header>

            {semDisparo && (
                <p style={{ fontSize: '0.84rem', color: '#0369a1', background: '#e0f2fe',
                            border: '1px solid #bae6fd', borderRadius: 10,
                            padding: '11px 14px', lineHeight: 1.55, marginBottom: '1rem' }}>
                    {emTeste
                        ? <>O disparo em massa <strong>não entra no teste</strong> — cada mensagem
                           enviada assim é cobrada pela Meta por template. O atendimento automático
                           está liberado normalmente nos seus 7 dias.{' '}</>
                        : <>O envio em massa não faz parte do seu plano.{' '}</>}
                    <a href="/plano" style={{ color: '#0369a1', fontWeight: 600 }}>Ver os planos</a>.
                </p>
            )}

            <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
                {(campaigns || []).length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '4rem 2rem', color: 'var(--text-secondary)' }}>
                        <Megaphone size={48} style={{ opacity: 0.3, marginBottom: 16 }} />
                        <h3 style={{ fontWeight: 700, marginBottom: 4 }}>Nenhuma campanha ainda</h3>
                        <p>Crie sua primeira campanha pra falar com sua base.</p>
                    </div>
                ) : (
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
                        <thead>
                            <tr style={{ borderBottom: '1px solid var(--border)', textAlign: 'left', color: 'var(--text-secondary)' }}>
                                <th style={{ padding: '12px 16px', fontWeight: 600 }}>Disparo</th>
                                <th style={{ padding: '12px 16px', fontWeight: 600 }}>Status</th>
                                <th style={{ padding: '12px 16px', fontWeight: 600 }}>Enviadas</th>
                                <th style={{ padding: '12px 16px', fontWeight: 600 }}>Lidas</th>
                                <th style={{ padding: '12px 16px', fontWeight: 600 }}>Criada</th>
                                <th style={{ padding: '12px 16px', fontWeight: 600, textAlign: 'right' }}>Ações</th>
                            </tr>
                        </thead>
                        <tbody>
                            {campaigns.map(c => (
                                <tr key={c.id} style={{ borderBottom: '1px solid var(--border)', cursor: 'pointer' }} onClick={() => navigate(`/campanhas/${c.id}`)}>
                                    <td style={{ padding: '12px 16px' }}>
                                        <p style={{ margin: 0, fontWeight: 600 }}>{c.name}</p>
                                        <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{c.template?.display_name}</p>
                                    </td>
                                    <td style={{ padding: '12px 16px' }}><StatusBadge status={c.status} /></td>
                                    <td style={{ padding: '12px 16px' }}>{c.sent_count}/{c.recipients_count}</td>
                                    <td style={{ padding: '12px 16px' }}>{c.read_count}</td>
                                    <td style={{ padding: '12px 16px', color: 'var(--text-secondary)' }}>{fmtDate(c.created_at)}</td>
                                    <td style={{ padding: '12px 16px', textAlign: 'right' }} onClick={e => e.stopPropagation()}>
                                        <button className="inv-action-btn" title="Excluir" style={{ color: '#dc2626' }} onClick={() => setConfirmDeleteId(c.id)}><Trash2 size={15} /></button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>

            {wizard && <CampaignWizard onClose={() => setWizard(false)} />}
            {confirmDeleteId && (
                <ConfirmModal message="Excluir esta campanha e seu histórico de envios?"
                    onCancel={() => setConfirmDeleteId(null)}
                    onConfirm={async () => { await deleteCampaign(confirmDeleteId); setConfirmDeleteId(null); }} />
            )}
        </div>
    );
};

export default Campaigns;
