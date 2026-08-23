import React, { useState } from 'react';
import { Search, TrendingUp, ShoppingCart, X, Package, Camera, FileText, Printer, RefreshCw } from 'lucide-react';
import { useAppContext, formatDateStr } from '../context/AppContext.jsx';
import { MODELO_PADRAO, montarContrato, dadosDoContrato, imprimirContrato, formatarCPF } from '../lib/contrato.js';
import CustosDoVeiculo from './CustosDoVeiculo.jsx';

// Par rotulo/valor. Valor ausente vira travessao em vez de sumir: espaco vazio
// mostra que o dado FALTA, e e assim que a loja descobre o que nao coletou.
const Campo = ({ rotulo, valor, mono }) => (
    <div>
        <p className="text-muted" style={{ fontSize: '0.7rem', textTransform: 'uppercase',
                                           letterSpacing: '0.5px', margin: '0 0 2px' }}>{rotulo}</p>
        <p style={{ fontWeight: 600, margin: 0, fontSize: '0.9rem',
                    fontFamily: mono ? 'ui-monospace, monospace' : 'inherit',
                    color: valor ? 'inherit' : 'var(--text-secondary)' }}>
            {valor || '\u2014'}
        </p>
    </div>
);

const Bloco = ({ titulo, icone, children }) => (
    <div style={{ marginTop: '1.5rem' }}>
        <p style={{ display: 'flex', alignItems: 'center', gap: 7, margin: '0 0 10px',
                    fontWeight: 700, fontSize: '0.85rem' }}>
            {icone} {titulo}
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                      gap: '0.9rem', padding: '12px 14px', background: 'var(--input-bg)',
                      borderRadius: 12 }}>
            {children}
        </div>
    </div>
);

const dinheiro = (v) => (v == null || v === '' ? '' : `R$ ${Number(v).toLocaleString('pt-BR')}`);

// Reimpressao do contrato desta venda. O carro vendido guarda comprador, troca e
// forma de pagamento, entao da pra remontar o documento igual ao do dia da
// venda — sem isso, contrato perdido significa redigitar tudo.
const ContratoDaVenda = ({ car, onClose }) => {
    const { companySettings } = useAppContext();
    const venda = { ...car, salePrice: car.sold_price, saleDate: car.sold_at, sellerName: car.sold_by };
    const html = montarContrato(
        companySettings?.contract_template || MODELO_PADRAO,
        dadosDoContrato({ loja: companySettings, carro: car, venda }),
    );

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 780 }}>
                <div className="modal-header"><h2>Contrato de Compra e Venda</h2></div>
                <div className="modal-body" style={{ maxHeight: '60vh', overflowY: 'auto',
                                                     background: '#fff', color: '#111',
                                                     padding: 22, borderRadius: 8 }}>
                    <div dangerouslySetInnerHTML={{ __html: html }} />
                </div>
                <div className="modal-footer" style={{ justifyContent: 'flex-end', gap: 10 }}>
                    <button className="btn-secondary" onClick={onClose}>Fechar</button>
                    <button className="btn-primary" onClick={() => imprimirContrato(html)}>
                        <Printer size={18} /> Imprimir
                    </button>
                </div>
            </div>
        </div>
    );
};

