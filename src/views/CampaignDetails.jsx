import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Send, CheckCircle2, Eye, XCircle, Loader2 } from 'lucide-react';
import { useAppContext } from '../context/AppContext.jsx';
import { supabase } from '../lib/supabase.js';

const SEND_STATUS = {
    pending:   { label: 'Pendente',  color: '#64748b', bg: '#f1f5f9' },
    sent:      { label: 'Enviada',   color: '#2563eb', bg: '#eff6ff' },
    delivered: { label: 'Entregue',  color: '#0891b2', bg: '#ecfeff' },
    read:      { label: 'Lida',      color: '#059669', bg: '#ecfdf5' },
    failed:    { label: 'Falhou',    color: '#dc2626', bg: '#fef2f2' },
};

const StatCard = ({ icon, label, value, color }) => (
    <div className="card" style={{ padding: '1.1rem 1.25rem', display: 'flex', alignItems: 'center', gap: 14 }}>
        <div style={{ width: 42, height: 42, borderRadius: 10, background: `${color}18`, color, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{icon}</div>
        <div>
            <p style={{ margin: 0, fontSize: '0.72rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>{label}</p>
            <h3 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 800 }}>{value}</h3>
        </div>
    </div>
);

const CampaignDetails = () => {
    const { id } = useParams();
    const navigate = useNavigate();
    const { campaigns, fetchCampaignSends } = useAppContext();
    const [sends, setSends] = useState([]);
    const [loading, setLoading] = useState(true);

    const campaign = (campaigns || []).find(c => c.id === id) || null;

    const load = useCallback(async (signal) => {
        try {
            const data = await fetchCampaignSends(id, signal);
            if (signal?.aborted) return;
            setSends(data);
        } finally {
            if (!signal?.aborted) setLoading(false);
        }
    }, [id, fetchCampaignSends]);

    useEffect(() => {
        const controller = new AbortController();
        // Watchdog: se pendurar (conexão morta após dormir a aba), aborta e solta o spinner.
        const timer = setTimeout(() => { controller.abort(); setLoading(false); }, 10000);
        load(controller.signal).finally(() => clearTimeout(timer));
        return () => { clearTimeout(timer); controller.abort(); };
    }, [load]);

    // Realtime nos envios desta campanha
    useEffect(() => {
        const channel = supabase
            .channel(`campaign-sends-${id}-${Math.random().toString(36).slice(2)}`)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'campaign_sends', filter: `campaign_id=eq.${id}` }, () => load())
            .subscribe();
        return () => { supabase.removeChannel(channel); };
    }, [id, load]);

    const counts = sends.reduce((acc, s) => { acc[s.status] = (acc[s.status] || 0) + 1; return acc; }, {});
    const total = sends.length;
    const done = (counts.sent || 0) + (counts.delivered || 0) + (counts.read || 0) + (counts.failed || 0);
    const progress = total ? Math.round((done / total) * 100) : 0;

    return (
        <div className="view-content">
            <header className="view-header-flex">
                <div className="view-header">
                    <button className="btn-text" onClick={() => navigate('/campanhas')} style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 6 }}>
                        <ArrowLeft size={16} /> Campanhas
                    </button>
                    <h1>{campaign?.name || 'Campanha'}</h1>
                    <p>{campaign?.template?.display_name} • {campaign?.status}</p>
                </div>
            </header>

            <div className="metrics-grid">
                <StatCard icon={<Send size={20} />} label="Enviadas" value={(counts.sent || 0) + (counts.delivered || 0) + (counts.read || 0)} color="#2563eb" />
                <StatCard icon={<CheckCircle2 size={20} />} label="Entregues" value={(counts.delivered || 0) + (counts.read || 0)} color="#0891b2" />
                <StatCard icon={<Eye size={20} />} label="Lidas" value={counts.read || 0} color="#059669" />
                <StatCard icon={<XCircle size={20} />} label="Falharam" value={counts.failed || 0} color="#dc2626" />
            </div>

            {campaign?.status === 'sending' && (
                <div className="card" style={{ padding: '1rem 1.25rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: '0.85rem' }}>
                        <span>Enviando...</span><span>{progress}%</span>
                    </div>
                    <div style={{ height: 8, borderRadius: 4, background: 'var(--input-bg)', overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${progress}%`, background: 'var(--primary)', transition: 'width 0.3s' }} />
                    </div>
                </div>
            )}

            <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
                {loading ? (
                    <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}><Loader2 size={24} style={{ animation: 'spin 1s linear infinite', color: 'var(--primary)' }} /></div>
                ) : sends.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-secondary)' }}>Nenhum envio registrado ainda.</div>
                ) : (
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
                        <thead>
                            <tr style={{ borderBottom: '1px solid var(--border)', textAlign: 'left', color: 'var(--text-secondary)' }}>
                                <th style={{ padding: '10px 16px', fontWeight: 600 }}>Cliente</th>
                                <th style={{ padding: '10px 16px', fontWeight: 600 }}>Telefone</th>
                                <th style={{ padding: '10px 16px', fontWeight: 600 }}>Status</th>
                                <th style={{ padding: '10px 16px', fontWeight: 600 }}>Detalhe</th>
                            </tr>
                        </thead>
                        <tbody>
                            {sends.map(s => {
                                const cfg = SEND_STATUS[s.status] ?? SEND_STATUS.pending;
                                return (
                                    <tr key={s.id} style={{ borderBottom: '1px solid var(--border)' }}>
                                        <td style={{ padding: '10px 16px' }}>{s.customer_name || '—'}</td>
                                        <td style={{ padding: '10px 16px', color: 'var(--text-secondary)' }}>{s.customer_phone}</td>
                                        <td style={{ padding: '10px 16px' }}><span className="status-badge" style={{ background: cfg.bg, color: cfg.color }}>{cfg.label}</span></td>
                                        <td style={{ padding: '10px 16px', fontSize: '0.78rem', color: '#dc2626' }}>{s.error_message ? s.error_message.slice(0, 80) : ''}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                )}
            </div>
        </div>
    );
};

export default CampaignDetails;
