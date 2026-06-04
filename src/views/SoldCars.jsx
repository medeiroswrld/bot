import React, { useState } from 'react';
import { Search, TrendingUp, ShoppingCart, X, Package } from 'lucide-react';
import { useAppContext, formatDateStr } from '../context/AppContext.jsx';

const DetailDrawer = ({ car, onClose }) => {
    const images = car.images || (car.image ? [car.image] : []);
    const [activeImg, setActiveImg] = useState(0);

    if (!car) return null;
    return (
        <div className="drawer-overlay" onClick={onClose}>
            <div className="drawer-content" onClick={e => e.stopPropagation()}>
                <div className="drawer-header">
                    <h2>Detalhes da Venda</h2>
                    <button className="close-btn" onClick={onClose}><X size={20} /></button>
                </div>
                <div className="drawer-body">
                    <div className="detail-gallery">
                        <div className="gallery-main">
                            <img src={images[activeImg]} alt={car.model} />
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
                    
                    {car.sold_by && (
                        <div className="seller-badge" style={{ marginBottom: '1.5rem' }}>
                            <small className="text-muted">Vendido por:</small>
                            <span className="seller-name-label">{car.sold_by}</span>
                        </div>
                    )}

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem' }}>
                        <div>
                            <p className="text-muted" style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '0.25rem' }}>Valor de Venda</p>
                            <p style={{ fontWeight: 700, color: '#059669', fontSize: '1.1rem' }}>R$ {car.sold_price?.toLocaleString('pt-BR')}</p>
                        </div>
                        <div>
                            <p className="text-muted" style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '0.25rem' }}>Valor Original</p>
                            <p style={{ fontWeight: 600 }}>R$ {car.price?.toLocaleString('pt-BR')}</p>
                        </div>
                        <div>
                            <p className="text-muted" style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '0.25rem' }}>Data da Venda</p>
                            <p style={{ fontWeight: 600 }}>{formatDateStr((car.sold_at || '').split('T')[0])}</p>
                        </div>
                        <div>
                            <p className="text-muted" style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '0.25rem' }}>Quilometragem</p>
                            <p style={{ fontWeight: 600 }}>{car.km} km</p>
                        </div>
                        <div>
                            <p className="text-muted" style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '0.25rem' }}>Cor</p>
                            <p style={{ fontWeight: 600 }}>{car.color}</p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

const SoldCars = () => {
    const { soldCars } = useAppContext();
    const [search, setSearch] = useState('');
    const [filterMonth, setFilterMonth] = useState('todos');
    const [viewCar, setViewCar] = useState(null);

    const availableMonths = [...new Set(soldCars.map(c => (c.sold_at || '').substring(0, 7)))].filter(Boolean).sort().reverse();

    const filtered = soldCars.filter(c => {
        const matchSearch = `${c.brand} ${c.model} ${c.version}`.toLowerCase().includes(search.toLowerCase());
        const matchMonth = filterMonth === 'todos' || (c.sold_at || '').substring(0, 7) === filterMonth;
        return matchSearch && matchMonth;
    });

    const totalRevenue = filtered.reduce((acc, c) => acc + (Number(c.sold_price) || 0), 0);
    const formatCurrency = (val) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(val);

    return (
        <div className="view-content">
            <header className="view-header-flex">
                <div className="view-header">
                    <h1>Histórico de Vendas</h1>
                    <p>Acompanhe todas as transações finalizadas pela equipe.</p>
                </div>
                <div className="sold-summary-badges">
                    <div className="sold-summary-badge">
                        <span>{filtered.length}</span>
                        <small>Vendidos</small>
                    </div>
                    <div className="sold-summary-badge highlight">
                        <span>{formatCurrency(totalRevenue)}</span>
                        <small>Receita Total</small>
                    </div>
                </div>
            </header>

            <div className="inv-toolbar" style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                <div className="inv-search" style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '0.75rem', background: 'var(--card-bg)', border: '1px solid var(--border)', padding: '0.65rem 1rem', borderRadius: 'var(--radius-md)' }}>
                    <Search size={18} />
                    <input type="text" placeholder="Buscar veículo vendido..." value={search} onChange={e => setSearch(e.target.value)} style={{ border: 'none', background: 'transparent', outline: 'none', width: '100%', fontSize: '0.9rem', color: 'var(--text-primary)' }} />
                </div>
                <select value={filterMonth} onChange={e => setFilterMonth(e.target.value)} style={{ padding: '0.65rem 1rem', borderRadius: 8, border: '1px solid var(--border)', outline: 'none', background: 'var(--card-bg)', color: 'var(--text-primary)', minWidth: '150px' }}>
                    <option value="todos">Todos os meses</option>
                    {availableMonths.map(month => {
                        const [y, m] = month.split('-');
                        const dateObj = new Date(y, m - 1);
                        const label = dateObj.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
                        return <option key={month} value={month}>{label.charAt(0).toUpperCase() + label.slice(1)}</option>
                    })}
                </select>
            </div>

            <div className="sold-list">
                {filtered.map(car => (
                    <div key={car.id} className="sold-card card" onClick={() => setViewCar(car)} style={{ cursor: 'pointer' }}>
                        <img src={car.images?.[0] || car.image} alt={car.model} className="sold-card-img" />
                        <div className="sold-card-info">
                            <h3 style={{ fontWeight: 700, fontSize: '1.05rem' }}>{car.brand} {car.model}</h3>
                            <p className="text-muted" style={{ fontSize: '0.85rem' }}>{car.version} • {car.year} • {car.color}</p>
                            {car.sold_by && (
                                <div className="seller-badge" style={{ padding: '0.25rem 0.5rem', marginTop: '0.5rem', border: 'none', background: '#f8fafc' }}>
                                    <small className="text-muted" style={{ fontSize: '0.7rem' }}>Vendedor:</small>
                                    <strong style={{ fontSize: '0.75rem', marginLeft: '0.25rem', color: 'var(--color-primary)' }}>{car.sold_by}</strong>
                                </div>
                            )}
                        </div>
                        <div className="sold-card-detail">
                            <small className="text-muted">Valor de Venda</small>
                            <strong style={{ color: '#059669' }}>R$ {car.sold_price?.toLocaleString('pt-BR')}</strong>
                        </div>
                        <div className="sold-card-detail">
                            <small className="text-muted">Data</small>
                            <strong>{formatDateStr((car.sold_at || '').split('T')[0])}</strong>
                        </div>
                    </div>
                ))}
                {filtered.length === 0 && (
                    <div style={{ textAlign: 'center', padding: '4rem 2rem' }}>
                        <Package size={48} style={{ color: '#94a3b8', marginBottom: '1rem' }} />
                        <h3 style={{ fontWeight: 600, marginBottom: '0.5rem' }}>Sem registros de venda</h3>
                        <p className="text-muted">As vendas finalizadas no estoque aparecerão aqui automaticamente.</p>
                    </div>
                )}
            </div>

            {viewCar && <DetailDrawer car={viewCar} onClose={() => setViewCar(null)} />}
        </div>
    );
};

export default SoldCars;
