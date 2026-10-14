import { useState, useMemo } from 'react';
import {
    Bookmark, Search, Trash2, Copy, Eye, CheckCircle2, XCircle, Bell, X, Package,
    Rocket, Loader2, Plus
} from 'lucide-react';
import { useAppContext } from '../context/AppContext.jsx';
import { miniatura } from '../lib/imagemUrl.js';

const STATUS_CFG = {
    active:    { label: 'Aguardando',       color: '#64748b', bg: '#f1f5f9' },
    matched:   { label: 'Match encontrado!', color: '#d97706', bg: '#fff7ed' },
    notified:  { label: 'Cliente avisado',   color: '#2563eb', bg: '#eff6ff' },
    converted: { label: 'Vendido',           color: '#059669', bg: '#ecfdf5' },
    dismissed: { label: 'Descartado',        color: '#dc2626', bg: '#fef2f2' },
    expired:   { label: 'Expirado',          color: '#64748b', bg: '#f1f5f9' },
};

const FILTERS = [
    { value: 'todos',     label: 'Todos' },
    { value: 'active',    label: 'Aguardando' },
    { value: 'matched',   label: 'Match!' },
    { value: 'notified',  label: 'Avisados' },
    { value: 'converted', label: 'Vendidos' },
    { value: 'dismissed', label: 'Descartados' },
];

const lower = (v) => String(v ?? '').toLowerCase();
const fmtKm  = (n) => `${Number(n).toLocaleString('pt-BR')} km`;
const fmtBRL = (n) => `R$ ${Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}`;

// Resumo amigável dos critérios: "Honda Civic 2009-2011, até 90 mil km, até R$ 60.000"
function formatCriteria(it) {
    const parts = [];
    const nome = [it.brand, it.model].filter(Boolean).join(' ');
    if (nome) parts.push(nome);
    if (it.year_min || it.year_max) {
        if (it.year_min && it.year_max) parts.push(`${it.year_min}-${it.year_max}`);
        else if (it.year_min) parts.push(`a partir de ${it.year_min}`);
        else parts.push(`até ${it.year_max}`);
    }
    if (it.km_max) parts.push(`até ${fmtKm(it.km_max)}`);
    if (it.price_max) parts.push(`até ${fmtBRL(it.price_max)}`);
    if (it.vehicle_type) parts.push(it.vehicle_type);
    if (it.fuel) parts.push(it.fuel);
    if (it.transmission) parts.push(it.transmission);
    if (it.color) parts.push(it.color);
    return parts.join(' • ');
}

// Mesma lógica do edge function: carros disponíveis que batem com o interesse
function matchCarsForInterest(it, inventory) {
    return (inventory || []).filter((car) => {
        if (car.status !== 'disponivel') return false;
        const carName = [car.brand, car.model, car.version].filter(Boolean).join(' ');
        const carKm   = Number(car.km ?? car.mileage ?? 0);
        if (it.model && !lower(carName).includes(lower(it.model))) return false;
        if (it.brand && lower(car.brand) !== lower(it.brand)) return false;
        if (it.year_min && car.year < it.year_min) return false;
        if (it.year_max && car.year > it.year_max) return false;
        if (it.km_max && carKm > it.km_max) return false;
        if (it.price_min && car.price < it.price_min) return false;
        if (it.price_max && car.price > it.price_max) return false;
        if (it.vehicle_type && lower(car.vehicle_type) !== lower(it.vehicle_type)) return false;
        if (it.transmission && lower(car.transmission) !== lower(it.transmission)) return false;
        if (it.fuel && lower(car.fuel) !== lower(it.fuel)) return false;
        if (it.color && lower(car.color) !== lower(it.color)) return false;
        return true;
    });
}

function relativeDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

const StatusBadge = ({ status }) => {
    const cfg = STATUS_CFG[status] ?? STATUS_CFG.active;
    return (
        <span className="status-badge" style={{ background: cfg.bg, color: cfg.color }}>{cfg.label}</span>
    );
};

