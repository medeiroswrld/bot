import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { X, Copy, Bookmark, Rocket, Settings, Loader2 } from 'lucide-react';
import { useAppContext } from '../context/AppContext.jsx';

const fmtBRL = (n) => `R$ ${Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}`;
const fmtKm  = (n) => `${Number(n).toLocaleString('pt-BR')} km`;

const MatchFoundModal = ({ data, onClose }) => {
    const navigate = useNavigate();
    const { addToast, waitingListTemplateReady, notifyWaitingListMatch } = useAppContext();
    const [notifying, setNotifying] = useState(false);
    if (!data) return null;

    const { car, matches = [], matches_count = 0 } = data;

    const notifyAll = async () => {
        setNotifying(true);
        const ok = await notifyWaitingListMatch(car.id, matches.map(m => m.id));
        setNotifying(false);
        if (ok) onClose();
    };

    const buildMessage = (m) => {
        const nome = (m.customer_name || '').split(' ')[0] || 'tudo bem';
        const carInfo = `${car.name}, ${car.year}, ${fmtKm(car.km ?? 0)}, ${fmtBRL(car.price)}`;
        return `Olá ${nome}! Lembra do ${m.model} que você procurava? Acabou de entrar um aqui na loja: ${carInfo}. Quer ver as fotos?`;
    };

    const copyMsg = async (m) => {
        try {
            await navigator.clipboard.writeText(buildMessage(m));
            addToast('Mensagem copiada!', 'success');
        } catch {
            addToast('Não consegui copiar. Tente manualmente.', 'error');
        }
    };

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        🎯 {matches_count} {matches_count === 1 ? 'cliente quer' : 'clientes querem'} esse carro!
                    </h2>
                    <button className="close-btn" onClick={onClose}><X size={24} /></button>
                </div>

                <p className="text-muted" style={{ fontSize: '0.85rem', marginBottom: 12 }}>
                    O <strong>{car.name}</strong> que você acabou de cadastrar bate com interesses na lista de espera.
                    Copie a mensagem e avise cada cliente pelo WhatsApp.
                </p>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {matches.map((m) => (
                        <div key={m.id} style={{ display: 'flex', gap: 12, alignItems: 'center', padding: 12, border: '1px solid var(--border)', borderRadius: 10, flexWrap: 'wrap' }}>
                            <div style={{ flex: 1, minWidth: 180 }}>
                                <p style={{ margin: 0, fontWeight: 700 }}>{m.customer_name || 'Cliente'}</p>
                                <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                                    {m.customer_phone} • procurava: {m.model}
                                </p>
                                {m.notes && <p style={{ margin: '2px 0 0', fontSize: '0.75rem', color: 'var(--text-secondary)', fontStyle: 'italic' }}>{m.notes}</p>}
                            </div>
                            <button className="btn-primary" style={{ display: 'flex', alignItems: 'center', gap: 6 }} onClick={() => copyMsg(m)}>
                                <Copy size={15} /> Copiar mensagem
                            </button>
                        </div>
                    ))}
                </div>

                {/* Aviso automático (se template configurado e aprovado) */}
                {waitingListTemplateReady ? (
                    <div style={{ marginTop: 14, padding: 12, borderRadius: 10, background: 'var(--bg-card)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '0.85rem' }}>Quer disparar o aviso oficial (template) pra todos de uma vez?</span>
                        <button className="btn-primary" onClick={notifyAll} disabled={notifying}
                            style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#059669' }}>
                            {notifying ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : <Rocket size={16} />}
                            Avisar todos automaticamente
                        </button>
                    </div>
                ) : (
                    <div style={{ marginTop: 12, fontSize: '0.78rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Settings size={14} />
                        <button className="btn-text" style={{ padding: 0 }} onClick={() => { onClose(); navigate('/configuracoes'); }}>
                            Configurar avisos automáticos →
                        </button>
                    </div>
                )}

                <div className="modal-footer" style={{ marginTop: 16 }}>
                    <button className="btn-secondary" onClick={onClose}>Fechar</button>
                    <button className="btn-primary" style={{ display: 'flex', alignItems: 'center', gap: 6 }} onClick={() => { onClose(); navigate('/lista-de-espera'); }}>
                        <Bookmark size={16} /> Ir pra Lista de Espera
                    </button>
                </div>
            </div>
        </div>
    );
};

export default MatchFoundModal;
