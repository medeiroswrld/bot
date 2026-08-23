import React, { useState } from 'react';
import { Plus, Trash2, Lock } from 'lucide-react';
import { useAppContext } from '../context/AppContext.jsx';
import { contaDoVeiculo, sugestoes, brl } from '../lib/financeiro.js';

// Custos de um veículo, em estoque ou já vendido.
//
// O mesmo painel serve nos dois estados de propósito: peça trocada antes de
// anunciar e despesa que aparece depois da venda (multa atrasada, acerto de
// documentação) entram no mesmo lugar. Separar em duas telas faria a segunda
// nunca ser usada.
const CustosDoVeiculo = ({ car }) => {
    const { financialEntries, addFinancialEntry, removeFinancialEntry } = useAppContext();
    const [aberto, setAberto] = useState(false);
    const [salvando, setSalvando] = useState(false);
    const [form, setForm] = useState({
        categoria: 'Peças',
        valor: '',
        descricao: '',
        data: new Date().toISOString().slice(0, 10),
    });

    const conta = contaDoVeiculo(car, financialEntries);
    const opcoes = sugestoes('despesa', true, financialEntries);

    const lancar = async () => {
        const valor = Number(String(form.valor).replace(',', '.'));
        if (!valor || valor <= 0 || !form.categoria.trim()) return;
        setSalvando(true);
        await addFinancialEntry({
            car_id: car.id, tipo: 'despesa',
            categoria: form.categoria, valor,
            descricao: form.descricao, data: form.data,
        });
        setForm(f => ({ ...f, valor: '', descricao: '' }));
        setSalvando(false);
        setAberto(false);
    };

    const linha = { display: 'flex', justifyContent: 'space-between', fontSize: '0.86rem', padding: '3px 0' };

    return (
        <div style={{ marginTop: '1.5rem' }}>
            <p style={{ fontWeight: 700, fontSize: '0.85rem', margin: '0 0 10px' }}>Custos deste veículo</p>

            <div style={{ background: 'var(--input-bg)', borderRadius: 12, padding: '12px 14px' }}>
                <div style={linha}>
                    <span className="text-muted">Compra</span>
                    <strong>{conta.compra ? brl(conta.compra) : '—'}</strong>
                </div>
                <div style={linha}>
                    <span className="text-muted">Gastos lançados</span>
                    <strong>{conta.gastos ? brl(conta.gastos) : '—'}</strong>
                </div>
                <div style={{ ...linha, borderTop: '1px solid var(--border)', marginTop: 6, paddingTop: 8 }}>
                    <span style={{ fontWeight: 600 }}>Investido</span>
                    <strong>{brl(conta.investido)}</strong>
                </div>

                {conta.vendido ? (
                    <>
                        <div style={linha}>
                            <span className="text-muted">Vendido por</span>
                            <strong>{brl(conta.venda)}</strong>
                        </div>
                        <div style={{ ...linha, borderTop: '1px solid var(--border)', marginTop: 6, paddingTop: 8 }}>
                            <span style={{ fontWeight: 700 }}>Lucro</span>
                            <strong style={{ color: conta.lucro >= 0 ? '#059669' : '#dc2626', fontSize: '1.05rem' }}>
                                {brl(conta.lucro)}
                                {conta.margem != null && (
                                    <span style={{ fontWeight: 500, fontSize: '0.78rem', marginLeft: 6 }}>
                                        ({conta.margem.toFixed(1)}%)
                                    </span>
                                )}
                            </strong>
                        </div>
                    </>
                ) : (
                    // Carro parado não tem prejuízo, tem dinheiro parado. Chamar de
                    // prejuízo o que ainda está na loja é número errado, e número
                    // errado faz o lojista abandonar a tela.
                    <p style={{ margin: '8px 0 0', fontSize: '0.74rem', color: 'var(--text-secondary)' }}>
                        O lucro aparece quando o veículo for vendido.
                    </p>
                )}

                {conta.compra === 0 && (
                    <p style={{ margin: '8px 0 0', fontSize: '0.74rem', color: '#b45309' }}>
                        Sem valor de compra cadastrado — o lucro sai errado. Edite o veículo e preencha.
                    </p>
                )}
            </div>

            {conta.itens.length > 0 && (
                <div style={{ marginTop: 10 }}>
                    {conta.itens.map((l) => (
                        <div key={l.id} style={{ display: 'flex', alignItems: 'center', gap: 8,
                                                 padding: '6px 0', borderBottom: '1px solid var(--border)',
                                                 fontSize: '0.82rem' }}>
                            <span style={{ flex: '0 0 62px', color: 'var(--text-secondary)', fontSize: '0.74rem' }}>
                                {String(l.data).split('-').reverse().slice(0, 2).join('/')}
                            </span>
                            <span style={{ flex: 1 }}>
                                {l.categoria}
                                {l.descricao && <span className="text-muted"> · {l.descricao}</span>}
                            </span>
                            <strong style={{ color: l.tipo === 'receita' ? '#059669' : 'inherit' }}>
                                {l.tipo === 'receita' ? '+' : '−'} {brl(l.valor)}
                            </strong>
                            {l.origem === 'automatico' ? (
                                // Automático não se apaga por aqui: ele espelha a venda ou a
                                // compra, e apagar só o lançamento deixaria o financeiro
                                // discordando do cadastro sem ninguém perceber.
                                <span title="Lançado pelo sistema a partir da venda ou da compra"
                                      style={{ color: 'var(--text-secondary)', display: 'flex' }}>
                                    <Lock size={13} />
                                </span>
                            ) : (
                                <button className="icon-btn" title="Excluir lançamento"
                                        onClick={() => removeFinancialEntry(l.id)}
                                        style={{ color: '#dc2626' }}>
                                    <Trash2 size={14} />
                                </button>
                            )}
                        </div>
                    ))}
                </div>
            )}

            {aberto ? (
                <div style={{ marginTop: 12, padding: 12, border: '1px solid var(--border)', borderRadius: 10 }}>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <div className="form-group" style={{ flex: '1 1 150px', marginBottom: 8 }}>
                            <label>Categoria</label>
                            <input type="text" list="cat-veiculo" value={form.categoria}
                                onChange={e => setForm(f => ({ ...f, categoria: e.target.value }))} />
                            <datalist id="cat-veiculo">
                                {opcoes.map(c => <option key={c} value={c} />)}
                            </datalist>
                        </div>
                        <div className="form-group" style={{ flex: '0 1 110px', marginBottom: 8 }}>
                            <label>Valor</label>
                            <input type="number" step="0.01" value={form.valor} autoFocus
                                onChange={e => setForm(f => ({ ...f, valor: e.target.value }))} />
                        </div>
                        <div className="form-group" style={{ flex: '0 1 140px', marginBottom: 8 }}>
                            <label>Data</label>
                            <input type="date" value={form.data}
                                onChange={e => setForm(f => ({ ...f, data: e.target.value }))} />
                        </div>
                        <div className="form-group" style={{ flex: '1 1 100%', marginBottom: 8 }}>
                            <label>Descrição</label>
                            <input type="text" placeholder="Ex: par de pneus dianteiros"
                                value={form.descricao}
                                onChange={e => setForm(f => ({ ...f, descricao: e.target.value }))} />
                        </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                        <button className="btn-secondary" onClick={() => setAberto(false)}>Cancelar</button>
                        <button className="btn-primary" onClick={lancar} disabled={salvando || !form.valor}>
                            {salvando ? 'Salvando…' : 'Lançar gasto'}
                        </button>
                    </div>
                </div>
            ) : (
                <button className="btn-secondary" style={{ marginTop: 10, width: '100%' }}
                        onClick={() => setAberto(true)}>
                    <Plus size={16} /> Lançar gasto neste veículo
                </button>
            )}
        </div>
    );
};

export default CustosDoVeiculo;