// ─── Modal: carros do estoque que batem ───────────────────────────────────────
const MatchesModal = ({ interest, cars, onClose }) => (
    <div className="modal-overlay" onClick={onClose}>
        <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
                <h2>Carros que batem com {interest.model}</h2>
                <button className="close-btn" onClick={onClose}><X size={24} /></button>
            </div>
            {cars.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '2.5rem 1rem', color: 'var(--text-secondary)' }}>
                    <Package size={40} style={{ opacity: 0.4, marginBottom: 12 }} />
                    <p>Nenhum carro disponível no estoque bate com esse interesse agora.</p>
                </div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {cars.map(car => (
                        <div key={car.id} style={{ display: 'flex', gap: 12, alignItems: 'center', padding: 12, border: '1px solid var(--border)', borderRadius: 10 }}>
                            {car.images?.[0]
                                ? <img src={miniatura(car.images[0])} loading="lazy" alt="" style={{ width: 72, height: 52, borderRadius: 6, objectFit: 'cover' }} />
                                : <div style={{ width: 72, height: 52, borderRadius: 6, background: 'var(--input-bg)' }} />}
                            <div style={{ flex: 1 }}>
                                <p style={{ margin: 0, fontWeight: 700 }}>{car.brand} {car.model}</p>
                                <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                                    {car.version} • {car.year} • {fmtKm(car.km ?? 0)}
                                </p>
                            </div>
                            <strong style={{ color: '#059669' }}>{fmtBRL(car.price)}</strong>
                        </div>
                    ))}
                </div>
            )}
        </div>
    </div>
);

// ─── Modal: mensagem pronta pra avisar o cliente ──────────────────────────────
const NotifyModal = ({ interest, cars, onClose, onMarkNotified }) => {
    const { addToast } = useAppContext();
    const car = cars[0];
    const nome = (interest.customer_name || '').split(' ')[0] || 'tudo bem';
    const msg = car
        ? `Olá ${nome}! Lembra do ${interest.model} que você procurava? Acabou de entrar um aqui na loja: ${car.brand} ${car.model} ${car.version || ''} ${car.year}, ${fmtKm(car.km ?? 0)}, ${fmtBRL(car.price)}. Quer ver as fotos?`
        : `Olá ${nome}! Sobre o ${interest.model} que você procurava — temos novidades aqui na loja. Quer dar uma olhada?`;

    const copy = async () => {
        try {
            await navigator.clipboard.writeText(msg);
            addToast('Mensagem copiada!', 'success');
        } catch {
            addToast('Não consegui copiar. Selecione o texto manualmente.', 'error');
        }
    };

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content modal-sm" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>Avisar {interest.customer_name || 'cliente'}</h2>
                    <button className="close-btn" onClick={onClose}><X size={24} /></button>
                </div>
                <p className="text-muted" style={{ fontSize: '0.8rem', marginBottom: 8 }}>
                    Copie a mensagem e cole no WhatsApp <strong>{interest.customer_phone}</strong>:
                </p>
                <textarea
                    readOnly
                    value={msg}
                    rows={5}
                    style={{ width: '100%', boxSizing: 'border-box', padding: 12, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-main)', color: 'var(--text-primary)', fontSize: '0.875rem', resize: 'vertical', fontFamily: 'inherit' }}
                />
                <div className="modal-footer" style={{ marginTop: 12 }}>
                    <button className="btn-secondary" onClick={onClose}>Fechar</button>
                    <button className="btn-primary" onClick={copy} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Copy size={16} /> Copiar mensagem
                    </button>
                    <button className="btn-primary" style={{ background: '#2563eb' }} onClick={() => { onMarkNotified(); onClose(); }}>
                        Marcar como avisado
                    </button>
                </div>
            </div>
        </div>
    );
};

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

