import { useNavigate } from 'react-router-dom';
import { X, Copy, Bookmark } from 'lucide-react';
import { useAppContext } from '../context/AppContext.jsx';

const fmtBRL = (n) => `R$ ${Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}`;
const fmtKm  = (n) => `${Number(n).toLocaleString('pt-BR')} km`;

const MatchFoundModal = ({ data, onClose }) => {
    const navigate = useNavigate();
    const { addToast } = useAppContext();
    if (!data) return null;

    const { car, matches = [], matches_count = 0 } = data;

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
