import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    MessageCircle, Users, Calendar, CarFront,
    ChevronRight, Bot
} from 'lucide-react';
import { useAppContext, getTodayStr } from '../context/AppContext.jsx';
import PrimeirosPassos from './PrimeirosPassos.jsx';
import ResultadosAssistente from './ResultadosAssistente.jsx';
import VendasDoAssistente from './VendasDoAssistente.jsx';
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

// ─── Area Chart ───────────────────────────────────────────────────────────────

const fmtBRL = (v) =>
    v === 0 ? 'R$ 0' : `R$ ${Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}`;

// ─── useCountUp ───────────────────────────────────────────────────────────────

const useCountUp = (target, duration = 900) => {
    const [count, setCount] = useState(0);
    useEffect(() => {
        if (!target) { setCount(0); return; }
        let frameId;
        const start = Date.now();
        const tick = () => {
            const progress = Math.min((Date.now() - start) / duration, 1);
            const eased = 1 - Math.pow(1 - progress, 3); // ease-out cúbico
            setCount(Math.round(target * eased));
            if (progress < 1) { frameId = requestAnimationFrame(tick); }
        };
        frameId = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(frameId);
    }, [target, duration]);
    return count;
};

const AreaChart = ({ points, labels, color = '#6366f1', formatValue }) => {
    const [hoverIdx, setHoverIdx] = useState(null);
    const H = 88, W = 100;
    const padTop = 14, padBottom = 6;
    const maxVal = Math.max(...points, 1);

    const coords = points.map((v, i) => ({
        x: points.length === 1 ? W / 2 : (i / (points.length - 1)) * W,
        y: H - padBottom - (v / maxVal) * (H - padTop - padBottom),
        v,
    }));

    const linePath = coords.map((c, i) => {
        if (i === 0) return `M${c.x.toFixed(2)},${c.y.toFixed(2)}`;
        const prev = coords[i - 1];
        const dx = (c.x - prev.x) * 0.42;
        return `C${(prev.x + dx).toFixed(2)},${prev.y.toFixed(2)} ${(c.x - dx).toFixed(2)},${c.y.toFixed(2)} ${c.x.toFixed(2)},${c.y.toFixed(2)}`;
    }).join(' ');

    const last = coords[coords.length - 1];
    const first = coords[0];
    const areaPath = `${linePath} L${last.x},${H} L${first.x},${H} Z`;
    const gId = `ac-${color.replace(/[^a-z0-9]/gi, '')}`;

    return (
        <div style={{ position: 'relative', userSelect: 'none' }}>
            <svg
                viewBox={`0 0 ${W} ${H}`}
                preserveAspectRatio="none"
                style={{ width: '100%', height: 108, display: 'block', overflow: 'visible' }}
            >
                <defs>
                    <linearGradient id={gId} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={color} stopOpacity="0.38" />
                        <stop offset="100%" stopColor={color} stopOpacity="0.01" />
                    </linearGradient>
                </defs>

                {/* Grid horizontal lines */}
                {[0.25, 0.5, 0.75].map((f) => {
                    const y = padTop + (1 - f) * (H - padTop - padBottom);
                    return (
                        <line
                            key={f}
                            x1="0" y1={y.toFixed(1)}
                            x2={W} y2={y.toFixed(1)}
                            stroke="currentColor"
                            strokeOpacity="0.07"
                            strokeWidth="0.6"
                        />
                    );
                })}

                <path d={areaPath} fill={`url(#${gId})`} />
                <path d={linePath} fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" />

                {/* Hover zones + indicators */}
                {coords.map((c, i) => {
                    const prevMid = i === 0 ? 0 : (coords[i - 1].x + c.x) / 2;
                    const nextMid = i === coords.length - 1 ? W : (c.x + coords[i + 1].x) / 2;
                    const isHov = hoverIdx === i;
                    return (
                        <g key={i}>
                            <rect
                                x={prevMid} y={0}
                                width={nextMid - prevMid} height={H}
                                fill="transparent"
                                onMouseEnter={() => setHoverIdx(i)}
                                onMouseLeave={() => setHoverIdx(null)}
                                style={{ cursor: 'crosshair' }}
                            />
                            {isHov && (
                                <>
                                    <line
                                        x1={c.x.toFixed(2)} y1={padTop / 2}
                                        x2={c.x.toFixed(2)} y2={H}
                                        stroke={color} strokeWidth="0.7"
                                        strokeDasharray="2.5,2" opacity="0.5"
                                    />
                                    <circle cx={c.x} cy={c.y} r="4" fill="white" />
                                    <circle cx={c.x} cy={c.y} r="2.6" fill={color} />
                                </>
                            )}
                        </g>
                    );
                })}
            </svg>

            {/* Tooltip */}
            {hoverIdx !== null && (
                <div style={{
                    position: 'absolute',
                    left: `${(coords[hoverIdx].x / W) * 100}%`,
                    top: 0,
                    transform: 'translate(-50%, 0)',
                    background: 'var(--bg-card)',
                    border: `1px solid ${color}50`,
                    borderRadius: 7,
                    padding: '3px 10px',
                    fontSize: '0.73rem',
                    fontWeight: 700,
                    color: 'var(--text-primary)',
                    pointerEvents: 'none',
                    whiteSpace: 'nowrap',
                    boxShadow: '0 4px 16px rgba(0,0,0,0.14)',
                    zIndex: 10,
                }}>
                    <span style={{ color }}>{formatValue ? formatValue(points[hoverIdx]) : points[hoverIdx]}</span>
                    <span style={{ color: 'var(--text-secondary)', fontWeight: 400, marginLeft: 5 }}>
                        {labels[hoverIdx]}
                    </span>
                </div>
            )}

            {/* X-axis labels — posicionados no mesmo % x dos pontos SVG */}
            <div style={{ position: 'relative', height: 18, marginTop: 6 }}>
                {labels.map((l, i) => (
                    <span key={i} style={{
                        position: 'absolute',
                        left: `${(i / (labels.length - 1)) * 100}%`,
                        transform: 'translateX(-50%)',
                        fontSize: '0.62rem',
                        color: hoverIdx === i ? color : 'var(--text-secondary)',
                        fontWeight: hoverIdx === i ? 700 : 400,
                        transition: 'color 0.12s',
                        whiteSpace: 'nowrap',
                    }}>
                        {l}
                    </span>
                ))}
            </div>
        </div>
    );
};