const DetailDrawer = ({ car, onClose }) => {
    const images = car.images || (car.image ? [car.image] : []);
    const [activeImg, setActiveImg] = useState(0);
    const [verContrato, setVerContrato] = useState(false);
    // Contrato so faz sentido com nome e CPF — mesma regra da tela de venda.
    const temContrato = Boolean(car?.buyer_name && car?.buyer_cpf);

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
                            {images.length > 0 ? (
                                <img src={images[activeImg]} alt={`${car.brand} ${car.model}`} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 12 }} />
                            ) : (
                                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 240, background: 'var(--input-bg)', borderRadius: 12, color: '#94a3b8', gap: 8 }}>
                                    <Camera size={40} strokeWidth={1.5} />
                                    <span style={{ fontSize: '0.85rem' }}>Sem foto cadastrada</span>
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
                    <p className="text-muted" style={{ marginBottom: '1rem' }}>{car.version} \u2022 {car.year}</p>

                    {temContrato && (
                        <button className="btn-primary" style={{ width: '100%' }}
                                onClick={() => setVerContrato(true)}>
                            <FileText size={17} /> Ver contrato desta venda
                        </button>
                    )}

                    <Bloco titulo="A venda" icone={<ShoppingCart size={15} />}>
                        <div>
                            <p className="text-muted" style={{ fontSize: '0.7rem', textTransform: 'uppercase',
                                                               letterSpacing: '0.5px', margin: '0 0 2px' }}>Valor de venda</p>
                            <p style={{ fontWeight: 700, color: '#059669', fontSize: '1.05rem', margin: 0 }}>
                                {dinheiro(car.sold_price) || '\u2014'}
                            </p>
                        </div>
                        <Campo rotulo="Valor anunciado" valor={dinheiro(car.price)} />
                        <Campo rotulo="Data da venda" valor={formatDateStr((car.sold_at || '').split('T')[0])} />
                        <Campo rotulo="Vendedor" valor={car.sold_by} />
                        <Campo rotulo="Forma de pagamento" valor={car.payment_terms} />
                    </Bloco>

                    <Bloco titulo="Comprador" icone={<Package size={15} />}>
                        <Campo rotulo="Nome" valor={car.buyer_name} />
                        <Campo rotulo="CPF" valor={car.buyer_cpf ? formatarCPF(car.buyer_cpf) : ''} mono />
                        <Campo rotulo="RG" valor={car.buyer_rg} mono />
                        <Campo rotulo="Telefone" valor={car.buyer_phone} />
                        <Campo rotulo="E-mail" valor={car.buyer_email} />
                        <Campo rotulo="Endereco" valor={car.buyer_address} />
                    </Bloco>

                    <Bloco titulo="Documento do veiculo" icone={<FileText size={15} />}>
                        <Campo rotulo="Placa" valor={car.plate} mono />
                        <Campo rotulo="Renavam" valor={car.renavam} mono />
                        <Campo rotulo="Chassi" valor={car.chassi} mono />
                        <Campo rotulo="Ano do modelo" valor={car.model_year} />
                        <Campo rotulo="Cor" valor={car.color} />
                        <Campo rotulo="Quilometragem" valor={car.km != null ? `${Number(car.km).toLocaleString('pt-BR')} km` : ''} />
                    </Bloco>

                    {car.trade_in_plate && (
                        <Bloco titulo="Veiculo recebido na troca" icone={<RefreshCw size={15} />}>
                            <Campo rotulo="Marca" valor={car.trade_in_brand} />
                            <Campo rotulo="Modelo" valor={car.trade_in_model} />
                            <Campo rotulo="Ano" valor={car.trade_in_year} />
                            <Campo rotulo="Placa" valor={car.trade_in_plate} mono />
                            <Campo rotulo="Renavam" valor={car.trade_in_renavam} mono />
                            <Campo rotulo="Chassi" valor={car.trade_in_chassi} mono />
                            <Campo rotulo="Cor" valor={car.trade_in_color} />
                            <Campo rotulo="Km" valor={car.trade_in_km != null ? `${Number(car.trade_in_km).toLocaleString('pt-BR')} km` : ''} />
                            <Campo rotulo="Valor avaliado" valor={dinheiro(car.trade_in_value)} />
                        </Bloco>
                    )}

                    {/* Mesmo painel do estoque: despesa que aparece DEPOIS da venda
                        (multa atrasada, acerto de documentacao) entra aqui e refaz o
                        lucro. Sem isso o numero congelaria no dia da venda. */}
                    <CustosDoVeiculo car={car} />
                </div>
            </div>
            {verContrato && <ContratoDaVenda car={car} onClose={() => setVerContrato(false)} />}
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
        // Busca inclui o comprador: quem procura uma venda antiga lembra do nome
        // do cliente muito mais do que da versao do carro.
        const alvo = `${c.brand} ${c.model} ${c.version} ${c.buyer_name ?? ''} ${c.buyer_cpf ?? ''} ${c.plate ?? ''}`;
        const matchSearch = alvo.toLowerCase().includes(search.toLowerCase());
        const matchMonth = filterMonth === 'todos' || (c.sold_at || '').substring(0, 7) === filterMonth;
        return matchSearch && matchMonth;
    });

    const totalRevenue = filtered.reduce((acc, c) => acc + (Number(c.sold_price) || 0), 0);
    // Contrato exige nome E CPF; o resto do cadastro pode faltar que o documento
    // ainda sai, com linha em branco. Sem esses dois, nao sai.
    const comContrato = filtered.filter(c => c.buyer_name && c.buyer_cpf).length;
    const comTroca = filtered.filter(c => c.trade_in_plate).length;
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
                    <div className="sold-summary-badge">
                        <span>{comContrato}</span>
                        <small>Com contrato</small>
                    </div>
                    {comTroca > 0 && (
                        <div className="sold-summary-badge">
                            <span>{comTroca}</span>
                            <small>Com troca</small>
                        </div>
                    )}
                </div>
            </header>

            <div className="inv-toolbar" style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                <div className="inv-search" style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '0.75rem', background: 'var(--card-bg)', border: '1px solid var(--border)', padding: '0.65rem 1rem', borderRadius: 'var(--radius-md)' }}>
                    <Search size={18} />
                    <input type="text" placeholder="Buscar por veículo, comprador, CPF ou placa..." value={search} onChange={e => setSearch(e.target.value)} style={{ border: 'none', background: 'transparent', outline: 'none', width: '100%', fontSize: '0.9rem', color: 'var(--text-primary)' }} />
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
                        {car.images?.[0] ? (
                            <img
                                src={car.images[0]}
                                alt={`${car.brand} ${car.model}`}
                                className="sold-card-img"
                                onError={(e) => {
                                    e.currentTarget.style.display = 'none';
                                    e.currentTarget.nextSibling.style.display = 'flex';
                                }}
                            />
                        ) : null}
                        <div
                            className="sold-card-img"
                            style={{
                                display: car.images?.[0] ? 'none' : 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                background: 'var(--input-bg)',
                                color: '#94a3b8',
                                flexShrink: 0,
                            }}
                        >
                            <Camera size={26} strokeWidth={1.5} />
                        </div>
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
                            <small className="text-muted">Entrada</small>
                            <strong>{car.created_at ? new Date(car.created_at).toLocaleDateString('pt-BR') : '—'}</strong>
                        </div>
                        <div className="sold-card-detail">
                            <small className="text-muted">Saída</small>
                            <strong>{formatDateStr((car.sold_at || '').split('T')[0])}</strong>
                        </div>
                        {car.created_at && car.sold_at && (
                            <div className="sold-card-detail">
                                <small className="text-muted">Tempo de giro</small>
                                {/* Quantos dias o carro ficou parado ate vender. E o
                                    numero que diz se a compra foi boa - preco de venda
                                    sozinho nao mostra capital parado. */}
                                <strong>
                                    {Math.max(0, Math.floor((new Date(car.sold_at) - new Date(car.created_at)) / 86400000))} dias
                                </strong>
                            </div>
                        )}
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
