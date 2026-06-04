import React, { useState, useRef, useEffect } from 'react';
import {
    Plus, Search, Eye, Pencil, Trash2, Image as ImageIcon,
    X, Gauge, Tag, CheckCircle2, ShoppingCart, MoreVertical, Package, Camera
} from 'lucide-react';
import { useAppContext, getTodayStr } from '../context/AppContext.jsx';

const CarPlaceholder = () => (
    <div className="car-placeholder">
        <Camera size={36} strokeWidth={1.5} />
        <span>Sem foto</span>
    </div>
);

const StatusBadge = ({ status }) => {
    const map = {
        disponivel: { label: 'Disponível', bg: '#ecfdf5', color: '#059669' },
        reservado: { label: 'Reservado', bg: '#fff7ed', color: '#d97706' }
    };
    const s = map[status] || map.disponivel;
    return <span className="inv-status-badge" style={{ background: s.bg, color: s.color }}>{s.label}</span>;
};

const EMPTY_CAR = { brand: '', model: '', version: '', year: '', price: '', km: '', transmission: 'Automático', fuel: 'Flex', color: '', vehicle_type: 'carro', status: 'disponivel', images: [] };

// Parse preço no formato brasileiro ("198.000" ou "198.000,00" ou "198000") → número
const parsePriceBR = (value) => {
    if (typeof value === 'number') return value;
    const cleaned = String(value).replace(/\./g, '').replace(',', '.');
    return parseFloat(cleaned) || 0;
};

