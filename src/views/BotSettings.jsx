import React, { useState, useEffect } from 'react';
import { Bot, Save, CheckCircle, Plus, Trash2, HelpCircle, ToggleLeft, ToggleRight } from 'lucide-react';

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
import { useAppContext } from '../context/AppContext.jsx';
import { supabase } from '../lib/supabase.js';

const BotSettings = () => {
    const { user } = useAppContext();

    // ── Instruções personalizadas ──────────────────────────────────────────────
    const [instructions, setInstructions] = useState('');
    const [savingInstr, setSavingInstr] = useState(false);
    const [savedInstr, setSavedInstr] = useState(false);

    // ── FAQs ──────────────────────────────────────────────────────────────────
    const [faqs, setFaqs] = useState([]);
    const [loadingFaqs, setLoadingFaqs] = useState(true);
    const [showAddForm, setShowAddForm] = useState(false);
    const [newQ, setNewQ] = useState('');
    const [newA, setNewA] = useState('');
    const [addingFaq, setAddingFaq] = useState(false);
    const [confirmDeleteId, setConfirmDeleteId] = useState(null);

    useEffect(() => {
        if (!user?.id) return;

        supabase
            .from('company_settings')
            .select('bot_custom_instructions')
            .eq('user_id', user.id)
            .single()
            .then(({ data }) => {
                setInstructions(data?.bot_custom_instructions || '');
            });

        supabase
            .from('bot_faqs')
            .select('*')
            .eq('user_id', user.id)
            .order('created_at', { ascending: true })
            .then(({ data }) => {
                setFaqs(data || []);
                setLoadingFaqs(false);
            });
    }, [user?.id]);

    const saveInstructions = async () => {
        if (!user?.id) return;
        setSavingInstr(true);
        const { error } = await supabase
            .from('company_settings')
            .update({ bot_custom_instructions: instructions, updated_at: new Date().toISOString() })
            .eq('user_id', user.id);
        setSavingInstr(false);
        if (!error) {
            // Atualiza o estado local com o valor salvo — sem precisar recarregar
            setSavedInstr(true);
            setTimeout(() => setSavedInstr(false), 2000);
        }
    };

    const addFaq = async () => {
        if (!user?.id || !newQ.trim() || !newA.trim()) return;
        setAddingFaq(true);
        const { data } = await supabase
            .from('bot_faqs')
            .insert({ user_id: user.id, question: newQ.trim(), answer: newA.trim() })
            .select()
            .single();
        if (data) {
            setFaqs(prev => [...prev, data]);
            setNewQ('');
            setNewA('');
            setShowAddForm(false);
        }
        setAddingFaq(false);
    };

    const toggleFaq = async (id, currentEnabled) => {
        const newEnabled = !currentEnabled;
        setFaqs(prev => prev.map(f => f.id === id ? { ...f, enabled: newEnabled } : f));
        await supabase.from('bot_faqs').update({ enabled: newEnabled }).eq('id', id);
    };

    const deleteFaq = async (id) => {
        setFaqs(prev => prev.filter(f => f.id !== id));
        await supabase.from('bot_faqs').delete().eq('id', id);
    };

    const confirmDeleteFaq = async () => {
        await deleteFaq(confirmDeleteId);
        setConfirmDeleteId(null);
    };

    return (
        <div className="view-content">
            <header className="view-header">
                <h1>Assistente</h1>
                <p>Configure o comportamento do bot de atendimento automático pelo WhatsApp.</p>
            </header>

            <div className="settings-grid">
                {/* ── Instruções personalizadas ─────────────────────────────── */}
                <section className="settings-section card">
                    <div className="section-title">
                        <Bot size={20} />
                        <h2>Instruções Personalizadas</h2>
                    </div>
                    <div className="settings-form">
                        <div className="form-group">
                            <label>Comportamentos específicos da sua concessionária</label>
                            <textarea
                                rows={8}
                                value={instructions}
                                onChange={e => setInstructions(e.target.value)}
                                placeholder={"Exemplos:\n• Sempre ofereça test drive aos sábados\n• Nunca passe o preço final, diga que um vendedor confirma\n• Mencione que temos financiamento em até 60x\n• Ao agendar, sempre confirme o endereço da loja"}
                                style={{ resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.6 }}
                            />
                            <p style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', marginTop: '-0.25rem', lineHeight: 1.5 }}>
                                Regras que o bot sempre vai seguir. Escreva em linguagem natural, uma por linha.
                            </p>
                        </div>
                        <button
                            className="btn-primary"
                            onClick={saveInstructions}
                            disabled={savingInstr}
                            style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
                        >
                            {savedInstr
                                ? <><CheckCircle size={18} /> Salvo!</>
                                : savingInstr
                                    ? 'Salvando...'
                                    : <><Save size={18} /> Salvar Instruções</>}
                        </button>
                    </div>
                </section>

                {/* ── Perguntas frequentes ──────────────────────────────────── */}
                <section className="settings-section card">
                    <div className="section-title" style={{ justifyContent: 'space-between' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', color: 'var(--color-primary)' }}>
                            <HelpCircle size={20} />
                            <h2 style={{ color: 'var(--color-text-main)', marginBottom: 0 }}>Perguntas Frequentes</h2>
                        </div>
                        {!showAddForm && (
                            <button
                                className="btn-outline"
                                onClick={() => setShowAddForm(true)}
                                style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', padding: '0.5rem 0.85rem' }}
                            >
                                <Plus size={16} /> Adicionar
                            </button>
                        )}
                    </div>

                    {/* Formulário de nova FAQ */}
                    {showAddForm && (
                        <div style={{ marginBottom: '1.25rem', padding: '1rem', borderRadius: '10px', border: '1px dashed var(--border)', background: 'var(--input-bg)' }}>
                            <div className="form-group">
                                <label>Pergunta</label>
                                <input
                                    type="text"
                                    value={newQ}
                                    onChange={e => setNewQ(e.target.value)}
                                    placeholder="Ex: Vocês aceitam troca de veículo?"
                                    autoFocus
                                />
                            </div>
                            <div className="form-group">
                                <label>Resposta</label>
                                <textarea
                                    rows={3}
                                    value={newA}
                                    onChange={e => setNewA(e.target.value)}
                                    placeholder="Ex: Sim, avaliamos seu veículo na hora. Um de nossos consultores vai verificar e apresentar uma proposta."
                                    style={{ resize: 'vertical', fontFamily: 'inherit' }}
                                />
                            </div>
                            <div style={{ display: 'flex', gap: '0.75rem' }}>
                                <button
                                    className="btn-primary"
                                    onClick={addFaq}
                                    disabled={addingFaq || !newQ.trim() || !newA.trim()}
                                    style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
                                >
                                    <Plus size={16} /> {addingFaq ? 'Salvando...' : 'Salvar'}
                                </button>
                                <button
                                    className="btn-outline"
                                    onClick={() => { setShowAddForm(false); setNewQ(''); setNewA(''); }}
                                >
                                    Cancelar
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Lista de FAQs */}
                    {loadingFaqs ? (
                        <p style={{ color: 'var(--color-text-muted)', fontSize: '0.9rem' }}>Carregando...</p>
                    ) : faqs.length === 0 ? (
                        <div style={{ textAlign: 'center', padding: '2rem 0', color: 'var(--color-text-muted)' }}>
                            <HelpCircle size={32} style={{ margin: '0 auto 0.75rem', display: 'block', opacity: 0.4 }} />
                            <p style={{ fontSize: '0.9rem' }}>Nenhuma pergunta cadastrada ainda.</p>
                            <p style={{ fontSize: '0.8rem', marginTop: '0.25rem' }}>Adicione respostas para as dúvidas mais comuns dos clientes.</p>
                        </div>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                            {faqs.map(faq => (
                                <div
                                    key={faq.id}
                                    style={{
                                        display: 'flex',
                                        alignItems: 'flex-start',
                                        gap: '0.75rem',
                                        padding: '0.875rem 1rem',
                                        borderRadius: '10px',
                                        border: '1px solid #e2e8f0',
                                        background: faq.enabled ? 'var(--input-bg)' : 'var(--bg-app)',
                                        opacity: faq.enabled ? 1 : 0.55,
                                        transition: 'all 0.2s',
                                    }}
                                >
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <p style={{ fontWeight: 600, fontSize: '0.9rem', marginBottom: '0.25rem', color: 'var(--color-text-main)' }}>
                                            {faq.question}
                                        </p>
                                        <p style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
                                            {faq.answer}
                                        </p>
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', flexShrink: 0 }}>
                                        <button
                                            title={faq.enabled ? 'Desativar' : 'Ativar'}
                                            onClick={() => toggleFaq(faq.id, faq.enabled)}
                                            style={{
                                                background: 'none',
                                                border: 'none',
                                                cursor: 'pointer',
                                                padding: '0.25rem',
                                                borderRadius: '6px',
                                                color: faq.enabled ? 'var(--color-primary)' : '#94a3b8',
                                                display: 'flex',
                                                alignItems: 'center',
                                            }}
                                        >
                                            {faq.enabled
                                                ? <ToggleRight size={22} />
                                                : <ToggleLeft size={22} />}
                                        </button>
                                        <button
                                            title="Excluir"
                                            onClick={() => setConfirmDeleteId(faq.id)}
                                            style={{
                                                background: 'none',
                                                border: 'none',
                                                cursor: 'pointer',
                                                padding: '0.25rem',
                                                borderRadius: '6px',
                                                color: '#ef4444',
                                                display: 'flex',
                                                alignItems: 'center',
                                            }}
                                        >
                                            <Trash2 size={16} />
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </section>
            </div>
            {confirmDeleteId && (
                <ConfirmModal
                    message="Tem certeza que deseja excluir esta FAQ? Essa ação não pode ser desfeita."
                    onConfirm={confirmDeleteFaq}
                    onCancel={() => setConfirmDeleteId(null)}
                />
            )}
        </div>
    );
};

export default BotSettings;
