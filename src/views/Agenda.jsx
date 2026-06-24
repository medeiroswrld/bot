import React, { useState } from 'react';
import {
    Plus, X, Clock, User, CarFront, Phone, CheckCircle, AlertCircle,
    XCircle, CalendarCheck, RotateCcw, Trash2
} from 'lucide-react';

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
import { useAppContext, getTodayStr, formatDateStr } from '../context/AppContext.jsx';

const STATUS_CONFIG = {
    agendado: { label: 'Agendado', icon: <Clock size={14} />, className: 'status-pending' },
    confirmado: { label: 'Confirmado', icon: <CheckCircle size={14} />, className: 'status-success' },
    realizado: { label: 'Realizado', icon: <CalendarCheck size={14} />, className: 'status-done' },
    cancelado: { label: 'Cancelado', icon: <XCircle size={14} />, className: 'status-error' },
    ausente: { label: 'Não Compareceu', icon: <AlertCircle size={14} />, className: 'status-warning' },
};

const NewAppointmentModal = ({ onClose, onSave }) => {
    const [form, setForm] = useState({ customer: '', phone: '', car: '', date: getTodayStr(), time: '10:00', notes: '' });
    const handleChange = (field, value) => setForm(prev => ({ ...prev, [field]: value }));
    const handleSubmit = () => {
        if (!form.customer || !form.date) return;
        onSave(form);
        onClose();
    };
    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content modal-sm" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>Novo Agendamento</h2>
                    <button className="close-btn" onClick={onClose}><X size={24} /></button>
                </div>
                <div className="settings-form">
                    <div className="form-group"><label>Nome do Cliente *</label><input type="text" value={form.customer} onChange={e => handleChange('customer', e.target.value)} placeholder="Nome completo" /></div>
                    <div className="form-row">
                        <div className="form-group"><label>Telefone</label><input type="text" value={form.phone} onChange={e => handleChange('phone', e.target.value)} placeholder="(00) 00000-0000" /></div>
                        <div className="form-group"><label>Veículo de Interesse</label><input type="text" value={form.car} onChange={e => handleChange('car', e.target.value)} placeholder="Ex: Toyota Corolla" /></div>
                    </div>
                    <div className="form-row">
                        <div className="form-group"><label>Data *</label><input type="date" value={form.date} onChange={e => handleChange('date', e.target.value)} /></div>
                        <div className="form-group"><label>Horário</label><input type="time" value={form.time} onChange={e => handleChange('time', e.target.value)} /></div>
                    </div>
                    <div className="form-group"><label>Observações</label><textarea rows={3} value={form.notes} onChange={e => handleChange('notes', e.target.value)} placeholder="Detalhes sobre o agendamento..." /></div>
                    <div className="modal-footer">
                        <button className="btn-secondary" onClick={onClose}>Cancelar</button>
                        <button className="btn-primary" onClick={handleSubmit}>Criar Agendamento</button>
                    </div>
                </div>
            </div>
        </div>
    );
};

const AppointmentDetailModal = ({ appt, onClose, onStatusChange }) => {
    const { leads } = useAppContext();
    if (!appt) return null;
    const s = STATUS_CONFIG[appt.status] || STATUS_CONFIG.agendado;
    // Pré-avaliação de troca: pega do lead casado pelo telefone (sem query nova)
    const lead = leads.find(l => l.phone === appt.phone);
    const tradeIn = lead ? [
        ['Modelo', lead.trade_in_model],
        ['Ano', lead.trade_in_year],
        ['KM', lead.trade_in_km],
        ['Tempo de posse', lead.trade_in_ownership_time],
        ['Nota do dono', lead.trade_in_owner_rating && `${lead.trade_in_owner_rating}/10`],
        ['Pagamento', lead.trade_in_payment_preference],
        ['Diferença', lead.trade_in_difference_payment],
        ['Extras', lead.trade_in_extra_info],
    ].filter(([, v]) => v && String(v).trim()) : [];
    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content modal-sm" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>Detalhes do Agendamento</h2>
                    <button className="close-btn" onClick={onClose}><X size={24} /></button>
                </div>
                <div style={{ padding: '0 0 1.5rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem' }}>
                        <div className="item-avatar" style={{ width: 48, height: 48 }}>{appt.customer.substring(0, 2).toUpperCase()}</div>
                        <div>
                            <h3 style={{ fontWeight: 700 }}>{appt.customer}</h3>
                            <span className={`appointment-status ${s.className}`}>{s.icon} {s.label}</span>
                        </div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem', marginBottom: '1.5rem' }}>
                        <div>
                            <p className="text-muted" style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '0.25rem' }}>Data</p>
                            <p style={{ fontWeight: 600 }}>{formatDateStr(appt.date)}</p>
                        </div>
                        <div>
                            <p className="text-muted" style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '0.25rem' }}>Horário</p>
                            <p style={{ fontWeight: 600 }}>{appt.time}</p>
                        </div>
                        <div>
                            <p className="text-muted" style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '0.25rem' }}>Veículo</p>
                            <p style={{ fontWeight: 600 }}>{appt.car || '—'}</p>
                        </div>
                        <div>
                            <p className="text-muted" style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '0.25rem' }}>Telefone</p>
                            <p style={{ fontWeight: 600 }}>{appt.phone || '—'}</p>
                        </div>
                    </div>
                    {appt.notes && (
                        <div style={{ marginBottom: '1.5rem' }}>
                            <p className="text-muted" style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '0.25rem' }}>Observações</p>
                            <p style={{ fontSize: '0.9rem' }}>{appt.notes}</p>
                        </div>
                    )}
                    {tradeIn.length > 0 && (
                        <div style={{ marginBottom: '1.5rem', padding: '0.75rem 1rem', borderRadius: 10, background: 'var(--input-bg)', border: '1px solid #e2e8f0' }}>
                            <p style={{ fontSize: '0.8rem', fontWeight: 700, marginBottom: '0.5rem' }}>🚗 Pré-avaliação de Troca</p>
                            {tradeIn.map(([label, value]) => (
                                <p key={label} style={{ fontSize: '0.82rem', marginBottom: 2 }}>
                                    <span style={{ color: '#94a3b8' }}>{label}:</span> <strong>{value}</strong>
                                </p>
                            ))}
                        </div>
                    )}
                    <div>
                        <label style={{ fontSize: '0.85rem', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '0.5rem' }}>Alterar Status</label>
                        <select value={appt.status} onChange={e => onStatusChange(appt.id, e.target.value)}
                            style={{ width: '100%', padding: '0.75rem 1rem', borderRadius: 12, border: '1px solid #e2e8f0', fontSize: '0.9rem' }}>
                            {Object.entries(STATUS_CONFIG).map(([key, val]) => (
                                <option key={key} value={key}>{val.label}</option>
                            ))}
                        </select>
                    </div>
                </div>
            </div>
        </div>
    );
};

