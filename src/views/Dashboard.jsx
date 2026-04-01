import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
    CarFront, Users, Calendar, TrendingUp, AlertTriangle,
    Clock, ShoppingCart, ArrowUpRight, ChevronRight
} from 'lucide-react';
import { useAppContext, getTodayStr } from '../context/AppContext.jsx';

const Dashboard = () => {
    const navigate = useNavigate();
    const { inventory, soldCars, leads, appointments } = useAppContext();

    const todayStr = getTodayStr();

    // Cálculos Dinâmicos
    const newLeadsToday = leads.filter(l => l.date === todayStr).length;
    const visitsToday = appointments.filter(a => a.date === todayStr).length;
    const availableCars = inventory.filter(c => c.status === 'disponivel').length;
    const reservedCars = inventory.filter(c => c.status === 'reservado').length;
    
    const soldThisMonth = soldCars.length; // Para o MVP, todo o histórico conta como mês atual
    const revenueThisMonth = soldCars.reduce((acc, car) => acc + (car.salePrice || 0), 0);
    const formatCurrency = (val) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(val);

    const upcomingAppointments = appointments
        .filter(a => a.status === 'confirmado' || a.status === 'agendado')
        .slice(0, 3);
        
    const latestLeads = [...leads].reverse().slice(0, 4);

    return (
        <div className="view-content">
            <header className="view-header">
                <h1>Panorama Operacional</h1>
                <p>Resumo em tempo real das operações da sua concessionária.</p>
            </header>

            <div className="metrics-grid">
                <div className="metric-card card">
                    <div className="metric-icon" style={{ background: '#eff6ff', color: '#3b82f6' }}><Users size={24} /></div>
                    <div className="metric-info">
                        <span className="metric-label">Leads Novos Hoje</span>
                        <h3 className="metric-value">{newLeadsToday}</h3>
                    </div>
                </div>
                <div className="metric-card card">
                    <div className="metric-icon" style={{ background: '#fef3c7', color: '#f59e0b' }}><Calendar size={24} /></div>
                    <div className="metric-info">
                        <span className="metric-label">Visitas Hoje</span>
                        <h3 className="metric-value">{visitsToday}</h3>
                    </div>
                </div>
                <div className="metric-card card">
                    <div className="metric-icon" style={{ background: '#ecfdf5', color: '#10b981' }}><CarFront size={24} /></div>
                    <div className="metric-info">
                        <span className="metric-label">Veículos Disponíveis</span>
                        <h3 className="metric-value">{availableCars}</h3>
                    </div>
                </div>
                <div className="metric-card card">
                    <div className="metric-icon" style={{ background: '#fff7ed', color: '#f59e0b' }}><Clock size={24} /></div>
                    <div className="metric-info">
                        <span className="metric-label">Veículos Reservados</span>
                        <h3 className="metric-value">{reservedCars}</h3>
                    </div>
                </div>
                <div className="metric-card card">
                    <div className="metric-icon" style={{ background: '#f0fdf4', color: '#22c55e' }}><ShoppingCart size={24} /></div>
                    <div className="metric-info">
                        <span className="metric-label">Vendidos (Período)</span>
                        <h3 className="metric-value">{soldThisMonth}</h3>
                    </div>
                    <div className="metric-trend positive"><ArrowUpRight size={16} /> Alta</div>
                </div>
                <div className="metric-card card">
                    <div className="metric-icon" style={{ background: '#eef2ff', color: '#6366f1' }}><TrendingUp size={24} /></div>
                    <div className="metric-info">
                        <span className="metric-label">Receita Acumulada</span>
                        <h3 className="metric-value">{formatCurrency(revenueThisMonth)}</h3>
                    </div>
                </div>
            </div>

            <div className="dashboard-grid">
                <section className="dashboard-section card">
                    <div className="section-title">
                        <h2>Próximos Atendimentos</h2>
                        <button className="btn-text" onClick={() => navigate('/agenda')}>Ver agenda <ChevronRight size={16} /></button>
                    </div>
                    <div className="visit-list">
                        {upcomingAppointments.length === 0 ? (
                            <p className="text-muted" style={{ padding: '1rem' }}>Não há próximos atendimentos na agenda.</p>
                        ) : (
                            upcomingAppointments.map((v, i) => (
                                <div key={i} className="list-item">
                                    <div className="item-avatar">{v.customer.substring(0,2).toUpperCase()}</div>
                                    <div className="item-details">
                                        <p className="item-name">{v.customer}</p>
                                        <p className="item-meta">{v.time} • {v.car}</p>
                                    </div>
                                    <span className="status-badge" style={{
                                        background: v.status === 'confirmado' ? '#ecfdf5' : '#eff6ff',
                                        color: v.status === 'confirmado' ? '#10b981' : '#3b82f6',
                                        textTransform: 'capitalize'
                                    }}>{v.status}</span>
                                </div>
                            ))
                        )}
                    </div>
                </section>

                <section className="dashboard-section card">
                    <div className="section-title">
                        <h2>Pendências & Alertas</h2>
                    </div>
                    <div className="alert-list">
                        <div className="alert-item alert-warning">
                            <AlertTriangle size={18} />
                            <span>{leads.filter(l => l.status === 'novo').length} leads aguardando primeiro contato</span>
                            <ChevronRight size={16} />
                        </div>
                        <div className="alert-item alert-info">
                            <Clock size={18} />
                            <span>{appointments.filter(a => a.status === 'agendado').length} agendamentos pendentes de confirmação</span>
                            <ChevronRight size={16} />
                        </div>
                        <div className="alert-item alert-neutral">
                            <CarFront size={18} />
                            <span>Verifique o giro de estoque dos seminovos</span>
                            <ChevronRight size={16} />
                        </div>
                    </div>
                </section>

                <section className="dashboard-section card">
                    <div className="section-title">
                        <h2>Leads Recentes</h2>
                        <button className="btn-text" onClick={() => navigate('/leads')}>Ver todos <ChevronRight size={16} /></button>
                    </div>
                    <div className="lead-list">
                        {latestLeads.length === 0 ? (
                            <p className="text-muted" style={{ padding: '1rem' }}>Não há leads recentes.</p>
                        ) : (
                            latestLeads.map((l, i) => (
                                <div key={i} className="list-item">
                                    <div className="item-avatar">{l.avatar || l.name.substring(0,2).toUpperCase()}</div>
                                    <div className="item-details">
                                        <p className="item-name">{l.name}</p>
                                        <p className="item-meta">Interesse: {l.car}</p>
                                    </div>
                                    <span className="status-badge" style={{
                                        background: l.status === 'novo' ? '#eff6ff' : '#fff7ed',
                                        color: l.status === 'novo' ? '#3b82f6' : '#f59e0b',
                                        textTransform: 'capitalize'
                                    }}>{l.status}</span>
                                </div>
                            ))
                        )}
                    </div>
                </section>
            </div>
        </div>
    );
};

export default Dashboard;