// ─── Bar Chart ────────────────────────────────────────────────────────────────

const BarChart = ({ items }) => {
    const [hoverIdx, setHoverIdx] = useState(null);
    const maxCount = Math.max(...items.map(s => s.count), 1);

    return (
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 136, paddingTop: 20 }}>
            {items.map((item, i) => {
                const pct = (item.count / maxCount) * 100;
                const isHov = hoverIdx === i;
                return (
                    <div
                        key={item.key}
                        style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, cursor: 'default' }}
                        onMouseEnter={() => setHoverIdx(i)}
                        onMouseLeave={() => setHoverIdx(null)}
                    >
                        {/* Count label */}
                        <span style={{
                            fontSize: '0.75rem', fontWeight: 700,
                            color: isHov ? item.color : 'transparent',
                            transition: 'color 0.14s',
                            height: 18, lineHeight: '18px',
                        }}>
                            {item.count}
                        </span>
                        {/* Bar */}
                        <div style={{
                            width: '100%',
                            height: `${Math.max(pct, 4)}%`,
                            maxHeight: 78,
                            background: `linear-gradient(to top, ${item.color}aa, ${item.color})`,
                            borderRadius: '5px 5px 2px 2px',
                            opacity: hoverIdx === null || isHov ? 1 : 0.38,
                            transition: 'opacity 0.15s',
                            boxShadow: isHov ? `0 -3px 14px ${item.color}44` : 'none',
                        }} />
                        {/* Label */}
                        <span style={{
                            fontSize: '0.59rem',
                            color: isHov ? item.color : 'var(--text-secondary)',
                            textAlign: 'center', lineHeight: 1.25,
                            transition: 'color 0.14s',
                        }}>
                            {item.label.split(' ')[0]}
                        </span>
                    </div>
                );
            })}
        </div>
    );
};

// ─── Dashboard ────────────────────────────────────────────────────────────────

const DAY_NAMES = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

