import React, { useState, useRef, useEffect } from 'react';
import {
    Plus, Search, Eye, Pencil, Trash2, Image as ImageIcon,
    X, Gauge, Tag, CheckCircle2, ShoppingCart, MoreVertical, Package
} from 'lucide-react';
import { useAppContext, getTodayStr } from '../context/AppContext.jsx';

const StatusBadge = ({ status }) => {
    const map = {
        disponivel: { label: 'Disponível', bg: '#ecfdf5', color: '#059669' },
        reservado: { label: 'Reservado', bg: '#fff7ed', color: '#d97706' }
    };
    const s = map[status] || map.disponivel;
    return <span className="inv-status-badge" style={{ background: s.bg, color: s.color }}>{s.label}</span>;
};

const EMPTY_CAR = { brand: '', model: '', version: '', year: '', price: '', km: '', transmission: 'Automático', fuel: 'Flex', color: '', status: 'disponivel', image: '' };

const CarFormModal = ({ car, isEdit, onClose, onSave }) => {
    const { addToast } = useAppContext();
    const [form, setForm] = useState(car ? { ...car } : { ...EMPTY_CAR });
    const handleChange = (field, value) => setForm(prev => ({ ...prev, [field]: value }));

    const handleImageUpload = (e) => {
        const file = e.target.files[0];
        if (file) {
            if (file.size > 10 * 1024 * 1024) {
                addToast('A imagem deve ter no máximo 10MB.', 'error');
                return;
            }
            const reader = new FileReader();
            reader.onloadend = () => handleChange('image', reader.result);
            reader.readAsDataURL(file);
        }
    };

    const handleSubmit = () => {
        if (!form.brand || !form.model || !form.price || !form.year) {
            addToast('Preencha os campos obrigatórios (*).', 'error');
            return;
        }
        
        onSave({
            ...form,
            price: Number(form.price),
            status: form.status || 'disponivel',
            image: form.image || 'https://images.unsplash.com/photo-1583121274602-3e2820c69888?q=80&w=400&auto=format&fit=crop'
        });
        onClose();
    };

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>{isEdit ? 'Editar informações' : 'Novo veículo'}</h2>
                    <button className="close-btn" onClick={onClose}><X size={24} /></button>
                </div>
                <div className="settings-form">
                    <div 
                        className="image-upload-area" 
                        onClick={() => document.getElementById('car-image-upload').click()}
                        style={{
                            cursor: 'pointer', 
                            position: 'relative', 
                            minHeight: '160px', 
                            display: 'flex', 
                            flexDirection: 'column', 
                            alignItems: 'center', 
                            justifyContent: 'center',
                            overflow: 'hidden',
                            border: '2px dashed #94a3b8',
                            borderRadius: '12px',
                            marginBottom: '1.5rem',
                            background: '#f8fafc',
                            padding: 0
                        }}
                    >
                        <input id="car-image-upload" type="file" accept="image/*" style={{ display: 'none' }} onChange={handleImageUpload} />
                        {form.image ? (
                            <img src={form.image} alt="Preview" style={{ width: '100%', height: '100%', objectFit: 'cover', position: 'absolute', top: 0, left: 0 }} />
                        ) : null}
                        <div style={{
                            position: 'relative', 
                            zIndex: 1, 
                            background: form.image ? 'rgba(255,255,255,0.9)' : 'transparent',
                            padding: '1rem',
                            borderRadius: '8px',
                            textAlign: 'center',
                            width: form.image ? 'auto' : '100%',
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            boxShadow: form.image ? '0 4px 6px -1px rgba(0, 0, 0, 0.1)' : 'none'
                        }}>
                            <ImageIcon size={32} className="text-muted" style={{ marginBottom: '0.5rem' }} />
                            <p className="font-600" style={{ margin: 0, color: '#0f172a' }}>{form.image ? 'Clique para alterar a foto' : 'Arraste fotos ou clique para enviar'}</p>
                            {!form.image && <p className="text-muted" style={{ fontSize: '0.8rem', margin: 0, marginTop: '0.25rem' }}>PNG, JPG até 10MB</p>}
                        </div>
                    </div>
                    <div className="form-row">
                        <div className="form-group"><label>Marca *</label><input type="text" value={form.brand} onChange={e => handleChange('brand', e.target.value)} placeholder="Ex: Toyota" /></div>
                        <div className="form-group"><label>Modelo *</label><input type="text" value={form.model} onChange={e => handleChange('model', e.target.value)} placeholder="Ex: Corolla" /></div>
                    </div>
                    <div className="form-row">
                        <div className="form-group"><label>Versão</label><input type="text" value={form.version} onChange={e => handleChange('version', e.target.value)} placeholder="Ex: XEi 2.0 Flex" /></div>
                        <div className="form-group"><label>Status</label>
                            <select value={form.status} onChange={e => handleChange('status', e.target.value)}>
                                <option value="disponivel">Disponível</option>
                                <option value="reservado">Reservado</option>
                            </select>
                        </div>
                    </div>
                    <div className="form-row">
                        <div className="form-group"><label>Ano *</label><input type="text" value={form.year} onChange={e => handleChange('year', e.target.value)} placeholder="Ex: 2024" /></div>
                        <div className="form-group"><label>Valor (R$) *</label><input type="number" value={form.price} onChange={e => handleChange('price', e.target.value)} placeholder="148900" /></div>
                    </div>
                    <div className="form-row">
                        <div className="form-group"><label>Quilometragem</label><input type="text" value={form.km} onChange={e => handleChange('km', e.target.value)} placeholder="15.000" /></div>
                        <div className="form-group"><label>Câmbio</label>
                            <select value={form.transmission} onChange={e => handleChange('transmission', e.target.value)}>
                                <option>Automático</option><option>Manual</option><option>CVT</option>
                            </select>
                        </div>
                    </div>
                    <div className="form-row">
                        <div className="form-group"><label>Combustível</label>
                            <select value={form.fuel} onChange={e => handleChange('fuel', e.target.value)}>
                                <option>Flex</option><option>Gasolina</option><option>Diesel</option><option>Elétrico</option><option>Híbrido</option>
                            </select>
                        </div>
                        <div className="form-group"><label>Cor</label><input type="text" value={form.color} onChange={e => handleChange('color', e.target.value)} placeholder="Prata" /></div>
                    </div>
                    <div className="modal-footer" style={{ marginTop: '1rem' }}>
                        <button className="btn-secondary" onClick={onClose}>Cancelar</button>
                        <button className="btn-primary" onClick={handleSubmit}>
                            {isEdit ? 'Salvar Alterações' : 'Registrar Veículo'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

const SellModal = ({ car, onClose, onConfirm }) => {
    const [salePrice, setSalePrice] = useState(car ? car.price : 0);
    const [saleDate, setSaleDate] = useState(getTodayStr());
    if (!car) return null;
    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content modal-sm" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>Registrar Venda</h2>
                    <button className="close-btn" onClick={onClose}><X size={24} /></button>
                </div>
                <div className="sell-modal-body">
                    <div className="sell-car-info">
                        <img src={car.image} alt={car.model} className="sell-car-thumb" />
                        <div>
                            <h3>{car.brand} {car.model}</h3>
                            <p className="text-muted">{car.version} • {car.year}</p>
                        </div>
                    </div>
                    <div className="form-group">
                        <label>Valor Fechado (R$)</label>
                        <input type="number" value={salePrice} onChange={e => setSalePrice(Number(e.target.value))} />
                    </div>
                    <div className="form-group">
                        <label>Data da Venda</label>
                        <input type="date" value={saleDate} onChange={e => setSaleDate(e.target.value)} />
                    </div>
                </div>
                <div className="modal-footer">
                    <button className="btn-secondary" onClick={onClose}>Cancelar</button>
                    <button className="btn-primary" style={{ background: '#059669' }} onClick={() => onConfirm(car.id, salePrice, saleDate)}>
                        <CheckCircle2 size={18} /> Confirmar Venda
                    </button>
                </div>
            </div>
        </div>
    );
};

const DetailDrawer = ({ car, onClose }) => {
    if (!car) return null;
    return (
        <div className="drawer-overlay" onClick={onClose}>
            <div className="drawer-content" onClick={e => e.stopPropagation()}>
                <div className="drawer-header">
                    <h2>Detalhes do Veículo</h2>
                    <button className="close-btn" onClick={onClose}><X size={20} /></button>
                </div>
                <div className="drawer-body">
                    <img src={car.image} alt={car.model} style={{ width: '100%', height: 200, objectFit: 'cover', borderRadius: 12, marginBottom: '1.5rem' }} />
                    <h3 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '0.25rem' }}>{car.brand} {car.model}</h3>
                    <p className="text-muted" style={{ marginBottom: '1.5rem' }}>{car.version} • {car.year}</p>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                        {[
                            ['Preço', `R$ ${Number(car.price).toLocaleString('pt-BR')}`],
                            ['Quilometragem', `${car.km} km`],
                            ['Câmbio', car.transmission],
                            ['Combustível', car.fuel],
                            ['Cor', car.color],
                            ['Status', car.status === 'disponivel' ? 'Disponível' : 'Reservado']
                        ].map(([label, value]) => (
                            <div key={label}>
                                <p className="text-muted" style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '0.25rem' }}>{label}</p>
                                <p style={{ fontWeight: 600 }}>{value}</p>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
};

const DropdownMenu = ({ car, onView, onEdit, onSell, onDelete }) => {
    const [open, setOpen] = useState(false);
    const ref = useRef(null);

    useEffect(() => {
        const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    return (
        <div ref={ref} style={{ position: 'relative' }}>
            <button className="inv-action-btn" onClick={() => setOpen(!open)} title="Mais ações"><MoreVertical size={16} /></button>
            {open && (
                <div className="dropdown-menu" style={{ top: '100%', right: 0 }}>
                    <button className="dropdown-item" onClick={() => { onView(); setOpen(false); }}><Eye size={14} /> Ver Detalhes</button>
                    <button className="dropdown-item" onClick={() => { onEdit(); setOpen(false); }}><Pencil size={14} /> Editar</button>
                    <button className="dropdown-item" onClick={() => { onSell(); setOpen(false); }}><ShoppingCart size={14} /> Marcar Vendido</button>
                    <button className="dropdown-item danger" onClick={() => { onDelete(); setOpen(false); }}><Trash2 size={14} /> Excluir</button>
                </div>
            )}
        </div>
    );
};

const Inventory = () => {
    const { inventory, addInventoryCar, updateInventoryCar, removeInventoryCar, sellCar } = useAppContext();
    const [search, setSearch] = useState('');
    const [filterStatus, setFilterStatus] = useState('todos');
    const [showAddModal, setShowAddModal] = useState(false);
    const [editCar, setEditCar] = useState(null);
    const [sellCarObj, setSellCarObj] = useState(null);
    const [viewCar, setViewCar] = useState(null);

    const filtered = inventory.filter(c => {
        const matchSearch = `${c.brand} ${c.model} ${c.version} ${c.year}`.toLowerCase().includes(search.toLowerCase());
        const matchStatus = filterStatus === 'todos' || c.status === filterStatus;
        return matchSearch && matchStatus;
    });

    const handleAddCar = (carData) => addInventoryCar(carData);
    const handleEditCar = (carData) => updateInventoryCar(editCar.id, carData);
    const handleSell = (carId, price, date) => { sellCar(carId, price, date); setSellCarObj(null); };
    const handleDelete = (carId) => { if (window.confirm('Deseja realmente remover este veículo do estoque? Essa ação não pode ser desfeita.')) removeInventoryCar(carId); };

    return (
        <div className="view-content">
            <header className="view-header-flex">
                <div className="view-header">
                    <h1>Meu Estoque</h1>
                    <p>Gerencie seus veículos. <strong>{filtered.length}</strong> listado{filtered.length !== 1 ? 's' : ''}.</p>
                </div>
                <button className="btn-primary" onClick={() => setShowAddModal(true)} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <Plus size={20} /> Novo Veículo
                </button>
            </header>

            <div className="inv-toolbar">
                <div className="inv-search">
                    <Search size={18} />
                    <input type="text" placeholder="Buscar por marca, modelo ou versão..." value={search} onChange={e => setSearch(e.target.value)} />
                </div>
                <div className="inv-filters">
                    {[['todos', 'Todos'], ['disponivel', 'Disponíveis'], ['reservado', 'Reservados']].map(([key, label]) => (
                        <button key={key} className={`inv-filter-btn ${filterStatus === key ? 'active' : ''}`} onClick={() => setFilterStatus(key)}>{label}</button>
                    ))}
                </div>
            </div>

            <div className="inv-grid">
                {filtered.map(car => (
                    <div key={car.id} className="inv-card card">
                        <div className="inv-card-img">
                            <img src={car.image} alt={`${car.brand} ${car.model}`} />
                            <StatusBadge status={car.status} />
                        </div>
                        <div className="inv-card-body">
                            <div className="inv-card-top">
                                <div>
                                    <h3 className="inv-card-name">{car.brand} {car.model}</h3>
                                    <p className="inv-card-version">{car.version}</p>
                                </div>
                                <span className="inv-card-year">{car.year}</span>
                            </div>
                            <div className="inv-card-price">R$ {Number(car.price).toLocaleString('pt-BR')}</div>
                            <div className="inv-card-specs">
                                <span><Gauge size={14} /> {car.km} km</span>
                                <span><Tag size={14} /> {car.transmission}</span>
                                <span>{car.fuel}</span>
                            </div>
                            <div className="inv-card-actions">
                                <button className="inv-action-btn sell" onClick={() => setSellCarObj(car)} title="Finalizar venda">
                                    <ShoppingCart size={16} /> Vendido
                                </button>
                                <button className="inv-action-btn" onClick={() => setViewCar(car)} title="Ver detalhes"><Eye size={16} /></button>
                                <button className="inv-action-btn" onClick={() => setEditCar(car)} title="Editar"><Pencil size={16} /></button>
                                <DropdownMenu
                                    car={car}
                                    onView={() => setViewCar(car)}
                                    onEdit={() => setEditCar(car)}
                                    onSell={() => setSellCarObj(car)}
                                    onDelete={() => handleDelete(car.id)}
                                />
                            </div>
                        </div>
                    </div>
                ))}
                {filtered.length === 0 && (
                    <div className="empty-state" style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '5rem 2rem', background: 'white', borderRadius: '16px', border: '1px dashed #cbd5e1' }}>
                        <Package size={56} style={{ color: '#94a3b8', marginBottom: '1.5rem', opacity: 0.8 }} />
                        <h3 style={{ fontWeight: 700, marginBottom: '0.5rem', fontSize: '1.25rem', color: '#1e293b' }}>Nenhum veículo encontrado</h3>
                        <p className="text-muted" style={{ maxWidth: '400px', margin: '0 auto' }}>Tente ajustar os filtros de busca ou clique em "Novo Veículo" para adicionar um ao seu pátio.</p>
                    </div>
                )}
            </div>

            {showAddModal && <CarFormModal onClose={() => setShowAddModal(false)} onSave={handleAddCar} />}
            {editCar && <CarFormModal car={editCar} isEdit onClose={() => setEditCar(null)} onSave={handleEditCar} />}
            {sellCarObj && <SellModal car={sellCarObj} onClose={() => setSellCarObj(null)} onConfirm={handleSell} />}
            {viewCar && <DetailDrawer car={viewCar} onClose={() => setViewCar(null)} />}
        </div>
    );
};

export default Inventory;
