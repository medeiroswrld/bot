import React, { useState, useEffect, useRef } from 'react';
import {
    Building2, Calendar, MapPin, Phone, MessageSquare, Save, CheckCircle,
    User, Mail, ToggleLeft, ToggleRight, Plus, Trash2, CalendarOff,
    Image as ImageIcon, Upload, RefreshCw, Gift, Bell, CreditCard, Bot, Landmark, X
} from 'lucide-react';
import { useAppContext } from '../context/AppContext.jsx';
import { supabase } from '../lib/supabase.js';
import { MODELO_PADRAO, CAMPOS, formatarCNPJ } from '../lib/contrato.js';
import { prepararImagem, ehHeic } from '../lib/imagem.js';
import { detectar, aplicar } from '../lib/marcadores.js';
import DoisFatores from './DoisFatores.jsx';

// ─── Assistente de marcadores ────────────────────────────────────────────────
// A loja cola o contrato de uma venda real; aqui ela confirma o que virou campo.
//
// A revisão não é ritual. Formato rígido (CPF, placa, chassi) o sistema acerta,
// mas nome e endereço são indistinguíveis entre si — aplicar sozinho produziria
// contrato assinado com o nome no lugar errado. Por isso nada é trocado sem
// alguém olhar.
const AssistenteMarcadores = ({ texto, onAplicar, onFechar }) => {
    const achados = detectar(texto);
    const [escolhas, setEscolhas] = useState(
        () => Object.fromEntries(achados.map((a) => [a.valor, a.campo])),
    );

    const marcados = Object.values(escolhas).filter(Boolean).length;
    const todos = () => setEscolhas(Object.fromEntries(achados.map((a) => [a.valor, a.campo])));
    const nenhum = () => setEscolhas(Object.fromEntries(achados.map((a) => [a.valor, null])));

    return (
        <div className="modal-overlay" onClick={onFechar}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}
                 style={{ maxWidth: 780 }}>
                <div className="modal-header">
                    <h2>Marcar campos automaticamente</h2>
                    <button className="icon-btn" onClick={onFechar}>&times;</button>
                </div>

                <div style={{ padding: '1rem 1.5rem', maxHeight: '60vh', overflowY: 'auto' }}>
                    {achados.length === 0 ? (
                        <p style={{ fontSize: '0.86rem', color: 'var(--color-text-muted)' }}>
                            Não reconheci nenhum campo. Isso acontece quando o contrato ainda
                            está em branco — cole um contrato já preenchido de uma venda real,
                            que aí dá pra identificar o que é dado e o que é texto fixo.
                        </p>
                    ) : (
                        <>
                            <p style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)',
                                        margin: '0 0 4px', lineHeight: 1.5 }}>
                                Encontrei <strong>{achados.length}</strong> campos. Confira cada um
                                antes de aplicar — o que estiver errado aqui sai errado em todo
                                contrato daqui pra frente.
                            </p>
                            <p style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)',
                                        margin: '0 0 12px' }}>
                                Nome e endereço não aparecem aqui: não há como o sistema saber se
                                um nome é do comprador ou de uma testemunha. Esses você marca
                                selecionando o texto e clicando no campo, na tela anterior.
                            </p>
                            <p style={{ fontSize: '0.78rem', color: '#b45309', background: '#fffbeb',
                                        border: '1px solid #fde68a', borderRadius: 8,
                                        padding: '8px 11px', margin: '0 0 12px', lineHeight: 1.5 }}>
                                Valores e datas vêm <strong>desmarcados de propósito</strong>, menos o
                                maior valor. Um contrato tem multa, parcela e entrada além do preço
                                da venda — marcar todos como preço faria a multa de R$ 500 sair como
                                o valor do carro. Marque um por um o que for mesmo da venda.
                            </p>

                            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                                <button type="button" className="btn-secondary"
                                        style={{ fontSize: '0.76rem' }} onClick={todos}>
                                    Marcar todos
                                </button>
                                <button type="button" className="btn-secondary"
                                        style={{ fontSize: '0.76rem' }} onClick={nenhum}>
                                    Nenhum
                                </button>
                            </div>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                                {achados.map((a) => {
                                    // Sugestoes primeiro, resto da lista depois: o campo certo
                                    // costuma ser um dos dois primeiros, e rolar 30 opcoes pra
                                    // achar seria pior que digitar a mao.
                                    const ordenados = [
                                        ...a.alternativas,
                                        ...CAMPOS.map(([c]) => c).filter((c) => !a.alternativas.includes(c)),
                                    ];
                                    return (
                                        <div key={a.valor} style={{
                                            border: '1px solid var(--border)', borderRadius: 8,
                                            padding: '10px 12px',
                                            opacity: escolhas[a.valor] ? 1 : 0.55,
                                        }}>
                                            <div style={{ display: 'flex', gap: 10, alignItems: 'center',
                                                          flexWrap: 'wrap' }}>
                                                <code style={{ fontSize: '0.82rem', fontWeight: 600,
                                                               background: 'var(--input-bg)',
                                                               padding: '2px 7px', borderRadius: 4 }}>
                                                    {a.valor}
                                                </code>
                                                {a.ocorrencias > 1 && (
                                                    <span style={{ fontSize: '0.72rem',
                                                                   color: 'var(--color-text-muted)' }}>
                                                        aparece {a.ocorrencias}x
                                                    </span>
                                                )}
                                                <span style={{ marginLeft: 'auto' }} />
                                                <select
                                                    value={escolhas[a.valor] ?? ''}
                                                    onChange={(e) => setEscolhas((x) => ({
                                                        ...x, [a.valor]: e.target.value || null,
                                                    }))}
                                                    style={{ fontSize: '0.78rem', padding: '4px 6px',
                                                             fontFamily: 'ui-monospace, monospace' }}>
                                                    <option value="">não marcar</option>
                                                    {ordenados.map((c) => (
                                                        <option key={c} value={c}>{`{{${c}}}`}</option>
                                                    ))}
                                                </select>
                                            </div>
                                            {a.contexto && (
                                                <p style={{ margin: '6px 0 0', fontSize: '0.74rem',
                                                            color: 'var(--color-text-muted)',
                                                            lineHeight: 1.45 }}>
                                                    {a.contexto}
                                                </p>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </>
                    )}
                </div>

                <div className="modal-footer">
                    <button className="btn-secondary" onClick={onFechar}>Cancelar</button>
                    <button className="btn-primary" disabled={!marcados}
                            onClick={() => onAplicar(aplicar(texto, escolhas))}>
                        Aplicar {marcados > 0 ? `(${marcados})` : ''}
                    </button>
                </div>
            </div>
        </div>
    );
};
import ConectarWhatsApp from './ConectarWhatsApp.jsx';

const WEEK_DAYS = [
    { key: 'mon', label: 'Segunda-feira' },
    { key: 'tue', label: 'Terça-feira' },
    { key: 'wed', label: 'Quarta-feira' },
    { key: 'thu', label: 'Quinta-feira' },
    { key: 'fri', label: 'Sexta-feira' },
    { key: 'sat', label: 'Sábado'       },
    { key: 'sun', label: 'Domingo'       },
];

const DEFAULT_BH = {
    mon: { open: true,  start: '09:00', end: '18:00' },
    tue: { open: true,  start: '09:00', end: '18:00' },
    wed: { open: true,  start: '09:00', end: '18:00' },
    thu: { open: true,  start: '09:00', end: '18:00' },
    fri: { open: true,  start: '09:00', end: '18:00' },
    sat: { open: true,  start: '09:00', end: '12:00' },
    sun: { open: false, start: '09:00', end: '18:00' },
};

const PAYMENT_OPTIONS = [
    'À vista (PIX, transferência)',
    'Cartão de crédito',
    'Cartão de débito',
    'Financiamento bancário',
    'Financiamento próprio da loja',
    'Consórcio',
    'Troca (recebe carro como parte do pagamento)',
    'Boleto',
];

const Settings = () => {
    const { company, updateCompany, profile, user, companySettings, messageTemplates, updateNotificationSettings, refreshCompanySettings } = useAppContext();

    // ── Notificações automáticas (aniversário / lista de espera) ──────────────
    const approvedTemplates = (messageTemplates || []).filter(t => t.status === 'approved');
    const [notif, setNotif] = useState({ birthday_enabled: false, birthday_template_id: '', waiting_list_template_id: '' });
    const [savingNotif, setSavingNotif] = useState(false);
    const saveNotif = async () => {
        setSavingNotif(true);
        await updateNotificationSettings({
            birthday_enabled: notif.birthday_enabled,
            birthday_template_id: notif.birthday_template_id || null,
            waiting_list_template_id: notif.waiting_list_template_id || null,
        });
        setSavingNotif(false);
    };

    // ── Perfil da empresa ─────────────────────────────────────────────────────
    const [localCompany, setLocalCompany] = useState(company);
    const [savingCompany, setSavingCompany]   = useState(false);
    const [savedCompany,  setSavedCompany]    = useState(false);

    const handleCompanyChange = (field, value) =>
        setLocalCompany(prev => ({ ...prev, [field]: value }));

    const saveCompany = async () => {
        setSavingCompany(true);
        await updateCompany(localCompany);
        setSavingCompany(false);
        setSavedCompany(true);
        setTimeout(() => setSavedCompany(false), 2000);
    };

    // ── Horário por dia ───────────────────────────────────────────────────────
    const [bh, setBh]                         = useState(DEFAULT_BH);
    const [apptDuration,    setApptDuration]    = useState('60');
    const [apptInterval,    setApptInterval]    = useState('15');
    const [apptMaxPerSlot,  setApptMaxPerSlot]  = useState('1');
    const [savingSchedule, setSavingSchedule]   = useState(false);
    const [savedSchedule,  setSavedSchedule]    = useState(false);

    const setDayField = (key, field, value) =>
        setBh(prev => ({ ...prev, [key]: { ...prev[key], [field]: value } }));

    const saveSchedule = async () => {
        if (!user?.id) return;
        setSavingSchedule(true);
        await supabase.from('company_settings').update({
            business_hours:            bh,
            appointment_duration:      Number(apptDuration),
            appointment_interval:      Number(apptInterval),
            max_appointments_per_slot: Math.min(10, Math.max(1, Number(apptMaxPerSlot) || 1)),
            updated_at: new Date().toISOString(),
        }).eq('user_id', user.id);
        await refreshCompanySettings();
        setSavingSchedule(false);
        setSavedSchedule(true);
        setTimeout(() => setSavedSchedule(false), 2000);
    };

    // ── Perfil do WhatsApp ────────────────────────────────────────────────────
    const [wpAbout,        setWpAbout]        = useState('');
    const [wpPhotoPreview, setWpPhotoPreview] = useState(null);
    const [wpPhotoFile,    setWpPhotoFile]    = useState(null);
    const [wpPhoneId,      setWpPhoneId]      = useState('');
    const [savingWp,       setSavingWp]       = useState(false);
    const [savedWp,        setSavedWp]        = useState(false);
    const [wpError,        setWpError]        = useState('');
    const wpFileRef = useRef(null);

    // ── Integração WhatsApp (API): IDs editáveis + token cifrado (write-only) ──
    const [wpWabaId,    setWpWabaId]    = useState('');    // whatsapp_business_account_id
    const [wpTokenSet,  setWpTokenSet]  = useState(false); // flag whatsapp_token_set (do contexto)
    const [wpToken,     setWpToken]     = useState('');    // input write-only (limpa após salvar)
    const [savingInteg, setSavingInteg] = useState(false);
    const [savedInteg,  setSavedInteg]  = useState(false);
    const [savingToken, setSavingToken] = useState(false);
    const [tokenMsg,    setTokenMsg]    = useState('');

    const handleWpPhotoChange = (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setWpPhotoFile(file);
        setWpPhotoPreview(URL.createObjectURL(file));
    };

    const updateWhatsAppProfile = async () => {
        if (!user?.id) return;
        setSavingWp(true);
        setSavedWp(false);
        setWpError('');
        try {
            let photoUrl = null;

            // 1. Upload da foto para Supabase Storage (se selecionada)
            if (wpPhotoFile) {
                const ext  = wpPhotoFile.name.split('.').pop();
                const path = `${user.id}/profile.${ext}`;
                const { error: upErr } = await supabase.storage
                    .from('whatsapp-profiles')
                    .upload(path, wpPhotoFile, { upsert: true, contentType: wpPhotoFile.type });
                if (upErr) throw new Error(`Upload falhou: ${upErr.message}`);

                const { data: urlData } = supabase.storage
                    .from('whatsapp-profiles')
                    .getPublicUrl(path);
                photoUrl = urlData?.publicUrl;
            }

            // 2. Salva about na company_settings
            await supabase
                .from('company_settings')
                .update({ whatsapp_about: wpAbout, updated_at: new Date().toISOString() })
                .eq('user_id', user.id);
            await refreshCompanySettings();

            // 3. Chama edge function para atualizar perfil na API do WhatsApp
            const { data: sessionData } = await supabase.auth.getSession();
            const token = sessionData?.session?.access_token;
            const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;

            const res = await fetch(`${supabaseUrl}/functions/v1/update-whatsapp-profile`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({ photo_url: photoUrl, about: wpAbout }),
            });

            if (!res.ok) {
                const txt = await res.text();
                throw new Error(txt || `Erro ${res.status}`);
            }

            setSavedWp(true);
            setTimeout(() => setSavedWp(false), 3000);
        } catch (err) {
            setWpError(err.message || 'Erro ao atualizar perfil do WhatsApp.');
        } finally {
            setSavingWp(false);
        }
    };

    // Phone Number ID + WABA: NÃO são segredo → update direto (RLS protege a linha).
    const saveIntegration = async () => {
        if (!user?.id) return;
        setSavingInteg(true);
        await supabase.from('company_settings').update({
            whatsapp_phone_number_id:     wpPhoneId || null,
            whatsapp_business_account_id: wpWabaId  || null,
            updated_at: new Date().toISOString(),
        }).eq('user_id', user.id);
        await refreshCompanySettings();
        setSavingInteg(false);
        setSavedInteg(true);
        setTimeout(() => setSavedInteg(false), 2000);
    };

    // Token: SEMPRE via Edge Function dedicada (nunca PATCH direto; nunca volta pro front).
    const saveToken = async () => {
        const t = wpToken.trim();
        if (!t) { setTokenMsg('Cole o token antes de salvar.'); return; }
        setSavingToken(true); setTokenMsg('');
        const { data, error } = await supabase.functions.invoke('set-whatsapp-token', { body: { token: t } });
        setSavingToken(false);
        if (error || data?.error) { setTokenMsg(await mensagemDoErro(error, data, 'Erro ao salvar token.')); return; }
        setWpToken('');                 // limpa o input (write-only)
        setWpTokenSet(true);
        setTokenMsg('Token cadastrado ✓');
        await refreshCompanySettings();
    };

    // O supabase.functions.invoke NAO devolve o corpo em `data` quando o status
    // e non-2xx: ele vira FunctionsHttpError e a mensagem especifica da funcao
    // fica presa em error.context. Sem ler dali, o lojista via so "Edge Function
    // returned a non-2xx status code" - que nao diz se foi token com espaco,
    // token curto ou falha do Vault.
    const mensagemDoErro = async (error, data, padrao) => {
        if (data?.error) return data.error;
        try {
            const corpo = await error?.context?.json?.();
            if (corpo?.error) return corpo.error;
        } catch { /* corpo ilegivel: cai no padrao */ }
        return error?.message || padrao;
    };

    const removeToken = async () => {
        setSavingToken(true); setTokenMsg('');
        const { data, error } = await supabase.functions.invoke('set-whatsapp-token', { body: { remove: true } });
        setSavingToken(false);
        if (error || data?.error) { setTokenMsg(await mensagemDoErro(error, data, 'Erro ao remover token.')); return; }
        setWpToken('');
        setWpTokenSet(false);
        setTokenMsg('Token removido — usando o padrão.');
        await refreshCompanySettings();
    };

    // ── Formas de pagamento ───────────────────────────────────────────────────
    const [payMethods, setPayMethods] = useState([]); // opções padrão marcadas
    const [payOther,   setPayOther]   = useState('');  // texto livre adicional
    const [savingPay,  setSavingPay]  = useState(false);
    const [savedPay,   setSavedPay]   = useState(false);

    const togglePay = (label) =>
        setPayMethods(prev =>
            prev.includes(label) ? prev.filter(m => m !== label) : [...prev, label]
        );

    const savePayments = async () => {
        if (!user?.id) return;
        setSavingPay(true);
        const ordered = PAYMENT_OPTIONS.filter(o => payMethods.includes(o)); // ordem estável
        const other   = payOther.trim();
        const methods = [...ordered, ...(other ? [other] : [])];
        await supabase
            .from('company_settings')
            .update({ payment_methods: methods, updated_at: new Date().toISOString() })
            .eq('user_id', user.id);
        await refreshCompanySettings();
        setSavingPay(false);
        setSavedPay(true);
        setTimeout(() => setSavedPay(false), 2000);
    };

    // ── Instagram e Messenger ─────────────────────────────────────────────────
    // Um token POR CANAL: ha loja que so usa o Direct e nunca abre o Messenger,
    // e obrigá-la a conectar uma pagina seria pedir configuracao que ela nao usa.
    const [fbPageId, setFbPageId] = useState('');
    const [igUserId, setIgUserId] = useState('');
    const [igTokenSet, setIgTokenSet] = useState(false);
    const [fbTokenSet, setFbTokenSet] = useState(false);
    const [igToken, setIgToken] = useState('');
    const [fbToken, setFbToken] = useState('');
    const [savingSocial, setSavingSocial] = useState(null);   // 'instagram' | 'messenger' | null
    const [socialMsg, setSocialMsg] = useState({});           // por canal

    const msgCanal = (canal, texto) => setSocialMsg(m => ({ ...m, [canal]: texto }));

    const salvarCanal = async (canal) => {
        if (!user?.id) return;
        setSavingSocial(canal); msgCanal(canal, '');

        const ehIg = canal === 'instagram';
        const id = (ehIg ? igUserId : fbPageId).trim();
        const token = (ehIg ? igToken : fbToken).trim();

        // ID vazio grava NULL, nao string vazia: o webhook procura a loja por
        // esse ID, e vazio casaria com qualquer outro vazio.
        const { error: idErr } = await supabase
            .from('company_settings')
            .update({ [ehIg ? 'ig_user_id' : 'fb_page_id']: id || null, updated_at: new Date().toISOString() })
            .eq('user_id', user.id);

        if (idErr) {
            setSavingSocial(null);
            msgCanal(canal, idErr.message || 'Erro ao salvar o ID.');
            return;
        }

        // Token e opcional aqui: da pra salvar so o ID e colar o token depois.
        if (token) {
            const { data, error } = await supabase.functions.invoke('set-meta-token', { body: { canal, token } });
            if (error || data?.error) {
                setSavingSocial(null);
                msgCanal(canal, await mensagemDoErro(error, data, 'Erro ao salvar token.'));
                return;
            }
            if (ehIg) { setIgToken(''); setIgTokenSet(true); } else { setFbToken(''); setFbTokenSet(true); }
        }

        setSavingSocial(null);
        msgCanal(canal, 'Salvo ✓');
        await refreshCompanySettings();
    };

    const removerTokenCanal = async (canal) => {
        setSavingSocial(canal); msgCanal(canal, '');
        const { data, error } = await supabase.functions.invoke('set-meta-token', { body: { canal, remove: true } });
        setSavingSocial(null);
        if (error || data?.error) {
            msgCanal(canal, await mensagemDoErro(error, data, 'Erro ao remover token.'));
            return;
        }
        if (canal === 'instagram') setIgTokenSet(false); else setFbTokenSet(false);
        msgCanal(canal, 'Token removido.');
        await refreshCompanySettings();
    };

    // ── Contrato de venda ─────────────────────────────────────────────────────
    const [cnpj, setCnpj] = useState('');
    const [modeloContrato, setModeloContrato] = useState('');

    // Logo da loja, usada pelo marcador {{logo}} do contrato.
    const [logoUrl, setLogoUrl] = useState('');
    const [subindoLogo, setSubindoLogo] = useState(false);

    const enviarLogo = async (bruto) => {
        if (!bruto || !user?.id) return;
        // Logo tirada de print no iPhone chega em HEIC igual foto de carro.
        let arquivo = bruto;
        if (ehHeic(bruto)) {
            setSubindoLogo(true);
            try { arquivo = await prepararImagem(bruto); }
            catch { setSubindoLogo(false); alert('Não consegui converter essa imagem. Tente enviar como JPEG ou PNG.'); return; }
        }
        // Limite modesto de propósito: logo é imagem pequena, e arquivo grande
        // só serve pra estourar a primeira página do contrato e demorar a
        // carregar na hora de imprimir.
        if (arquivo.size > 2 * 1024 * 1024) {
            alert('A logo precisa ter menos de 2 MB.');
            return;
        }
        setSubindoLogo(true);
        try {
            const ext = (arquivo.name.split('.').pop() || 'png').toLowerCase();
            // Caminho fixo por loja: subir de novo SUBSTITUI, em vez de deixar
            // arquivos órfãos acumulando no Storage a cada troca de logo.
            const caminho = `logos/${user.id}.${ext}`;
            const { error } = await supabase.storage
                .from('whatsapp-profiles')
                .upload(caminho, arquivo, { upsert: true, contentType: arquivo.type });
            if (error) throw error;

            const { data: pub } = supabase.storage.from('whatsapp-profiles').getPublicUrl(caminho);
            // `?v=` derrota o cache do navegador: sem isso, trocar a logo
            // continuaria imprimindo a antiga até alguém limpar o cache.
            setLogoUrl(`${pub.publicUrl}?v=${Date.now()}`);
        } catch (e) {
            alert(`Não consegui enviar a logo: ${e.message}`);
        } finally {
            setSubindoLogo(false);
        }
    };
    const [savingCtr, setSavingCtr] = useState(false);
    const [savedCtr, setSavedCtr] = useState(false);

    const contratoRef = useRef(null);
    const [assistenteAberto, setAssistenteAberto] = useState(false);

    // Insere o marcador na posicao do cursor. Sem isso o lojista teria que
    // digitar {{comprador_cpf}} a mao, errar uma chave e nao entender por que
    // o campo nao preencheu.
    const inserirCampo = (campo) => {
        const el = contratoRef.current;
        const marcador = `{{${campo}}}`;
        if (!el) { setModeloContrato((t) => t + marcador); return; }
        const ini = el.selectionStart ?? el.value.length;
        const fim = el.selectionEnd ?? ini;
        const novo = el.value.slice(0, ini) + marcador + el.value.slice(fim);
        setModeloContrato(novo);
        // Devolve o foco com o cursor depois do marcador, senao a cada clique
        // ele volta pro fim do texto.
        requestAnimationFrame(() => {
            el.focus();
            const pos = ini + marcador.length;
            el.setSelectionRange(pos, pos);
        });
    };

    const saveContrato = async () => {
        if (!user?.id) return;
        setSavingCtr(true);
        await supabase
            .from('company_settings')
            .update({
                cnpj: cnpj.replace(/\D/g, '') || null,
                // Vazio grava NULL, nao string vazia: NULL significa "usa o
                // padrao do sistema", string vazia geraria contrato em branco.
                contract_template: modeloContrato.trim() || null,
                logo_url: logoUrl || null,
                updated_at: new Date().toISOString(),
            })
            .eq('user_id', user.id);
        await refreshCompanySettings();
        setSavingCtr(false);
        setSavedCtr(true);
        setTimeout(() => setSavedCtr(false), 2000);
    };

    // ── Troca de senha ────────────────────────────────────────────────────────
    // Nao existia em lugar nenhum do sistema: quem esquecia a senha dependia do
    // e-mail de recuperacao, que aponta pra Site URL do projeto — e ela estava
    // em localhost. Aqui o proprio usuario define a nova, ja logado.
    const [senhaNova, setSenhaNova] = useState('');
    const [senhaConf, setSenhaConf] = useState('');
    const [senhaMsg,  setSenhaMsg]  = useState('');
    const [salvandoSenha, setSalvandoSenha] = useState(false);

    const trocarSenha = async () => {
        setSenhaMsg('');
        if (senhaNova.length < 6) { setSenhaMsg('A senha precisa de pelo menos 6 caracteres.'); return; }
        if (senhaNova !== senhaConf) { setSenhaMsg('As duas senhas nao sao iguais.'); return; }
        setSalvandoSenha(true);
        const { error } = await supabase.auth.updateUser({ password: senhaNova });
        setSalvandoSenha(false);
        if (error) { setSenhaMsg(error.message || 'Nao foi possivel alterar a senha.'); return; }
        setSenhaNova(''); setSenhaConf('');
        setSenhaMsg('Senha alterada com sucesso.');
    };

    // ── Funcionamento do bot (liga/desliga + janela de horario) ────────────────
    const [botCfg, setBotCfg] = useState({
        enabled: true, agendado: false, inicio: '08:00', fim: '18:00',
        // Desligado por padrão: loja com equipe grande pode preferir que a
        // conversa espere um humano de verdade, e assumir isso pelo cliente
        // seria o bot atropelando um atendimento em andamento.
        devolver: false, devolverMin: 15,
    });
    const [bloqueados, setBloqueados] = useState([]);
    const [novoBloqueio, setNovoBloqueio] = useState('');
    const [savingBot, setSavingBot] = useState(false);
    const [savedBot,  setSavedBot]  = useState(false);

    // Guarda so os digitos: o mesmo numero digitado de tres jeitos viraria tres
    // entradas na lista, e a loja acharia que bloqueou quando bloqueou o
    // formato.
    const adicionarBloqueio = () => {
        const d = String(novoBloqueio).replace(/\D/g, '');
        if (d.length < 10) return;
        if (!bloqueados.includes(d)) setBloqueados(l => [...l, d]);
        setNovoBloqueio('');
    };

    const saveBotCfg = async () => {
        if (!user?.id) return;
        setSavingBot(true);
        await supabase
            .from('company_settings')
            .update({
                bot_enabled: botCfg.enabled,
                bot_schedule_enabled: botCfg.agendado,
                bot_start: botCfg.inicio,
                bot_end: botCfg.fim,
                auto_return_enabled: botCfg.devolver === true,
                // Piso de 5 minutos: abaixo disso o bot atropela o atendente que
                // so foi buscar uma informacao, e a varredura roda de 5 em 5 —
                // prometer 2 minutos seria promessa que o cron nao cumpre.
                auto_return_minutes: Math.max(5, Number(botCfg.devolverMin) || 15),
                bot_blocked_numbers: bloqueados,
                updated_at: new Date().toISOString(),
            })
            .eq('user_id', user.id);
        await refreshCompanySettings();
        setSavingBot(false);
        setSavedBot(true);
        setTimeout(() => setSavedBot(false), 2000);
    };

    // ── Equipe e contatos de outros setores ───────────────────────────────────
    // Duas listas curtas que o bot passa a conhecer: quem trabalha na loja (pra
    // confirmar quando o cliente cita um nome) e o telefone de cada setor (pra
    // encaminhar consignacao, administrativo etc. em vez de improvisar).
    const [equipe,   setEquipe]   = useState([]);   // [{ nome, funcao }]
    const [contatos, setContatos] = useState([]);   // [{ setor, telefone, quando_usar }]
    const [savingEquipe, setSavingEquipe] = useState(false);
    const [savedEquipe,  setSavedEquipe]  = useState(false);

    const saveEquipe = async () => {
        if (!user?.id) return;
        setSavingEquipe(true);
        // Descarta linha em branco: o lojista adiciona e deixa vazia o tempo
        // todo, e linha vazia no prompt vira ruido pro modelo.
        const time = equipe
            .map(m => ({ nome: (m.nome || '').trim(), funcao: (m.funcao || '').trim() }))
            .filter(m => m.nome);
        const setores = contatos
            .map(c => ({
                setor: (c.setor || '').trim(),
                telefone: (c.telefone || '').trim(),
                quando_usar: (c.quando_usar || '').trim(),
            }))
            .filter(c => c.setor && c.telefone);
        await supabase
            .from('company_settings')
            .update({ team_members: time, department_contacts: setores, updated_at: new Date().toISOString() })
            .eq('user_id', user.id);
        await refreshCompanySettings();
        setEquipe(time); setContatos(setores);
        setSavingEquipe(false);
        setSavedEquipe(true);
        setTimeout(() => setSavedEquipe(false), 2000);
    };

    // ── Financiamento ─────────────────────────────────────────────────────────
    const [financing, setFinancing] = useState({ enabled: false, rate: '', maxInstallments: 48, minDownPct: 20, banks: '' });
    const [savingFin, setSavingFin] = useState(false);
    const [savedFin,  setSavedFin]  = useState(false);

    const saveFinancing = async () => {
        if (!user?.id) return;
        setSavingFin(true);
        await supabase.from('company_settings').update({
            financing_enabled: financing.enabled,
            financing_interest_rate: financing.rate === '' ? null : Number(financing.rate),
            financing_max_installments: Number(financing.maxInstallments) || 48,
            financing_min_down_payment_percent: financing.minDownPct === '' ? null : Number(financing.minDownPct),
            financing_banks: financing.banks || null,
            updated_at: new Date().toISOString(),
        }).eq('user_id', user.id);
        await refreshCompanySettings();
        setSavingFin(false);
        setSavedFin(true);
        setTimeout(() => setSavedFin(false), 2000);
    };

    // ── Comportamento do Bot ──────────────────────────────────────────────────
    const [delayedSched, setDelayedSched] = useState(true);
    const [savingBehav,  setSavingBehav]  = useState(false);
    const [savedBehav,   setSavedBehav]   = useState(false);

    // ── Qualificação FORD (toggles independentes, salvar próprio) ──────────────
    const [ford,       setFord]       = useState({ family: true, occupation: true, recreation: true, financial: true });
    // Cada pergunta da troca liga/desliga sozinha: "nota de 0 a 10" cai bem numa
    // loja e soa estranha em outra. Mesmo padrao do ford acima.
    const [tradeQ, setTradeQ] = useState({ modelo: true, ano: true, km: true, tempo_dono: true, nota: true, pagamento: true });
    // Desligada por padrão: loja que usa outra base de cálculo — ou que não quer
    // número nenhum antes de ver o carro — não pode ter isso ativo sem pedir.
    const [avaliacao, setAvaliacao] = useState({ enabled: false, teto: 90 });
    const [savingFord, setSavingFord] = useState(false);
    const [savedFord,  setSavedFord]  = useState(false);

    // ── Lembrete de Visita (toggle + minutos, salvar próprio) ──────────────────
    const [visitReminder, setVisitReminder] = useState({ enabled: false, minutes: 15 });
    const [savingVR, setSavingVR] = useState(false);
    const [savedVR,  setSavedVR]  = useState(false);

    // ── Pré-avaliação de Carro / Troca (toggle + perguntas extras, salvar próprio) ──
    const [tradeIn, setTradeIn] = useState({ enabled: true, extraQuestions: '' });
    const [savingTI, setSavingTI] = useState(false);
    const [savedTI,  setSavedTI]  = useState(false);

    // ── Hidratação ÚNICA a partir do contexto (companySettings) ────────────────
    // O AppContext já carrega company_settings uma vez (select *). Em vez de cada
    // seção disparar seu próprio fetch (5 queries em paralelo que corriam com o
    // refresh de token → seção vazia até F5), hidratamos tudo daqui. Guardado por
    // ref pra rodar só na 1ª vez que o companySettings fica disponível — assim um
    // refresh pós-save NÃO sobrescreve edições não salvas de outra seção.
    const hydratedRef = useRef(false);
    useEffect(() => {
        if (!companySettings || hydratedRef.current) return;
        hydratedRef.current = true;
        const s = companySettings;

        // Notificações
        setNotif({
            birthday_enabled: !!s.birthday_enabled,
            birthday_template_id: s.birthday_template_id || '',
            waiting_list_template_id: s.waiting_list_template_id || '',
        });
        // Horário / agenda
        if (s.business_hours) setBh({ ...DEFAULT_BH, ...s.business_hours });
        if (s.appointment_duration) setApptDuration(String(s.appointment_duration));
        // != null, nao truthy: 0 = "sem intervalo" e uma escolha valida da loja,
        // e o if antigo a rejeitava. O valor era gravado certo no banco e a tela
        // voltava pra 15 min no reload, parecendo que o salvamento nao pegou.
        if (s.appointment_interval != null) setApptInterval(String(s.appointment_interval));
        if (s.max_appointments_per_slot) setApptMaxPerSlot(String(s.max_appointments_per_slot));
        // WhatsApp
        if (s.whatsapp_about) setWpAbout(s.whatsapp_about);
        if (s.whatsapp_phone_number_id) setWpPhoneId(s.whatsapp_phone_number_id);
        if (s.whatsapp_business_account_id) setWpWabaId(s.whatsapp_business_account_id);
        setWpTokenSet(s.whatsapp_token_set === true);
        // Formas de pagamento
        const pay = Array.isArray(s.payment_methods) ? s.payment_methods : [];
        setPayMethods(pay.filter(m => PAYMENT_OPTIONS.includes(m)));
        setPayOther(pay.filter(m => !PAYMENT_OPTIONS.includes(m)).join(', '));
        // Instagram / Messenger
        setFbPageId(s.fb_page_id ?? '');
        setIgUserId(s.ig_user_id ?? '');
        setIgTokenSet(s.ig_token_set === true);
        setFbTokenSet(s.fb_token_set === true);
        // Contrato
        setCnpj(s.cnpj ?? '');
        setModeloContrato(s.contract_template ?? '');
        setLogoUrl(s.logo_url ?? '');
        // Funcionamento do bot
        setBotCfg({
            enabled:  s.bot_enabled !== false,
            agendado: s.bot_schedule_enabled === true,
            // Postgres devolve time como "08:00:00"; o input type=time quer HH:MM.
            inicio: String(s.bot_start ?? '08:00').slice(0, 5),
            fim:    String(s.bot_end   ?? '18:00').slice(0, 5),
            devolver: s.auto_return_enabled === true,
            devolverMin: Number(s.auto_return_minutes ?? 15),
        });
        setBloqueados(Array.isArray(s.bot_blocked_numbers) ? s.bot_blocked_numbers : []);
        // Equipe e contatos por setor
        setEquipe(Array.isArray(s.team_members) ? s.team_members : []);
        setContatos(Array.isArray(s.department_contacts) ? s.department_contacts : []);
        // Financiamento
        setFinancing({
            enabled: s.financing_enabled === true,
            rate: s.financing_interest_rate ?? '',
            maxInstallments: s.financing_max_installments ?? 48,
            minDownPct: s.financing_min_down_payment_percent ?? 20,
            banks: s.financing_banks ?? '',
        });
        // Comportamento do bot / FORD / lembrete / troca
        setDelayedSched(s.delayed_schedule_enabled !== false);
        setAvaliacao({
            enabled: s.trade_in_valuation_enabled === true,
            teto: Number(s.trade_in_valuation_max_percent ?? 90),
        });
        if (s.trade_in_questions && typeof s.trade_in_questions === 'object') {
            setTradeQ({ ...{ modelo: true, ano: true, km: true, tempo_dono: true, nota: true, pagamento: true }, ...s.trade_in_questions });
        }
        if (s.ford_qualification && typeof s.ford_qualification === 'object') {
            setFord({ family: true, occupation: true, recreation: true, financial: true, ...s.ford_qualification });
        }
        setVisitReminder({
            enabled: s.visit_reminder_enabled === true,
            minutes: Number(s.visit_reminder_minutes_before ?? 15),
        });
        setTradeIn({
            enabled: s.trade_in_evaluation_enabled !== false,
            extraQuestions: s.trade_in_extra_questions || '',
        });
    }, [companySettings]);

    const saveBehavior = async () => {
        if (!user?.id) return;
        setSavingBehav(true);
        await supabase
            .from('company_settings')
            .update({ delayed_schedule_enabled: delayedSched, updated_at: new Date().toISOString() })
            .eq('user_id', user.id);
        await refreshCompanySettings();
        setSavingBehav(false);
        setSavedBehav(true);
        setTimeout(() => setSavedBehav(false), 2000);
    };

    const saveFord = async () => {
        if (!user?.id) return;
        setSavingFord(true);
        await supabase
            .from('company_settings')
            .update({ ford_qualification: ford, updated_at: new Date().toISOString() })
            .eq('user_id', user.id);
        await refreshCompanySettings();
        setSavingFord(false);
        setSavedFord(true);
        setTimeout(() => setSavedFord(false), 2000);
    };

    const saveVisitReminder = async () => {
        if (!user?.id) return;
        setSavingVR(true);
        await supabase
            .from('company_settings')
            .update({
                visit_reminder_enabled: visitReminder.enabled,
                visit_reminder_minutes_before: visitReminder.minutes,
                updated_at: new Date().toISOString(),
            })
            .eq('user_id', user.id);
        await refreshCompanySettings();
        setSavingVR(false);
        setSavedVR(true);
        setTimeout(() => setSavedVR(false), 2000);
    };

    const saveTradeIn = async () => {
        if (!user?.id) return;
        setSavingTI(true);
        await supabase
            .from('company_settings')
            .update({
                trade_in_evaluation_enabled: tradeIn.enabled,
                trade_in_extra_questions: tradeIn.extraQuestions || null,
                trade_in_questions: tradeQ,
                trade_in_valuation_enabled: avaliacao.enabled,
                trade_in_valuation_max_percent: Math.min(100, Math.max(10, Number(avaliacao.teto) || 90)),
                updated_at: new Date().toISOString(),
            })
            .eq('user_id', user.id);
        await refreshCompanySettings();
        setSavingTI(false);
        setSavedTI(true);
        setTimeout(() => setSavedTI(false), 2000);
    };

    // ── Exceções / Feriados ───────────────────────────────────────────────────
    const [exceptions, setExceptions]     = useState([]);
    const [loadingEx,  setLoadingEx]      = useState(true);
    const [showExForm, setShowExForm]     = useState(false);
    const [addingEx,   setAddingEx]       = useState(false);
    const [newEx, setNewEx] = useState({
        date: '', closed: true, start_time: '', end_time: '', note: '',
    });

    useEffect(() => {
        if (!user?.id) return;
        const controller = new AbortController();
        // Watchdog: se pendurar (conexão morta após dormir a aba), aborta e solta o spinner.
        const timer = setTimeout(() => { controller.abort(); setLoadingEx(false); }, 10000);
        supabase
            .from('schedule_exceptions')
            .select('*')
            .eq('user_id', user.id)
            .order('date', { ascending: true })
            .abortSignal(controller.signal)
            .then(({ data }) => {
                if (controller.signal.aborted) return;
                setExceptions(data || []);
            })
            .catch(() => { /* abort/erro: ignora */ })
            .finally(() => {
                clearTimeout(timer);
                if (!controller.signal.aborted) setLoadingEx(false);
            });
        return () => { clearTimeout(timer); controller.abort(); };
    }, [user?.id]);

    const addException = async () => {
        if (!user?.id || !newEx.date) return;
        setAddingEx(true);
        const payload = {
            user_id:    user.id,
            date:       newEx.date,
            closed:     newEx.closed,
            start_time: !newEx.closed && newEx.start_time ? newEx.start_time : null,
            end_time:   !newEx.closed && newEx.end_time   ? newEx.end_time   : null,
            note:       newEx.note || null,
        };
        const { data } = await supabase
            .from('schedule_exceptions')
            .upsert(payload, { onConflict: 'user_id,date' })
            .select()
            .single();
        if (data) {
            setExceptions(prev => {
                const rest = prev.filter(e => e.date !== data.date);
                return [...rest, data].sort((a, b) => a.date.localeCompare(b.date));
            });
            setNewEx({ date: '', closed: true, start_time: '', end_time: '', note: '' });
            setShowExForm(false);
        }
        setAddingEx(false);
    };

    const cancelExForm = () => {
        setShowExForm(false);
        setNewEx({ date: '', closed: true, start_time: '', end_time: '', note: '' });
    };

    const deleteException = async (id) => {
        setExceptions(prev => prev.filter(e => e.id !== id));
        await supabase.from('schedule_exceptions').delete().eq('id', id);
    };

    const formatExDate = (dateStr) => {
        const d = new Date(dateStr + 'T12:00:00');
        return d.toLocaleDateString('pt-BR', {
            weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric',
        });
    };

    // ── Render ────────────────────────────────────────────────────────────────
    return (
        <div className="view-content">
            <header className="view-header">
                <h1>Configurações</h1>
                <p>Personalize o perfil da concessionária e defina as regras de atendimento.</p>
            </header>

            <div className="settings-grid">
                {/* ── Perfil da Empresa ───────────────────────────────────── */}
                <section className="settings-section card">
                    <div className="section-title">
                        <Building2 size={20} />
                        <h2>Perfil da Empresa</h2>
                    </div>
                    <div className="settings-form">
                        {user && (
                            <div className="form-row" style={{ marginBottom: '0.5rem', opacity: 0.7 }}>
                                <div className="form-group">
                                    <label>
                                        <User size={14} style={{ display: 'inline', verticalAlign: 'middle', marginRight: '4px' }} />
                                        Usuário
                                    </label>
                                    <input type="text" value={profile?.full_name || 'Administrador'} disabled style={{ cursor: 'not-allowed' }} />
                                </div>
                                <div className="form-group">
                                    <label>
                                        <Mail size={14} style={{ display: 'inline', verticalAlign: 'middle', marginRight: '4px' }} />
                                        E-mail
                                    </label>
                                    <input type="text" value={user.email} disabled style={{ cursor: 'not-allowed' }} />
                                </div>
                            </div>
                        )}
                        <div className="form-group">
                            <label>Nome da Concessionária</label>
                            <input
                                type="text"
                                value={localCompany.name}
                                onChange={e => handleCompanyChange('name', e.target.value)}
                            />
                        </div>
                        <div className="form-group">
                            <label>Endereço Completo</label>
                            <div className="input-with-icon">
                                <MapPin size={16} />
                                <input
                                    type="text"
                                    value={localCompany.address}
                                    onChange={e => handleCompanyChange('address', e.target.value)}
                                />
                            </div>
                        </div>
                        <div className="form-row">
                            <div className="form-group">
                                <label>Telefone Principal</label>
                                <div className="input-with-icon">
                                    <Phone size={16} />
                                    <input
                                        type="text"
                                        value={localCompany.phone}
                                        onChange={e => handleCompanyChange('phone', e.target.value)}
                                    />
                                </div>
                            </div>
                            <div className="form-group">
                                <label>WhatsApp (Automação)</label>
                                <div className="input-with-icon">
                                    <MessageSquare size={16} />
                                    <input
                                        type="text"
                                        value={localCompany.whatsapp}
                                        onChange={e => handleCompanyChange('whatsapp', e.target.value)}
                                    />
                                </div>
                            </div>
                        </div>
                        <button
                            className="btn-primary"
                            onClick={saveCompany}
                            disabled={savingCompany}
                            style={{ marginTop: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}
                        >
                            {savedCompany
                                ? <><CheckCircle size={18} /> Salvo!</>
                                : savingCompany ? 'Salvando...'
                                : <><Save size={18} /> Salvar Alterações</>}
                        </button>
                    </div>
                </section>

                {/* ── Horário de Funcionamento ────────────────────────────── */}
                <section className="settings-section card">
                    <div className="section-title">
                        <Calendar size={20} />
                        <h2>Horário de Funcionamento</h2>
                    </div>
                    <div className="settings-form">
                        {/* Tabela de dias */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0', marginBottom: '1.5rem' }}>
                            {WEEK_DAYS.map(({ key, label }) => {
                                const day = bh[key] || DEFAULT_BH[key];
                                return (
                                    <div
                                        key={key}
                                        style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '0.75rem',
                                            padding: '0.6rem 0',
                                            borderBottom: '1px solid #f1f5f9',
                                        }}
                                    >
                                        <button
                                            onClick={() => setDayField(key, 'open', !day.open)}
                                            title={day.open ? 'Fechar este dia' : 'Abrir este dia'}
                                            style={{
                                                background: 'none', border: 'none', cursor: 'pointer',
                                                padding: 0, flexShrink: 0, display: 'flex',
                                                color: day.open ? 'var(--color-primary)' : '#94a3b8',
                                            }}
                                        >
                                            {day.open ? <ToggleRight size={26} /> : <ToggleLeft size={26} />}
                                        </button>
                                        <span style={{
                                            width: '130px', flexShrink: 0, fontSize: '0.875rem',
                                            fontWeight: 500,
                                            color: day.open ? 'var(--color-text-main)' : '#94a3b8',
                                        }}>
                                            {label}
                                        </span>
                                        {day.open ? (
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flex: 1 }}>
                                                <input
                                                    type="time"
                                                    value={day.start}
                                                    onChange={e => setDayField(key, 'start', e.target.value)}
                                                    style={{
                                                        padding: '0.35rem 0.5rem', borderRadius: '8px',
                                                        border: '1px solid var(--border)', fontSize: '0.875rem',
                                                        background: 'var(--input-bg)', color: 'var(--text-primary)', flex: 1,
                                                    }}
                                                />
                                                <span style={{ color: '#94a3b8', fontSize: '0.8rem', flexShrink: 0 }}>às</span>
                                                <input
                                                    type="time"
                                                    value={day.end}
                                                    onChange={e => setDayField(key, 'end', e.target.value)}
                                                    style={{
                                                        padding: '0.35rem 0.5rem', borderRadius: '8px',
                                                        border: '1px solid var(--border)', fontSize: '0.875rem',
                                                        background: 'var(--input-bg)', color: 'var(--text-primary)', flex: 1,
                                                    }}
                                                />
                                            </div>
                                        ) : (
                                            <span style={{ color: '#94a3b8', fontSize: '0.82rem', fontStyle: 'italic' }}>
                                                Fechado
                                            </span>
                                        )}
                                    </div>
                                );
                            })}
                        </div>

                        {/* Duração, intervalo e visitas simultâneas */}
                        <div className="form-row">
                            <div className="form-group">
                                <label>Duração da Visita</label>
                                <select value={apptDuration} onChange={e => setApptDuration(e.target.value)}>
                                    <option value="30">30 minutos</option>
                                    <option value="60">1 hora</option>
                                    <option value="90">1 hora e 30 min</option>
                                </select>
                            </div>
                            <div className="form-group">
                                <label>Intervalo entre Visitas</label>
                                <select value={apptInterval} onChange={e => setApptInterval(e.target.value)}>
                                    <option value="0">Sem intervalo</option>
                                    <option value="15">15 minutos</option>
                                    <option value="30">30 minutos</option>
                                </select>
                            </div>
                        </div>
                        <div className="form-group">
                            <label>Visitas simultâneas por horário</label>
                            <input
                                type="number"
                                min="1"
                                max="10"
                                value={apptMaxPerSlot}
                                onChange={e => setApptMaxPerSlot(e.target.value)}
                            />
                            <p style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', marginTop: '-0.25rem', lineHeight: 1.5 }}>
                                Útil para concessionárias com mais de um vendedor disponível ao mesmo tempo. Padrão: 1.
                            </p>
                        </div>

                        <button
                            className="btn-primary"
                            onClick={saveSchedule}
                            disabled={savingSchedule}
                            style={{ marginTop: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}
                        >
                            {savedSchedule
                                ? <><CheckCircle size={18} /> Salvo!</>
                                : savingSchedule ? 'Salvando...'
                                : <><Save size={18} /> Salvar Agenda</>}
                        </button>
                    </div>
                </section>
            </div>

            {/* ── Perfil do WhatsApp ─────────────────────────────────────────── */}
            <div style={{ marginTop: '2rem' }}>
                <section className="settings-section card">
                    <div className="section-title">
                        <MessageSquare size={20} />
                        <h2>Perfil do WhatsApp</h2>
                    </div>
                    <div className="settings-form">
                        <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', marginBottom: '1rem', lineHeight: 1.5 }}>
                            Atualize a foto e a descrição que aparecem no perfil do número de WhatsApp da concessionária.
                            Requer a API do WhatsApp Business (Meta Cloud API).
                        </p>

                        {/* Foto */}
                        <div className="form-group">
                            <label>Foto do Perfil</label>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                                <div
                                    onClick={() => wpFileRef.current?.click()}
                                    style={{
                                        width: 80, height: 80, borderRadius: '50%',
                                        border: '2px dashed var(--border)', background: 'var(--input-bg)',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        cursor: 'pointer', overflow: 'hidden', flexShrink: 0,
                                    }}
                                >
                                    {wpPhotoPreview
                                        ? <img src={wpPhotoPreview} alt="Preview" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                        : <ImageIcon size={24} color="#94a3b8" />}
                                </div>
                                <div>
                                    <button
                                        className="btn-outline"
                                        onClick={() => wpFileRef.current?.click()}
                                        style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem' }}
                                    >
                                        <Upload size={14} /> Escolher foto
                                    </button>
                                    <p style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: '0.35rem' }}>
                                        JPEG ou PNG, máx. 5 MB
                                    </p>
                                </div>
                                <input
                                    ref={wpFileRef}
                                    type="file"
                                    accept="image/jpeg,image/png"
                                    style={{ display: 'none' }}
                                    onChange={handleWpPhotoChange}
                                />
                            </div>
                        </div>

                        {/* Descrição */}
                        <div className="form-group">
                            <label>Descrição (about)</label>
                            <textarea
                                rows={3}
                                value={wpAbout}
                                onChange={e => setWpAbout(e.target.value)}
                                maxLength={139}
                                placeholder="Ex: Sua concessionária de confiança. Carros novos e seminovos com as melhores condições."
                                style={{ resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.6 }}
                            />
                            <p style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: '-0.25rem' }}>
                                {wpAbout.length}/139 caracteres
                            </p>
                        </div>

                        {wpError && (
                            <p style={{ fontSize: '0.85rem', color: '#ef4444', marginBottom: '0.5rem' }}>{wpError}</p>
                        )}

                        <button
                            className="btn-primary"
                            onClick={updateWhatsAppProfile}
                            disabled={savingWp}
                            style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
                        >
                            {savedWp
                                ? <><CheckCircle size={18} /> Atualizado!</>
                                : savingWp
                                    ? <><RefreshCw size={18} style={{ animation: 'spin 1s linear infinite' }} /> Atualizando...</>
                                    : <><MessageSquare size={18} /> Atualizar no WhatsApp</>}
                        </button>
                    </div>
                </section>
            </div>

            {/* ── Integração WhatsApp (API) ──────────────────────────────────── */}
            <div style={{ marginTop: '2rem' }}>
                {/* Embedded Signup: caminho recomendado. Os campos manuais
                    abaixo ficam como alternativa pra quem ja configurou na mao. */}
                <ConectarWhatsApp />

                <section className="settings-section card">
                    <div className="section-title">
                        <MessageSquare size={20} />
                        <h2>Integração WhatsApp (API)</h2>
                    </div>
                    <div className="settings-form">
                        <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', marginBottom: '1rem', lineHeight: 1.5 }}>
                            Credenciais da API do WhatsApp Business (Meta Cloud API) desta concessionária.
                            O token fica <strong>criptografado</strong> e nunca é exibido de volta.
                        </p>

                        <div className="form-group">
                            <label>Phone Number ID</label>
                            <input type="text" value={wpPhoneId}
                                onChange={e => setWpPhoneId(e.target.value)}
                                placeholder="Ex: 123456789012345" />
                        </div>
                        <div className="form-group">
                            <label>WhatsApp Business Account ID (WABA)</label>
                            <input type="text" value={wpWabaId}
                                onChange={e => setWpWabaId(e.target.value)}
                                placeholder="Ex: 987654321098765" />
                        </div>
                        <button className="btn-outline" onClick={saveIntegration} disabled={savingInteg}
                            style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.5rem' }}>
                            {savedInteg ? <><CheckCircle size={16} /> Salvo!</>
                                : savingInteg ? <><RefreshCw size={16} style={{ animation: 'spin 1s linear infinite' }} /> Salvando...</>
                                : <><Save size={16} /> Salvar IDs</>}
                        </button>

                        <div className="form-group">
                            <label>Token de acesso (WhatsApp Cloud API)</label>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem',
                                fontSize: '0.85rem', color: wpTokenSet ? '#16a34a' : 'var(--color-text-muted)' }}>
                                {wpTokenSet
                                    ? <><CheckCircle size={16} /> Token próprio cadastrado</>
                                    : <span>Nenhum token próprio — usando o token padrão da agência.</span>}
                            </div>
                            <input type="password" value={wpToken}
                                onChange={e => setWpToken(e.target.value)}
                                autoComplete="new-password"
                                placeholder={wpTokenSet ? 'Cole um novo token para substituir' : 'Cole o token do WhatsApp Cloud API'} />
                            <p style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: '-0.25rem' }}>
                                Por segurança, o token salvo não é exibido de volta. Deixe em branco para manter o atual.
                            </p>
                        </div>

                        {tokenMsg && (
                            <p style={{ fontSize: '0.85rem', marginBottom: '0.5rem',
                                color: (tokenMsg.includes('✓') || tokenMsg.includes('removido')) ? '#16a34a' : '#ef4444' }}>
                                {tokenMsg}
                            </p>
                        )}

                        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                            <button className="btn-primary" onClick={saveToken} disabled={savingToken || !wpToken.trim()}
                                style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                {savingToken ? <><RefreshCw size={18} style={{ animation: 'spin 1s linear infinite' }} /> Salvando...</>
                                    : <><Save size={18} /> Salvar token</>}
                            </button>
                            {wpTokenSet && (
                                <button className="btn-outline" onClick={removeToken} disabled={savingToken}
                                    style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#ef4444' }}>
                                    <Trash2 size={16} /> Remover token
                                </button>
                            )}
                        </div>
                    </div>
                </section>
            </div>

            {/* ── Formas de Pagamento ────────────────────────────────────────── */}
            <div style={{ marginTop: '2rem' }}>
                <section className="settings-section card">
                    <div className="section-title">
                        <CreditCard size={20} />
                        <h2>Formas de Pagamento</h2>
                    </div>
                    <div className="settings-form">
                        <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', marginBottom: '1rem', lineHeight: 1.5 }}>
                            Marque as formas de pagamento que a concessionária aceita. O assistente
                            usa essa lista ao responder dúvidas sobre pagamento — e não inventa
                            formas que não estejam marcadas aqui.
                        </p>

                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '0.5rem', marginBottom: '1rem' }}>
                            {PAYMENT_OPTIONS.map(label => {
                                const checked = payMethods.includes(label);
                                return (
                                    <label
                                        key={label}
                                        style={{
                                            display: 'flex', alignItems: 'center', gap: '0.6rem',
                                            padding: '0.6rem 0.85rem', borderRadius: '10px',
                                            border: `1px solid ${checked ? 'var(--color-primary)' : 'var(--border)'}`,
                                            background: checked ? 'rgba(37,99,235,0.06)' : 'var(--input-bg)',
                                            cursor: 'pointer', fontSize: '0.875rem', transition: 'all 0.15s',
                                        }}
                                    >
                                        <input
                                            type="checkbox"
                                            checked={checked}
                                            onChange={() => togglePay(label)}
                                            style={{ width: 16, height: 16, flexShrink: 0, accentColor: 'var(--color-primary)' }}
                                        />
                                        <span>{label}</span>
                                    </label>
                                );
                            })}
                        </div>

                        <div className="form-group">
                            <label>Outras opções (opcional)</label>
                            <input
                                type="text"
                                value={payOther}
                                onChange={e => setPayOther(e.target.value)}
                                placeholder="Ex: Criptomoeda, cheque pré-datado"
                            />
                            <p style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', marginTop: '-0.25rem', lineHeight: 1.5 }}>
                                Formas adicionais que a loja aceita e não estão na lista acima.
                            </p>
                        </div>

                        <button
                            className="btn-primary"
                            onClick={savePayments}
                            disabled={savingPay}
                            style={{ marginTop: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}
                        >
                            {savedPay
                                ? <><CheckCircle size={18} /> Salvo!</>
                                : savingPay ? 'Salvando...'
                                : <><Save size={18} /> Salvar Formas de Pagamento</>}
                        </button>
                    </div>
                </section>
            </div>

            {/* -- Instagram e Messenger ---------------------------------------- */}
            <div style={{ marginTop: '2rem' }}>
                <section className="settings-section card">
                    <div className="section-title">
                        <MessageSquare size={20} />
                        <h2>Instagram e Messenger</h2>
                    </div>
                    <div className="settings-form">
                        <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', marginBottom: '1.25rem', lineHeight: 1.5 }}>
                            O mesmo bot atende também no Direct do Instagram e no Messenger.
                            Os dois são independentes — conecte só o que a loja usa.
                        </p>

                        {[
                            {
                                canal: 'instagram',
                                titulo: 'Instagram Direct',
                                rotuloId: 'ID da conta do Instagram',
                                dica: 'É o ID da conta comercial, não o @ do perfil.',
                                placeholder: 'Ex: 17841400000000000',
                                id: igUserId, setId: setIgUserId,
                                token: igToken, setToken: setIgToken,
                                temToken: igTokenSet,
                            },
                            {
                                canal: 'messenger',
                                titulo: 'Messenger',
                                rotuloId: 'ID da página do Facebook',
                                dica: 'A página que recebe as mensagens.',
                                placeholder: 'Ex: 100000000000000',
                                id: fbPageId, setId: setFbPageId,
                                token: fbToken, setToken: setFbToken,
                                temToken: fbTokenSet,
                            },
                        ].map((c) => (
                            <div key={c.canal} style={{
                                border: '1px solid var(--border)', borderRadius: 10,
                                padding: '14px 16px', marginBottom: 14,
                            }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                                    <strong style={{ fontSize: '0.9rem' }}>{c.titulo}</strong>
                                    <span style={{
                                        fontSize: '0.7rem', fontWeight: 700, padding: '1px 8px', borderRadius: 999,
                                        background: c.temToken && c.id ? '#dcfce7' : 'var(--input-bg)',
                                        color: c.temToken && c.id ? '#15803d' : 'var(--color-text-muted)',
                                    }}>
                                        {c.temToken && c.id ? 'conectado' : 'não conectado'}
                                    </span>
                                </div>

                                <div className="form-group">
                                    <label>{c.rotuloId}</label>
                                    <input type="text" value={c.id} placeholder={c.placeholder}
                                        onChange={e => c.setId(e.target.value)} />
                                    <p style={{ fontSize: '0.76rem', color: 'var(--color-text-muted)', marginTop: 4 }}>
                                        {c.dica}
                                    </p>
                                </div>

                                <div className="form-group">
                                    <label>Token de acesso</label>
                                    {c.temToken && (
                                        <p style={{ fontSize: '0.8rem', color: '#15803d', display: 'flex', alignItems: 'center', gap: 5, margin: '0 0 6px' }}>
                                            <CheckCircle size={14} /> Token cadastrado
                                        </p>
                                    )}
                                    <input type="password" value={c.token} autoComplete="new-password"
                                        placeholder={c.temToken ? 'Em branco mantém o atual' : 'Cole o token'}
                                        onChange={e => c.setToken(e.target.value)} />
                                </div>

                                {socialMsg[c.canal] && (
                                    <p style={{ fontSize: '0.82rem', margin: '0 0 8px',
                                                color: socialMsg[c.canal].includes('✓') ? '#15803d' : '#dc2626' }}>
                                        {socialMsg[c.canal]}
                                    </p>
                                )}

                                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                                    <button className="btn-primary" onClick={() => salvarCanal(c.canal)}
                                        disabled={savingSocial === c.canal}
                                        style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                        <Save size={16} /> {savingSocial === c.canal ? 'Salvando...' : 'Salvar'}
                                    </button>
                                    {c.temToken && (
                                        <button className="btn-secondary" onClick={() => removerTokenCanal(c.canal)}
                                            disabled={savingSocial === c.canal} style={{ color: '#dc2626' }}>
                                            Remover token
                                        </button>
                                    )}
                                </div>
                            </div>
                        ))}

                        <div style={{ padding: '10px 12px', borderRadius: 8,
                                      background: 'var(--input-bg)', border: '1px solid var(--border)' }}>
                            <p style={{ margin: '0 0 6px', fontSize: '0.8rem', fontWeight: 600 }}>
                                Falta configurar na Meta
                            </p>
                            <p style={{ margin: 0, fontSize: '0.76rem', color: 'var(--color-text-muted)', lineHeight: 1.6 }}>
                                No app da Meta, aponte o webhook de cada canal para:
                            </p>
                            <code style={{ display: 'block', marginTop: 6, fontSize: '0.72rem', wordBreak: 'break-all',
                                           padding: '6px 8px', borderRadius: 6, background: 'var(--bg-main)' }}>
                                {import.meta.env.VITE_SUPABASE_URL}/functions/v1/social-webhook
                            </code>
                            <p style={{ margin: '6px 0 0', fontSize: '0.76rem', color: 'var(--color-text-muted)', lineHeight: 1.6 }}>
                                O token de verificação é o mesmo do WhatsApp. Assine o campo{' '}
                                <strong>messages</strong> em cada canal — sem isso o webhook fica válido
                                e nenhuma mensagem chega.
                            </p>
                        </div>
                    </div>
                </section>
            </div>

            {/* -- Contrato de Venda -------------------------------------------- */}
            <div style={{ marginTop: '2rem' }}>
                <section className="settings-section card">
                    <div className="section-title">
                        <Save size={20} />
                        <h2>Contrato de Venda</h2>
                    </div>
                    <div className="settings-form">
                        <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', marginBottom: '1rem', lineHeight: 1.5 }}>
                            Ao registrar uma venda com nome e CPF do comprador, o contrato é montado
                            e fica pronto pra imprimir.
                        </p>

                        <div className="form-group">
                            <label>CNPJ da loja</label>
                            <input type="text" value={formatarCNPJ(cnpj)} placeholder="00.000.000/0000-00"
                                onChange={e => setCnpj(e.target.value)} />
                        </div>

                        <div className="form-group">
                            {/* Logo. Fica junto do contrato, e não em "dados da
                                empresa", porque é aqui que ela é usada — quem
                                sobe a logo está pensando no papel que vai
                                imprimir. */}
                            <label>Logo da loja</label>
                            <p style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)', margin: '0 0 8px', lineHeight: 1.5 }}>
                                Aparece no contrato onde você escrever <code>{'{{logo}}'}</code>.
                                PNG ou JPG, até 2 MB.
                            </p>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 18, flexWrap: 'wrap' }}>
                                {logoUrl ? (
                                    <img src={logoUrl} alt="Logo da loja"
                                        style={{
                                            maxHeight: 56, maxWidth: 180, objectFit: 'contain',
                                            border: '1px solid var(--border)', borderRadius: 8, padding: 6,
                                            background: '#fff',
                                        }} />
                                ) : (
                                    <div style={{
                                        height: 56, width: 120, display: 'flex', alignItems: 'center',
                                        justifyContent: 'center', border: '1px dashed var(--border)',
                                        borderRadius: 8, fontSize: '0.72rem', color: 'var(--color-text-muted)',
                                    }}>
                                        sem logo
                                    </div>
                                )}

                                <label className="btn-outline" style={{ cursor: 'pointer', margin: 0 }}>
                                    {subindoLogo ? 'Enviando…' : logoUrl ? 'Trocar logo' : 'Enviar logo'}
                                    <input type="file" accept="image/png,image/jpeg,image/webp,image/heic,image/heif,.heic,.heif" hidden
                                        disabled={subindoLogo}
                                        onChange={(e) => { enviarLogo(e.target.files?.[0]); e.target.value = ''; }} />
                                </label>

                                {logoUrl && (
                                    <button type="button" className="btn-secondary"
                                        onClick={() => setLogoUrl('')}
                                        style={{ fontSize: '0.78rem' }}>
                                        Remover
                                    </button>
                                )}
                            </div>

                            <label>Modelo do contrato</label>
                            <p style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)', margin: '0 0 8px', lineHeight: 1.5 }}>
                                Cole aqui o contrato da sua loja — pode ser texto simples, copiado
                                direto do Word. Em branco, o sistema usa o modelo genérico.
                                Use <code>{'{{logo}}'}</code> no topo e <code>{'{{assinaturas}}'}</code> no
                                fim: o sistema desenha a imagem e as duas colunas de assinatura,
                                que texto puro não consegue fazer.
                            </p>
                            <textarea
                                ref={contratoRef}
                                rows={14}
                                value={modeloContrato}
                                placeholder="Cole o contrato da sua loja, ou deixe em branco para usar o genérico"
                                onChange={e => setModeloContrato(e.target.value)}
                                style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.78rem', lineHeight: 1.55 }}
                            />
                            <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                                <button type="button" className="btn-secondary"
                                    style={{ fontSize: '0.8rem' }}
                                    onClick={() => setModeloContrato(MODELO_PADRAO)}>
                                    Carregar o modelo padrão para editar
                                </button>
                                <button type="button" className="btn-secondary"
                                    style={{ fontSize: '0.8rem' }}
                                    disabled={!modeloContrato.trim()}
                                    title="Cole um contrato já preenchido e o sistema propõe os campos"
                                    onClick={() => setAssistenteAberto(true)}>
                                    Marcar campos automaticamente
                                </button>
                            </div>

                            {assistenteAberto && (
                                <AssistenteMarcadores
                                    texto={modeloContrato}
                                    onFechar={() => setAssistenteAberto(false)}
                                    onAplicar={(novo) => {
                                        setModeloContrato(novo);
                                        setAssistenteAberto(false);
                                        addToast('Campos marcados. Confira o texto antes de salvar.', 'success');
                                    }}
                                />
                            )}
                        </div>

                        <div className="form-group">
                            <label>Campos disponíveis</label>
                            <p style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)', margin: '0 0 8px' }}>
                                Clique para inserir onde o cursor estiver. O sistema preenche na
                                hora da venda.
                            </p>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                                {CAMPOS.map(([campo, rotulo]) => (
                                    <button key={campo} type="button" title={`Inserir ${rotulo}`}
                                        onClick={() => inserirCampo(campo)}
                                        style={{ fontSize: '0.72rem', fontFamily: 'ui-monospace, monospace',
                                                 padding: '3px 8px', borderRadius: 5, cursor: 'pointer',
                                                 background: 'var(--input-bg)', border: '1px solid var(--border)',
                                                 color: 'var(--color-text)' }}>
                                        {`{{${campo}}}`}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <p style={{ fontSize: '0.78rem', color: '#b45309', background: '#fffbeb',
                                    border: '1px solid #fde68a', borderRadius: 8, padding: '9px 12px', lineHeight: 1.5 }}>
                            O modelo padrão é um ponto de partida, não uma peça jurídica pronta.
                            Passe pelo seu advogado antes de usar com cliente.
                        </p>

                        <button className="btn-primary" onClick={saveContrato} disabled={savingCtr}
                            style={{ marginTop: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            {savedCtr
                                ? <><CheckCircle size={18} /> Salvo!</>
                                : savingCtr ? 'Salvando...'
                                : <><Save size={18} /> Salvar Contrato</>}
                        </button>
                    </div>
                </section>
            </div>

            {/* -- Senha -------------------------------------------------------- */}
            <div style={{ marginTop: '2rem' }}>
                <section className="settings-section card">
                    <div className="section-title">
                        <User size={20} />
                        <h2>Alterar Senha</h2>
                    </div>
                    <div className="settings-form">
                        <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', marginBottom: '1rem', lineHeight: 1.5 }}>
                            Define uma nova senha de acesso. Voce continua logado depois de trocar.
                        </p>
                        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                            <div className="form-group" style={{ flex: '1 1 200px' }}>
                                <label>Nova senha</label>
                                <input type="password" value={senhaNova} autoComplete="new-password"
                                    placeholder="Minimo 6 caracteres"
                                    onChange={e => setSenhaNova(e.target.value)} />
                            </div>
                            <div className="form-group" style={{ flex: '1 1 200px' }}>
                                <label>Repita a nova senha</label>
                                <input type="password" value={senhaConf} autoComplete="new-password"
                                    onChange={e => setSenhaConf(e.target.value)} />
                            </div>
                        </div>
                        {senhaMsg && (
                            <p style={{ fontSize: '0.82rem', marginTop: 4, color: senhaMsg.includes('sucesso') ? '#15803d' : '#dc2626' }}>
                                {senhaMsg}
                            </p>
                        )}
                        <button className="btn-primary" onClick={trocarSenha} disabled={salvandoSenha}
                            style={{ marginTop: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            {salvandoSenha ? 'Salvando...' : <><Save size={18} /> Alterar Senha</>}
                        </button>
                    </div>
                </section>
            </div>

            {/* -- Verificacao em duas etapas ----------------------------------- */}
            <div style={{ marginTop: '2rem' }}>
                <DoisFatores />
            </div>

            {/* ── Funcionamento do Bot ───────────────────────────────────────── */}
            <div style={{ marginTop: '2rem' }}>
                <section className="settings-section card">
                    <div className="section-title">
                        <Bot size={20} />
                        <h2>Funcionamento do Bot</h2>
                    </div>
                    <div className="settings-form">
                        {companySettings?.bot_contratado === false && (
                            // Aviso, nao trava. A trava de verdade e no servidor e no banco —
                            // esconder controle na tela nao impede ninguem de chamar a API.
                            <p style={{ fontSize: '0.82rem', color: '#0369a1', background: '#e0f2fe',
                                        border: '1px solid #bae6fd', borderRadius: 8,
                                        padding: '10px 12px', lineHeight: 1.5, marginBottom: 14 }}>
                                O bot não faz parte do seu plano. As configurações abaixo ficam
                                salvas, mas ele não responde. Fale com a gente para incluir.
                            </p>
                        )}
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 14,
                                      opacity: companySettings?.bot_contratado === false ? 0.5 : 1 }}>
                            <button type="button" onClick={() => setBotCfg(b => ({ ...b, enabled: !b.enabled }))}
                                title={botCfg.enabled ? 'Desativar' : 'Ativar'}
                                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, flexShrink: 0, color: botCfg.enabled ? '#10b981' : '#94a3b8' }}>
                                {botCfg.enabled ? <ToggleRight size={26} /> : <ToggleLeft size={26} />}
                            </button>
                            <div>
                                <span style={{ fontSize: '0.9rem', fontWeight: 500 }}>Bot ativo</span>
                                <p style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>
                                    Desligado, ele nao responde nunca. As mensagens continuam chegando e a
                                    conversa fica marcada como pendente pra equipe ver.
                                </p>
                            </div>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 10, opacity: botCfg.enabled ? 1 : 0.45 }}>
                            <button type="button" disabled={!botCfg.enabled}
                                onClick={() => setBotCfg(b => ({ ...b, agendado: !b.agendado }))}
                                title={botCfg.agendado ? 'Desativar' : 'Ativar'}
                                style={{ background: 'none', border: 'none', cursor: botCfg.enabled ? 'pointer' : 'not-allowed', padding: 0, flexShrink: 0, color: botCfg.agendado ? '#10b981' : '#94a3b8' }}>
                                {botCfg.agendado ? <ToggleRight size={26} /> : <ToggleLeft size={26} />}
                            </button>
                            <div>
                                <span style={{ fontSize: '0.9rem', fontWeight: 500 }}>Responder so em determinado horario</span>
                                <p style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>
                                    Fora da janela o bot fica calado e a conversa vai pra pendente.
                                </p>
                            </div>
                        </div>

                        {botCfg.enabled && botCfg.agendado && (
                            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 10 }}>
                                <div className="form-group" style={{ flex: '1 1 140px' }}>
                                    <label>Comeca as</label>
                                    <input type="time" value={botCfg.inicio}
                                        onChange={e => setBotCfg(b => ({ ...b, inicio: e.target.value }))} />
                                </div>
                                <div className="form-group" style={{ flex: '1 1 140px' }}>
                                    <label>Para as</label>
                                    <input type="time" value={botCfg.fim}
                                        onChange={e => setBotCfg(b => ({ ...b, fim: e.target.value }))} />
                                </div>
                            </div>
                        )}

                        {botCfg.enabled && botCfg.agendado && botCfg.inicio > botCfg.fim && (
                            <p style={{ fontSize: '0.8rem', color: '#0369a1', background: '#e0f2fe', padding: '8px 12px', borderRadius: 8, lineHeight: 1.5 }}>
                                Essa janela atravessa a meia-noite: o bot responde das {botCfg.inicio} ate a
                                meia-noite e da meia-noite ate as {botCfg.fim} do dia seguinte.
                            </p>
                        )}

                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10,
                                      marginTop: 14, marginBottom: 10,
                                      paddingTop: 14, borderTop: '1px solid var(--border)',
                                      opacity: botCfg.enabled ? 1 : 0.45 }}>
                            <button type="button" disabled={!botCfg.enabled}
                                onClick={() => setBotCfg(b => ({ ...b, devolver: !b.devolver }))}
                                title={botCfg.devolver ? 'Desativar' : 'Ativar'}
                                style={{ background: 'none', border: 'none',
                                         cursor: botCfg.enabled ? 'pointer' : 'not-allowed',
                                         padding: 0, flexShrink: 0,
                                         color: botCfg.devolver ? '#10b981' : '#94a3b8' }}>
                                {botCfg.devolver ? <ToggleRight size={26} /> : <ToggleLeft size={26} />}
                            </button>
                            <div>
                                <span style={{ fontSize: '0.9rem', fontWeight: 500 }}>
                                    Devolver ao bot se o atendente parar de responder
                                </span>
                                <p style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>
                                    O atendente assume, some, e a conversa fica travada em
                                    &quot;humano&quot; pra sempre — o cliente não recebe mais nada e
                                    ninguém percebe. Com isto ligado, o bot retoma sozinho.
                                </p>
                            </div>
                        </div>

                        {botCfg.enabled && botCfg.devolver && (
                            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end',
                                          flexWrap: 'wrap', marginBottom: 10 }}>
                                <div className="form-group" style={{ flex: '0 1 150px', marginBottom: 0 }}>
                                    <label>Depois de quantos minutos</label>
                                    <input type="number" min="5" max="240" value={botCfg.devolverMin}
                                        onChange={e => setBotCfg(b => ({ ...b, devolverMin: e.target.value }))} />
                                </div>
                                <p style={{ fontSize: '0.76rem', color: 'var(--color-text-muted)',
                                            flex: '1 1 220px', margin: '0 0 4px' }}>
                                    Conta a partir da última mensagem da conversa. Se o cliente
                                    estiver esperando, o bot responde na hora que retomar.
                                </p>
                            </div>
                        )}

                        <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
                            <span style={{ fontSize: '0.9rem', fontWeight: 500 }}>
                                Números que o bot nunca responde
                            </span>
                            <p style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)', margin: '2px 0 10px' }}>
                                O número da equipe, do contador, do guincho, do fornecedor. A mensagem
                                continua aparecendo em Conversas — só o bot fica calado.
                            </p>

                            {bloqueados.length > 0 && (
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                                    {bloqueados.map((n) => (
                                        <span key={n} style={{ display: 'inline-flex', alignItems: 'center', gap: 6,
                                                               fontSize: '0.8rem', padding: '3px 6px 3px 10px',
                                                               borderRadius: 999, background: 'var(--input-bg)',
                                                               border: '1px solid var(--border)',
                                                               fontFamily: 'ui-monospace, monospace' }}>
                                            {n}
                                            <button type="button" title="Remover"
                                                onClick={() => setBloqueados(l => l.filter(x => x !== n))}
                                                style={{ background: 'none', border: 'none', cursor: 'pointer',
                                                         color: '#dc2626', display: 'flex', padding: 2 }}>
                                                <X size={13} />
                                            </button>
                                        </span>
                                    ))}
                                </div>
                            )}

                            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                                <div className="form-group" style={{ flex: '0 1 200px', marginBottom: 0 }}>
                                    <label>Telefone</label>
                                    <input type="tel" placeholder="(15) 98837-2081"
                                        value={novoBloqueio}
                                        onChange={e => setNovoBloqueio(e.target.value)}
                                        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); adicionarBloqueio(); } }} />
                                </div>
                                <button type="button" className="btn-secondary" onClick={adicionarBloqueio}
                                    disabled={novoBloqueio.replace(/\D/g, '').length < 10}>
                                    Adicionar
                                </button>
                            </div>
                            <p style={{ fontSize: '0.74rem', color: 'var(--color-text-muted)', margin: '8px 0 0' }}>
                                Pode digitar como quiser: a comparação ignora DDI, parênteses e o nono dígito.
                            </p>
                        </div>

                        <button
                            className="btn-primary"
                            onClick={saveBotCfg}
                            disabled={savingBot}
                            style={{ marginTop: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}
                        >
                            {savedBot
                                ? <><CheckCircle size={18} /> Salvo!</>
                                : savingBot ? 'Salvando...'
                                : <><Save size={18} /> Salvar Funcionamento</>}
                        </button>
                    </div>
                </section>
            </div>

            {/* -- Equipe e Outros Setores --------------------------------- */}
            <div style={{ marginTop: '2rem' }}>
                <section className="settings-section card">
                    <div className="section-title">
                        <User size={20} />
                        <h2>Equipe e Outros Setores</h2>
                    </div>
                    <div className="settings-form">
                        <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', marginBottom: '1rem', lineHeight: 1.5 }}>
                            O bot usa estas listas pra reconhecer quem trabalha na loja e pra encaminhar
                            assuntos que nao sao de vendas ao numero certo.
                        </p>

                        <div className="form-group">
                            <label>Equipe da loja</label>
                            <p style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', margin: '0 0 0.75rem', lineHeight: 1.5 }}>
                                Quando o cliente cita alguem, o bot confirma que a pessoa e da equipe. Se o
                                nome nao estiver aqui, ele nao nega -- passa pra um atendente.
                            </p>
                            {equipe.map((m, i) => (
                                <div key={i} style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
                                    <input
                                        type="text" value={m.nome || ''} placeholder="Nome"
                                        style={{ flex: 2 }}
                                        onChange={e => setEquipe(equipe.map((x, j) => j === i ? { ...x, nome: e.target.value } : x))}
                                    />
                                    <input
                                        type="text" value={m.funcao || ''} placeholder="Funcao (ex: Vendedor)"
                                        style={{ flex: 2 }}
                                        onChange={e => setEquipe(equipe.map((x, j) => j === i ? { ...x, funcao: e.target.value } : x))}
                                    />
                                    <button
                                        type="button" className="btn-icon" title="Remover"
                                        onClick={() => setEquipe(equipe.filter((_, j) => j !== i))}
                                    >
                                        <Trash2 size={16} />
                                    </button>
                                </div>
                            ))}
                            <button
                                type="button" className="btn-secondary"
                                style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem' }}
                                onClick={() => setEquipe([...equipe, { nome: '', funcao: '' }])}
                            >
                                <Plus size={16} /> Adicionar pessoa
                            </button>
                        </div>

                        <div className="form-group" style={{ marginTop: '1.5rem' }}>
                            <label>Contatos de outros setores</label>
                            <p style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', margin: '0 0 0.75rem', lineHeight: 1.5 }}>
                                O campo "encaminhe quando" e o que faz o bot acertar: descreva com as palavras
                                do cliente, nao com o nome do setor. Ex: "quer deixar o carro pra loja vender".
                            </p>
                            {contatos.map((c, i) => (
                                <div key={i} style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
                                    <input
                                        type="text" value={c.setor || ''} placeholder="Setor (ex: Consignacao)"
                                        style={{ flex: '1 1 140px' }}
                                        onChange={e => setContatos(contatos.map((x, j) => j === i ? { ...x, setor: e.target.value } : x))}
                                    />
                                    <input
                                        type="text" value={c.telefone || ''} placeholder="Telefone com DDD"
                                        style={{ flex: '1 1 140px' }}
                                        onChange={e => setContatos(contatos.map((x, j) => j === i ? { ...x, telefone: e.target.value } : x))}
                                    />
                                    <input
                                        type="text" value={c.quando_usar || ''} placeholder="Encaminhe quando..."
                                        style={{ flex: '2 1 220px' }}
                                        onChange={e => setContatos(contatos.map((x, j) => j === i ? { ...x, quando_usar: e.target.value } : x))}
                                    />
                                    <button
                                        type="button" className="btn-icon" title="Remover"
                                        onClick={() => setContatos(contatos.filter((_, j) => j !== i))}
                                    >
                                        <Trash2 size={16} />
                                    </button>
                                </div>
                            ))}
                            <button
                                type="button" className="btn-secondary"
                                style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem' }}
                                onClick={() => setContatos([...contatos, { setor: '', telefone: '', quando_usar: '' }])}
                            >
                                <Plus size={16} /> Adicionar setor
                            </button>
                            <p style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', marginTop: '0.75rem', lineHeight: 1.5 }}>
                                O bot so escreve numero que estiver cadastrado aqui. Se ele tentar passar
                                qualquer outro, a resposta e bloqueada e a conversa vai pra um atendente.
                            </p>
                        </div>

                        <button
                            className="btn-primary"
                            onClick={saveEquipe}
                            disabled={savingEquipe}
                            style={{ marginTop: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}
                        >
                            {savedEquipe
                                ? <><CheckCircle size={18} /> Salvo!</>
                                : savingEquipe ? 'Salvando...'
                                : <><Save size={18} /> Salvar Equipe e Setores</>}
                        </button>
                    </div>
                </section>
            </div>

            {/* ── Comportamento do Bot ────────────────────────────────────────── */}
            <div style={{ marginTop: '2rem' }}>
                <section className="settings-section card">
                    <div className="section-title">
                        <Bot size={20} />
                        <h2>Comportamento do Bot</h2>
                    </div>
                    <div className="settings-form">
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                            <button
                                type="button"
                                onClick={() => setDelayedSched(v => !v)}
                                title={delayedSched ? 'Desativar' : 'Ativar'}
                                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, flexShrink: 0, color: delayedSched ? '#10b981' : '#94a3b8' }}
                            >
                                {delayedSched ? <ToggleRight size={32} /> : <ToggleLeft size={32} />}
                            </button>
                            <div>
                                <strong style={{ display: 'block', marginBottom: 4 }}>Verificação simulada de agenda</strong>
                                <p style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
                                    Quando o cliente pede um horário ocupado, o vendedor diz que vai verificar com o superior e responde alguns minutos depois — confirmando o encaixe ou propondo alternativas. Recomendado: ligado.
                                </p>
                            </div>
                        </div>
                        <button
                            className="btn-primary"
                            onClick={saveBehavior}
                            disabled={savingBehav}
                            style={{ marginTop: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}
                        >
                            {savedBehav
                                ? <><CheckCircle size={18} /> Salvo!</>
                                : savingBehav ? 'Salvando...'
                                : <><Save size={18} /> Salvar</>}
                        </button>

                        {/* ── Sub-seção: Qualificação do Lead (FORD) ───────────────── */}
                        <div style={{ borderTop: '1px solid var(--border)', margin: '1.5rem 0 1.25rem' }} />
                        <strong style={{ display: 'block', marginBottom: 4 }}>Qualificação do Lead (Técnica FORD)</strong>
                        <p style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)', lineHeight: 1.5, marginBottom: '0.75rem' }}>
                            O vendedor pode descobrir naturalmente, durante a conversa, informações importantes do cliente. Cada categoria que você ativar abaixo será explorada quando fizer sentido no fluxo.
                        </p>
                        {[
                            ['family',     '👨‍👩‍👧 Família',             'estado civil, filhos, com quem mora'],
                            ['occupation', '💼 Ocupação',              'profissão e área de trabalho'],
                            ['recreation', '🎯 Recreação',             'uso do carro (trabalho/lazer) e estilo de vida'],
                            ['financial',  '💰 Capacidade financeira', 'forma de pagamento e faixa de orçamento'],
                        ].map(([key, label, hint]) => (
                            <div key={key} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 8 }}>
                                <button type="button" onClick={() => setFord(f => ({ ...f, [key]: !f[key] }))}
                                    title={ford[key] ? 'Desativar' : 'Ativar'}
                                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, flexShrink: 0, color: ford[key] ? '#10b981' : '#94a3b8' }}>
                                    {ford[key] ? <ToggleRight size={26} /> : <ToggleLeft size={26} />}
                                </button>
                                <div>
                                    <span style={{ fontSize: '0.9rem', fontWeight: 500 }}>{label}</span>
                                    <p style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>{hint}</p>
                                </div>
                            </div>
                        ))}
                        <button
                            className="btn-primary"
                            onClick={saveFord}
                            disabled={savingFord}
                            style={{ marginTop: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}
                        >
                            {savedFord
                                ? <><CheckCircle size={18} /> Salvo!</>
                                : savingFord ? 'Salvando...'
                                : <><Save size={18} /> Salvar Qualificação FORD</>}
                        </button>

                        {/* ── Sub-seção: Lembrete de Visita ───────────────────────── */}
                        <div style={{ borderTop: '1px solid var(--border)', margin: '1.5rem 0 1.25rem' }} />
                        <strong style={{ display: 'block', marginBottom: 4 }}>Lembrete de Visita</strong>
                        <p style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)', lineHeight: 1.5, marginBottom: '0.75rem' }}>
                            O sistema envia uma mensagem de lembrete via WhatsApp alguns minutos antes da visita. Requer o template <strong>lembrete_visita</strong> aprovado pela Meta.
                        </p>
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 12 }}>
                            <button type="button" onClick={() => setVisitReminder(v => ({ ...v, enabled: !v.enabled }))}
                                title={visitReminder.enabled ? 'Desativar' : 'Ativar'}
                                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, flexShrink: 0, color: visitReminder.enabled ? '#10b981' : '#94a3b8' }}>
                                {visitReminder.enabled ? <ToggleRight size={26} /> : <ToggleLeft size={26} />}
                            </button>
                            <div>
                                <span style={{ fontSize: '0.9rem', fontWeight: 500 }}>Enviar lembrete antes da visita</span>
                                <p style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>Ative só depois que o template estiver aprovado pela Meta.</p>
                            </div>
                        </div>
                        <div className="form-group">
                            <label>Enviar quantos minutos antes</label>
                            <select value={visitReminder.minutes} onChange={e => setVisitReminder(v => ({ ...v, minutes: Number(e.target.value) }))}>
                                <option value={15}>15 minutos</option>
                                <option value={30}>30 minutos</option>
                                <option value={60}>1 hora</option>
                                <option value={120}>2 horas</option>
                            </select>
                        </div>
                        <button
                            className="btn-primary"
                            onClick={saveVisitReminder}
                            disabled={savingVR}
                            style={{ marginTop: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}
                        >
                            {savedVR
                                ? <><CheckCircle size={18} /> Salvo!</>
                                : savingVR ? 'Salvando...'
                                : <><Save size={18} /> Salvar Lembrete de Visita</>}
                        </button>

                        {/* ── Sub-seção: Pré-avaliação de Carro (Troca) ───────────── */}
                        <div style={{ borderTop: '1px solid var(--border)', margin: '1.5rem 0 1.25rem' }} />
                        <strong style={{ display: 'block', marginBottom: 4 }}>Pré-avaliação de Carro (Troca)</strong>
                        <p style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)', lineHeight: 1.5, marginBottom: '0.75rem' }}>
                            Quando o cliente mencionar que tem carro pra trocar, o vendedor coleta naturalmente informações sobre o veículo (modelo, ano, KM, etc.). Essas informações ficam disponíveis no perfil do lead e no card de agendamento.
                        </p>
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 12 }}>
                            <button type="button" onClick={() => setTradeIn(t => ({ ...t, enabled: !t.enabled }))}
                                title={tradeIn.enabled ? 'Desativar' : 'Ativar'}
                                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, flexShrink: 0, color: tradeIn.enabled ? '#10b981' : '#94a3b8' }}>
                                {tradeIn.enabled ? <ToggleRight size={26} /> : <ToggleLeft size={26} />}
                            </button>
                            <div>
                                <span style={{ fontSize: '0.9rem', fontWeight: 500 }}>Ativar pré-avaliação de carro</span>
                            </div>
                        </div>
                        {tradeIn.enabled && (
                            <>
                                <p style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)', marginBottom: 8 }}>
                                    Perguntas que o vendedor faz — desligue as que não fazem sentido na sua loja:
                                </p>
                                <div style={{ marginBottom: '1rem' }}>
                                    {[
                                        ['modelo',     'Modelo (marca e modelo)',   '"Você tem o quê hoje?"'],
                                        ['ano',        'Ano',                       '"É de qual ano?"'],
                                        ['km',         'Quilometragem',             '"Tá com quantos km mais ou menos?"'],
                                        ['tempo_dono', 'Há quanto tempo é dono',    '"Faz tempo que tá com ele?"'],
                                        ['nota',       'Nota de 0 a 10 pro carro',  '"Que nota você daria pra ele?"'],
                                        ['pagamento',  'Forma de pagamento',        '"Trocar diretinho ou pagar diferença?"'],
                                    ].map(([key, label, hint]) => (
                                        <div key={key} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 8 }}>
                                            <button type="button" onClick={() => setTradeQ(q => ({ ...q, [key]: !q[key] }))}
                                                title={tradeQ[key] ? 'Desativar' : 'Ativar'}
                                                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, flexShrink: 0, color: tradeQ[key] ? '#10b981' : '#94a3b8' }}>
                                                {tradeQ[key] ? <ToggleRight size={26} /> : <ToggleLeft size={26} />}
                                            </button>
                                            <div>
                                                <span style={{ fontSize: '0.9rem', fontWeight: 500 }}>{label}</span>
                                                <p style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>{hint}</p>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                                <div className="form-group">
                                    <label>Perguntas adicionais (opcional)</label>
                                    <textarea
                                        rows={3}
                                        value={tradeIn.extraQuestions}
                                        onChange={e => setTradeIn(t => ({ ...t, extraQuestions: e.target.value }))}
                                        placeholder={"Uma pergunta por linha. Ex:\nTem algum dano na lataria?\nJá bateu o carro?"}
                                        style={{ resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.6 }}
                                    />
                                    <p style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)', marginTop: '-0.25rem' }}>Cada linha = 1 pergunta extra que o bot vai fazer.</p>
                                </div>

                                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10,
                                              paddingTop: 14, borderTop: '1px solid var(--border)' }}>
                                    <button type="button"
                                        onClick={() => setAvaliacao(a => ({ ...a, enabled: !a.enabled }))}
                                        title={avaliacao.enabled ? 'Desativar' : 'Ativar'}
                                        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                                                 flexShrink: 0, color: avaliacao.enabled ? '#10b981' : '#94a3b8' }}>
                                        {avaliacao.enabled ? <ToggleRight size={26} /> : <ToggleLeft size={26} />}
                                    </button>
                                    <div>
                                        <span style={{ fontSize: '0.9rem', fontWeight: 500 }}>
                                            Estimar o valor da troca pela FIPE
                                        </span>
                                        <p style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>
                                            O bot pergunta quanto o carro está na FIPE e aplica a nota que o próprio
                                            dono deu. Nota 7 num carro de R$ 50.000 = 70% = R$ 35.000. Sempre como
                                            estimativa, com a avaliação real na loja.
                                        </p>
                                    </div>
                                </div>

                                {avaliacao.enabled && (
                                    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                                        <div className="form-group" style={{ flex: '0 1 150px', marginBottom: 0 }}>
                                            <label>Teto da estimativa (%)</label>
                                            <input type="number" min="10" max="100" value={avaliacao.teto}
                                                onChange={e => setAvaliacao(a => ({ ...a, teto: e.target.value }))} />
                                        </div>
                                        <p style={{ fontSize: '0.76rem', color: 'var(--color-text-muted)',
                                                    flex: '1 1 220px', margin: '0 0 4px' }}>
                                            Sem teto, nota 10 significaria pagar 100% da FIPE. Nenhuma loja faz isso, e
                                            o bot prometendo vira discussão no balcão.
                                        </p>
                                    </div>
                                )}
                            </>
                        )}
                        <button
                            className="btn-primary"
                            onClick={saveTradeIn}
                            disabled={savingTI}
                            style={{ marginTop: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}
                        >
                            {savedTI
                                ? <><CheckCircle size={18} /> Salvo!</>
                                : savingTI ? 'Salvando...'
                                : <><Save size={18} /> Salvar Pré-avaliação de Carro</>}
                        </button>
                    </div>
                </section>
            </div>

            {/* ── Financiamento ────────────────────────────────────────────── */}
            <div style={{ marginTop: '2rem' }}>
                <section className="settings-section card">
                    <div className="section-title"><Landmark size={20} /><h2>Financiamento</h2></div>
                    <div className="settings-form">
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 12 }}>
                            <button type="button" onClick={() => setFinancing(f => ({ ...f, enabled: !f.enabled }))}
                                title={financing.enabled ? 'Desativar' : 'Ativar'}
                                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, flexShrink: 0, color: financing.enabled ? '#10b981' : '#94a3b8' }}>
                                {financing.enabled ? <ToggleRight size={32} /> : <ToggleLeft size={32} />}
                            </button>
                            <div>
                                <strong style={{ display: 'block', marginBottom: 4 }}>Ativar simulação de financiamento</strong>
                                <p style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)', lineHeight: 1.5 }}>Quando ligado, o bot pode simular parcelas (estimativa) se o cliente pedir.</p>
                            </div>
                        </div>
                        <div className="form-row">
                            <div className="form-group">
                                <label>Taxa de juros ao mês (%)</label>
                                <input type="number" step="0.01" placeholder="Ex: 2.2" value={financing.rate} onChange={e => setFinancing(f => ({ ...f, rate: e.target.value }))} />
                            </div>
                            <div className="form-group">
                                <label>Prazo máximo (parcelas)</label>
                                <input type="number" placeholder="Ex: 48" value={financing.maxInstallments} onChange={e => setFinancing(f => ({ ...f, maxInstallments: e.target.value }))} />
                            </div>
                        </div>
                        <div className="form-row">
                            <div className="form-group">
                                <label>Entrada mínima (%)</label>
                                <input type="number" step="0.1" placeholder="Ex: 20" value={financing.minDownPct} onChange={e => setFinancing(f => ({ ...f, minDownPct: e.target.value }))} />
                            </div>
                            <div className="form-group">
                                <label>Bancos que trabalha (opcional)</label>
                                <input type="text" placeholder="Ex: BV, Santander, Omni" value={financing.banks} onChange={e => setFinancing(f => ({ ...f, banks: e.target.value }))} />
                            </div>
                        </div>
                        <p style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', background: 'var(--input-bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '0.6rem 0.85rem', lineHeight: 1.5 }}>
                            ⚠️ Os valores simulados são estimativas. O valor final depende da análise de crédito do banco.
                        </p>
                        <button className="btn-primary" onClick={saveFinancing} disabled={savingFin}
                            style={{ marginTop: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            {savedFin
                                ? <><CheckCircle size={18} /> Salvo!</>
                                : savingFin ? 'Salvando...'
                                : <><Save size={18} /> Salvar Financiamento</>}
                        </button>
                    </div>
                </section>
            </div>

            {/* ── Exceções e Feriados (largura total) ───────────────────────── */}
            <div style={{ marginTop: '2rem' }}>
                <section className="settings-section card">
                    <div className="section-title" style={{ justifyContent: 'space-between' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', color: 'var(--color-primary)' }}>
                            <CalendarOff size={20} />
                            <h2 style={{ color: 'var(--color-text-main)', marginBottom: 0 }}>Exceções e Feriados</h2>
                        </div>
                        {!showExForm && (
                            <button
                                className="btn-outline"
                                onClick={() => setShowExForm(true)}
                                style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', padding: '0.5rem 0.85rem' }}
                            >
                                <Plus size={16} /> Adicionar
                            </button>
                        )}
                    </div>

                    {/* Formulário de nova exceção */}
                    {showExForm && (
                        <div style={{ marginBottom: '1.5rem', padding: '1rem', borderRadius: '10px', border: '1px dashed var(--border)', background: 'var(--input-bg)' }}>
                            <div className="form-row">
                                <div className="form-group">
                                    <label>Data</label>
                                    <input
                                        type="date"
                                        value={newEx.date}
                                        onChange={e => setNewEx(prev => ({ ...prev, date: e.target.value }))}
                                        autoFocus
                                    />
                                </div>
                                <div className="form-group">
                                    <label>Tipo</label>
                                    <select
                                        value={newEx.closed ? 'closed' : 'special'}
                                        onChange={e => setNewEx(prev => ({ ...prev, closed: e.target.value === 'closed' }))}
                                    >
                                        <option value="closed">Fechado neste dia</option>
                                        <option value="special">Horário especial</option>
                                    </select>
                                </div>
                            </div>
                            {!newEx.closed && (
                                <div className="form-row">
                                    <div className="form-group">
                                        <label>Abre às</label>
                                        <input
                                            type="time"
                                            value={newEx.start_time}
                                            onChange={e => setNewEx(prev => ({ ...prev, start_time: e.target.value }))}
                                        />
                                    </div>
                                    <div className="form-group">
                                        <label>Fecha às</label>
                                        <input
                                            type="time"
                                            value={newEx.end_time}
                                            onChange={e => setNewEx(prev => ({ ...prev, end_time: e.target.value }))}
                                        />
                                    </div>
                                </div>
                            )}
                            <div className="form-group">
                                <label>Observação (opcional)</label>
                                <input
                                    type="text"
                                    placeholder="Ex: Corpus Christi, evento interno..."
                                    value={newEx.note}
                                    onChange={e => setNewEx(prev => ({ ...prev, note: e.target.value }))}
                                />
                            </div>
                            <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem' }}>
                                <button
                                    className="btn-primary"
                                    onClick={addException}
                                    disabled={addingEx || !newEx.date}
                                    style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
                                >
                                    <Plus size={16} /> {addingEx ? 'Salvando...' : 'Salvar'}
                                </button>
                                <button className="btn-outline" onClick={cancelExForm}>
                                    Cancelar
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Lista de exceções */}
                    {loadingEx ? (
                        <p style={{ color: 'var(--color-text-muted)', fontSize: '0.9rem' }}>Carregando...</p>
                    ) : exceptions.length === 0 ? (
                        <div style={{ textAlign: 'center', padding: '1.5rem 0', color: 'var(--color-text-muted)' }}>
                            <CalendarOff size={28} style={{ margin: '0 auto 0.5rem', display: 'block', opacity: 0.35 }} />
                            <p style={{ fontSize: '0.9rem' }}>Nenhuma exceção cadastrada.</p>
                            <p style={{ fontSize: '0.8rem', marginTop: '0.2rem' }}>
                                Adicione feriados ou dias com horário especial.
                            </p>
                        </div>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                            {exceptions.map(ex => (
                                <div
                                    key={ex.id}
                                    style={{
                                        display: 'flex', alignItems: 'center', gap: '1rem',
                                        padding: '0.75rem 1rem', borderRadius: '10px',
                                        border: '1px solid var(--border)', background: 'var(--card-bg)',
                                    }}
                                >
                                    <div style={{ flex: 1 }}>
                                        <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>
                                            {formatExDate(ex.date)}
                                        </span>
                                        {' · '}
                                        {ex.closed
                                            ? <span style={{ color: '#ef4444', fontSize: '0.85rem', fontWeight: 500 }}>Fechado</span>
                                            : <span style={{ color: '#10b981', fontSize: '0.85rem', fontWeight: 500 }}>
                                                Horário especial: {ex.start_time} – {ex.end_time}
                                              </span>
                                        }
                                        {ex.note && (
                                            <span style={{ color: '#94a3b8', fontSize: '0.82rem' }}> · {ex.note}</span>
                                        )}
                                    </div>
                                    <button
                                        title="Excluir"
                                        onClick={() => deleteException(ex.id)}
                                        style={{
                                            background: 'none', border: 'none', cursor: 'pointer',
                                            color: '#ef4444', display: 'flex', alignItems: 'center',
                                            padding: '0.25rem', borderRadius: '6px',
                                        }}
                                    >
                                        <Trash2 size={16} />
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </section>

                {/* ── Notificações Automáticas ────────────────────────────── */}
                <section className="settings-section card">
                    <div className="section-title">
                        <Bell size={20} />
                        <h2>Notificações Automáticas</h2>
                    </div>

                    {approvedTemplates.length === 0 && (
                        <p className="text-muted" style={{ fontSize: '0.85rem', marginBottom: '1rem' }}>
                            Você precisa de pelo menos um template aprovado pela Meta. Crie em <strong>Templates</strong>.
                        </p>
                    )}

                    {/* Aniversário */}
                    <div style={{ marginBottom: '1.5rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                            <Gift size={18} style={{ color: 'var(--primary)' }} />
                            <strong style={{ flex: 1 }}>Mensagem de aniversário automática</strong>
                            <button type="button" onClick={() => setNotif(p => ({ ...p, birthday_enabled: !p.birthday_enabled }))}
                                style={{ background: 'none', border: 'none', cursor: 'pointer', color: notif.birthday_enabled ? '#10b981' : '#94a3b8' }}>
                                {notif.birthday_enabled ? <ToggleRight size={32} /> : <ToggleLeft size={32} />}
                            </button>
                        </div>
                        <p className="text-muted" style={{ fontSize: '0.78rem', marginBottom: 8 }}>
                            Toda manhã (9h Brasília) o sistema verifica os aniversariantes do dia e envia a mensagem. O template precisa estar aprovado e ter 1 variável (o nome).
                        </p>
                        <select value={notif.birthday_template_id} onChange={e => setNotif(p => ({ ...p, birthday_template_id: e.target.value }))}
                            style={{ width: '100%', padding: '0.65rem 1rem', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--card-bg)', color: 'var(--text-primary)' }}>
                            <option value="">Selecione o template de aniversário…</option>
                            {approvedTemplates.map(t => (
                                <option key={t.id} value={t.id}>{t.display_name} ({(t.body_variables?.length ?? 0)} variável{(t.body_variables?.length ?? 0) !== 1 ? 'is' : ''})</option>
                            ))}
                        </select>
                    </div>

                    {/* Lista de espera */}
                    <div style={{ marginBottom: '1.5rem' }}>
                        <strong style={{ display: 'block', marginBottom: 6 }}>Template de aviso da Lista de Espera</strong>
                        <p className="text-muted" style={{ fontSize: '0.78rem', marginBottom: 8 }}>
                            Usado quando você clicar "Avisar todos" na Lista de Espera ao cadastrar um carro novo. Deve ter 3 variáveis (nome, modelo procurado, descrição do carro).
                        </p>
                        <select value={notif.waiting_list_template_id} onChange={e => setNotif(p => ({ ...p, waiting_list_template_id: e.target.value }))}
                            style={{ width: '100%', padding: '0.65rem 1rem', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--card-bg)', color: 'var(--text-primary)' }}>
                            <option value="">Selecione o template de aviso…</option>
                            {approvedTemplates.map(t => (
                                <option key={t.id} value={t.id}>{t.display_name} ({(t.body_variables?.length ?? 0)} variáveis)</option>
                            ))}
                        </select>
                    </div>

                    <button className="btn-primary" onClick={saveNotif} disabled={savingNotif} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Save size={16} /> {savingNotif ? 'Salvando...' : 'Salvar notificações'}
                    </button>
                </section>
            </div>
        </div>
    );
};

export default Settings;
