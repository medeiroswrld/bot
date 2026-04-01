import React, { useState } from 'react';
import { Building2, Calendar, MapPin, Phone, MessageSquare, Save, CheckCircle } from 'lucide-react';
import { useAppContext } from '../context/AppContext.jsx';

const Settings = () => {
    const { company, agendaConfig, updateCompany, updateAgendaConfig } = useAppContext();

    const [localCompany, setLocalCompany] = useState(company);
    const [localAgenda, setLocalAgenda] = useState(agendaConfig);
    const [savedCompany, setSavedCompany] = useState(false);
    const [savedAgenda, setSavedAgenda] = useState(false);

    const handleCompanyChange = (field, value) => setLocalCompany(prev => ({ ...prev, [field]: value }));
    const handleDayToggle = (day) => setLocalAgenda(prev => ({ ...prev, days: { ...prev.days, [day]: !prev.days[day] } }));
    const handleAgendaChange = (field, value) => setLocalAgenda(prev => ({ ...prev, [field]: value }));

    const saveCompany = () => {
        updateCompany(localCompany);
        setSavedCompany(true);
        setTimeout(() => setSavedCompany(false), 2000);
    };

    const saveAgenda = () => {
        updateAgendaConfig(localAgenda);
        setSavedAgenda(true);
        setTimeout(() => setSavedAgenda(false), 2000);
    };

    return (
        <div className="view-content">
            <header className="view-header">
                <h1>Configurações</h1>
                <p>Personalize o perfil da concessionária e defina as regras de atendimento.</p>
            </header>

            <div className="settings-grid">
                <section className="settings-section card">
                    <div className="section-title">
                        <Building2 size={20} />
                        <h2>Perfil da Empresa</h2>
                    </div>
                    <div className="settings-form">
                        <div className="form-group">
                            <label>Nome da Concessionária</label>
                            <input type="text" value={localCompany.name} onChange={e => handleCompanyChange('name', e.target.value)} />
                        </div>
                        <div className="form-group">
                            <label>Endereço Completo</label>
                            <div className="input-with-icon">
                                <MapPin size={16} />
                                <input type="text" value={localCompany.address} onChange={e => handleCompanyChange('address', e.target.value)} />
                            </div>
                        </div>
                        <div className="form-row">
                            <div className="form-group">
                                <label>Telefone Principal</label>
                                <div className="input-with-icon">
                                    <Phone size={16} />
                                    <input type="text" value={localCompany.phone} onChange={e => handleCompanyChange('phone', e.target.value)} />
                                </div>
                            </div>
                            <div className="form-group">
                                <label>WhatsApp (Automação)</label>
                                <div className="input-with-icon">
                                    <MessageSquare size={16} />
                                    <input type="text" value={localCompany.whatsapp} onChange={e => handleCompanyChange('whatsapp', e.target.value)} />
                                </div>
                            </div>
                        </div>
                        <button className="btn-primary" onClick={saveCompany} style={{ marginTop: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            {savedCompany ? <><CheckCircle size={18} /> Salvo!</> : <><Save size={18} /> Salvar Alterações</>}
                        </button>
                    </div>
                </section>

                <section className="settings-section card">
                    <div className="section-title">
                        <Calendar size={20} />
                        <h2>Regras da Agenda</h2>
                    </div>
                    <div className="settings-form">
                        <div className="form-group">
                            <label>Dias de Funcionamento</label>
                            <div className="days-selector">
                                {Object.entries(localAgenda.days).map(([day, active]) => (
                                    <button key={day} className={`day-btn ${active ? 'active' : ''}`} onClick={() => handleDayToggle(day)}>{day}</button>
                                ))}
                            </div>
                        </div>
                        <div className="form-row">
                            <div className="form-group">
                                <label>Horário de Abertura</label>
                                <input type="time" value={localAgenda.startTime} onChange={e => handleAgendaChange('startTime', e.target.value)} />
                            </div>
                            <div className="form-group">
                                <label>Horário de Fechamento</label>
                                <input type="time" value={localAgenda.endTime} onChange={e => handleAgendaChange('endTime', e.target.value)} />
                            </div>
                        </div>
                        <div className="form-row">
                            <div className="form-group">
                                <label>Duração da Visita</label>
                                <select value={localAgenda.duration} onChange={e => handleAgendaChange('duration', e.target.value)}>
                                    <option value="30">30 minutos</option>
                                    <option value="60">1 hora</option>
                                    <option value="90">1 hora e 30 min</option>
                                </select>
                            </div>
                            <div className="form-group">
                                <label>Intervalo entre Visitas</label>
                                <select value={localAgenda.interval} onChange={e => handleAgendaChange('interval', e.target.value)}>
                                    <option value="0">Sem intervalo</option>
                                    <option value="15">15 minutos</option>
                                    <option value="30">30 minutos</option>
                                </select>
                            </div>
                        </div>
                        <button className="btn-primary" onClick={saveAgenda} style={{ marginTop: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            {savedAgenda ? <><CheckCircle size={18} /> Salvo!</> : <><Save size={18} /> Salvar Agenda</>}
                        </button>
                    </div>
                </section>
            </div>
        </div>
    );
};

export default Settings;