// Cadastro manual na lista de espera.
//
// Até aqui só o bot criava interesse — o que deixava de fora o caso mais comum:
// o cliente que ligou, passou na loja, ou falou com o vendedor na rua. Esses
// ficavam num papel e a loja não era avisada quando o carro entrava.
//
// O telefone é obrigatório porque é ele que permite avisar depois. Interesse
// sem telefone é anotação, não lista de espera.
const NovoInteresse = ({ onFechar }) => {
    const { addInterest } = useAppContext();
    const [salvando, setSalvando] = useState(false);
    const [form, setForm] = useState({
        customer_name: '', customer_phone: '', brand: '', model: '',
        year_min: '', year_max: '', km_max: '', price_max: '',
        vehicle_type: 'carro', notes: '',
    });

    const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
    const podeSalvar = form.customer_phone.replace(/\D/g, '').length >= 10 && form.model.trim();

    const salvar = async () => {
        setSalvando(true);
        const ok = await addInterest(form);
        setSalvando(false);
        if (ok) onFechar();
    };

    return (
        <div className="modal-overlay" onClick={onFechar}>
            <div className="modal-content modal-sm" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header"><h2>Adicionar à lista de espera</h2></div>
                <div style={{ padding: '1.1rem 1.4rem' }}>
                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                        <div className="form-group" style={{ flex: '1 1 170px' }}>
                            <label>Nome do cliente</label>
                            <input type="text" value={form.customer_name} autoFocus
                                onChange={(e) => set('customer_name', e.target.value)} />
                        </div>
                        <div className="form-group" style={{ flex: '1 1 150px' }}>
                            <label>Telefone *</label>
                            <input type="tel" placeholder="(15) 98837-2081" value={form.customer_phone}
                                onChange={(e) => set('customer_phone', e.target.value)} />
                        </div>
                        <div className="form-group" style={{ flex: '1 1 130px' }}>
                            <label>Marca</label>
                            <input type="text" placeholder="Opcional" value={form.brand}
                                onChange={(e) => set('brand', e.target.value)} />
                        </div>
                        <div className="form-group" style={{ flex: '1 1 150px' }}>
                            <label>Modelo *</label>
                            <input type="text" placeholder="Ex: Onix" value={form.model}
                                onChange={(e) => set('model', e.target.value)} />
                        </div>
                        <div className="form-group" style={{ flex: '0 1 110px' }}>
                            <label>Ano mínimo</label>
                            <input type="number" value={form.year_min}
                                onChange={(e) => set('year_min', e.target.value)} />
                        </div>
                        <div className="form-group" style={{ flex: '0 1 110px' }}>
                            <label>Ano máximo</label>
                            <input type="number" value={form.year_max}
                                onChange={(e) => set('year_max', e.target.value)} />
                        </div>
                        <div className="form-group" style={{ flex: '0 1 120px' }}>
                            <label>Km máxima</label>
                            <input type="number" value={form.km_max}
                                onChange={(e) => set('km_max', e.target.value)} />
                        </div>
                        <div className="form-group" style={{ flex: '0 1 130px' }}>
                            <label>Até quanto (R$)</label>
                            <input type="number" value={form.price_max}
                                onChange={(e) => set('price_max', e.target.value)} />
                        </div>
                        <div className="form-group" style={{ flex: '0 1 120px' }}>
                            <label>Tipo</label>
                            <select value={form.vehicle_type} onChange={(e) => set('vehicle_type', e.target.value)}>
                                <option value="carro">Carro</option>
                                <option value="moto">Moto</option>
                            </select>
                        </div>
                        <div className="form-group" style={{ flex: '1 1 100%' }}>
                            <label>Observações</label>
                            <input type="text" placeholder="Ex: prefere prata, aceita financiar"
                                value={form.notes} onChange={(e) => set('notes', e.target.value)} />
                        </div>
                    </div>
                    <p style={{ fontSize: '0.76rem', color: 'var(--color-text-muted)', margin: '4px 0 0' }}>
                        Quanto menos filtro, mais carros batem. Marca e ano em branco significam
                        &quot;qualquer um&quot;.
                    </p>
                </div>
                <div className="modal-footer">
                    <button className="btn-secondary" onClick={onFechar}>Cancelar</button>
                    <button className="btn-primary" onClick={salvar} disabled={salvando || !podeSalvar}>
                        {salvando ? 'Salvando…' : 'Adicionar'}
                    </button>
                </div>
            </div>
        </div>
    );
};

