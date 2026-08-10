import React, { useState } from 'react';
import {
    Search, List, LayoutGrid, X, Phone, MessageSquare, Users, Trash2, Upload, Archive
} from 'lucide-react';
import { useAppContext, formatDateStr } from '../context/AppContext.jsx';
import ImportContacts from './ImportContacts.jsx';

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

const STATUS_MAP = {
    novo: { label: 'Novo', bg: '#eff6ff', color: '#3b82f6', dot: '#3b82f6' },
    atendimento: { label: 'Em Atendimento', bg: '#fff7ed', color: '#d97706', dot: '#f59e0b' },
    proposta: { label: 'Proposta', bg: '#fef3c7', color: '#b45309', dot: '#d97706' },
    negociacao: { label: 'Negociação', bg: '#e0e7ff', color: '#4338ca', dot: '#6366f1' },
    vendido: { label: 'Vendido', bg: '#ecfdf5', color: '#059669', dot: '#10b981' },
    perdido: { label: 'Perdido', bg: '#fef2f2', color: '#dc2626', dot: '#ef4444' },
};

const LeadDrawer = ({ lead, onClose, onStatusChange }) => {
    const { updateLead } = useAppContext();
    const [savedField, setSavedField] = useState(null);
    if (!lead) return null;
    const TRADE_FIELDS = [
        ['trade_in_model', 'Modelo'],
        ['trade_in_year', 'Ano'],
        ['trade_in_km', 'Quilometragem'],
        ['trade_in_ownership_time', 'Tempo de posse'],
        ['trade_in_owner_rating', 'Nota do dono (0-10)'],
        ['trade_in_payment_preference', 'Forma de pagamento'],
        ['trade_in_difference_payment', 'Diferença (como paga)'],
    ];
    const hasTradeIn = [...TRADE_FIELDS.map(f => f[0]), 'trade_in_extra_info'].some(f => (lead[f] || '').toString().trim());
    const s = STATUS_MAP[lead.status] || STATUS_MAP.novo;
    return (
        <div className="drawer-overlay" onClick={onClose}>
            <div className="drawer-content" onClick={e => e.stopPropagation()}>
                <div className="drawer-header">
                    <h2>Detalhes do Lead</h2>
                    <button className="close-btn" onClick={onClose}><X size={20} /></button>
                </div>
                <div className="drawer-body">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '2rem' }}>
                        <div className="item-avatar" style={{ width: 56, height: 56, fontSize: '1.1rem' }}>{lead.avatar}</div>
                        <div>
                            <h3 style={{ fontWeight: 700, fontSize: '1.15rem' }}>{lead.name}</h3>
                            <span className="status-badge" style={{ background: s.bg, color: s.color }}>{s.label}</span>
                        </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem', marginBottom: '2rem' }}>
                        {[
                            ['Telefone', lead.phone],
                            ['Cidade', lead.city],
                            ['Interesse', lead.car],
                            ['Renda Declarada', lead.income],
                            ['Entrada Disponível', lead.entry],
                            ['Captado em', formatDateStr(lead.date)]
                        ].map(([label, value]) => (
                            <div key={label}>
                                <p className="text-muted" style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '0.25rem' }}>{label}</p>
                                <p style={{ fontWeight: 600 }}>{value}</p>
                            </div>
                        ))}
                    </div>

                    <div style={{ marginBottom: '1.5rem' }}>
                        <label style={{ fontSize: '0.85rem', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '0.5rem' }}>Atualizar Status</label>
                        <select value={lead.status} onChange={e => onStatusChange(lead.id, e.target.value)}
                            style={{ width: '100%', padding: '0.75rem 1rem', borderRadius: 12, border: '1px solid var(--border)', background: 'var(--input-bg)', color: 'var(--text-primary)', fontSize: '0.9rem' }}>
                            {Object.entries(STATUS_MAP).map(([key, val]) => (
                                <option key={key} value={key}>{val.label}</option>
                            ))}
                        </select>
                    </div>

                    <div style={{ marginBottom: '1.5rem' }}>
                        <label style={{ fontSize: '0.85rem', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '0.5rem' }}>Data de aniversário</label>
                        <input
                            type="date"
                            defaultValue={lead.birth_date || ''}
                            onBlur={e => { if (e.target.value !== (lead.birth_date || '')) updateLead(lead.id, { birth_date: e.target.value }); }}
                            style={{ width: '100%', padding: '0.75rem 1rem', borderRadius: 12, border: '1px solid var(--border)', background: 'var(--input-bg)', color: 'var(--text-primary)', fontSize: '0.9rem', boxSizing: 'border-box' }}
                        />
                        <p style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: 4 }}>Usado pela mensagem automática de aniversário (se ativada em Configurações).</p>
                    </div>

                    {/* Qualificação FORD — editável pelo atendente */}
                    <div style={{ marginBottom: '1.5rem' }}>
                        <label style={{ fontSize: '0.85rem', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '0.5rem' }}>Qualificação do Cliente</label>
                        {[
                            ['family_info',     '👨‍👩‍👧 Família'],
                            ['occupation',      '💼 Ocupação'],
                            ['recreation_info', '🎯 Recreação'],
                            ['financial_info',  '💰 Capacidade Financeira'],
                        ].map(([field, label]) => (
                            <div key={field} style={{ marginBottom: '0.75rem' }}>
                                <p style={{ fontSize: '0.75rem', color: '#94a3b8', marginBottom: 2, display: 'flex', alignItems: 'center', gap: 6 }}>
                                    {label}
                                    {savedField === field && <span style={{ color: '#10b981', fontSize: '0.7rem', fontWeight: 600 }}>✓ salvo</span>}
                                </p>
                                <textarea
                                    rows={2}
                                    defaultValue={lead[field] || ''}
                                    placeholder="—"
                                    onBlur={e => {
                                        if (e.target.value !== (lead[field] || '')) {
                                            updateLead(lead.id, { [field]: e.target.value });
                                            setSavedField(field);
                                            setTimeout(() => setSavedField(s => (s === field ? null : s)), 1500);
                                        }
                                    }}
                                    style={{ width: '100%', padding: '0.5rem 0.75rem', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--input-bg)', color: 'var(--text-primary)', fontSize: '0.85rem', resize: 'vertical', fontFamily: 'inherit', boxSizing: 'border-box' }}
                                />
                            </div>
                        ))}
                    </div>

                    {/* Carro pra Troca — editável pelo atendente */}
                    <div style={{ marginBottom: '1.5rem' }}>
                        <label style={{ fontSize: '0.85rem', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '0.5rem' }}>🚗 Carro pra Troca</label>
                        {!hasTradeIn ? (
                            <p style={{ fontSize: '0.8rem', color: '#94a3b8', fontStyle: 'italic' }}>Cliente não mencionou troca de carro.</p>
                        ) : (
                            <>
                                {TRADE_FIELDS.map(([field, label]) => (
                                    <div key={field} style={{ marginBottom: '0.6rem' }}>
                                        <p style={{ fontSize: '0.75rem', color: '#94a3b8', marginBottom: 2, display: 'flex', alignItems: 'center', gap: 6 }}>
                                            {label}
                                            {savedField === field && <span style={{ color: '#10b981', fontSize: '0.7rem', fontWeight: 600 }}>✓ salvo</span>}
                                        </p>
                                        <input
                                            type="text"
                                            defaultValue={lead[field] || ''}
                                            placeholder="—"
                                            onBlur={e => {
                                                if (e.target.value !== (lead[field] || '')) {
                                                    updateLead(lead.id, { [field]: e.target.value });
                                                    setSavedField(field);
                                                    setTimeout(() => setSavedField(s => (s === field ? null : s)), 1500);
                                                }
                                            }}
                                            style={{ width: '100%', padding: '0.5rem 0.75rem', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--input-bg)', color: 'var(--text-primary)', fontSize: '0.85rem', boxSizing: 'border-box' }}
                                        />
                                    </div>
                                ))}
                                <div style={{ marginBottom: '0.6rem' }}>
                                    <p style={{ fontSize: '0.75rem', color: '#94a3b8', marginBottom: 2, display: 'flex', alignItems: 'center', gap: 6 }}>
                                        Informações extras
                                        {savedField === 'trade_in_extra_info' && <span style={{ color: '#10b981', fontSize: '0.7rem', fontWeight: 600 }}>✓ salvo</span>}
                                    </p>
                                    <textarea
                                        rows={3}
                                        defaultValue={lead.trade_in_extra_info || ''}
                                        placeholder="—"
                                        onBlur={e => {
                                            if (e.target.value !== (lead.trade_in_extra_info || '')) {
                                                updateLead(lead.id, { trade_in_extra_info: e.target.value });
                                                setSavedField('trade_in_extra_info');
                                                setTimeout(() => setSavedField(s => (s === 'trade_in_extra_info' ? null : s)), 1500);
                                            }
                                        }}
                                        style={{ width: '100%', padding: '0.5rem 0.75rem', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--input-bg)', color: 'var(--text-primary)', fontSize: '0.85rem', resize: 'vertical', fontFamily: 'inherit', boxSizing: 'border-box' }}
                                    />
                                </div>
                            </>
                        )}
                    </div>
                </div>
                <div className="drawer-footer">
                    <button className="btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }} onClick={() => alert('Simulação: Iniciando chamada telefônica...')}>
                        <Phone size={16} /> Ligar
                    </button>
                    <button className="btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: '#25D366' }} onClick={() => alert(`Simulação: Iniciando conversa de WhatsApp com ${lead.phone}`)}>
                        <MessageSquare size={16} /> WhatsApp
                    </button>
                </div>
            </div>
        </div>
    );
};

const Leads = () => {
    const { leads, updateLeadStatus, deleteLead, addToast } = useAppContext();
    const [search, setSearch] = useState('');
    const [filterStatus, setFilterStatus] = useState('todos');
    const [view, setView] = useState('kanban');
    const [selectedLead, setSelectedLead] = useState(null);
    const [draggedId, setDraggedId] = useState(null);
    const [confirmDeleteId, setConfirmDeleteId] = useState(null);
    const [mostrarImportados, setMostrarImportados] = useState(false);
    const [importando, setImportando] = useState(false);

    const handleDeleteLead = (id) => { setConfirmDeleteId(id); };
    const confirmDelete = () => {
        deleteLead(confirmDeleteId);
        if (selectedLead?.id === confirmDeleteId) setSelectedLead(null);
        setConfirmDeleteId(null);
        addToast('Lead excluído.', 'success');
    };

    // A base importada fica ESCONDIDA por padrão. São milhares de contatos que
    // nunca falaram com a loja: se caírem no kanban junto com os leads do bot,
    // a coluna "Novo" vira um paredão e o vendedor perde a tela de trabalho.
    const importados = leads.filter(l => l.source === 'importacao').length;

    const filtered = leads.filter(l => {
        const matchSearch = `${l.name} ${l.car} ${l.phone} ${l.city}`.toLowerCase().includes(search.toLowerCase());
        const matchStatus = filterStatus === 'todos' || l.status === filterStatus;
        const matchOrigem = mostrarImportados || l.source !== 'importacao';
        return matchSearch && matchStatus && matchOrigem;
    });

    const handleStatusChange = (id, newStatus) => {
        updateLeadStatus(id, newStatus);
        addToast(`Lead atualizado para "${STATUS_MAP[newStatus]?.label}".`, 'info');
        if (selectedLead?.id === id) setSelectedLead(prev => ({ ...prev, status: newStatus }));
    };

    const handleDragStart = (e, id) => { setDraggedId(id); e.dataTransfer.effectAllowed = 'move'; };
    const handleDragOver = (e) => e.preventDefault();
    const handleDrop = (e, newStatus) => {
        e.preventDefault();
        if (draggedId) { handleStatusChange(draggedId, newStatus); setDraggedId(null); }
    };

    const statusOrder = ['novo', 'atendimento', 'proposta', 'negociacao', 'vendido', 'perdido'];

    return (
        <div className="view-content">
            <header className="view-header-flex">
                <div className="view-header">
                    <h1>Central de Leads</h1>
                    <p>{leads.length} contato{leads.length !== 1 ? 's' : ''} capturado{leads.length !== 1 ? 's' : ''} via WhatsApp e n8n.</p>
                </div>
                <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                    <div className="search-box">
                        <Search size={16} />
                        <input type="text" placeholder="Buscar lead..." value={search} onChange={e => setSearch(e.target.value)} />
                    </div>
                    <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={{ padding: '0.65rem 1rem', borderRadius: 8, border: '1px solid var(--border)', outline: 'none', background: 'var(--card-bg)', color: 'var(--text-primary)' }}>
                        <option value="todos">Todos os Status</option>
                        {Object.entries(STATUS_MAP).map(([key, val]) => (
                            <option key={key} value={key}>{val.label}</option>
                        ))}
                    </select>
                    {importados > 0 && (
                        <button
                            className={mostrarImportados ? 'btn-primary' : 'btn-secondary'}
                            onClick={() => setMostrarImportados(v => !v)}
                            title="A base importada fica fora do funil do dia a dia"
                        >
                            <Archive size={15} /> Base importada ({importados})
                        </button>
                    )}
                    <button className="btn-secondary" onClick={() => setImportando(true)}>
                        <Upload size={15} /> Importar
                    </button>
                    <div className="view-toggle">
                        <button className={`toggle-btn ${view === 'table' ? 'active' : ''}`} onClick={() => setView('table')} title="Tabela"><List size={18} /></button>
                        <button className={`toggle-btn ${view === 'kanban' ? 'active' : ''}`} onClick={() => setView('kanban')} title="Kanban"><LayoutGrid size={18} /></button>
                    </div>
                </div>
            </header>

            {view === 'table' ? (
                <div className="leads-container card" style={{ padding: 0, overflow: 'hidden' }}>
                    <table className="modern-table">
                        <thead>
                            <tr>
                                <th>Lead</th>
                                <th>Interesse</th>
                                <th>Cidade</th>
                                <th>Status</th>
                                <th>Ações</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filtered.map(lead => {
                                const s = STATUS_MAP[lead.status] || STATUS_MAP.novo;
                                return (
                                    <tr key={lead.id}>
                                        <td>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', cursor: 'pointer' }} onClick={() => setSelectedLead(lead)}>
                                                <div className="item-avatar">{lead.avatar}</div>
                                                <div>
                                                    <p className="lead-name">{lead.name}</p>
                                                    <p className="lead-phone">{lead.phone}</p>
                                                </div>
                                            </div>
                                        </td>
                                        <td><span className="lead-car">{lead.car}</span></td>
                                        <td>{lead.city}</td>
                                        <td>
                                            <select value={lead.status} onChange={e => handleStatusChange(lead.id, e.target.value)}
                                                style={{ background: s.bg, color: s.color, border: 'none', padding: '0.35rem 0.75rem', borderRadius: 20, fontWeight: 600, fontSize: '0.8rem', cursor: 'pointer' }}>
                                                {Object.entries(STATUS_MAP).map(([key, val]) => (
                                                    <option key={key} value={key}>{val.label}</option>
                                                ))}
                                            </select>
                                        </td>
                                        <td>
                                            <div className="table-actions">
                                                <button className="action-icon-btn" onClick={() => setSelectedLead(lead)} title="Ver detalhes"><Users size={16} /></button>
                                                <button className="action-icon-btn whatsapp" title="Enviar mensagem" onClick={() => addToast('Simulação: Abrindo WhatsApp...', 'info')}><MessageSquare size={16} /></button>
                                                <button className="action-icon-btn" title="Excluir lead" onClick={e => { e.stopPropagation(); handleDeleteLead(lead.id); }} style={{ color: '#ef4444' }}><Trash2 size={16} /></button>
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                    {filtered.length === 0 && (
                        <div style={{ textAlign: 'center', padding: '3rem' }}>
                            <p className="text-muted">Nenhum lead corresponde à busca.</p>
                        </div>
                    )}
                </div>
            ) : (
                <div className="lead-kanban-board">
                    {statusOrder.map(statusKey => {
                        const info = STATUS_MAP[statusKey];
                        const items = filtered.filter(l => l.status === statusKey);
                        return (
                            <div key={statusKey} className="lead-kanban-column"
                                onDragOver={handleDragOver}
                                onDrop={e => handleDrop(e, statusKey)}>
                                <div className="lead-kanban-col-header">
                                    <span className="column-dot" style={{ background: info.dot }}></span>
                                    <h3>{info.label}</h3>
                                    <span className="column-count">{items.length}</span>
                                </div>
                                <div className="lead-kanban-col-body">
                                    {items.map(lead => (
                                        <div key={lead.id} className="lead-kanban-card card"
                                            draggable
                                            onDragStart={e => handleDragStart(e, lead.id)}
                                            onClick={() => setSelectedLead(lead)}
                                            style={{ cursor: 'pointer' }}>
                                            <div className="lead-kanban-header">
                                                <strong>{lead.name}</strong>
                                                <div style={{ display: 'flex', gap: 4 }}>
                                                    <MessageSquare size={14} style={{ color: '#25D366', cursor: 'pointer' }} onClick={e => { e.stopPropagation(); addToast('Simulação: Abrindo WhatsApp...', 'info'); }} />
                                                    <Trash2 size={14} style={{ color: '#ef4444', cursor: 'pointer' }} onClick={e => { e.stopPropagation(); handleDeleteLead(lead.id); }} />
                                                </div>
                                            </div>
                                            <p className="lead-kanban-car">{lead.car}</p>
                                            <div className="lead-kanban-meta">
                                                <span>{lead.phone}</span>
                                                <span>{lead.city}</span>
                                                <span>{formatDateStr(lead.date)}</span>
                                            </div>
                                        </div>
                                    ))}
                                    {items.length === 0 && (
                                        <div className="empty-column">Arraste leads para cá</div>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {selectedLead && <LeadDrawer lead={selectedLead} onClose={() => setSelectedLead(null)} onStatusChange={handleStatusChange} />}
            {confirmDeleteId && (
                <ConfirmModal
                    message="Tem certeza que deseja excluir este lead? Essa ação não pode ser desfeita."
                    onConfirm={confirmDelete}
                    onCancel={() => setConfirmDeleteId(null)}
                />
            )}
            {importando && <ImportContacts onClose={() => setImportando(false)} />}
        </div>
    );
};

export default Leads;