const CarFormModal = ({ car, isEdit, onClose, onSave }) => {
    const { addToast } = useAppContext();
    const [form, setForm] = useState(car ? {
        ...car,
        price: car.price != null ? Number(car.price).toLocaleString('pt-BR', { maximumFractionDigits: 0 }) : '',
        km:    car.km    != null ? Number(car.km).toLocaleString('pt-BR',    { maximumFractionDigits: 0 }) : '',
        vehicle_type: car.vehicle_type || 'carro',
        images: (car.images || (car.image ? [car.image] : [])).map(img => typeof img === 'string' ? { preview: img, file: null } : img),
    } : { ...EMPTY_CAR });
    const [errors, setErrors] = useState({});

    const handleChange = (field, value) => {
        setForm(prev => ({ ...prev, [field]: value }));
        if (errors[field]) setErrors(prev => ({ ...prev, [field]: null }));
    };

    const handleImageUpload = (e) => {
        const files = Array.from(e.target.files);
        const currentImagesCount = form.images?.length || 0;
        
        if (currentImagesCount + files.length > 8) {
            addToast('Limite de 8 fotos atingido.', 'error');
            return;
        }

        files.forEach(file => {
            if (file.size > 10 * 1024 * 1024) {
                addToast(`A imagem ${file.name} excede 10MB.`, 'error');
                return;
            }
            const preview = URL.createObjectURL(file);
            setForm(prev => ({ ...prev, images: [...(prev.images || []), { preview, file }] }));
        });
    };

    const removeImage = (index) => {
        setForm(prev => ({
            ...prev,
            images: prev.images.filter((_, i) => i !== index)
        }));
    };

    const handleSubmit = () => {
        const newErrors = {};
        if (!form.brand) newErrors.brand = true;
        if (!form.model) newErrors.model = true;
        if (!form.price) newErrors.price = true;
        if (!form.year) newErrors.year = true;

        if (Object.keys(newErrors).length > 0) {
            setErrors(newErrors);
            addToast('Preencha os campos obrigatórios.', 'error');
            return;
        }
        
        onSave({
            ...form,
            price: parsePriceBR(form.price),
            km:    parsePriceBR(form.km),
            status: form.status || 'disponivel',
            images: form.images?.length > 0 ? form.images : []
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
                    <div className="form-group">
                        <label>Fotos do Veículo ({form.images?.length || 0}/8)</label>
                        <div className="image-upload-grid">
                            {(form.images || []).map((img, index) => (
                                <div key={index} className="image-preview-item">
                                    <img src={img.preview || img} alt={`Preview ${index}`} />
                                    <button className="remove-image-btn" onClick={() => removeImage(index)}><Trash2 size={14} /></button>
                                </div>
                            ))}
                            {(!form.images || form.images.length < 8) && (
                                <div className="upload-card-btn" onClick={() => document.getElementById('car-images-upload').click()}>
                                    <Plus size={24} />
                                    <span style={{ fontSize: '0.7rem', fontWeight: 600 }}>Adicionar</span>
                                    <input id="car-images-upload" type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={handleImageUpload} />
                                </div>
                            )}
                        </div>
                        {form.images?.length === 8 && <p className="error-message" style={{ color: '#f59e0b' }}>Limite de 8 fotos atingido.</p>}
                    </div>

                    <div className="form-row">
                        <div className={`form-group ${errors.brand ? 'has-error' : ''}`}>
                            <label>Marca *</label>
                            <input type="text" value={form.brand} onChange={e => handleChange('brand', e.target.value)} placeholder="Ex: Toyota" />
                        </div>
                        <div className={`form-group ${errors.model ? 'has-error' : ''}`}>
                            <label>Modelo *</label>
                            <input type="text" value={form.model} onChange={e => handleChange('model', e.target.value)} placeholder="Ex: Corolla" />
                        </div>
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
                        <div className="form-group"><label>Tipo de Veículo</label>
                            <select value={form.vehicle_type || 'carro'} onChange={e => handleChange('vehicle_type', e.target.value)}>
                                <option value="carro">🚗 Carro</option>
                                <option value="moto">🏍 Moto</option>
                            </select>
                        </div>
                    </div>
                    <div className="form-row">
                        <div className={`form-group ${errors.year ? 'has-error' : ''}`}>
                            <label>Ano *</label>
                            <input type="text" value={form.year} onChange={e => handleChange('year', e.target.value)} placeholder="Ex: 2024" />
                        </div>
                        <div className={`form-group ${errors.price ? 'has-error' : ''}`}>
                            <label>Valor (R$) *</label>
                            <input type="text" inputMode="numeric" value={form.price} onChange={e => handleChange('price', e.target.value)} placeholder="Ex: 198000 ou 198.000" />
                        </div>
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
    const { addToast } = useAppContext();
    const [salePrice, setSalePrice] = useState(car ? car.price : 0);
    const [saleDate, setSaleDate] = useState(getTodayStr());
    const [sellerName, setSellerName] = useState('');
    const [error, setError] = useState(false);

    if (!car) return null;

    const handleConfirm = () => {
        if (!sellerName.trim()) {
            setError(true);
            addToast('O nome do vendedor é obrigatório.', 'error');
            return;
        }
        onConfirm(car.id, salePrice, saleDate, sellerName);
    };

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content modal-sm" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>Registrar Venda</h2>
                    <button className="close-btn" onClick={onClose}><X size={24} /></button>
                </div>
                <div className="sell-modal-body">
                    <div className="sell-car-info">
                        {car.images?.[0] ? <img src={car.images[0]} alt={car.model} className="sell-car-thumb" /> : <div className="sell-car-thumb" style={{display:'flex',alignItems:'center',justifyContent:'center',background:'var(--input-bg)',borderRadius:'8px',width:'64px',height:'64px'}}><Camera size={24} color="#94a3b8" /></div>}
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
                    <div className={`form-group ${error ? 'has-error' : ''}`}>
                        <label>Vendedor *</label>
                        <input 
                            type="text" 
                            placeholder="Nome do vendedor" 
                            value={sellerName} 
                            onChange={e => { setSellerName(e.target.value); if (error) setError(false); }} 
                        />
                        {error && <p className="error-message">Campo obrigatório</p>}
                    </div>
                </div>
                <div className="modal-footer">
                    <button className="btn-secondary" onClick={onClose}>Cancelar</button>
                    <button className="btn-primary" style={{ background: '#059669' }} onClick={handleConfirm}>
                        <CheckCircle2 size={18} /> Confirmar Venda
                    </button>
                </div>
            </div>
        </div>
    );
};

const DetailDrawer = ({ car, onClose }) => {
    const images = car.images?.length > 0 ? car.images : [];
    const [activeImg, setActiveImg] = useState(0);

    if (!car) return null;
    return (
        <div className="drawer-overlay" onClick={onClose}>
            <div className="drawer-content" onClick={e => e.stopPropagation()}>
                <div className="drawer-header">
                    <h2>Detalhes do Veículo</h2>
                    <button className="close-btn" onClick={onClose}><X size={20} /></button>
                </div>
                <div className="drawer-body">
                    <div className="detail-gallery">
                        <div className="gallery-main">
                            {images.length > 0 ? (
                                <img src={images[activeImg]} alt={car.model} />
                            ) : (
                                <div style={{display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',height:'280px',background:'var(--input-bg)',borderRadius:'12px',color:'#94a3b8',gap:'0.5rem'}}>
                                    <Camera size={48} strokeWidth={1.5} />
                                    <span style={{fontSize:'0.875rem',fontWeight:500}}>Nenhuma foto cadastrada</span>
                                </div>
                            )}
                        </div>
                        {images.length > 1 && (
                            <div className="gallery-thumbs">
                                {images.map((img, idx) => (
                                    <div 
                                        key={idx} 
                                        className={`thumb-item ${activeImg === idx ? 'active' : ''}`}
                                        onClick={() => setActiveImg(idx)}
                                    >
                                        <img src={img} alt={`Thumb ${idx}`} />
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                    <h3 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '0.25rem' }}>{car.brand} {car.model}</h3>
                    <p className="text-muted" style={{ marginBottom: '1.5rem' }}>{car.version} • {car.year}</p>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                        {[
                            ['Preço', `R$ ${Number(car.price).toLocaleString('pt-BR')}`],
                            ['Quilometragem', `${Number(car.km).toLocaleString('pt-BR')} km`],
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
    const [confirmDeleteId, setConfirmDeleteId] = useState(null);

    const filtered = inventory.filter(c => {
        const matchSearch = `${c.brand} ${c.model} ${c.version} ${c.year}`.toLowerCase().includes(search.toLowerCase());
        const matchStatus = filterStatus === 'todos' || c.status === filterStatus;
        return matchSearch && matchStatus;
    });

    const handleAddCar = (carData) => addInventoryCar(carData);
    const handleEditCar = (carData) => updateInventoryCar(editCar.id, carData);
    const handleSell = (carId, price, date, seller) => { sellCar(carId, price, date, seller); setSellCarObj(null); };
    const handleDelete = (carId) => setConfirmDeleteId(carId);
    const confirmDelete = () => { removeInventoryCar(confirmDeleteId); setConfirmDeleteId(null); };

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
                            {car.images?.length > 0 ? (
                                <img src={car.images[0]} alt={`${car.brand} ${car.model}`} />
                            ) : (
                                <CarPlaceholder />
                            )}
                            <StatusBadge status={car.status} />
                            {car.vehicle_type === 'moto' && (
                                <span style={{ position: 'absolute', top: 8, left: 8, background: '#7c3aed', color: '#fff', fontSize: '0.65rem', fontWeight: 700, padding: '2px 7px', borderRadius: 4, letterSpacing: '0.04em' }}>MOTO</span>
                            )}
                            {car.images?.length > 1 && <div className="image-count-overlay"><ImageIcon size={12} /> {car.images.length}</div>}
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
                                <span><Gauge size={14} /> {Number(car.km).toLocaleString('pt-BR')} km</span>
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
                    <div className="empty-state" style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '5rem 2rem', background: 'var(--card-bg)', borderRadius: '16px', border: '1px dashed var(--border)' }}>
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
            {confirmDeleteId && (
                <ConfirmModal
                    message="Tem certeza que deseja excluir este veículo do estoque? Essa ação não pode ser desfeita."
                    onConfirm={confirmDelete}
                    onCancel={() => setConfirmDeleteId(null)}
                />
            )}
        </div>
    );
};

export default Inventory;