// ─── Página ───────────────────────────────────────────────────────────────────
const WaitingList = () => {
    const { vehicleInterests, inventory, updateInterestStatus, deleteInterest, addToast,
        waitingListTemplateReady, notifyWaitingListMatch } = useAppContext();
    const [filter, setFilter] = useState('todos');
    const [search, setSearch] = useState('');
    const [matchesModal, setMatchesModal] = useState(null);
    const [notifyModal, setNotifyModal] = useState(null);
    const [confirmDeleteId, setConfirmDeleteId] = useState(null);
    const [notifyingId, setNotifyingId] = useState(null);
    const [novoAberto, setNovoAberto] = useState(false);

    // Calcula os carros que batem com cada interesse UMA vez por mudança de dados
    // (em vez de recalcular por linha em cada render).
    const matchesByInterest = useMemo(() => {
        const map = new Map();
        for (const it of (vehicleInterests || [])) {
            map.set(it.id, matchCarsForInterest(it, inventory));
        }
        return map;
    }, [vehicleInterests, inventory]);

    const matchedWithCar = useMemo(
        () => (vehicleInterests || []).some(i => i.status === 'matched' && (matchesByInterest.get(i.id)?.length > 0)),
        [vehicleInterests, matchesByInterest],
    );

    // Avisa um cliente sobre o primeiro carro do estoque que bate com o interesse dele
    const notifyOne = async (it) => {
        const cars = matchesByInterest.get(it.id) || [];
        if (!cars.length) { addToast('Nenhum carro no estoque bate com esse interesse agora.', 'error'); return; }
        setNotifyingId(it.id);
        await notifyWaitingListMatch(cars[0].id, [it.id]);
        setNotifyingId(null);
    };

    // Master: avisa todos os matched, agrupando por carro (cada notify usa 1 car_id)
    const notifyAllMatched = async () => {
        const groups = new Map(); // carId -> ids[]
        for (const it of (vehicleInterests || [])) {
            if (it.status !== 'matched') continue;
            const cars = matchesByInterest.get(it.id) || [];
            if (!cars.length) continue;
            const carId = cars[0].id;
            if (!groups.has(carId)) groups.set(carId, []);
            groups.get(carId).push(it.id);
        }
        if (groups.size === 0) { addToast('Nenhum interesse "match" com carro disponível agora.', 'error'); return; }
        setNotifyingId('all');
        for (const [carId, ids] of groups) {
            await notifyWaitingListMatch(carId, ids);
        }
        setNotifyingId(null);
    };

    const filtered = useMemo(() => (vehicleInterests || []).filter((it) => {
        if (filter !== 'todos' && it.status !== filter) return false;
        if (search) {
            const q = search.toLowerCase();
            const hay = `${it.customer_name ?? ''} ${it.model ?? ''} ${it.brand ?? ''} ${it.customer_phone ?? ''}`.toLowerCase();
            if (!hay.includes(q)) return false;
        }
        return true;
    }), [vehicleInterests, filter, search]);

    const handleNotified = async (it) => {
        await updateInterestStatus(it.id, 'notified');
    };

    return (
        <div className="view-content">
            <header className="view-header-flex">
                <div className="view-header">
                    <h1>Lista de Espera</h1>
                    <p>Clientes esperando veículos específicos. Avise quando o carro entrar no estoque.</p>
                </div>
                <button className="btn-secondary" onClick={() => setNovoAberto(true)}
                    style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Plus size={16} /> Adicionar cliente
                </button>
                {waitingListTemplateReady && matchedWithCar && (
                    <button className="btn-primary" onClick={notifyAllMatched} disabled={notifyingId === 'all'}
                        style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#059669' }}>
                        {notifyingId === 'all' ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : <Rocket size={16} />}
                        Avisar todos os "match"
                    </button>
                )}
            </header>

            {novoAberto && <NovoInteresse onFechar={() => setNovoAberto(false)} />}

            <div className="inv-toolbar" style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
                <div className="inv-search" style={{ flex: 1, minWidth: 220, display: 'flex', alignItems: 'center', gap: '0.75rem', background: 'var(--card-bg)', border: '1px solid var(--border)', padding: '0.65rem 1rem', borderRadius: 'var(--radius-md, 8px)' }}>
                    <Search size={18} />
                    <input type="text" placeholder="Buscar por cliente, modelo ou telefone..." value={search} onChange={e => setSearch(e.target.value)} style={{ border: 'none', background: 'transparent', outline: 'none', width: '100%', fontSize: '0.9rem', color: 'var(--text-primary)' }} />
                </div>
                <div className="inv-filters" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {FILTERS.map(f => (
                        <button key={f.value} className={`inv-filter-btn ${filter === f.value ? 'active' : ''}`} onClick={() => setFilter(f.value)}>{f.label}</button>
                    ))}
                </div>
            </div>

            <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
                {filtered.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '4rem 2rem', color: 'var(--text-secondary)' }}>
                        <Bookmark size={48} style={{ opacity: 0.3, marginBottom: 16 }} />
                        <h3 style={{ fontWeight: 700, marginBottom: 4 }}>Nenhum interesse na lista</h3>
                        <p>Quando o bot registrar interesses de clientes, eles aparecem aqui.</p>
                    </div>
                ) : (
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
                        <thead>
                            <tr style={{ borderBottom: '1px solid var(--border)', textAlign: 'left', color: 'var(--text-secondary)' }}>
                                <th style={{ padding: '12px 16px', fontWeight: 600 }}>Cliente</th>
                                <th style={{ padding: '12px 16px', fontWeight: 600 }}>Telefone</th>
                                <th style={{ padding: '12px 16px', fontWeight: 600 }}>Quer o quê?</th>
                                <th style={{ padding: '12px 16px', fontWeight: 600 }}>Status</th>
                                <th style={{ padding: '12px 16px', fontWeight: 600 }}>Registrado</th>
                                <th style={{ padding: '12px 16px', fontWeight: 600, textAlign: 'right' }}>Ações</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filtered.map((it) => {
                                const matchCars = matchesByInterest.get(it.id) || [];
                                return (
                                    <tr key={it.id} style={{ borderBottom: '1px solid var(--border)' }}>
                                        <td style={{ padding: '12px 16px', fontWeight: 600 }}>{it.customer_name || '—'}</td>
                                        <td style={{ padding: '12px 16px', color: 'var(--text-secondary)' }}>{it.customer_phone}</td>
                                        <td style={{ padding: '12px 16px', maxWidth: 320 }}>{formatCriteria(it) || it.model}</td>
                                        <td style={{ padding: '12px 16px' }}><StatusBadge status={it.status} /></td>
                                        <td style={{ padding: '12px 16px', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{relativeDate(it.created_at)}</td>
                                        <td style={{ padding: '12px 16px' }}>
                                            <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                                                <button className="inv-action-btn" title="Ver carros que batem" onClick={() => setMatchesModal({ interest: it, cars: matchCars })}>
                                                    <Eye size={15} />{matchCars.length > 0 ? ` ${matchCars.length}` : ''}
                                                </button>
                                                {waitingListTemplateReady && it.status === 'matched' && matchCars.length > 0 && (
                                                    <button className="inv-action-btn" title="Avisar automaticamente (template)" style={{ color: '#059669' }}
                                                        onClick={() => notifyOne(it)} disabled={notifyingId === it.id}>
                                                        {notifyingId === it.id ? <Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} /> : <Rocket size={15} />}
                                                    </button>
                                                )}
                                                <button className="inv-action-btn" title="Avisar manual (copiar mensagem)" onClick={() => setNotifyModal({ interest: it, cars: matchCars })}>
                                                    <Bell size={15} />
                                                </button>
                                                {it.status !== 'converted' && (
                                                    <button className="inv-action-btn" title="Marcar como vendido" style={{ color: '#059669' }} onClick={() => updateInterestStatus(it.id, 'converted')}>
                                                        <CheckCircle2 size={15} />
                                                    </button>
                                                )}
                                                {it.status !== 'dismissed' && (
                                                    <button className="inv-action-btn" title="Descartar" style={{ color: '#d97706' }} onClick={() => updateInterestStatus(it.id, 'dismissed')}>
                                                        <XCircle size={15} />
                                                    </button>
                                                )}
                                                <button className="inv-action-btn" title="Excluir" style={{ color: '#dc2626' }} onClick={() => setConfirmDeleteId(it.id)}>
                                                    <Trash2 size={15} />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                )}
            </div>

            {matchesModal && (
                <MatchesModal interest={matchesModal.interest} cars={matchesModal.cars} onClose={() => setMatchesModal(null)} />
            )}
            {notifyModal && (
                <NotifyModal
                    interest={notifyModal.interest}
                    cars={notifyModal.cars}
                    onClose={() => setNotifyModal(null)}
                    onMarkNotified={() => handleNotified(notifyModal.interest)}
                />
            )}
            {confirmDeleteId && (
                <ConfirmModal
                    message="Tem certeza que deseja excluir este interesse da lista de espera?"
                    onCancel={() => setConfirmDeleteId(null)}
                    onConfirm={async () => { await deleteInterest(confirmDeleteId); setConfirmDeleteId(null); addToast('Interesse removido.', 'info'); }}
                />
            )}
        </div>
    );
};

export default WaitingList;
