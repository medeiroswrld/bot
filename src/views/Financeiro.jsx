import React, { useState } from 'react';
import { Plus, Trash2, Lock, Printer, TrendingUp, TrendingDown } from 'lucide-react';
import { useAppContext } from '../context/AppContext.jsx';
import { demonstrativo, sugestoes, rotuloMes, brl } from '../lib/financeiro.js';

const mesAtual = () => new Date().toISOString().slice(0, 7);
const mesesAtras = (n) => {
    const d = new Date();
    d.setMonth(d.getMonth() - n);
    return d.toISOString().slice(0, 7);
};

// Formulário de lançamento avulso — o que não pertence a um veículo: aluguel,
// energia, contabilidade. Gasto de carro entra pela ficha do veículo, onde ele
// também conta no lucro daquele carro.
const NovoLancamento = ({ onFechar }) => {
    const { financialEntries, addFinancialEntry, inventory, soldCars } = useAppContext();
    const [salvando, setSalvando] = useState(false);
    const [form, setForm] = useState({
        tipo: 'despesa', categoria: '', valor: '', descricao: '',
        data: new Date().toISOString().slice(0, 10), car_id: '',
    });

    const opcoes = sugestoes(form.tipo, Boolean(form.car_id), financialEntries);
    const carros = [...(inventory || []), ...(soldCars || [])];

    const salvar = async () => {
        const valor = Number(String(form.valor).replace(',', '.'));
        if (!valor || valor <= 0 || !form.categoria.trim()) return;
        setSalvando(true);
        await addFinancialEntry({ ...form, valor });
        setSalvando(false);
        onFechar();
    };

    return (
        <div className="modal-overlay" onClick={onFechar}>
            <div className="modal-content modal-sm" onClick={e => e.stopPropagation()}>
                <div className="modal-header"><h2>Novo lançamento</h2></div>
                <div style={{ padding: '1.1rem 1.4rem' }}>
                    <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
                        {['despesa', 'receita'].map(t => (
                            <button key={t}
                                className={form.tipo === t ? 'btn-primary' : 'btn-secondary'}
                                style={{ flex: 1, textTransform: 'capitalize' }}
                                onClick={() => setForm(f => ({ ...f, tipo: t, categoria: '' }))}>
                                {t}
                            </button>
                        ))}
                    </div>

                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                        <div className="form-group" style={{ flex: '1 1 170px' }}>
                            <label>Categoria</label>
                            <input type="text" list="cat-fin" value={form.categoria} autoFocus
                                onChange={e => setForm(f => ({ ...f, categoria: e.target.value }))} />
                            <datalist id="cat-fin">
                                {opcoes.map(c => <option key={c} value={c} />)}
                            </datalist>
                        </div>
                        <div className="form-group" style={{ flex: '0 1 120px' }}>
                            <label>Valor</label>
                            <input type="number" step="0.01" value={form.valor}
                                onChange={e => setForm(f => ({ ...f, valor: e.target.value }))} />
                        </div>
                        <div className="form-group" style={{ flex: '0 1 150px' }}>
                            <label>Data</label>
                            <input type="date" value={form.data}
                                onChange={e => setForm(f => ({ ...f, data: e.target.value }))} />
                        </div>
                        <div className="form-group" style={{ flex: '1 1 100%' }}>
                            <label>Descrição</label>
                            <input type="text" value={form.descricao}
                                onChange={e => setForm(f => ({ ...f, descricao: e.target.value }))} />
                        </div>
                        <div className="form-group" style={{ flex: '1 1 100%' }}>
                            <label>Veículo (opcional)</label>
                            <select value={form.car_id}
                                onChange={e => setForm(f => ({ ...f, car_id: e.target.value }))}>
                                <option value="">Despesa da operação, sem veículo</option>
                                {carros.map(c => (
                                    <option key={c.id} value={c.id}>
                                        {c.brand} {c.model} {c.year} {c.plate ? `· ${c.plate}` : ''}
                                    </option>
                                ))}
                            </select>
                            <p style={{ margin: '4px 0 0', fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                                Ao escolher um veículo, o gasto entra também no lucro dele.
                            </p>
                        </div>
                    </div>
                </div>
                <div className="modal-footer">
                    <button className="btn-secondary" onClick={onFechar}>Cancelar</button>
                    <button className="btn-primary" onClick={salvar} disabled={salvando || !form.valor || !form.categoria}>
                        {salvando ? 'Salvando…' : 'Lançar'}
                    </button>
                </div>
            </div>
        </div>
    );
};

const Financeiro = () => {
    const { financialEntries, removeFinancialEntry } = useAppContext();
    const [de, setDe] = useState(mesesAtras(5));
    const [ate, setAte] = useState(mesAtual());
    const [novo, setNovo] = useState(false);

    const d = demonstrativo(financialEntries || [], de, ate);

    const th = { padding: '9px 10px', fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-secondary)',
                 textTransform: 'uppercase', letterSpacing: '0.4px', whiteSpace: 'nowrap' };
    const td = { padding: '8px 10px', fontSize: '0.84rem', whiteSpace: 'nowrap',
                 fontVariantNumeric: 'tabular-nums' };

    const Secao = ({ titulo, bloco, cor, icone }) => (
        <>
            <tr>
                <td colSpan={d.meses.length + 3} style={{ padding: '16px 10px 6px', fontWeight: 700,
                                                          fontSize: '0.82rem', textTransform: 'uppercase',
                                                          letterSpacing: '0.5px', color: cor }}>
                    {icone} {titulo}
                </td>
            </tr>
            {bloco.linhas.length === 0 && (
                <tr><td colSpan={d.meses.length + 3} style={{ ...td, color: 'var(--text-secondary)' }}>
                    Nenhum lançamento no período.
                </td></tr>
            )}
            {bloco.linhas.map(l => (
                <tr key={l.categoria} style={{ borderTop: '1px solid var(--border)' }}>
                    <td style={{ ...td, whiteSpace: 'normal' }}>{l.categoria}</td>
                    {d.meses.map(m => (
                        <td key={m} style={{ ...td, textAlign: 'right',
                                             color: l.porMes[m] ? 'inherit' : 'var(--text-secondary)' }}>
                            {l.porMes[m] ? brl(l.porMes[m]) : '—'}
                        </td>
                    ))}
                    <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{brl(l.total)}</td>
                    <td style={{ ...td, textAlign: 'right', color: cor, fontSize: '0.76rem' }}>
                        {l.pct.toFixed(1)}%
                    </td>
                </tr>
            ))}
            <tr style={{ borderTop: '2px solid var(--border)' }}>
                <td style={{ ...td, fontWeight: 700 }}>Total</td>
                {d.meses.map(m => (
                    <td key={m} style={{ ...td, textAlign: 'right', fontWeight: 700 }}>
                        {brl(bloco.totaisPorMes[m] ?? 0)}
                    </td>
                ))}
                <td style={{ ...td, textAlign: 'right', fontWeight: 700, color: cor }}>
                    {brl(bloco.totalGeral)}
                </td>
                <td />
            </tr>
        </>
    );

    return (
        <div className="view-content">
            <header className="view-header-flex">
                <div className="view-header">
                    <h1>Financeiro</h1>
                    <p>Receitas e despesas da loja, mês a mês. Gasto lançado num veículo aparece aqui e no lucro dele.</p>
                </div>
                <button className="btn-primary" onClick={() => setNovo(true)}>
                    <Plus size={18} /> Novo lançamento
                </button>
            </header>

            <div className="inv-toolbar" style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <div className="form-group" style={{ marginBottom: 0 }}>
                    <label>De</label>
                    <input type="month" value={de} onChange={e => setDe(e.target.value)} />
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                    <label>Até</label>
                    <input type="month" value={ate} onChange={e => setAte(e.target.value)} />
                </div>
                <button className="btn-secondary" onClick={() => window.print()} style={{ marginLeft: 'auto' }}>
                    <Printer size={16} /> Imprimir
                </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                          gap: 12, margin: '16px 0' }}>
                <div className="metric-card">
                    <p className="text-muted" style={{ fontSize: '0.76rem', margin: 0 }}>Receitas no período</p>
                    <p style={{ fontSize: '1.35rem', fontWeight: 700, color: '#059669', margin: '2px 0 0' }}>
                        {brl(d.receitas.totalGeral)}
                    </p>
                </div>
                <div className="metric-card">
                    <p className="text-muted" style={{ fontSize: '0.76rem', margin: 0 }}>Despesas no período</p>
                    <p style={{ fontSize: '1.35rem', fontWeight: 700, color: '#dc2626', margin: '2px 0 0' }}>
                        {brl(d.despesas.totalGeral)}
                    </p>
                </div>
                <div className="metric-card">
                    <p className="text-muted" style={{ fontSize: '0.76rem', margin: 0 }}>Resultado</p>
                    <p style={{ fontSize: '1.35rem', fontWeight: 700, margin: '2px 0 0',
                                color: d.resultado >= 0 ? '#059669' : '#dc2626' }}>
                        {brl(d.resultado)}
                    </p>
                </div>
            </div>

            <div style={{ overflowX: 'auto', background: 'var(--card-bg)', border: '1px solid var(--border)',
                          borderRadius: 12 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
                    <thead>
                        <tr style={{ background: 'var(--input-bg)' }}>
                            <th style={{ ...th, textAlign: 'left' }}>Origem</th>
                            {d.meses.map(m => (
                                <th key={m} style={{ ...th, textAlign: 'right' }}>{rotuloMes(m)}</th>
                            ))}
                            <th style={{ ...th, textAlign: 'right' }}>Total</th>
                            <th style={{ ...th, textAlign: 'right' }}>%</th>
                        </tr>
                    </thead>
                    <tbody>
                        <Secao titulo="Receitas" bloco={d.receitas} cor="#059669" icone={<TrendingUp size={13} />} />
                        <Secao titulo="Despesas" bloco={d.despesas} cor="#dc2626" icone={<TrendingDown size={13} />} />
                        <tr style={{ borderTop: '3px solid var(--border)', background: 'var(--input-bg)' }}>
                            <td style={{ ...td, fontWeight: 700 }}>Resumo</td>
                            {d.meses.map(m => (
                                <td key={m} style={{ ...td, textAlign: 'right', fontWeight: 700,
                                                     color: (d.resumoPorMes[m] ?? 0) >= 0 ? '#059669' : '#dc2626' }}>
                                    {brl(d.resumoPorMes[m] ?? 0)}
                                </td>
                            ))}
                            <td style={{ ...td, textAlign: 'right', fontWeight: 700,
                                         color: d.resultado >= 0 ? '#059669' : '#dc2626' }}>
                                {brl(d.resultado)}
                            </td>
                            <td />
                        </tr>
                    </tbody>
                </table>
            </div>

            <h2 style={{ fontSize: '1rem', margin: '28px 0 10px' }}>Lançamentos do período</h2>
            <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12,
                          overflow: 'hidden' }}>
                {(financialEntries || [])
                    .filter(l => {
                        const mes = String(l.data).slice(0, 7);
                        return d.meses.includes(mes);
                    })
                    .map(l => (
                        <div key={l.id} style={{ display: 'flex', alignItems: 'center', gap: 10,
                                                 padding: '10px 14px', borderBottom: '1px solid var(--border)',
                                                 fontSize: '0.85rem' }}>
                            <span style={{ flex: '0 0 72px', color: 'var(--text-secondary)', fontSize: '0.76rem' }}>
                                {String(l.data).split('-').reverse().join('/')}
                            </span>
                            <span style={{ flex: 1 }}>
                                {l.categoria}
                                {l.descricao && <span className="text-muted"> · {l.descricao}</span>}
                            </span>
                            <strong style={{ color: l.tipo === 'receita' ? '#059669' : '#dc2626' }}>
                                {l.tipo === 'receita' ? '+' : '−'} {brl(l.valor)}
                            </strong>
                            {l.origem === 'automatico' ? (
                                <span title="Lançado pelo sistema a partir da venda ou da compra"
                                      style={{ color: 'var(--text-secondary)', display: 'flex' }}>
                                    <Lock size={13} />
                                </span>
                            ) : (
                                <button className="icon-btn" title="Excluir"
                                        onClick={() => removeFinancialEntry(l.id)} style={{ color: '#dc2626' }}>
                                    <Trash2 size={14} />
                                </button>
                            )}
                        </div>
                    ))}
                {(financialEntries || []).filter(l => d.meses.includes(String(l.data).slice(0, 7))).length === 0 && (
                    <p style={{ padding: 20, margin: 0, color: 'var(--text-secondary)', fontSize: '0.88rem' }}>
                        Nenhum lançamento neste período. Venda registrada e veículo cadastrado com valor de
                        compra entram aqui sozinhos.
                    </p>
                )}
            </div>

            {novo && <NovoLancamento onFechar={() => setNovo(false)} />}
        </div>
    );
};

export default Financeiro;
