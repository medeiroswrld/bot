import { useState, useMemo } from 'react';
import {
    FileText, Plus, Search, Trash2, X, Send, RefreshCw, Pencil,
    CheckCircle2, Clock, AlertCircle, Loader2
} from 'lucide-react';
import { useAppContext } from '../context/AppContext.jsx';

const STATUS_CFG = {
    draft:    { label: 'Rascunho',             color: '#64748b', bg: '#f1f5f9', icon: Pencil },
    pending:  { label: 'Aguardando aprovação', color: '#d97706', bg: '#fff7ed', icon: Clock },
    approved: { label: 'Aprovado',             color: '#059669', bg: '#ecfdf5', icon: CheckCircle2 },
    rejected: { label: 'Rejeitado',            color: '#dc2626', bg: '#fef2f2', icon: AlertCircle },
    paused:   { label: 'Pausado',              color: '#64748b', bg: '#f1f5f9', icon: AlertCircle },
    disabled: { label: 'Desativado',           color: '#64748b', bg: '#f1f5f9', icon: AlertCircle },
};

const CATEGORY_HELP = 'MARKETING: ofertas/promoções (~R$0,40). UTILITY: confirmações, lembretes, avisos (~R$0,15). AUTHENTICATION: só códigos.';

const EMPTY_TPL = {
    display_name: '', meta_template_name: '', category: 'UTILITY', language: 'pt_BR',
    header_type: '', header_content: '', body_text: '', body_variables: [],
    footer_text: '', buttons: [],
};

const slugify = (s) => String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60);

// Maior índice {{N}} usado no corpo
const maxVarIndex = (text) => {
    const matches = [...String(text || '').matchAll(/\{\{(\d+)\}\}/g)].map(m => parseInt(m[1], 10));
    return matches.length ? Math.max(...matches) : 0;
};

const buildPreview = (tpl) => {
    let txt = tpl.body_text || '';
    (tpl.body_variables || []).forEach((v, i) => {
        txt = txt.replaceAll(`{{${i + 1}}}`, v.example || `{{${i + 1}}}`);
    });
    return txt;
};

