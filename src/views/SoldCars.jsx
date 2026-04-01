import React, { useState } from 'react';
import { Search, TrendingUp, ShoppingCart, X, Package } from 'lucide-react';
import { useAppContext, formatDateStr } from '../context/AppContext.jsx';

const DetailDrawer = ({ car, onClose }) => {
    if (!car) return null;
    return (
        <div className="drawer-overlay" onClick={onClose}>
            <div className="drawer-content" onClick={e => e.stopPropagation()}>
                <div className="drawer-header">
                    <h2>Detalhes da Venda</h2>
                    <button className="close-btn" onClick={onClose}><X size={20} /></button>
                </div>
                <div className="drawer-body">
                    <img src={car.image} alt={car.model} style={{ width: '100%', height: 200, objectFit: 'cover', borderRadius: 12, marginBottom: '1.5rem' }} />
                    <h3 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '0.25rem' }}>{car.brand} {car.model}</h3>
                    <p className="text-muted" style={{ marginBottom: '1.5rem' }}>{car.version} • {car.year}</p>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem' }}>
                        <div>
                            <p className="text-muted" style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '0.25rem' }}>Valor de Venda</p>
                            <p style={{ fontWeight: 700, color: '#059669', fontSize: '1.1rem' }}>R$ {car.salePrice?.toLocaleString('pt-BR')}</p>
                        </div>
                        <div>
                            <p className="text-muted" style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '0.25rem' }}>Valor Original</p>
                            <p style={{ fontWeight: 600 }}>R$ {car.originalPrice?.toLocaleString('pt-BR')}</p>
                        </div>
                        <div>
                            <p className="text-muted" style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '0.25rem' }}>Data da Venda</p>
                            <p style={{ fontWeight: 600 }}>{formatDateStr(car.saleDate)}</p>
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

    const availableMonths = [...new Set(soldCars.map(c => c.saleDate.substring(0, 7)))].sort().reverse();

    const filtered = soldCars.filter(c => {
        const matchSearch = `${c.brand} ${c.model} ${c.version}`.toLowerCase().includes(search.toLowerCase());
        const matchMonth = filterMonth === 'todos' || c.saleDate.substring(0, 7) === filterMonth;
        return matchSearch && matchMonth;
    });

    const totalRevenue = filtered.reduce((acc, c) => acc + (c.salePrice || 0), 0);
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
                <div className="inv-search" style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '0.75rem', background: 'white', border: '1px solid var(--color-border)', padding: '0.65rem 1rem', borderRadius: 'var(--radius-md)' }}>
                    <Search size={18} />
                    <input type="text" placeholder="Buscar veículo vendido..." value={search} onChange={e => setSearch(e.target.value)} style={{ border: 'none', background: 'transparent', outline: 'none', width: '100%', fontSize: '0.9rem' }} />
                </div>
                <select value={filterMonth} onChange={e => setFilterMonth(e.target.value)} style={{ padding: '0.65rem 1rem', borderRadius: 8, border: '1px solid var(--color-border)', outline: 'none', background: 'white', minWidth: '150px' }}>
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
                        <img src={car.image} alt={car.model} className="sold-card-img" />
                        <div className="sold-card-info">
                            <h3 style={{ fontWeight: 700, fontSize: '1.05rem' }}>{car.brand} {car.model}</h3>
                            <p className="text-muted" style={{ fontSize: '0.85rem' }}>{car.version} • {car.year} • {car.color}</p>
                        </div>
                        <div className="sold-card-detail">
                            <small className="text-muted">Valor de Venda</small>
                            <strong style={{ color: '#059669' }}>R$ {car.salePrice?.toLocaleString('pt-BR')}</strong>
                        </div>
                        <div className="sold-card-detail">
                            <small className="text-muted">Data</small>
                            <strong>{formatDateStr(car.saleDate)}</strong>
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
