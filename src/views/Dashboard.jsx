import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    MessageCircle, Users, Calendar, CarFront,
    ChevronRight, Bot
} from 'lucide-react';
import { useAppContext, getTodayStr } from '../context/AppContext.jsx';
import { supabase } from '../lib/supabase.js';

const STATUS_LABELS = {
    novo:        { label: 'Novo',           color: '#3b82f6', bg: '#eff6ff' },
    atendimento: { label: 'Em Atendimento', color: '#d97706', bg: '#fff7ed' },
    proposta:    { label: 'Proposta',        color: '#b45309', bg: '#fef3c7' },
    negociacao:  { label: 'Negociação',      color: '#4338ca', bg: '#e0e7ff' },
    vendido:     { label: 'Vendido',         color: '#059669', bg: '#ecfdf5' },
    perdido:     { label: 'Perdido',         color: '#dc2626', bg: '#fef2f2' },
};

const MetricCard = ({ icon, label, value, color, bg }) => (
    <div className="metric-card card">
        <div className="metric-icon" style={{ background: bg, color }}>{icon}</div>
        <div className="metric-info">
            <span className="metric-label">{label}</span>
            <h3 className="metric-value">{value}</h3>
        </div>
    </div>
);

const Dashboard = () => {
    const navigate = useNavigate();
    const { leads, appointments, inventory, user } = useAppContext();

    const todayStr = getTodayStr();

    // ── Conversas do Supabase ─────────────────────────────────────────────────
    const [conversations, setConversations] = useState([]);
    const [loadingConvs, setLoadingConvs] = useState(true);

    useEffect(() => {
        if (!user?.id) return;
        supabase
            .from('conversations')
            .select('id, customer_name, customer_phone, status, last_message_at')
            .eq('user_id', user.id)
            .neq('status', 'closed')
            .order('last_message_at', { ascending: false })
            .limit(5)
            .then(({ data }) => {
                setConversations(data ?? []);
                setLoadingConvs(false);
            });
    }, [user?.id]);

    // ── Métricas calculadas ───────────────────────────────────────────────────

    // Leads novos hoje: compara apenas YYYY-MM-DD do created_at
    const newLeadsToday = leads.filter(l => (l.date ?? '').substring(0, 10) === todayStr).length;

    // Conversas ativas (bot + pending + human) — total e hoje
    const activeConvs = conversations.filter(c => c.status !== 'closed');
    const convsToday  = conversations.filter(c =>
        (c.last_message_at ?? '').substring(0, 10) === todayStr
    ).length;

    // Agendamentos de hoje
    const todayAppts = appointments.filter(a => a.date === todayStr);

    // Total por status no funil
    const leadsByStatus = Object.keys(STATUS_LABELS).map(key => ({
        key,
        ...STATUS_LABELS[key],
        count: leads.filter(l => l.status === key).length,
    }));

    const availableCars = inventory.filter(c => c.status === 'disponivel').length;

    return (
        <div className="view-content">
            <header className="view-header">
                <h1>Início</h1>
                <p>Resumo operacional da sua concessionária — {new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })}.</p>
            </header>

            {/* ── Métricas principais ──────────────────────────────────────── */}
            <div className="metrics-grid">
                <MetricCard
                    icon={<MessageCircle size={22} />}
                    label="Conversas ativas"
                    value={loadingConvs ? '...' : activeConvs.length}
                    color="#6366f1"
                    bg="#eef2ff"
                />
                <MetricCard
                    icon={<MessageCircle size={22} />}
                    label="Conversas hoje"
                    value={loadingConvs ? '...' : convsToday}
                    color="#8b5cf6"
                    bg="#f5f3ff"
                />
                <MetricCard
                    icon={<Users size={22} />}
                    label="Leads novos hoje"
                    value={newLeadsToday}
                    color="#3b82f6"
                    bg="#eff6ff"
                />
                <MetricCard
                    icon={<Calendar size={22} />}
                    label="Visitas hoje"
                    value={todayAppts.length}
                    color="#f59e0b"
                    bg="#fef3c7"
                />
                <MetricCard
                    icon={<CarFront size={22} />}
                    label="Veículos disponíveis"
                    value={availableCars}
                    color="#10b981"
                    bg="#ecfdf5"
                />
                <MetricCard
                    icon={<Users size={22} />}
                    label="Total de leads"
                    value={leads.length}
                    color="#64748b"
                    bg="#f1f5f9"
                />
            </div>

            <div className="dashboard-grid">
                {/* ── Agendamentos de hoje ────────────────────────────────── */}
                <section className="dashboard-section card">
                    <div className="section-title">
                        <h2>Visitas Hoje</h2>
                        <button className="btn-text" onClick={() => navigate('/agenda')}>
                            Ver agenda <ChevronRight size={16} />
                        </button>
                    </div>
                    <div className="visit-list">
                        {todayAppts.length === 0 ? (
                            <p className="text-muted" style={{ padding: '1rem' }}>
                                Nenhuma visita agendada para hoje.
                            </p>
                        ) : (
                            todayAppts
                                .sort((a, b) => a.time.localeCompare(b.time))
                                .map(a => (
                                    <div key={a.id} className="list-item">
                                        <div className="item-avatar">
                                            {(a.customer ?? 'C').substring(0, 2).toUpperCase()}
                                        </div>
                                        <div className="item-details">
                                            <p className="item-name">{a.customer}</p>
                                            <p className="item-meta">{a.time}{a.car ? ` • ${a.car}` : ''}</p>
                                        </div>
                                        <span className="status-badge" style={{
                                            background: a.status === 'confirmado' ? '#ecfdf5' : '#eff6ff',
                                            color: a.status === 'confirmado' ? '#10b981' : '#3b82f6',
                                            textTransform: 'capitalize',
                                        }}>
                                            {a.status}
                                        </span>
                                    </div>
                                ))
                        )}
                    </div>
                </section>

                {/* ── Funil de leads ──────────────────────────────────────── */}
                <section className="dashboard-section card">
                    <div className="section-title">
                        <h2>Funil de Leads</h2>
                        <button className="btn-text" onClick={() => navigate('/leads')}>
                            Ver leads <ChevronRight size={16} />
                        </button>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', padding: '0.25rem 0' }}>
                        {leadsByStatus.map(({ key, label, color, bg, count }) => (
                            count > 0 && (
                                <div key={key} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                    <span style={{
                                        width: 80, fontSize: '0.78rem', fontWeight: 600,
                                        color, background: bg, borderRadius: 20,
                                        padding: '2px 8px', textAlign: 'center', flexShrink: 0,
                                    }}>
                                        {label}
                                    </span>
                                    <div style={{ flex: 1, height: 8, borderRadius: 4, background: '#f1f5f9', overflow: 'hidden' }}>
                                        <div style={{
                                            height: '100%', borderRadius: 4, background: color,
                                            width: `${Math.min(100, (count / Math.max(leads.length, 1)) * 100)}%`,
                                            transition: 'width 0.3s',
                                        }} />
                                    </div>
                                    <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--color-text-main)', width: 24, textAlign: 'right' }}>
                                        {count}
                                    </span>
                                </div>
                            )
                        ))}
                        {leads.length === 0 && (
                            <p className="text-muted" style={{ fontSize: '0.85rem' }}>Nenhum lead ainda.</p>
                        )}
                    </div>
                </section>

                {/* ── Últimas conversas ───────────────────────────────────── */}
                <section className="dashboard-section card" style={{ gridColumn: '1 / -1' }}>
                    <div className="section-title">
                        <h2>Últimas Conversas Ativas</h2>
                        <button className="btn-text" onClick={() => navigate('/conversations')}>
                            Ver todas <ChevronRight size={16} />
                        </button>
                    </div>
                    <div className="lead-list">
                        {loadingConvs ? (
                            <p className="text-muted" style={{ padding: '1rem' }}>Carregando...</p>
                        ) : activeConvs.length === 0 ? (
                            <p className="text-muted" style={{ padding: '1rem' }}>Nenhuma conversa ativa no momento.</p>
                        ) : (
                            activeConvs.slice(0, 5).map(conv => {
                                const statusMap = {
                                    bot:     { label: 'Bot',      color: '#6366f1', bg: '#eef2ff' },
                                    pending: { label: 'Pendente', color: '#d97706', bg: '#fff7ed' },
                                    human:   { label: 'Humano',   color: '#10b981', bg: '#ecfdf5' },
                                };
                                const s = statusMap[conv.status] ?? statusMap.bot;
                                const name = conv.customer_name ?? conv.customer_phone;
                                const ago = (() => {
                                    if (!conv.last_message_at) return '';
                                    const mins = Math.floor((Date.now() - new Date(conv.last_message_at).getTime()) / 60000);
                                    if (mins < 1) return 'agora';
                                    if (mins < 60) return `${mins}m atrás`;
                                    const hrs = Math.floor(mins / 60);
                                    if (hrs < 24) return `${hrs}h atrás`;
                                    return `${Math.floor(hrs / 24)}d atrás`;
                                })();
                                return (
                                    <div key={conv.id} className="list-item" style={{ cursor: 'pointer' }}
                                        onClick={() => navigate('/conversations')}>
                                        <div className="item-avatar" style={{ background: s.color, color: '#fff' }}>
                                            {name.substring(0, 2).toUpperCase()}
                                        </div>
                                        <div className="item-details">
                                            <p className="item-name">{name}</p>
                                            <p className="item-meta">{conv.customer_phone}{ago ? ` • ${ago}` : ''}</p>
                                        </div>
                                        <span className="status-badge" style={{ background: s.bg, color: s.color }}>
                                            {conv.status === 'bot' ? <><Bot size={11} style={{ marginRight: 3 }} />{s.label}</> : s.label}
                                        </span>
                                    </div>
                                );
                            })
                        )}
                    </div>
                </section>
            </div>
        </div>
    );
};

export default Dashboard;