const StatusBadge = ({ status }) => {
    const cfg = STATUS_CFG[status] ?? STATUS_CFG.draft;
    const Icon = cfg.icon;
    return (
        <span className="status-badge" style={{ background: cfg.bg, color: cfg.color, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Icon size={11} />{cfg.label}
        </span>
    );
};

// ─── Editor ───────────────────────────────────────────────────────────────────
const TemplateEditor = ({ template, onClose }) => {
    const { saveTemplate, submitTemplate, addToast } = useAppContext();
    const [form, setForm] = useState(template ? { ...EMPTY_TPL, ...template } : { ...EMPTY_TPL });
    const [nameEdited, setNameEdited] = useState(!!template?.meta_template_name);
    const [saving, setSaving] = useState(false);

    const set = (k, v) => setForm(prev => ({ ...prev, [k]: v }));

    const onDisplayName = (v) => {
        setForm(prev => ({
            ...prev,
            display_name: v,
            meta_template_name: nameEdited ? prev.meta_template_name : slugify(v),
        }));
    };

    // Mantém body_variables sincronizado com o nº de {{N}} no corpo
    const syncVars = (text) => {
        const count = maxVarIndex(text);
        setForm(prev => {
            const vars = [...(prev.body_variables || [])];
            while (vars.length < count) vars.push({ name: `variavel_${vars.length + 1}`, example: '' });
            while (vars.length > count) vars.pop();
            return { ...prev, body_text: text, body_variables: vars };
        });
    };

    const addVariable = () => {
        const next = maxVarIndex(form.body_text) + 1;
        syncVars(`${form.body_text}{{${next}}}`);
    };

    const setVar = (i, k, v) => setForm(prev => {
        const vars = [...prev.body_variables];
        vars[i] = { ...vars[i], [k]: v };
        return { ...prev, body_variables: vars };
    });

    const validate = () => {
        if (!form.display_name.trim()) { addToast('Dê um nome amigável ao template.', 'error'); return false; }
        if (!form.meta_template_name.trim()) { addToast('Nome técnico obrigatório.', 'error'); return false; }
        if (!form.body_text.trim()) { addToast('O corpo da mensagem é obrigatório.', 'error'); return false; }
        if ((form.body_variables || []).some(v => !v.example?.trim())) {
            addToast('Preencha um exemplo para cada variável (a Meta exige).', 'error'); return false;
        }
        return true;
    };

    const doSave = async (thenSubmit) => {
        if (!validate()) return;
        setSaving(true);
        try {
            const saved = await saveTemplate(form);
            if (thenSubmit && saved?.id) await submitTemplate(saved.id);
            onClose();
        } catch { /* toast já exibido no context */ }
        finally { setSaving(false); }
    };

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 920 }}>
                <div className="modal-header">
                    <h2>{template ? 'Editar template' : 'Novo template'}</h2>
                    <button className="close-btn" onClick={onClose}><X size={24} /></button>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: 20 }}>
                    {/* Form */}
                    <div className="settings-form" style={{ minWidth: 0 }}>
                        <div className="form-row">
                            <div className="form-group">
                                <label>Nome amigável *</label>
                                <input type="text" value={form.display_name} onChange={e => onDisplayName(e.target.value)} placeholder="Ex: Aviso de carro disponível" />
                            </div>
                            <div className="form-group">
                                <label>Nome técnico (Meta) *</label>
                                <input type="text" value={form.meta_template_name}
                                    onChange={e => { setNameEdited(true); set('meta_template_name', slugify(e.target.value)); }}
                                    placeholder="aviso_carro_disponivel" />
                            </div>
                        </div>

                        <div className="form-row">
                            <div className="form-group">
                                <label>Categoria *</label>
                                <select value={form.category} onChange={e => set('category', e.target.value)} title={CATEGORY_HELP}>
                                    <option value="UTILITY">UTILITY (avisos, lembretes)</option>
                                    <option value="MARKETING">MARKETING (ofertas)</option>
                                    <option value="AUTHENTICATION">AUTHENTICATION (códigos)</option>
                                </select>
                                <p className="text-muted" style={{ fontSize: '0.7rem', marginTop: 4 }}>{CATEGORY_HELP}</p>
                            </div>
                            <div className="form-group">
                                <label>Idioma</label>
                                <input type="text" value="pt_BR" disabled />
                            </div>
                        </div>

                        <div className="form-row">
                            <div className="form-group">
                                <label>Cabeçalho</label>
                                <select value={form.header_type || ''} onChange={e => set('header_type', e.target.value || null)}>
                                    <option value="">Nenhum</option>
                                    <option value="TEXT">Texto</option>
                                </select>
                            </div>
                            {form.header_type === 'TEXT' && (
                                <div className="form-group">
                                    <label>Texto do cabeçalho</label>
                                    <input type="text" value={form.header_content || ''} onChange={e => set('header_content', e.target.value)} placeholder="Ex: Novidade na loja!" />
                                </div>
                            )}
                        </div>

                        <div className="form-group">
                            <label>Corpo da mensagem * (use {'{{1}}'}, {'{{2}}'} para variáveis)</label>
                            <textarea rows={4} value={form.body_text} onChange={e => syncVars(e.target.value)}
                                placeholder="Olá {{1}}! Lembra do {{2}} que você procurava? Acabou de entrar: {{3}}."
                                style={{ resize: 'vertical', fontFamily: 'inherit' }} />
                            <button type="button" className="btn-secondary" style={{ marginTop: 6, fontSize: '0.78rem' }} onClick={addVariable}>
                                <Plus size={13} /> Adicionar variável
                            </button>
                        </div>

                        {form.body_variables.length > 0 && (
                            <div className="form-group">
                                <label>Variáveis (a Meta exige um exemplo de cada)</label>
                                {form.body_variables.map((v, i) => (
                                    <div key={i} className="form-row" style={{ marginBottom: 6 }}>
                                        <div className="form-group" style={{ marginBottom: 0 }}>
                                            <input type="text" value={v.name} onChange={e => setVar(i, 'name', e.target.value)} placeholder={`Nome var {{${i + 1}}}`} />
                                        </div>
                                        <div className="form-group" style={{ marginBottom: 0 }}>
                                            <input type="text" value={v.example} onChange={e => setVar(i, 'example', e.target.value)} placeholder={`Exemplo para {{${i + 1}}}`} />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}

                        <div className="form-group">
                            <label>Rodapé (opcional)</label>
                            <input type="text" value={form.footer_text || ''} onChange={e => set('footer_text', e.target.value)} placeholder="Ex: Responda PARAR para não receber mais" />
                        </div>
                    </div>

                    {/* Preview */}
                    <div>
                        <label style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Pré-visualização</label>
                        <div style={{ marginTop: 8, background: '#e5ddd5', borderRadius: 10, padding: 14, minHeight: 120 }}>
                            <div style={{ background: '#fff', borderRadius: 8, padding: '8px 10px', boxShadow: '0 1px 1px rgba(0,0,0,0.1)', maxWidth: 260 }}>
                                {form.header_type === 'TEXT' && form.header_content && (
                                    <p style={{ margin: '0 0 4px', fontWeight: 700, fontSize: '0.85rem', color: '#111' }}>{form.header_content}</p>
                                )}
                                <p style={{ margin: 0, fontSize: '0.85rem', color: '#111', whiteSpace: 'pre-wrap', lineHeight: 1.4 }}>
                                    {buildPreview(form) || 'Sua mensagem aparece aqui...'}
                                </p>
                                {form.footer_text && (
                                    <p style={{ margin: '6px 0 0', fontSize: '0.7rem', color: '#888' }}>{form.footer_text}</p>
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                <div className="modal-footer" style={{ marginTop: 16 }}>
                    <button className="btn-secondary" onClick={onClose} disabled={saving}>Cancelar</button>
                    <button className="btn-secondary" onClick={() => doSave(false)} disabled={saving}>
                        {saving ? <Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} /> : 'Salvar rascunho'}
                    </button>
                    <button className="btn-primary" onClick={() => doSave(true)} disabled={saving} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Send size={15} /> Salvar e enviar pra Meta
                    </button>
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
const Templates = () => {
    const { messageTemplates, submitTemplate, deleteTemplate, checkTemplateStatus } = useAppContext();
    const [search, setSearch] = useState('');
    const [editor, setEditor] = useState(null); // {template} | {} (novo)
    const [confirmDeleteId, setConfirmDeleteId] = useState(null);
    const [checking, setChecking] = useState(false);

    const filtered = useMemo(() => (messageTemplates || []).filter(t =>
        !search || `${t.display_name} ${t.meta_template_name}`.toLowerCase().includes(search.toLowerCase())
    ), [messageTemplates, search]);

    const handleCheckAll = async () => { setChecking(true); await checkTemplateStatus(); setChecking(false); };

    return (
        <div className="view-content">
            <header className="view-header-flex">
                <div className="view-header">
                    <h1>Templates de Mensagem</h1>
                    <p>Modelos aprovados pela Meta para campanhas, aniversário e avisos automáticos.</p>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                    <button className="btn-secondary" onClick={handleCheckAll} disabled={checking} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <RefreshCw size={16} style={checking ? { animation: 'spin 1s linear infinite' } : undefined} /> Verificar status
                    </button>
                    <button className="btn-primary" onClick={() => setEditor({})} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Plus size={18} /> Novo Template
                    </button>
                </div>
            </header>

            <div className="inv-toolbar">
                <div className="inv-search">
                    <Search size={18} />
                    <input type="text" placeholder="Buscar template..." value={search} onChange={e => setSearch(e.target.value)} />
                </div>
            </div>

            <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
                {filtered.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '4rem 2rem', color: 'var(--text-secondary)' }}>
                        <FileText size={48} style={{ opacity: 0.3, marginBottom: 16 }} />
                        <h3 style={{ fontWeight: 700, marginBottom: 4 }}>Nenhum template ainda</h3>
                        <p>Crie um template e envie pra aprovação da Meta.</p>
                    </div>
                ) : (
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
                        <thead>
                            <tr style={{ borderBottom: '1px solid var(--border)', textAlign: 'left', color: 'var(--text-secondary)' }}>
                                <th style={{ padding: '12px 16px', fontWeight: 600 }}>Template</th>
                                <th style={{ padding: '12px 16px', fontWeight: 600 }}>Categoria</th>
                                <th style={{ padding: '12px 16px', fontWeight: 600 }}>Status</th>
                                <th style={{ padding: '12px 16px', fontWeight: 600, textAlign: 'right' }}>Ações</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filtered.map(t => (
                                <tr key={t.id} style={{ borderBottom: '1px solid var(--border)' }}>
                                    <td style={{ padding: '12px 16px' }}>
                                        <p style={{ margin: 0, fontWeight: 600 }}>{t.display_name}</p>
                                        <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{t.meta_template_name}</p>
                                        {t.status === 'rejected' && t.rejection_reason && (
                                            <p style={{ margin: '4px 0 0', fontSize: '0.72rem', color: '#dc2626' }}>Motivo: {t.rejection_reason.slice(0, 120)}</p>
                                        )}
                                    </td>
                                    <td style={{ padding: '12px 16px', color: 'var(--text-secondary)' }}>{t.category}</td>
                                    <td style={{ padding: '12px 16px' }}><StatusBadge status={t.status} /></td>
                                    <td style={{ padding: '12px 16px' }}>
                                        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                                            {(t.status === 'draft' || t.status === 'rejected') && (
                                                <button className="inv-action-btn" title="Enviar pra Meta" style={{ color: '#2563eb' }} onClick={() => submitTemplate(t.id)}><Send size={15} /></button>
                                            )}
                                            {(t.status === 'draft' || t.status === 'rejected') && (
                                                <button className="inv-action-btn" title="Editar" onClick={() => setEditor({ template: t })}><Pencil size={15} /></button>
                                            )}
                                            <button className="inv-action-btn" title="Excluir" style={{ color: '#dc2626' }} onClick={() => setConfirmDeleteId(t.id)}><Trash2 size={15} /></button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>

            {editor && <TemplateEditor template={editor.template} onClose={() => setEditor(null)} />}
            {confirmDeleteId && (
                <ConfirmModal
                    message="Excluir este template? Se já foi aprovado, ele continua existindo na Meta."
                    onCancel={() => setConfirmDeleteId(null)}
                    onConfirm={async () => { await deleteTemplate(confirmDeleteId); setConfirmDeleteId(null); }}
                />
            )}
        </div>
    );
};

export default Templates;
