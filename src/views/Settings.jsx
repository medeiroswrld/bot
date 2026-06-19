import React, { useState, useEffect, useRef } from 'react';
import {
    Building2, Calendar, MapPin, Phone, MessageSquare, Save, CheckCircle,
    User, Mail, ToggleLeft, ToggleRight, Plus, Trash2, CalendarOff,
    Image as ImageIcon, Upload, RefreshCw, Gift, Bell, CreditCard, Bot
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

const PAYMENT_OPTIONS = [
    'À vista (PIX, transferência)',
    'Cartão de crédito',
    'Cartão de débito',
    'Financiamento bancário',
    'Financiamento próprio da loja',
    'Consórcio',
    'Troca (recebe carro como parte do pagamento)',
    'Boleto',
];

const Settings = () => {
    const { company, updateCompany, profile, user, companySettings, messageTemplates, updateNotificationSettings } = useAppContext();

    // ── Notificações automáticas (aniversário / lista de espera) ──────────────
    const approvedTemplates = (messageTemplates || []).filter(t => t.status === 'approved');
    const [notif, setNotif] = useState({ birthday_enabled: false, birthday_template_id: '', waiting_list_template_id: '' });
    const [savingNotif, setSavingNotif] = useState(false);
    useEffect(() => {
        if (companySettings) setNotif({
            birthday_enabled: !!companySettings.birthday_enabled,
            birthday_template_id: companySettings.birthday_template_id || '',
            waiting_list_template_id: companySettings.waiting_list_template_id || '',
        });
    }, [companySettings]);
    const saveNotif = async () => {
        setSavingNotif(true);
        await updateNotificationSettings({
            birthday_enabled: notif.birthday_enabled,
            birthday_template_id: notif.birthday_template_id || null,
            waiting_list_template_id: notif.waiting_list_template_id || null,
        });
        setSavingNotif(false);
    };

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

    // ── Perfil do WhatsApp ────────────────────────────────────────────────────
    const [wpAbout,        setWpAbout]        = useState('');
    const [wpPhotoPreview, setWpPhotoPreview] = useState(null);
    const [wpPhotoFile,    setWpPhotoFile]    = useState(null);
    const [wpPhoneId,      setWpPhoneId]      = useState('');
    const [savingWp,       setSavingWp]       = useState(false);
    const [savedWp,        setSavedWp]        = useState(false);
    const [wpError,        setWpError]        = useState('');
    const wpFileRef = useRef(null);

    useEffect(() => {
        if (!user?.id) return;
        supabase
            .from('company_settings')
            .select('whatsapp_about, whatsapp_phone_number_id')
            .eq('user_id', user.id)
            .single()
            .then(({ data }) => {
                if (data?.whatsapp_about) setWpAbout(data.whatsapp_about);
                if (data?.whatsapp_phone_number_id) setWpPhoneId(data.whatsapp_phone_number_id);
            });
    }, [user?.id]);

    const handleWpPhotoChange = (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setWpPhotoFile(file);
        setWpPhotoPreview(URL.createObjectURL(file));
    };

    const updateWhatsAppProfile = async () => {
        if (!user?.id) return;
        setSavingWp(true);
        setSavedWp(false);
        setWpError('');
        try {
            let photoUrl = null;

            // 1. Upload da foto para Supabase Storage (se selecionada)
            if (wpPhotoFile) {
                const ext  = wpPhotoFile.name.split('.').pop();
                const path = `${user.id}/profile.${ext}`;
                const { error: upErr } = await supabase.storage
                    .from('whatsapp-profiles')
                    .upload(path, wpPhotoFile, { upsert: true, contentType: wpPhotoFile.type });
                if (upErr) throw new Error(`Upload falhou: ${upErr.message}`);

                const { data: urlData } = supabase.storage
                    .from('whatsapp-profiles')
                    .getPublicUrl(path);
                photoUrl = urlData?.publicUrl;
            }

            // 2. Salva about na company_settings
            await supabase
                .from('company_settings')
                .update({ whatsapp_about: wpAbout, updated_at: new Date().toISOString() })
                .eq('user_id', user.id);

            // 3. Chama edge function para atualizar perfil na API do WhatsApp
            const { data: sessionData } = await supabase.auth.getSession();
            const token = sessionData?.session?.access_token;
            const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;

            const res = await fetch(`${supabaseUrl}/functions/v1/update-whatsapp-profile`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({ photo_url: photoUrl, about: wpAbout }),
            });

            if (!res.ok) {
                const txt = await res.text();
                throw new Error(txt || `Erro ${res.status}`);
            }

            setSavedWp(true);
            setTimeout(() => setSavedWp(false), 3000);
        } catch (err) {
            setWpError(err.message || 'Erro ao atualizar perfil do WhatsApp.');
        } finally {
            setSavingWp(false);
        }
    };

    // ── Formas de pagamento ───────────────────────────────────────────────────
    const [payMethods, setPayMethods] = useState([]); // opções padrão marcadas
    const [payOther,   setPayOther]   = useState('');  // texto livre adicional
    const [savingPay,  setSavingPay]  = useState(false);
    const [savedPay,   setSavedPay]   = useState(false);

    useEffect(() => {
        if (!user?.id) return;
        supabase
            .from('company_settings')
            .select('payment_methods')
            .eq('user_id', user.id)
            .single()
            .then(({ data }) => {
                const saved = Array.isArray(data?.payment_methods) ? data.payment_methods : [];
                setPayMethods(saved.filter(m => PAYMENT_OPTIONS.includes(m)));
                setPayOther(saved.filter(m => !PAYMENT_OPTIONS.includes(m)).join(', '));
            });
    }, [user?.id]);

    const togglePay = (label) =>
        setPayMethods(prev =>
            prev.includes(label) ? prev.filter(m => m !== label) : [...prev, label]
        );

    const savePayments = async () => {
        if (!user?.id) return;
        setSavingPay(true);
        const ordered = PAYMENT_OPTIONS.filter(o => payMethods.includes(o)); // ordem estável
        const other   = payOther.trim();
        const methods = [...ordered, ...(other ? [other] : [])];
        await supabase
            .from('company_settings')
            .update({ payment_methods: methods, updated_at: new Date().toISOString() })
            .eq('user_id', user.id);
        setSavingPay(false);
        setSavedPay(true);
        setTimeout(() => setSavedPay(false), 2000);
    };

    // ── Comportamento do Bot ──────────────────────────────────────────────────
    const [delayedSched, setDelayedSched] = useState(true);
    const [savingBehav,  setSavingBehav]  = useState(false);
    const [savedBehav,   setSavedBehav]   = useState(false);

    useEffect(() => {
        if (!user?.id) return;
        supabase
            .from('company_settings')
            .select('delayed_schedule_enabled')
            .eq('user_id', user.id)
            .single()
            .then(({ data }) => {
                if (data) setDelayedSched(data.delayed_schedule_enabled !== false);
            });
    }, [user?.id]);

    const saveBehavior = async () => {
        if (!user?.id) return;
        setSavingBehav(true);
        await supabase
            .from('company_settings')
            .update({ delayed_schedule_enabled: delayedSched, updated_at: new Date().toISOString() })
            .eq('user_id', user.id);
        setSavingBehav(false);
        setSavedBehav(true);
        setTimeout(() => setSavedBehav(false), 2000);
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
        const controller = new AbortController();
        supabase
            .from('schedule_exceptions')
            .select('*')
            .eq('user_id', user.id)
            .order('date', { ascending: true })
            .abortSignal(controller.signal)
            .then(({ data }) => {
                if (controller.signal.aborted) return;
                setExceptions(data || []);
            })
            .catch(() => { /* abort/erro: ignora */ })
            .finally(() => {
                if (!controller.signal.aborted) setLoadingEx(false);
            });
        return () => controller.abort();
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
                                                        border: '1px solid var(--border)', fontSize: '0.875rem',
                                                        background: 'var(--input-bg)', color: 'var(--text-primary)', flex: 1,
                                                    }}
                                                />
                                                <span style={{ color: '#94a3b8', fontSize: '0.8rem', flexShrink: 0 }}>às</span>
                                                <input
                                                    type="time"
                                                    value={day.end}
                                                    onChange={e => setDayField(key, 'end', e.target.value)}
                                                    style={{
                                                        padding: '0.35rem 0.5rem', borderRadius: '8px',
                                                        border: '1px solid var(--border)', fontSize: '0.875rem',
                                                        background: 'var(--input-bg)', color: 'var(--text-primary)', flex: 1,
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

            {/* ── Perfil do WhatsApp ─────────────────────────────────────────── */}
            <div style={{ marginTop: '2rem' }}>
                <section className="settings-section card">
                    <div className="section-title">
                        <MessageSquare size={20} />
                        <h2>Perfil do WhatsApp</h2>
                    </div>
                    <div className="settings-form">
                        <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', marginBottom: '1rem', lineHeight: 1.5 }}>
                            Atualize a foto e a descrição que aparecem no perfil do número de WhatsApp da concessionária.
                            Requer a API do WhatsApp Business (Meta Cloud API).
                        </p>

                        {/* Foto */}
                        <div className="form-group">
                            <label>Foto do Perfil</label>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                                <div
                                    onClick={() => wpFileRef.current?.click()}
                                    style={{
                                        width: 80, height: 80, borderRadius: '50%',
                                        border: '2px dashed var(--border)', background: 'var(--input-bg)',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        cursor: 'pointer', overflow: 'hidden', flexShrink: 0,
                                    }}
                                >
                                    {wpPhotoPreview
                                        ? <img src={wpPhotoPreview} alt="Preview" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                        : <ImageIcon size={24} color="#94a3b8" />}
                                </div>
                                <div>
                                    <button
                                        className="btn-outline"
                                        onClick={() => wpFileRef.current?.click()}
                                        style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem' }}
                                    >
                                        <Upload size={14} /> Escolher foto
                                    </button>
                                    <p style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: '0.35rem' }}>
                                        JPEG ou PNG, máx. 5 MB
                                    </p>
                                </div>
                                <input
                                    ref={wpFileRef}
                                    type="file"
                                    accept="image/jpeg,image/png"
                                    style={{ display: 'none' }}
                                    onChange={handleWpPhotoChange}
                                />
                            </div>
                        </div>

                        {/* Descrição */}
                        <div className="form-group">
                            <label>Descrição (about)</label>
                            <textarea
                                rows={3}
                                value={wpAbout}
                                onChange={e => setWpAbout(e.target.value)}
                                maxLength={139}
                                placeholder="Ex: Sua concessionária de confiança. Carros novos e seminovos com as melhores condições."
                                style={{ resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.6 }}
                            />
                            <p style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: '-0.25rem' }}>
                                {wpAbout.length}/139 caracteres
                            </p>
                        </div>

                        {wpError && (
                            <p style={{ fontSize: '0.85rem', color: '#ef4444', marginBottom: '0.5rem' }}>{wpError}</p>
                        )}

                        <button
                            className="btn-primary"
                            onClick={updateWhatsAppProfile}
                            disabled={savingWp}
                            style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
                        >
                            {savedWp
                                ? <><CheckCircle size={18} /> Atualizado!</>
                                : savingWp
                                    ? <><RefreshCw size={18} style={{ animation: 'spin 1s linear infinite' }} /> Atualizando...</>
                                    : <><MessageSquare size={18} /> Atualizar no WhatsApp</>}
                        </button>
                    </div>
                </section>
            </div>

            {/* ── Formas de Pagamento ────────────────────────────────────────── */}
            <div style={{ marginTop: '2rem' }}>
                <section className="settings-section card">
                    <div className="section-title">
                        <CreditCard size={20} />
                        <h2>Formas de Pagamento</h2>
                    </div>
                    <div className="settings-form">
                        <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', marginBottom: '1rem', lineHeight: 1.5 }}>
                            Marque as formas de pagamento que a concessionária aceita. O assistente
                            usa essa lista ao responder dúvidas sobre pagamento — e não inventa
                            formas que não estejam marcadas aqui.
                        </p>

                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '0.5rem', marginBottom: '1rem' }}>
                            {PAYMENT_OPTIONS.map(label => {
                                const checked = payMethods.includes(label);
                                return (
                                    <label
                                        key={label}
                                        style={{
                                            display: 'flex', alignItems: 'center', gap: '0.6rem',
                                            padding: '0.6rem 0.85rem', borderRadius: '10px',
                                            border: `1px solid ${checked ? 'var(--color-primary)' : 'var(--border)'}`,
                                            background: checked ? 'rgba(37,99,235,0.06)' : 'var(--input-bg)',
                                            cursor: 'pointer', fontSize: '0.875rem', transition: 'all 0.15s',
                                        }}
                                    >
                                        <input
                                            type="checkbox"
                                            checked={checked}
                                            onChange={() => togglePay(label)}
                                            style={{ width: 16, height: 16, flexShrink: 0, accentColor: 'var(--color-primary)' }}
                                        />
                                        <span>{label}</span>
                                    </label>
                                );
                            })}
                        </div>

                        <div className="form-group">
                            <label>Outras opções (opcional)</label>
                            <input
                                type="text"
                                value={payOther}
                                onChange={e => setPayOther(e.target.value)}
                                placeholder="Ex: Criptomoeda, cheque pré-datado"
                            />
                            <p style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', marginTop: '-0.25rem', lineHeight: 1.5 }}>
                                Formas adicionais que a loja aceita e não estão na lista acima.
                            </p>
                        </div>

                        <button
                            className="btn-primary"
                            onClick={savePayments}
                            disabled={savingPay}
                            style={{ marginTop: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}
                        >
                            {savedPay
                                ? <><CheckCircle size={18} /> Salvo!</>
                                : savingPay ? 'Salvando...'
                                : <><Save size={18} /> Salvar Formas de Pagamento</>}
                        </button>
                    </div>
                </section>
            </div>

            {/* ── Comportamento do Bot ────────────────────────────────────────── */}
            <div style={{ marginTop: '2rem' }}>
                <section className="settings-section card">
                    <div className="section-title">
                        <Bot size={20} />
                        <h2>Comportamento do Bot</h2>
                    </div>
                    <div className="settings-form">
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                            <button
                                type="button"
                                onClick={() => setDelayedSched(v => !v)}
                                title={delayedSched ? 'Desativar' : 'Ativar'}
                                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, flexShrink: 0, color: delayedSched ? '#10b981' : '#94a3b8' }}
                            >
                                {delayedSched ? <ToggleRight size={32} /> : <ToggleLeft size={32} />}
                            </button>
                            <div>
                                <strong style={{ display: 'block', marginBottom: 4 }}>Verificação simulada de agenda</strong>
                                <p style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
                                    Quando o cliente pede um horário ocupado, o vendedor diz que vai verificar com o superior e responde alguns minutos depois — confirmando o encaixe ou propondo alternativas. Recomendado: ligado.
                                </p>
                            </div>
                        </div>
                        <button
                            className="btn-primary"
                            onClick={saveBehavior}
                            disabled={savingBehav}
                            style={{ marginTop: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}
                        >
                            {savedBehav
                                ? <><CheckCircle size={18} /> Salvo!</>
                                : savingBehav ? 'Salvando...'
                                : <><Save size={18} /> Salvar</>}
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
                        <div style={{ marginBottom: '1.5rem', padding: '1rem', borderRadius: '10px', border: '1px dashed var(--border)', background: 'var(--input-bg)' }}>
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
                                        border: '1px solid var(--border)', background: 'var(--card-bg)',
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

                {/* ── Notificações Automáticas ────────────────────────────── */}
                <section className="settings-section card">
                    <div className="section-title">
                        <Bell size={20} />
                        <h2>Notificações Automáticas</h2>
                    </div>

                    {approvedTemplates.length === 0 && (
                        <p className="text-muted" style={{ fontSize: '0.85rem', marginBottom: '1rem' }}>
                            Você precisa de pelo menos um template aprovado pela Meta. Crie em <strong>Templates</strong>.
                        </p>
                    )}

                    {/* Aniversário */}
                    <div style={{ marginBottom: '1.5rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                            <Gift size={18} style={{ color: 'var(--primary)' }} />
                            <strong style={{ flex: 1 }}>Mensagem de aniversário automática</strong>
                            <button type="button" onClick={() => setNotif(p => ({ ...p, birthday_enabled: !p.birthday_enabled }))}
                                style={{ background: 'none', border: 'none', cursor: 'pointer', color: notif.birthday_enabled ? '#10b981' : '#94a3b8' }}>
                                {notif.birthday_enabled ? <ToggleRight size={32} /> : <ToggleLeft size={32} />}
                            </button>
                        </div>
                        <p className="text-muted" style={{ fontSize: '0.78rem', marginBottom: 8 }}>
                            Toda manhã (9h Brasília) o sistema verifica os aniversariantes do dia e envia a mensagem. O template precisa estar aprovado e ter 1 variável (o nome).
                        </p>
                        <select value={notif.birthday_template_id} onChange={e => setNotif(p => ({ ...p, birthday_template_id: e.target.value }))}
                            style={{ width: '100%', padding: '0.65rem 1rem', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--card-bg)', color: 'var(--text-primary)' }}>
                            <option value="">Selecione o template de aniversário…</option>
                            {approvedTemplates.map(t => (
                                <option key={t.id} value={t.id}>{t.display_name} ({(t.body_variables?.length ?? 0)} variável{(t.body_variables?.length ?? 0) !== 1 ? 'is' : ''})</option>
                            ))}
                        </select>
                    </div>

                    {/* Lista de espera */}
                    <div style={{ marginBottom: '1.5rem' }}>
                        <strong style={{ display: 'block', marginBottom: 6 }}>Template de aviso da Lista de Espera</strong>
                        <p className="text-muted" style={{ fontSize: '0.78rem', marginBottom: 8 }}>
                            Usado quando você clicar "Avisar todos" na Lista de Espera ao cadastrar um carro novo. Deve ter 3 variáveis (nome, modelo procurado, descrição do carro).
                        </p>
                        <select value={notif.waiting_list_template_id} onChange={e => setNotif(p => ({ ...p, waiting_list_template_id: e.target.value }))}
                            style={{ width: '100%', padding: '0.65rem 1rem', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--card-bg)', color: 'var(--text-primary)' }}>
                            <option value="">Selecione o template de aviso…</option>
                            {approvedTemplates.map(t => (
                                <option key={t.id} value={t.id}>{t.display_name} ({(t.body_variables?.length ?? 0)} variáveis)</option>
                            ))}
                        </select>
                    </div>

                    <button className="btn-primary" onClick={saveNotif} disabled={savingNotif} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Save size={16} /> {savingNotif ? 'Salvando...' : 'Salvar notificações'}
                    </button>
                </section>
            </div>
        </div>
    );
};

export default Settings;
