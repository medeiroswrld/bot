import React, { useState } from 'react';
import { Plus, Trash2, Lock, Printer, TrendingUp, TrendingDown, Repeat, Check, Pencil } from 'lucide-react';
import { useAppContext } from '../context/AppContext.jsx';
import { demonstrativo, sugestoes, rotuloMes, brl, CATEGORIAS_OPERACAO } from '../lib/financeiro.js';

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

// Despesas fixas: salário, aluguel, contabilidade, internet.
//
// Isto é MODELO, não agendamento. O sistema nao cria lançamento futuro sozinho:
// conta de luz muda de valor, funcionário entra e sai, e caixa cheio de número
// adivinhado é pior que caixa vazio — quem confere descobre que não é real e
// para de olhar. A loja lança o mês quando ele chega e ajusta o que veio
// diferente.
const DespesasFixas = ({ mesFoco }) => {
    const {
        recurringExpenses, saveRecurringExpense, removeRecurringExpense,
        lancarFixasDoMes, financialEntries,
    } = useAppContext();

    const [aberto, setAberto] = useState(false);
    const [editando, setEditando] = useState(null);
    const [lancando, setLancando] = useState(false);
    const vazio = { categoria: '', valor: '', descricao: '', dia: '' };
    const [form, setForm] = useState(vazio);

    const ativas = (recurringExpenses || []).filter(f => f.ativo);
    const totalMes = ativas.reduce((sm, f) => sm + Number(f.valor || 0), 0);

    // Quais ainda nao foram lancadas no mes em foco. A checagem e pelo mesmo
    // `ref` que o banco usa como chave unica, entao a tela nunca discorda dele.
    const refs = new Set((financialEntries || []).map(l => l.ref).filter(Boolean));
    const pendentes = ativas.filter(f => !refs.has(`fixo:${f.id}:${mesFoco}`));

    const salvar = async () => {
        if (!form.categoria.trim() || !Number(form.valor)) return;
        await saveRecurringExpense({ ...form, id: editando });
        setForm(vazio); setEditando(null); setAberto(false);
    };

    const lancar = async () => {
        setLancando(true);
        await lancarFixasDoMes(mesFoco);
        setLancando(false);
    };

    return (
        <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)',
                      borderRadius: 12, padding: '14px 16px', marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <Repeat size={16} />
                <strong style={{ fontSize: '0.9rem' }}>Despesas fixas</strong>
                {ativas.length > 0 && (
                    <span className="text-muted" style={{ fontSize: '0.8rem' }}>
                        {ativas.length} · {brl(totalMes)} por mês
                    </span>
                )}
                <span style={{ marginLeft: 'auto' }} />
                <button className="btn-secondary" style={{ fontSize: '0.8rem' }}
                        onClick={() => { setForm(vazio); setEditando(null); setAberto(a => !a); }}>
                    <Plus size={15} /> Adicionar
                </button>
            </div>

            {ativas.length > 0 && (
                <div style={{ marginTop: 10 }}>
                    {ativas.map(f => {
                        const lancada = refs.has(`fixo:${f.id}:${mesFoco}`);
                        return (
                            <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 8,
                                                     padding: '6px 0', borderTop: '1px solid var(--border)',
                                                     fontSize: '0.84rem' }}>
                                {f.dia && (
                                    <span style={{ flex: '0 0 46px', fontSize: '0.72rem',
                                                   color: 'var(--text-secondary)' }}>dia {f.dia}</span>
                                )}
                                <span style={{ flex: 1 }}>
                                    {f.categoria}
                                    {f.descricao && <span className="text-muted"> · {f.descricao}</span>}
                                </span>
                                <strong>{brl(f.valor)}</strong>
                                {lancada && (
                                    <span title={`Já lançada em ${rotuloMes(mesFoco)}`}
                                          style={{ color: '#059669', display: 'flex' }}><Check size={14} /></span>
                                )}
                                <button className="icon-btn" title="Editar"
                                        onClick={() => {
                                            setForm({ categoria: f.categoria, valor: f.valor,
                                                      descricao: f.descricao ?? '', dia: f.dia ?? '' });
                                            setEditando(f.id); setAberto(true);
                                        }}>
                                    <Pencil size={13} />
                                </button>
                                <button className="icon-btn" title="Remover da lista de fixas"
                                        onClick={() => removeRecurringExpense(f.id)} style={{ color: '#dc2626' }}>
                                    <Trash2 size={13} />
                                </button>
                            </div>
                        );
                    })}
                </div>
            )}

            {aberto && (
                <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)',
                              display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                    <div className="form-group" style={{ flex: '1 1 160px', marginBottom: 0 }}>
                        <label>Categoria</label>
                        <input type="text" list="cat-fixa" value={form.categoria} autoFocus
                            placeholder="Ex: Salários e comissões"
                            onChange={e => setForm(f => ({ ...f, categoria: e.target.value }))} />
                        <datalist id="cat-fixa">
                            {CATEGORIAS_OPERACAO.map(c => <option key={c} value={c} />)}
                        </datalist>
                    </div>
                    <div className="form-group" style={{ flex: '0 1 120px', marginBottom: 0 }}>
                        <label>Valor</label>
                        <input type="number" step="0.01" value={form.valor}
                            onChange={e => setForm(f => ({ ...f, valor: e.target.value }))} />
                    </div>
                    <div className="form-group" style={{ flex: '0 1 90px', marginBottom: 0 }}>
                        <label>Dia</label>
                        <input type="number" min="1" max="31" value={form.dia} placeholder="opc."
                            onChange={e => setForm(f => ({ ...f, dia: e.target.value }))} />
                    </div>
                    <div className="form-group" style={{ flex: '1 1 160px', marginBottom: 0 }}>
                        <label>Descrição</label>
                        <input type="text" value={form.descricao}
                            onChange={e => setForm(f => ({ ...f, descricao: e.target.value }))} />
                    </div>
                    <button className="btn-primary" onClick={salvar}
                            disabled={!form.categoria.trim() || !Number(form.valor)}>
                        {editando ? 'Salvar' : 'Adicionar'}
                    </button>
                </div>
            )}

            {pendentes.length > 0 && (
                <div style={{ marginTop: 12, padding: '10px 12px', background: '#fffbeb',
                              border: '1px solid #fde68a', borderRadius: 8,
                              display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '0.82rem', color: '#92400e', flex: 1 }}>
                        {pendentes.length} despesa(s) fixa(s) ainda não lançada(s) em {rotuloMes(mesFoco)}.
                    </span>
                    <button className="btn-primary" onClick={lancar} disabled={lancando}>
                        {lancando ? 'Lançando…' : `Lançar em ${rotuloMes(mesFoco)}`}
                    </button>
                </div>
            )}
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

            <div style={{ marginTop: 16 }}>
                <DespesasFixas mesFoco={ate} />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                          gap: 12, margin: '0 0 16px' }}>
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
