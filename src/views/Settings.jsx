import React, { useState, useEffect } from 'react';
import {
    Building2, Calendar, MapPin, Phone, MessageSquare, Save, CheckCircle,
    User, Mail, ToggleLeft, ToggleRight, Plus, Trash2, CalendarOff
} from 'lucide-react';
import { useAppContext } from '../context/AppContext.jsx';
import { supabase } from '../lib/supabase.js';

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

const Settings = () => {
    const { company, updateCompany, profile, user } = useAppContext();

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

    useEffect(() => {
        if (!user?.id) return;
        supabase
            .from('company_settings')
            .select('business_hours, appointment_duration, appointment_interval, max_appointments_per_slot')
            .eq('user_id', user.id)
            .single()
            .then(({ data }) => {
                if (data?.business_hours) setBh({ ...DEFAULT_BH, ...data.business_hours });
                if (data?.appointment_duration) setApptDuration(String(data.appointment_duration));
                if (data?.appointment_interval) setApptInterval(String(data.appointment_interval));
                if (data?.max_appointments_per_slot) setApptMaxPerSlot(String(data.max_appointments_per_slot));
            });
    }, [user?.id]);

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
        setSavingSchedule(false);
        setSavedSchedule(true);
        setTimeout(() => setSavedSchedule(false), 2000);
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
        supabase
            .from('schedule_exceptions')
            .select('*')
            .eq('user_id', user.id)
            .order('date', { ascending: true })
            .then(({ data }) => {
                setExceptions(data || []);
                setLoadingEx(false);
            });
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
                                                        border: '1px solid #cbd5e1', fontSize: '0.875rem',
                                                        background: '#f8fafc', flex: 1,
                                                    }}
                                                />
                                                <span style={{ color: '#94a3b8', fontSize: '0.8rem', flexShrink: 0 }}>às</span>
                                                <input
                                                    type="time"
                                                    value={day.end}
                                                    onChange={e => setDayField(key, 'end', e.target.value)}
                                                    style={{
                                                        padding: '0.35rem 0.5rem', borderRadius: '8px',
                                                        border: '1px solid #cbd5e1', fontSize: '0.875rem',
                                                        background: '#f8fafc', flex: 1,
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
                        <div style={{ marginBottom: '1.5rem', padding: '1rem', borderRadius: '10px', border: '1px dashed #cbd5e1', background: '#f8fafc' }}>
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
                                        border: '1px solid #e2e8f0', background: '#f8fafc',
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
            </div>
        </div>
    );
};

export default Settings;
