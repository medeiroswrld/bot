import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Megaphone, Plus, X, Trash2, Send, ChevronRight, ChevronLeft,
    Users, CheckCircle2, AlertCircle, Loader2, FileText
} from 'lucide-react';
import { useAppContext } from '../context/AppContext.jsx';

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

const StatusBadge = ({ status }) => {
    const c = CAMP_STATUS[status] ?? CAMP_STATUS.draft;
    return <span className="status-badge" style={{ background: c.bg, color: c.color }}>{c.label}</span>;
};

// ─── Wizard ───────────────────────────────────────────────────────────────────
const CampaignWizard = ({ onClose }) => {
    const navigate = useNavigate();
    const { messageTemplates, leads, vehicleInterests, createCampaign, sendCampaign, addToast } = useAppContext();
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

    const template = approvedTemplates.find(t => t.id === templateId) || null;

    const audienceFilter = useMemo(() => {
        switch (audienceType) {
            case 'leads_by_status': return { statuses };
            case 'leads_inactive': return { days_inactive: Number(daysInactive) || 30 };
            case 'leads_by_interest_vehicle': return { model: interestModel };
            case 'custom_phones': return { phones: customPhones.split('\n').map(p => p.replace(/\D/g, '')).filter(Boolean) };
            default: return {};
        }
    }, [audienceType, statuses, daysInactive, interestModel, customPhones]);

    // Contagem estimada do público (client-side, a partir do estado do context)
    const audienceCount = useMemo(() => {
        const withPhone = (leads || []).filter(l => l.phone);
        switch (audienceType) {
            case 'all_leads': return withPhone.length;
            case 'leads_by_status': return withPhone.filter(l => statuses.includes(l.status)).length;
            case 'leads_inactive': {
                const cutoff = Date.now() - (Number(daysInactive) || 30) * 86400000;
                return withPhone.filter(l => new Date(l.date || 0).getTime() < cutoff).length;
            }
            case 'leads_by_interest_vehicle':
                return (vehicleInterests || []).filter(v => v.status === 'active' && (v.model || '').toLowerCase().includes(interestModel.toLowerCase())).length;
            case 'custom_phones': return audienceFilter.phones.length;
            default: return 0;
        }
    }, [audienceType, leads, vehicleInterests, statuses, daysInactive, interestModel, audienceFilter]);

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
                template_variables: vars,
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
                    <h2>Nova Campanha — Passo {step} de 4</h2>
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
                            ['leads_by_status', 'Leads em determinados status'],
                            ['leads_inactive', 'Leads inativos há X dias'],
                            ['leads_by_interest_vehicle', 'Lista de espera por modelo'],
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
                        {audienceType === 'custom_phones' && (
                            <div className="form-group" style={{ marginTop: 8 }}>
                                <label>Números (um por linha, com DDD)</label>
                                <textarea rows={4} value={customPhones} onChange={e => setCustomPhones(e.target.value)} placeholder={'5515999998888\n5511988887777'} style={{ fontFamily: 'monospace' }} />
                            </div>
                        )}

                        <div style={{ marginTop: 12, padding: 12, borderRadius: 8, background: 'var(--bg-card)', display: 'flex', alignItems: 'center', gap: 8 }}>
                            <Users size={18} style={{ color: 'var(--primary)' }} />
                            <strong>{audienceCount}</strong> {audienceCount === 1 ? 'pessoa' : 'pessoas'} vão receber
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
    const { campaigns, deleteCampaign } = useAppContext();
    const [wizard, setWizard] = useState(false);
    const [confirmDeleteId, setConfirmDeleteId] = useState(null);

    const fmtDate = (iso) => iso ? new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '';

    return (
        <div className="view-content">
            <header className="view-header-flex">
                <div className="view-header">
                    <h1>Campanhas</h1>
                    <p>Dispare mensagens em massa usando templates aprovados pela Meta.</p>
                </div>
                <button className="btn-primary" onClick={() => setWizard(true)} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Plus size={18} /> Nova Campanha
                </button>
            </header>

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
                                <th style={{ padding: '12px 16px', fontWeight: 600 }}>Campanha</th>
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