const RescheduleModal = ({ appt, onClose, onSave }) => {
    const [form, setForm] = useState({ date: appt.date, time: appt.time });
    if (!appt) return null;

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content modal-sm" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>Remarcar Visita</h2>
                    <button className="close-btn" onClick={onClose}><X size={24} /></button>
                </div>
                <div className="settings-form">
                    <p style={{ marginBottom: '1.5rem', color: '#64748b', fontSize: '0.9rem' }}>
                        Cliente: <strong>{appt.customer}</strong>
                    </p>
                    <div className="form-row">
                        <div className="form-group"><label>Nova Data *</label><input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} /></div>
                        <div className="form-group"><label>Novo Horário *</label><input type="time" value={form.time} onChange={e => setForm({ ...form, time: e.target.value })} /></div>
                    </div>
                    <div className="modal-footer">
                        <button className="btn-secondary" onClick={onClose}>Cancelar</button>
                        <button className="btn-primary" onClick={() => { onSave(appt.id, { date: form.date, time: form.time }); onClose(); }}>
                            Confirmar
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

const Agenda = () => {
    const { appointments, addAppointment, updateAppointmentStatus, updateAppointment, deleteAppointment } = useAppContext();
    const [showNewModal, setShowNewModal] = useState(false);
    const [filterStatus, setFilterStatus] = useState('todos');
    const [filterDate, setFilterDate] = useState('');
    const [selectedAppt, setSelectedAppt] = useState(null);
    const [rescheduleAppt, setRescheduleAppt] = useState(null);
    const [confirmDeleteId, setConfirmDeleteId] = useState(null);

    const confirmDelete = () => {
        deleteAppointment(confirmDeleteId);
        if (selectedAppt?.id === confirmDeleteId) setSelectedAppt(null);
        setConfirmDeleteId(null);
    };

    const todayStr = getTodayStr();

    const filtered = appointments.filter(a => {
        const matchStatus = filterStatus === 'todos' || a.status === filterStatus;
        const matchDate = !filterDate || a.date === filterDate;
        return matchStatus && matchDate;
    });

    // Group by day
    const grouped = filtered.reduce((acc, appt) => {
        const key = appt.date;
        if (!acc[key]) acc[key] = [];
        acc[key].push(appt);
        return acc;
    }, {});

    const sortedDates = Object.keys(grouped).sort();

    const getDayLabel = (dateStr) => {
        if (dateStr === todayStr) return 'Hoje';
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        if (dateStr === tomorrow.toISOString().split('T')[0]) return 'Amanhã';
        return formatDateStr(dateStr);
    };

    // Summary
    const todayAppts = appointments.filter(a => a.date === todayStr);
    const summaryData = [
        { label: 'Visitas Hoje', value: todayAppts.length },
        { label: 'Confirmados', value: todayAppts.filter(a => a.status === 'confirmado').length },
        { label: 'Pendentes', value: appointments.filter(a => a.status === 'agendado').length },
        { label: 'Realizados', value: appointments.filter(a => a.status === 'realizado').length },
    ];

    const handleQuickStatus = (e, id, newStatus) => {
        e.stopPropagation();
        updateAppointmentStatus(id, newStatus);
    };

    return (
        <div className="view-content">
            <header className="view-header-flex">
                <div className="view-header">
                    <h1>Agenda de Visitas</h1>
                    <p>Organize test drives e atendimentos presenciais.</p>
                </div>
                <button className="btn-primary" onClick={() => setShowNewModal(true)} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <Plus size={20} /> Novo Agendamento
                </button>
            </header>

            <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '2rem', flexWrap: 'wrap', alignItems: 'center' }}>
                {['todos', 'agendado', 'confirmado', 'realizado', 'cancelado', 'ausente'].map(key => (
                    <button key={key}
                        className={`inv-filter-btn ${filterStatus === key ? 'active' : ''}`}
                        onClick={() => setFilterStatus(key)}
                        style={{ textTransform: 'capitalize' }}>
                        {key === 'todos' ? 'Todos' : STATUS_CONFIG[key]?.label}
                    </button>
                ))}
                <div className="agenda-date-filter">
                    <CalendarCheck size={16} />
                    <input type="date" value={filterDate} onChange={e => setFilterDate(e.target.value)}
                        style={{ border: 'none', background: 'transparent', outline: 'none', fontSize: '0.85rem' }} />
                </div>
            </div>

            <div className="agenda-grid">
                <div className="agenda-main">
                    {sortedDates.length === 0 && (
                        <div style={{ textAlign: 'center', padding: '4rem 2rem' }}>
                            <CalendarCheck size={48} style={{ color: '#94a3b8', marginBottom: '1rem' }} />
                            <h3 style={{ fontWeight: 600, marginBottom: '0.5rem' }}>Agenda vazia para este filtro</h3>
                            <p className="text-muted">Crie um novo agendamento para começar.</p>
                        </div>
                    )}
                    {sortedDates.map(date => (
                        <div key={date} className="day-group">
                            <h3 className="day-title">{getDayLabel(date)}</h3>
                            <div className="appointment-list">
                                {grouped[date].sort((a, b) => a.time.localeCompare(b.time)).map(appt => {
                                    const s = STATUS_CONFIG[appt.status] || STATUS_CONFIG.agendado;
                                    return (
                                        <div key={appt.id} className="appointment-card card" onClick={() => setSelectedAppt(appt)} style={{ cursor: 'pointer' }}>
                                            <div className="app-time">
                                                <Clock size={16} /> {appt.time}
                                            </div>
                                            <div className="app-details">
                                                <p className="app-customer"><User size={14} /> {appt.customer}</p>
                                                <p className="app-car"><CarFront size={14} /> {appt.car}</p>
                                                {appt.phone && <p className="app-phone"><Phone size={12} /> {appt.phone}</p>}
                                            </div>
                                            <div className="app-actions">
                                                <span className={`appointment-status ${s.className}`}>{s.icon} {s.label}</span>
                                                <div className="agenda-quick-actions">
                                                    <button className="agenda-action-btn confirm" title="Confirmar" onClick={e => handleQuickStatus(e, appt.id, 'confirmado')}><CheckCircle size={16} /></button>
                                                    <button className="agenda-action-btn done" title="Realizado" onClick={e => handleQuickStatus(e, appt.id, 'realizado')}><CalendarCheck size={16} /></button>
                                                    <button className="agenda-action-btn" title="Remarcar" onClick={e => { e.stopPropagation(); setRescheduleAppt(appt); }}><RotateCcw size={16} /></button>
                                                    <button className="agenda-action-btn cancel" title="Cancelar" onClick={e => handleQuickStatus(e, appt.id, 'cancelado')}><XCircle size={16} /></button>
                                                    <button className="agenda-action-btn cancel" title="Excluir" onClick={e => { e.stopPropagation(); setConfirmDeleteId(appt.id); }}><Trash2 size={16} /></button>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    ))}
                </div>

                <div className="agenda-sidebar">
                    <div className="sidebar-card card">
                        <h3>Resumo</h3>
                        <div className="summary-list">
                            {summaryData.map(item => (
                                <div key={item.label} className="summary-item">
                                    <span>{item.label}</span>
                                    <strong>{item.value}</strong>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>

            {showNewModal && <NewAppointmentModal onClose={() => setShowNewModal(false)} onSave={addAppointment} />}
            {selectedAppt && <AppointmentDetailModal appt={selectedAppt} onClose={() => setSelectedAppt(null)} onStatusChange={(id, status) => { updateAppointmentStatus(id, status); setSelectedAppt(prev => prev ? { ...prev, status } : null); }} />}
            {rescheduleAppt && <RescheduleModal appt={rescheduleAppt} onClose={() => setRescheduleAppt(null)} onSave={updateAppointment} />}
            {confirmDeleteId && (
                <ConfirmModal
                    message="Tem certeza que deseja excluir este agendamento? Essa ação não pode ser desfeita."
                    onConfirm={confirmDelete}
                    onCancel={() => setConfirmDeleteId(null)}
                />
            )}
        </div>
    );
};

export default Agenda;