const Dashboard = () => {
    const navigate = useNavigate();
    const { leads, appointments, inventory, soldCars, user } = useAppContext();

    const todayStr = getTodayStr();

    // ── Conversas do Supabase ─────────────────────────────────────────────────
    const [conversations, setConversations] = useState([]);
    const [loadingConvs, setLoadingConvs] = useState(true);

    useEffect(() => {
        if (!user?.id) return;
        const controller = new AbortController();
        // Watchdog: se a query pendurar (conexão morta após dormir a aba), aborta e solta o spinner.
        const timer = setTimeout(() => { controller.abort(); setLoadingConvs(false); }, 10000);
        supabase
            .from('conversations')
            .select('id, customer_name, customer_phone, status, last_message_at')
            .eq('user_id', user.id)
            .neq('status', 'closed')
            .order('last_message_at', { ascending: false })
            .limit(5)
            .abortSignal(controller.signal)
            .then(({ data }) => {
                if (controller.signal.aborted) return;
                setConversations(data ?? []);
            })
            .catch(() => { /* abort/erro: ignora */ })
            .finally(() => {
                clearTimeout(timer);
                if (!controller.signal.aborted) setLoadingConvs(false);
            });
        return () => { clearTimeout(timer); controller.abort(); };
    }, [user?.id]);

    // ── Métricas calculadas ───────────────────────────────────────────────────

    const newLeadsToday = leads.filter(l => (l.date ?? '').substring(0, 10) === todayStr).length;
    const activeConvs   = conversations.filter(c => c.status !== 'closed');
    const convsToday    = conversations.filter(c => (c.last_message_at ?? '').substring(0, 10) === todayStr).length;
    const todayAppts    = appointments.filter(a => a.date === todayStr);
    const availableCars = inventory.filter(c => c.status === 'disponivel').length;

    const leadsByStatus = Object.keys(STATUS_LABELS).map(key => ({
        key,
        ...STATUS_LABELS[key],
        count: leads.filter(l => l.status === key).length,
    }));

    // ── Dados dos gráficos ────────────────────────────────────────────────────

    const last7Days = Array.from({ length: 7 }, (_, i) => {
        const d = new Date();
        d.setDate(d.getDate() - (6 - i));
        return {
            date:  d.toISOString().substring(0, 10),
            label: i === 6 ? 'Hoje' : DAY_NAMES[d.getDay()],
        };
    });

    const leadsPerDay  = last7Days.map(({ date }) => leads.filter(l => (l.date ?? '').substring(0, 10) === date).length);
    const totalLeads7d = leadsPerDay.reduce((a, b) => a + b, 0);
    const dayLabels    = last7Days.map(d => d.label);

    const activeStatuses = leadsByStatus.filter(s => s.count > 0);

    // ── Animações de contagem ─────────────────────────────────────────────────
    const countLeads7d     = useCountUp(totalLeads7d);
    const countLeadsTotal  = useCountUp(leads.length);

    // ── Faturamento ───────────────────────────────────────────────────────────
    const revenuePerDay = last7Days.map(({ date }) =>
        soldCars
            .filter(c => (c.sold_at ?? '').substring(0, 10) === date)
            .reduce((sum, c) => sum + (Number(c.sold_price) || 0), 0)
    );
    const totalRevenue7d = revenuePerDay.reduce((a, b) => a + b, 0);
    const soldCount7d    = soldCars.filter(c => {
        const d = (c.sold_at ?? '').substring(0, 10);
        return d >= last7Days[0].date && d <= last7Days[6].date;
    }).length;
    const countRevenue   = useCountUp(totalRevenue7d);
    const countSales     = useCountUp(soldCount7d);

    // ─────────────────────────────────────────────────────────────────────────

    return (
        <div className="view-content">
            <header className="view-header">
                <h1>Início</h1>
                <p>Resumo operacional da sua concessionária — {new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })}.</p>
            </header>

            {/* Fica ACIMA das métricas de propósito: numa loja que acabou de
                entrar, todas elas são zero, e zero no topo da primeira tela diz
                "aqui não acontece nada". A lista diz o que fazer para que
                acontecam. Some sozinha quando os quatro passos estiverem feitos. */}
            <PrimeirosPassos />

            {/* Logo abaixo da lista de tarefas e ACIMA das metricas de operacao:
                a lista diz o que falta fazer, este painel diz o que ja foi
                feito por conta propria. Some sozinho para quem nao tem
                assistente contratado. */}
            <ResultadosAssistente />
            <VendasDoAssistente />

            {/* ── Métricas principais ──────────────────────────────────────── */}
            <div className="metrics-grid">
                <MetricCard icon={<MessageCircle size={22} />} label="Conversas ativas"    value={loadingConvs ? '...' : activeConvs.length} color="#6366f1" bg="#eef2ff" />
                <MetricCard icon={<MessageCircle size={22} />} label="Conversas hoje"      value={loadingConvs ? '...' : convsToday}         color="#8b5cf6" bg="#f5f3ff" />
                <MetricCard icon={<Users size={22} />}         label="Leads novos hoje"    value={newLeadsToday}                              color="#3b82f6" bg="#eff6ff" />
                <MetricCard icon={<Calendar size={22} />}      label="Visitas hoje"         value={todayAppts.length}                          color="#f59e0b" bg="#fef3c7" />
                <MetricCard icon={<CarFront size={22} />}      label="Veículos disponíveis" value={availableCars}                              color="#10b981" bg="#ecfdf5" />
                <MetricCard icon={<Users size={22} />}         label="Total de leads"       value={leads.length}                               color="#64748b" bg="#f1f5f9" />
            </div>

            {/* ── Gráficos interativos ─────────────────────────────────────── */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '1.5rem' }}>

                {/* Leads — Últimos 7 Dias */}
                <div className="card" style={{ padding: '1.5rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.9rem' }}>
                        <div>
                            <p style={{ margin: 0, fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                                Novos Leads
                            </p>
                            <h2 style={{ margin: '2px 0 0', fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                                Últimos 7 dias
                            </h2>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                            <span style={{ fontSize: '1.75rem', fontWeight: 800, color: '#6366f1', lineHeight: 1 }}>
                                {countLeads7d}
                            </span>
                            <p style={{ margin: '2px 0 0', fontSize: '0.68rem', color: 'var(--text-secondary)' }}>
                                leads captados
                            </p>
                        </div>
                    </div>
                    <AreaChart points={leadsPerDay} labels={dayLabels} color="#6366f1" />
                </div>

                {/* Funil Visual */}
                <div className="card" style={{ padding: '1.5rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.9rem' }}>
                        <div>
                            <p style={{ margin: 0, fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                                Pipeline
                            </p>
                            <h2 style={{ margin: '2px 0 0', fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                                Funil por Status
                            </h2>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                            <span style={{ fontSize: '1.75rem', fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1 }}>
                                {countLeadsTotal}
                            </span>
                            <p style={{ margin: '2px 0 0', fontSize: '0.68rem', color: 'var(--text-secondary)' }}>
                                total de leads
                            </p>
                        </div>
                    </div>
                    {activeStatuses.length > 0 ? (
                        <BarChart items={activeStatuses} />
                    ) : (
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 136, color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                            Nenhum lead cadastrado ainda.
                        </div>
                    )}
                </div>
            </div>

            {/* ── Faturamento ──────────────────────────────────────────────── */}
            <div className="card" style={{ padding: '1.5rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.9rem' }}>
                    <div>
                        <p style={{ margin: 0, fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                            Faturamento
                        </p>
                        <h2 style={{ margin: '2px 0 0', fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                            Vendas — Últimos 7 dias
                        </h2>
                    </div>
                    <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'flex-start' }}>
                        <div style={{ textAlign: 'right' }}>
                            <span style={{ fontSize: '1.75rem', fontWeight: 800, color: '#10b981', lineHeight: 1 }}>
                                {fmtBRL(countRevenue)}
                            </span>
                            <p style={{ margin: '2px 0 0', fontSize: '0.68rem', color: 'var(--text-secondary)' }}>
                                receita no período
                            </p>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                            <span style={{ fontSize: '1.75rem', fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1 }}>
                                {countSales}
                            </span>
                            <p style={{ margin: '2px 0 0', fontSize: '0.68rem', color: 'var(--text-secondary)' }}>
                                {soldCount7d === 1 ? 'venda' : 'vendas'}
                            </p>
                        </div>
                    </div>
                </div>
                <AreaChart
                    points={revenuePerDay}
                    labels={dayLabels}
                    color="#10b981"
                    formatValue={fmtBRL}
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
                                    <div style={{ flex: 1, height: 8, borderRadius: 4, background: 'var(--input-bg)', overflow: 'hidden' }}>
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
                                const s    = statusMap[conv.status] ?? statusMap.bot;
                                const name = conv.customer_name ?? conv.customer_phone;
                                const ago  = (() => {
                                    if (!conv.last_message_at) return '';
                                    const mins = Math.floor((Date.now() - new Date(conv.last_message_at).getTime()) / 60000);
                                    if (mins < 1)  return 'agora';
                                    if (mins < 60) return `${mins}m atrás`;
                                    const hrs = Math.floor(mins / 60);
                                    if (hrs < 24)  return `${hrs}h atrás`;
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
