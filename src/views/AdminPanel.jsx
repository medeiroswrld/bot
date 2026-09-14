import React, { useState, useEffect, useCallback } from 'react';
import {
  ShieldCheck, RefreshCw, Loader2, AlertCircle, LogOut,
  CheckCircle2, Clock, Lock, Mail,
} from 'lucide-react';
import { supabaseAdmin } from '../lib/supabaseAdmin.js';

// Painel do dono do sistema. App à parte: não passa pelo AppProvider nem pelo
// shell do CRM, e tem sessão própria (ver supabaseAdmin.js).
//
// Esta tela não carrega privilégio nenhum — quem decide é a edge function
// admin-metrics, que confere o e-mail contra o secret ADMIN_EMAILS. Se alguém
// abrir /admin e logar com outra conta, recebe 403 e vê nada.

const PERIODOS = [{ dias: 7, label: '7 dias' }, { dias: 30, label: '30 dias' }, { dias: 90, label: '90 dias' }];

const num = (v) => Number(v ?? 0);
const brl = (usd, cot) => `R$ ${(num(usd) * cot).toFixed(2)}`;
const brlDireto = (v) => `R$ ${num(v).toFixed(2)}`;
const milhares = (v) => num(v).toLocaleString('pt-BR');
const dataCurta = (d) => (d ? new Date(d).toLocaleDateString('pt-BR') : '—');

// Vencimento do mês corrente a partir do dia fixo do plano.
const vencimento = (dia) => {
  if (!dia) return null;
  const hoje = new Date();
  // Dia 31 em mês de 30: cai no último dia do mês, em vez de virar o mês seguinte.
  const ultimo = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0).getDate();
  return new Date(hoje.getFullYear(), hoje.getMonth(), Math.min(dia, ultimo));
};

// ─── Login próprio ────────────────────────────────────────────────────────────
const LoginAdmin = ({ onEntrou }) => {
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro]   = useState('');
  const [indo, setIndo]   = useState(false);

  const entrar = async (e) => {
    e.preventDefault();
    setIndo(true); setErro('');
    const { error } = await supabaseAdmin.auth.signInWithPassword({ email: email.trim(), password: senha });
    setIndo(false);
    if (error) { setErro('E-mail ou senha incorretos.'); return; }
    onEntrou();
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0b0b0f', padding: 20 }}>
      <form onSubmit={entrar} style={{ width: '100%', maxWidth: 380, background: '#15151c', border: '1px solid #26262f', borderRadius: 16, padding: 28 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <ShieldCheck size={24} style={{ color: '#818cf8' }} />
          <h1 style={{ margin: 0, fontSize: '1.15rem', color: '#f4f4f5' }}>Painel do Administrador</h1>
        </div>
        <p style={{ margin: '0 0 22px', fontSize: '0.8rem', color: '#8b8b96' }}>
          Acesso restrito. Esta sessão é independente do CRM.
        </p>

        <label style={{ display: 'block', fontSize: '0.75rem', color: '#8b8b96', marginBottom: 5 }}>E-mail</label>
        <div style={{ position: 'relative', marginBottom: 14 }}>
          <Mail size={16} style={{ position: 'absolute', left: 12, top: 12, color: '#6b6b76' }} />
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username"
            style={{ width: '100%', padding: '10px 12px 10px 36px', borderRadius: 9, border: '1px solid #2c2c36', background: '#0f0f14', color: '#f4f4f5', fontSize: '0.9rem' }} />
        </div>

        <label style={{ display: 'block', fontSize: '0.75rem', color: '#8b8b96', marginBottom: 5 }}>Senha</label>
        <div style={{ position: 'relative', marginBottom: 18 }}>
          <Lock size={16} style={{ position: 'absolute', left: 12, top: 12, color: '#6b6b76' }} />
          <input type="password" required value={senha} onChange={(e) => setSenha(e.target.value)} autoComplete="current-password"
            style={{ width: '100%', padding: '10px 12px 10px 36px', borderRadius: 9, border: '1px solid #2c2c36', background: '#0f0f14', color: '#f4f4f5', fontSize: '0.9rem' }} />
        </div>

        {erro && (
          <div style={{ display: 'flex', gap: 7, alignItems: 'center', padding: '9px 12px', borderRadius: 8, background: '#2a1215', color: '#fca5a5', fontSize: '0.82rem', marginBottom: 14 }}>
            <AlertCircle size={15} /> {erro}
          </div>
        )}

        <button type="submit" disabled={indo}
          style={{ width: '100%', padding: '11px', borderRadius: 9, border: 'none', background: '#4f46e5', color: '#fff', fontSize: '0.92rem', fontWeight: 600, cursor: indo ? 'wait' : 'pointer' }}>
          {indo ? 'Entrando...' : 'Entrar'}
        </button>
      </form>
    </div>
  );
};

// ─── Mini dashboard de uma loja ──────────────────────────────────────────────
const QUALIDADE = { GREEN: ['#052e16', '#4ade80', 'alta'], YELLOW: ['#2b2410', '#fbbf24', 'media'], RED: ['#2a1215', '#fca5a5', 'baixa'] };
const CANAL = { whatsapp: 'WhatsApp', instagram: 'Instagram', messenger: 'Messenger' };

const DetalheLoja = ({ loja, dias, cotacao, chamar, onFechar }) => {
  const [d, setD] = useState(null);
  const [wa, setWa] = useState(null);
  const [ig, setIg] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');

  useEffect(() => {
    let vivo = true;
    setCarregando(true); setErro('');
    chamar({ acao: 'detalhe', user_id: loja.user_id, dias })
      .then((r) => { if (vivo) { setD(r.detalhe); setWa(r.whatsapp); setIg(r.instagram); } })
      .catch((e) => { if (vivo) setErro(e.message); })
      .finally(() => { if (vivo) setCarregando(false); });
    return () => { vivo = false; };
  }, [chamar, loja.user_id, dias]);

  const serie = d?.serie ?? [];
  // Escala pelo pico: barra relativa mostra a forma da curva, que e o que
  // importa aqui. Numero absoluto fica no hover.
  const pico = Math.max(1, ...serie.map((x) => num(x.conversas)));
  const box = { background: '#15151c', border: '1px solid #26262f', borderRadius: 12, padding: '14px 16px' };
  const rot = { margin: 0, fontSize: '0.72rem', color: '#8b8b96' };
  const val = { margin: '2px 0 0', fontSize: '1.15rem', fontWeight: 700 };

  const q = wa?.quality_rating ? (QUALIDADE[wa.quality_rating] ?? ['#18181b', '#a1a1aa', wa.quality_rating]) : null;

  return (
    <div onClick={onFechar}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 200, display: 'flex', justifyContent: 'flex-end' }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ width: 'min(760px, 100%)', background: '#0b0b0f', borderLeft: '1px solid #26262f', overflowY: 'auto', padding: '22px 24px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 18 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '1.1rem', color: '#f4f4f5' }}>{loja.empresa || 'Sem nome'}</h2>
            <p style={{ margin: '2px 0 0', fontSize: '0.78rem', color: '#8b8b96' }}>{loja.email}</p>
            <p style={{ margin: '2px 0 0', fontSize: '0.74rem', color: '#6b6b76' }}>
              cliente desde {dataCurta(loja.criado_em)} · últimos {dias} dias
            </p>
          </div>
          <button type="button" onClick={onFechar}
            style={{ marginLeft: 'auto', padding: '5px 12px', borderRadius: 8, border: '1px solid #2c2c36', background: '#15151c', color: '#a1a1aa', cursor: 'pointer', fontSize: '0.8rem' }}>
            Fechar
          </button>
        </div>

        {erro && (
          <div style={{ padding: '10px 14px', borderRadius: 8, background: '#2a1215', color: '#fca5a5', fontSize: '0.84rem', marginBottom: 14 }}>{erro}</div>
        )}

        {carregando ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
            <Loader2 size={24} style={{ color: '#818cf8' }} />
          </div>
        ) : d ? (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 16 }}>
              <div style={box}><p style={rot}>Custo no período</p><p style={val}>{brl(loja.custo_total_usd, cotacao)}</p></div>
              <div style={box}><p style={rot}>Custo por lead</p><p style={val}>{brl(loja.custo_medio_usd, cotacao)}</p></div>
              <div style={box}><p style={rot}>Lead completo (p90)</p><p style={val}>{brl(loja.custo_p90_usd, cotacao)}</p></div>
              <div style={box}>
                <p style={rot}>Margem no mês</p>
                <p style={{ ...val, color: (num(loja.billing_amount) - num(loja.custo_total_usd) * cotacao) >= 0 ? '#4ade80' : '#fca5a5' }}>
                  {brlDireto(num(loja.billing_amount) - num(loja.custo_total_usd) * cotacao)}
                </p>
                <p style={{ margin: 0, fontSize: '0.68rem', color: '#6b6b76' }}>
                  cobra {brlDireto(loja.billing_amount)} · custa {brl(loja.custo_total_usd, cotacao)}
                </p>
              </div>
            </div>

            {(d.canais ?? []).length > 1 && (
              <div style={{ ...box, marginBottom: 16 }}>
                <p style={{ ...rot, marginBottom: 10 }}>Custo por canal</p>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                  <thead>
                    <tr style={{ color: '#8b8b96', fontSize: '0.7rem', textAlign: 'right' }}>
                      <th style={{ textAlign: 'left', fontWeight: 500, paddingBottom: 6 }}>Canal</th>
                      <th style={{ fontWeight: 500, paddingBottom: 6 }}>Conversas</th>
                      <th style={{ fontWeight: 500, paddingBottom: 6 }}>Custo</th>
                      <th style={{ fontWeight: 500, paddingBottom: 6 }}>Por conversa</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.canais.map((c) => (
                      <tr key={c.canal} style={{ borderTop: '1px solid #26262f', textAlign: 'right' }}>
                        <td style={{ padding: '7px 0', textAlign: 'left' }}>{CANAL[c.canal] ?? c.canal}</td>
                        <td style={{ padding: '7px 0' }}>{c.conversas}</td>
                        <td style={{ padding: '7px 0' }}>{brl(c.custo_usd, cotacao)}</td>
                        <td style={{ padding: '7px 0', fontWeight: 600 }}>
                          {num(c.conversas) ? brl(num(c.custo_usd) / num(c.conversas), cotacao) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p style={{ margin: '10px 0 0', fontSize: '0.7rem', color: '#6b6b76' }}>
                  O Instagram nao cobra por mensagem como o WhatsApp — o que aparece
                  aqui e o custo de IA das conversas de cada canal.
                </p>
              </div>
            )}

            <div style={{ ...box, marginBottom: 16 }}>
              <p style={{ ...rot, marginBottom: 10 }}>Leads atendidos e custo por janela</p>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                <thead>
                  <tr style={{ color: '#8b8b96', fontSize: '0.7rem', textAlign: 'right' }}>
                    <th style={{ padding: '4px 0', textAlign: 'left' }}>Período</th>
                    <th style={{ padding: '4px 0' }}>Leads</th>
                    <th style={{ padding: '4px 0' }}>Por dia</th>
                    <th style={{ padding: '4px 0' }}>Custo</th>
                    <th style={{ padding: '4px 0' }}>Por lead</th>
                  </tr>
                </thead>
                <tbody>
                  {(d.janelas ?? []).map((j) => (
                    <tr key={j.dias} style={{ borderTop: '1px solid #26262f', textAlign: 'right' }}>
                      <td style={{ padding: '7px 0', textAlign: 'left' }}>{j.dias} dias</td>
                      <td style={{ padding: '7px 0' }}>{j.conversas}</td>
                      <td style={{ padding: '7px 0', fontWeight: 600 }}>{j.por_dia}</td>
                      <td style={{ padding: '7px 0' }}>{brl(j.custo_usd, cotacao)}</td>
                      <td style={{ padding: '7px 0', color: '#8b8b96' }}>
                        {num(j.conversas) ? brl(num(j.custo_usd) / num(j.conversas), cotacao) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p style={{ margin: '8px 0 0', fontSize: '0.68rem', color: '#6b6b76' }}>
                As janelas são acumuladas, não fatias: a de 30 dias inclui a de 7.
              </p>
            </div>

            <div style={{ ...box, marginBottom: 16 }}>
              <p style={{ ...rot, marginBottom: 10 }}>Conversas atendidas pelo bot, por dia</p>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 90 }}>
                {serie.map((x) => (
                  <div key={x.dia} title={`${new Date(x.dia + 'T12:00').toLocaleDateString('pt-BR')} · ${x.conversas} conversas · ${brl(x.custo_usd, cotacao)}`}
                    style={{
                      flex: 1, minWidth: 3, borderRadius: '3px 3px 0 0',
                      height: `${Math.max(2, (num(x.conversas) / pico) * 100)}%`,
                      background: num(x.conversas) ? '#4f46e5' : '#26262f',
                    }} />
                ))}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: '0.68rem', color: '#6b6b76' }}>
                <span>{serie.length ? new Date(serie[0].dia + 'T12:00').toLocaleDateString('pt-BR') : ''}</span>
                <span>pico de {pico}/dia</span>
                <span>hoje</span>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 10, marginBottom: 16 }}>
              <div style={box}>
                <p style={{ ...rot, marginBottom: 8 }}>WhatsApp</p>
                {wa?.erro ? (
                  <p style={{ margin: 0, fontSize: '0.78rem', color: '#fbbf24' }}>não consegui consultar: {wa.erro}</p>
                ) : wa ? (
                  <>
                    <p style={{ margin: 0, fontSize: '0.85rem' }}>{wa.display_phone_number} · {wa.verified_name}</p>
                    <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                      {q && <span style={{ padding: '2px 9px', borderRadius: 999, fontSize: '0.7rem', fontWeight: 700, background: q[0], color: q[1] }}>qualidade {q[2]}</span>}
                      <span style={{ padding: '2px 9px', borderRadius: 999, fontSize: '0.7rem', background: '#18181b', color: '#a1a1aa' }}>{wa.status}</span>
                      {wa.messaging_limit_tier && <span style={{ padding: '2px 9px', borderRadius: 999, fontSize: '0.7rem', background: '#18181b', color: '#a1a1aa' }}>{String(wa.messaging_limit_tier).replace('TIER_', 'até ')}</span>}
                    </div>
                  </>
                ) : (
                  <p style={{ margin: 0, fontSize: '0.78rem', color: '#6b6b76' }}>sem WhatsApp configurado</p>
                )}
              </div>

              <div style={box}>
                <p style={{ ...rot, marginBottom: 8 }}>Instagram</p>
                {ig?.erro ? (
                  <p style={{ margin: 0, fontSize: '0.78rem', color: '#fbbf24' }}>conexao com problema: {ig.erro}</p>
                ) : ig ? (
                  <>
                    <p style={{ margin: 0, fontSize: '0.85rem' }}>@{ig.username}</p>
                    <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                      <span style={{ padding: '2px 9px', borderRadius: 999, fontSize: '0.7rem', fontWeight: 700, background: '#052e16', color: '#4ade80' }}>conectado</span>
                      {ig.account_type && <span style={{ padding: '2px 9px', borderRadius: 999, fontSize: '0.7rem', background: '#18181b', color: '#a1a1aa' }}>{String(ig.account_type).toLowerCase()}</span>}
                      {ig.media_count != null && <span style={{ padding: '2px 9px', borderRadius: 999, fontSize: '0.7rem', background: '#18181b', color: '#a1a1aa' }}>{ig.media_count} publicacoes</span>}
                    </div>
                    {/* A Meta nao expoe nota de qualidade pra Instagram como faz
                        pro numero de WhatsApp. O que da pra afirmar e se o token
                        ainda responde — que e como a queda aparece antes de virar
                        mensagem sem resposta. */}
                    <p style={{ margin: '8px 0 0', fontSize: '0.68rem', color: '#6b6b76' }}>
                      O Instagram nao tem nota de qualidade; o que vale acompanhar e se a conexao responde.
                    </p>
                  </>
                ) : (
                  <p style={{ margin: 0, fontSize: '0.78rem', color: '#6b6b76' }}>sem Instagram conectado</p>
                )}
              </div>

              <div style={box}>
                <p style={{ ...rot, marginBottom: 8 }}>Base da loja</p>
                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: '0.82rem' }}>
                  <span>{d.totais.leads} leads <span style={{ color: '#6b6b76' }}>({d.totais.leads_novos} novos)</span></span>
                  <span>{d.totais.carros} carros</span>
                  <span>{d.totais.conversas} conversas</span>
                  <span>{d.totais.interesses} na espera</span>
                </div>
              </div>
            </div>

            <div style={{ ...box, marginBottom: 16 }}>
              <p style={{ ...rot, marginBottom: 8 }}>Tokens no período</p>
              <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', fontSize: '0.82rem' }}>
                <span>entrada <strong>{milhares(d.tokens.entrada)}</strong></span>
                <span>saída <strong>{milhares(d.tokens.saida)}</strong></span>
                <span>cache escrito <strong>{milhares(d.tokens.cache_w)}</strong></span>
                <span>cache lido <strong>{milhares(d.tokens.cache_r)}</strong></span>
              </div>
              <p style={{ margin: '8px 0 0', fontSize: '0.7rem', color: '#6b6b76' }}>
                Cache lido custa 1/10 da entrada — é o que segura o custo por lead.
              </p>
            </div>

            <div style={box}>
              <p style={{ ...rot, marginBottom: 8 }}>Disparos no período</p>
              {(d.campanhas ?? []).length ? (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                  <tbody>
                    {d.campanhas.map((c, i) => (
                      <tr key={i} style={{ borderTop: i ? '1px solid #26262f' : 'none' }}>
                        <td style={{ padding: '7px 0' }}>{c.nome}</td>
                        <td style={{ padding: '7px 0', color: '#8b8b96' }}>{dataCurta(c.criada)}</td>
                        <td style={{ padding: '7px 0', textAlign: 'right', color: '#8b8b96' }}>
                          {c.enviados}/{c.destinatarios} enviados · {c.lidas} lidas
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p style={{ margin: 0, fontSize: '0.8rem', color: '#6b6b76' }}>Nenhum disparo no período.</p>
              )}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
};

// ─── Créditos por plataforma ─────────────────────────────────────────────────
// Não há API pública confiável de saldo (o endpoint de créditos da OpenAI foi
// descontinuado para chave comum). Então o saldo é registrado à mão e o painel
// desconta o consumo a partir da data do registro. Responde melhor a pergunta
// real — "está perto de acabar?" — do que um número que não dá pra buscar.
const Creditos = ({ chamar, cotacao }) => {
  const [dados, setDados] = useState(null);
  const [editando, setEditando] = useState(null);
  const [valor, setValor] = useState('');
  const [erro, setErro] = useState('');

  const carregar = useCallback(() => {
    chamar({ acao: 'creditos' }).then(setDados).catch((e) => setErro(e.message));
  }, [chamar]);

  useEffect(() => { carregar(); }, [carregar]);

  const salvar = async (plataforma) => {
    try {
      await chamar({ acao: 'salvar_credito', plataforma, saldo_usd: Number(valor) || 0 });
      setEditando(null); setValor('');
      carregar();
    } catch (e) { setErro(e.message); }
  };

  if (!dados) return null;
  const semPreco = (dados.precos ?? []).filter((p) => !num(p.entrada_usd) && !num(p.saida_usd));

  return (
    <div style={{ marginBottom: 20 }}>
      <p style={{ margin: '0 0 8px', fontSize: '0.78rem', color: '#8b8b96' }}>Créditos nas plataformas</p>
      {erro && <p style={{ fontSize: '0.8rem', color: '#fca5a5' }}>{erro}</p>}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        {(dados.creditos ?? []).map((c) => {
          const restante = num(c.saldo_atual);
          const dias = c.dias_restantes;
          // Alerta por DIAS restantes, não por valor: US$ 20 é muito pra quem
          // gasta 1/dia e pouco pra quem gasta 15.
          const cor = dias == null ? '#a1a1aa' : dias <= 7 ? '#fca5a5' : dias <= 20 ? '#fbbf24' : '#4ade80';
          return (
            <div key={c.plataforma}
              style={{ background: '#15151c', border: '1px solid #26262f', borderRadius: 12, padding: '13px 16px', flex: '1 1 230px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <p style={{ margin: 0, fontSize: '0.72rem', color: '#8b8b96', textTransform: 'capitalize' }}>{c.plataforma}</p>
                <button type="button"
                  onClick={() => { setEditando(c.plataforma); setValor(String(c.saldo_usd)); }}
                  style={{ marginLeft: 'auto', background: 'none', border: 'none', color: '#6b6b76', cursor: 'pointer', fontSize: '0.7rem' }}>
                  atualizar
                </button>
              </div>

              {editando === c.plataforma ? (
                <div style={{ display: 'flex', gap: 6, marginTop: 8, alignItems: 'center' }}>
                  <span style={{ fontSize: '0.75rem', color: '#6b6b76' }}>US$</span>
                  <input type="number" step="0.01" value={valor} autoFocus
                    onChange={(e) => setValor(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') salvar(c.plataforma); }}
                    style={{ width: 90, padding: '4px 7px', borderRadius: 6, border: '1px solid #2c2c36', background: '#0f0f14', color: '#e4e4e7', fontSize: '0.8rem' }} />
                  <button type="button" onClick={() => salvar(c.plataforma)}
                    style={{ padding: '4px 10px', borderRadius: 6, border: 'none', background: '#4f46e5', color: '#fff', cursor: 'pointer', fontSize: '0.75rem' }}>
                    salvar
                  </button>
                  <button type="button" onClick={() => setEditando(null)}
                    style={{ background: 'none', border: 'none', color: '#6b6b76', cursor: 'pointer', fontSize: '0.75rem' }}>
                    cancelar
                  </button>
                </div>
              ) : (
                <>
                  <p style={{ margin: '2px 0 0', fontSize: '1.25rem', fontWeight: 700, color: cor }}>
                    US$ {restante.toFixed(2)}
                  </p>
                  <p style={{ margin: 0, fontSize: '0.7rem', color: '#6b6b76' }}>
                    {brlDireto(restante * cotacao)} · gasta US$ {num(c.por_dia).toFixed(2)}/dia
                  </p>
                  <p style={{ margin: '3px 0 0', fontSize: '0.72rem', color: cor, fontWeight: 600 }}>
                    {dias == null ? 'sem consumo no período' : `~${dias} dias restantes`}
                  </p>
                  <p style={{ margin: '3px 0 0', fontSize: '0.66rem', color: '#4b4b55' }}>
                    registrado US$ {num(c.saldo_usd).toFixed(2)} em {dataCurta(c.registrado_em)} · usou US$ {num(c.gasto_desde).toFixed(2)}
                  </p>
                </>
              )}
            </div>
          );
        })}
      </div>

      {semPreco.length > 0 && (
        <p style={{ margin: '8px 0 0', fontSize: '0.72rem', color: '#fbbf24' }}>
          Sem preço cadastrado: {semPreco.map((p) => p.prefixo).join(', ')} — essas chamadas
          somam zero no custo. Preencha em model_pricing pra a conta ficar completa.
        </p>
      )}
    </div>
  );
};

// ─── Painel ───────────────────────────────────────────────────────────────────
const Painel = ({ onSair }) => {
  const [dias, setDias]   = useState(30);
  const [dados, setDados] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro]   = useState('');
  // Cotação do dólar: buscada, com queda suave.
  //
  // Era fixa em 5,40 e editável na mão. O problema não era a digitação — era
  // que TODO número de custo do painel é multiplicado por ela. Com o câmbio
  // longe de 5,40, a margem por loja aparece errada, e é justamente esse
  // número que decide preço de plano.
  //
  // A objeção original continua válida: dependência externa não pode derrubar
  // o painel. Por isso a busca é opcional e cai em cascata —
  //   cotação de hoje → última guardada no navegador → 5,40
  // — e o valor segue editável, pra quando você quiser fixar um câmbio de
  // fechamento e conferir contra a fatura.
  const [cotacao, setCotacao] = useState(() => {
    try {
      const salva = JSON.parse(localStorage.getItem('cotacao_usd') || 'null');
      if (salva?.valor > 0) return salva.valor;
    } catch { /* storage bloqueado ou lixo: segue no padrão */ }
    return 5.4;
  });
  const [cotacaoEm, setCotacaoEm] = useState(null);

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const r = await fetch('https://economia.awesomeapi.com.br/json/last/USD-BRL');
        if (!r.ok) return;
        const j = await r.json();
        const v = Number(j?.USDBRL?.bid);
        // Faixa de sanidade: resposta estranha (0, null, ou câmbio absurdo) não
        // entra. Errar pra menos aqui inventa lucro que não existe.
        if (!vivo || !(v > 2 && v < 15)) return;
        setCotacao(v);
        setCotacaoEm(new Date());
        try {
          localStorage.setItem('cotacao_usd', JSON.stringify({ valor: v, em: Date.now() }));
        } catch { /* sem storage: só não guarda */ }
      } catch { /* offline ou API fora: fica com a última conhecida */ }
    })();
    return () => { vivo = false; };
  }, []);
  const [salvandoId, setSalvandoId] = useState(null);
  const [lojaAberta, setLojaAberta] = useState(null);

  const chamar = useCallback(async (body) => {
    const { data, error } = await supabaseAdmin.functions.invoke('admin-metrics', { body });
    if (error || data?.error) {
      let msg = data?.error || error?.message || 'Falha na requisição.';
      try {
        const corpo = await error?.context?.json?.();
        if (corpo?.error) msg = corpo.error;
      } catch { /* mantém a genérica */ }
      throw new Error(msg);
    }
    return data;
  }, []);

  const buscar = useCallback(async () => {
    setCarregando(true); setErro('');
    try { setDados(await chamar({ acao: 'metricas', dias })); }
    catch (e) { setErro(e.message); }
    finally { setCarregando(false); }
  }, [chamar, dias]);

  useEffect(() => { buscar(); }, [buscar]);

  const alternarPagamento = async (loja) => {
    setSalvandoId(loja.user_id);
    try {
      await chamar({
        acao: 'marcar_pagamento',
        user_id: loja.user_id,
        pago: !loja.pago_mes_atual,
        valor: loja.billing_amount,
      });
      await buscar();
    } catch (e) { setErro(e.message); }
    finally { setSalvandoId(null); }
  };
  // Plano da loja. A coluna e protegida por trigger no banco, entao esta e a
  // UNICA porta: o lojista nao consegue se liberar nem chamando a API direto.
  const alternarPlano = async (loja, campo) => {
    const atual = campo === 'bot' ? loja.bot_contratado : loja.disparos_contratado;
    const nome = campo === 'bot' ? 'o bot' : 'os disparos';
    const incluindo = !atual;
    if (!confirm(incluindo
      ? `Incluir ${nome} no plano de ${loja.empresa || loja.email}?`
      : `Tirar ${nome} do plano de ${loja.empresa || loja.email}? Para de funcionar imediatamente.`)) return;
    setSalvandoId(loja.user_id);
    try {
      // Manda SO o campo alterado: os dois niveis sao independentes e um toggle
      // nao pode zerar o outro sem querer.
      const corpo = { acao: 'plano', user_id: loja.user_id };
      if (campo === 'bot') corpo.bot_contratado = incluindo;
      else corpo.disparos_contratado = incluindo;
      await chamar(corpo);
      // `buscar`, não `carregar`: este componente só define `buscar`. O
      // `carregar` que estava aqui vive no componente de créditos, então a
      // troca de plano salvava e a tela nunca refletia — parecia que o clique
      // não tinha funcionado.
      await buscar();
    } catch (e) {
      setErro(e.message);
    } finally {
      setSalvandoId(null);
    }
  };

  // Integração de anúncios da loja. O dataset é de quem gerencia o anúncio —
  // hoje a Amply — então quem define é o administrador, não o lojista.
  const configurarCapi = async (loja) => {
    const valor = window.prompt(
      `Dataset da Meta para ${loja.empresa || loja.email}.\n\n` +
      'É o ID do dataset no Gerenciador de Eventos, que recebe as conversões.\n' +
      'Deixe em branco para desligar a devolução.',
      loja.capi_dataset_id || '',
    );
    if (valor === null) return;   // cancelou

    const dataset = valor.trim();
    setSalvandoId(loja.user_id);
    try {
      await chamar({
        acao: 'capi',
        user_id: loja.user_id,
        capi_dataset_id: dataset || null,
        capi_enabled: Boolean(dataset),
      });
      await buscar();
    } catch (e) {
      setErro(e.message);
    } finally {
      setSalvandoId(null);
    }
  };


  const alternarSuspensao = async (loja) => {
    const suspendendo = !loja.suspenso;
    if (suspendendo && !window.confirm(
      `Suspender ${loja.empresa || loja.email}?\n\n` +
      'O bot para de responder na hora. As mensagens dos clientes continuam ' +
      'sendo salvas e ficam como pendentes — nada se perde.'
    )) return;
    setSalvandoId(loja.user_id);
    try {
      await chamar({ acao: 'suspender', user_id: loja.user_id, suspenso: suspendendo });
      await buscar();
    } catch (e) { setErro(e.message); }
    finally { setSalvandoId(null); }
  };

  const salvarPlano = async (loja, dia, valor) => {
    setSalvandoId(loja.user_id);
    try {
      await chamar({ acao: 'salvar_plano', user_id: loja.user_id, billing_day: dia, billing_amount: valor });
      await buscar();
    } catch (e) { setErro(e.message); }
    finally { setSalvandoId(null); }
  };

  // Devolver o acesso a quem perdeu o celular.
  //
  // O Supabase nao gera codigos de recuperacao, e desativar a verificacao pela
  // tela do lojista exige uma sessao que so o proprio aplicativo autenticador
  // concede. Ou seja: sem este botao, perder o telefone tranca a pessoa pra fora
  // da conta de forma definitiva.
  //
  // A confirmacao e dura de proposito. Isto derruba uma protecao de seguranca, e
  // quem pede "perdi meu celular" por mensagem pode nao ser quem diz ser.
  const removerDoisFatores = async (loja) => {
    if (!window.confirm(
      `Remover a verificacao em duas etapas de ${loja.empresa || loja.email}?\n\n` +
      'A conta volta a ser protegida so pela senha, e a pessoa vai conseguir ' +
      'entrar sem o aplicativo autenticador.\n\n' +
      'Confirme por telefone que e realmente o titular antes de continuar.'
    )) return;
    setSalvandoId(loja.user_id);
    try {
      const r = await chamar({ acao: 'remover_2fa', user_id: loja.user_id });
      window.alert(r?.removidos
        ? 'Verificacao em duas etapas removida. Avise que a pessoa ja pode entrar so com a senha.'
        : (r?.mensagem || 'Esta conta nao tinha verificacao em duas etapas.'));
    } catch (e) { setErro(e.message); }
    finally { setSalvandoId(null); }
  };

  const card = { background: '#15151c', border: '1px solid #26262f', borderRadius: 12, padding: '13px 16px', flex: '1 1 160px' };
  const th   = { padding: '9px 10px', textAlign: 'left', fontSize: '0.7rem', color: '#8b8b96', fontWeight: 600, whiteSpace: 'nowrap' };
  const td   = { padding: '11px 10px', fontSize: '0.83rem', color: '#e4e4e7', whiteSpace: 'nowrap' };

  return (
    <div style={{ minHeight: '100vh', background: '#0b0b0f', color: '#e4e4e7', padding: '22px 26px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 3, flexWrap: 'wrap' }}>
        <ShieldCheck size={22} style={{ color: '#818cf8' }} />
        <h1 style={{ margin: 0, fontSize: '1.25rem' }}>Painel do Administrador</h1>
        <button type="button" onClick={onSair} title="Sair"
          style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 8, border: '1px solid #2c2c36', background: '#15151c', color: '#a1a1aa', cursor: 'pointer', fontSize: '0.8rem' }}>
          <LogOut size={14} /> Sair
        </button>
      </div>
      <p style={{ margin: '0 0 18px', fontSize: '0.82rem', color: '#8b8b96' }}>
        Todas as lojas cadastradas, inclusive as sem movimento. Custo só existe onde o bot
        respondeu — atendimento 100% humano não consome modelo.
      </p>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
        {PERIODOS.map((p) => (
          <button key={p.dias} type="button" onClick={() => setDias(p.dias)}
            style={{ padding: '6px 14px', borderRadius: 8, cursor: 'pointer', fontSize: '0.8rem', border: '1px solid #2c2c36', fontWeight: dias === p.dias ? 700 : 500, background: dias === p.dias ? '#4f46e5' : '#15151c', color: dias === p.dias ? '#fff' : '#a1a1aa' }}>
            {p.label}
          </button>
        ))}
        <button type="button" onClick={buscar} title="Atualizar"
          style={{ padding: '6px 10px', borderRadius: 8, cursor: 'pointer', border: '1px solid #2c2c36', background: '#15151c', color: '#a1a1aa', display: 'flex', alignItems: 'center' }}>
          <RefreshCw size={14} />
        </button>
        <label style={{ marginLeft: 'auto', fontSize: '0.78rem', color: '#8b8b96', display: 'flex', alignItems: 'center', gap: 6 }}>
          Dólar
          <input type="number" step="0.01" value={cotacao} onChange={(e) => setCotacao(Number(e.target.value) || 0)}
            style={{ width: 76, padding: '4px 8px', borderRadius: 6, border: '1px solid #2c2c36', background: '#0f0f14', color: '#e4e4e7' }} />
          {/* De onde veio o número. Sem isso não dá pra saber se o painel está
              usando o câmbio de hoje ou um valor velho de quando a API caiu. */}
          <span style={{ fontSize: '0.68rem', color: cotacaoEm ? '#4ade80' : '#71717a' }}>
            {cotacaoEm
              ? `de hoje, ${cotacaoEm.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
              : 'não atualizada'}
          </span>
        </label>
      </div>

      {erro && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '10px 14px', borderRadius: 8, background: '#2a1215', color: '#fca5a5', fontSize: '0.84rem', marginBottom: 16 }}>
          <AlertCircle size={16} /> {erro}
        </div>
      )}

      {carregando ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 70 }}>
          <Loader2 size={26} style={{ color: '#818cf8', animation: 'spin 1s linear infinite' }} />
        </div>
      ) : dados ? (
        <>
          <Creditos chamar={chamar} cotacao={cotacao} />

          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
            <div style={card}>
              <p style={{ margin: 0, fontSize: '0.72rem', color: '#8b8b96' }}>Custo do período</p>
              <p style={{ margin: '2px 0 0', fontSize: '1.3rem', fontWeight: 700 }}>{brl(dados.total.custo_usd, cotacao)}</p>
              <p style={{ margin: 0, fontSize: '0.7rem', color: '#6b6b76' }}>US$ {num(dados.total.custo_usd).toFixed(4)}</p>
            </div>
            <div style={card}>
              <p style={{ margin: 0, fontSize: '0.72rem', color: '#8b8b96' }}>Receita do mês</p>
              <p style={{ margin: '2px 0 0', fontSize: '1.3rem', fontWeight: 700 }}>{brlDireto(dados.total.receita_mes)}</p>
              <p style={{ margin: 0, fontSize: '0.7rem', color: '#4ade80' }}>recebido {brlDireto(dados.total.recebido_mes)}</p>
            </div>
            <div style={card}>
              <p style={{ margin: 0, fontSize: '0.72rem', color: '#8b8b96' }}>Lucro do mês</p>
              {(() => {
                // Faturamento menos custo real. E o unico numero que diz se o
                // preco fecha — receita sozinha nao diz nada.
                const lucro = num(dados.total.receita_mes) - num(dados.total.custo_usd) * cotacao;
                const margem = num(dados.total.receita_mes)
                  ? (lucro / num(dados.total.receita_mes)) * 100 : 0;
                return (
                  <>
                    <p style={{ margin: '2px 0 0', fontSize: '1.3rem', fontWeight: 700, color: lucro >= 0 ? '#4ade80' : '#fca5a5' }}>
                      {brlDireto(lucro)}
                    </p>
                    <p style={{ margin: 0, fontSize: '0.7rem', color: '#6b6b76' }}>
                      margem {margem.toFixed(0)}%
                    </p>
                  </>
                );
              })()}
            </div>
            <div style={card}>
              <p style={{ margin: 0, fontSize: '0.72rem', color: '#8b8b96' }}>Custo por conversa</p>
              <p style={{ margin: '2px 0 0', fontSize: '1.3rem', fontWeight: 700 }}>{brl(dados.total.custo_por_conversa_usd, cotacao)}</p>
            </div>
            <div style={card}>
              <p style={{ margin: 0, fontSize: '0.72rem', color: '#8b8b96' }}>Tokens</p>
              <p style={{ margin: '2px 0 0', fontSize: '1.3rem', fontWeight: 700 }}>{milhares(dados.total.tokens)}</p>
              <p style={{ margin: 0, fontSize: '0.7rem', color: '#6b6b76' }}>{dados.total.conversas} conversas · {dados.total.lojas} lojas</p>
            </div>
          </div>

          <div style={{ overflowX: 'auto', border: '1px solid #26262f', borderRadius: 12 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#15151c' }}>
                  <th style={th}>Loja</th>
                  <th style={{ ...th, textAlign: 'right' }}>Conversas</th>
                  <th style={{ ...th, textAlign: 'right' }}>Respostas</th>
                  <th style={{ ...th, textAlign: 'right' }}>Tokens</th>
                  <th style={{ ...th, textAlign: 'right' }}>Custo</th>
                  <th style={{ ...th, textAlign: 'right' }} title="90% das conversas custam ate esse valor — a referencia de um lead que percorreu o funil inteiro">Lead completo</th>
                  <th style={th}>Última atividade</th>
                  <th style={th}>Plano</th>
                  <th style={th}>Pagamento</th>
                  <th style={th}>Situação</th>
                </tr>
              </thead>
              <tbody>
                {dados.lojas.map((l) => {
                  const venc = vencimento(l.billing_day);
                  const atrasado = !l.pago_mes_atual && venc && venc < new Date();
                  return (
                    <tr key={l.user_id} style={{ borderTop: '1px solid #26262f' }}>
                      <td style={{ ...td, cursor: 'pointer' }} onClick={() => setLojaAberta(l)}
                          title="Abrir o detalhe desta loja">
                        <div style={{ fontWeight: 600, color: '#a5b4fc', display: 'flex', alignItems: 'center', gap: 6 }}>
                          {l.empresa || 'Sem nome'}
                          {/* Numero degradado precisa saltar da LISTA. Antes so
                              aparecia abrindo a loja, o que significa descobrir
                              tarde — e qualidade baixa vira bloqueio de envio. */}
                          {(() => {
                            const qq = l.qualidade?.quality_rating
                              ? (QUALIDADE[l.qualidade.quality_rating] ?? ['#18181b', '#a1a1aa', l.qualidade.quality_rating])
                              : null;
                            return qq ? (
                              <span title={`Qualidade do numero: ${qq[2]}${l.qualidade.status ? ` · ${l.qualidade.status}` : ''}`}
                                style={{ width: 8, height: 8, borderRadius: '50%', background: qq[1], flex: 'none' }} />
                            ) : null;
                          })()}
                        </div>
                        <div style={{ fontSize: '0.72rem', color: '#8b8b96' }}>{l.email}</div>
                        <div style={{ fontSize: '0.7rem', color: '#6b6b76' }}>
                          desde {dataCurta(l.criado_em)}
                          {!l.whatsapp_ativo && <span style={{ color: '#f59e0b' }}> · sem WhatsApp</span>}
                          {l.instagram_ativo && <span style={{ color: '#8b8b96' }}> · Instagram</span>}
                        </div>
                      </td>
                      <td style={{ ...td, textAlign: 'right' }}>{l.conversas_bot}</td>
                      <td style={{ ...td, textAlign: 'right' }}>{milhares(l.respostas_bot)}</td>
                      <td style={{ ...td, textAlign: 'right', color: '#a1a1aa' }}>{milhares(l.tokens_total)}</td>
                      <td style={{ ...td, textAlign: 'right' }}>
                        {brl(l.custo_total_usd, cotacao)}
                        {num(l.custo_instagram_usd) > 0 && (
                          <div style={{ fontSize: '0.68rem', color: '#8b8b96' }}
                               title={`Instagram: ${l.conversas_instagram} conversas`}>
                            insta {brl(l.custo_instagram_usd, cotacao)}
                          </div>
                        )}
                      </td>
                      <td style={{ ...td, textAlign: 'right', fontWeight: 600 }}>{brl(l.custo_p90_usd, cotacao)}</td>
                      <td style={{ ...td, fontSize: '0.76rem', color: '#8b8b96' }}>
                        {l.ultima_atividade ? new Date(l.ultima_atividade).toLocaleString('pt-BR') : 'nunca usou'}
                      </td>
                      <td style={td}>
                        <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
                          <span style={{ fontSize: '0.7rem', color: '#6b6b76' }}>dia</span>
                          <input type="number" min="1" max="31" defaultValue={l.billing_day ?? ''}
                            onBlur={(e) => {
                              const v = e.target.value === '' ? null : Number(e.target.value);
                              if (v !== (l.billing_day ?? null)) salvarPlano(l, v, l.billing_amount);
                            }}
                            style={{ width: 46, padding: '3px 5px', borderRadius: 5, border: '1px solid #2c2c36', background: '#0f0f14', color: '#e4e4e7', fontSize: '0.78rem' }} />
                          <span style={{ fontSize: '0.7rem', color: '#6b6b76' }}>R$</span>
                          <input type="number" step="0.01" defaultValue={l.billing_amount ?? ''}
                            onBlur={(e) => {
                              const v = e.target.value === '' ? null : Number(e.target.value);
                              if (v !== (l.billing_amount ?? null)) salvarPlano(l, l.billing_day, v);
                            }}
                            style={{ width: 74, padding: '3px 5px', borderRadius: 5, border: '1px solid #2c2c36', background: '#0f0f14', color: '#e4e4e7', fontSize: '0.78rem' }} />
                        </div>
                      </td>
                      <td style={td}>
                        {!l.billing_day ? (
                          <span style={{ fontSize: '0.75rem', color: '#6b6b76' }}>sem plano</span>
                        ) : (
                          <button type="button" onClick={() => alternarPagamento(l)} disabled={salvandoId === l.user_id}
                            title={l.pago_mes_atual ? 'Desmarcar' : 'Marcar como pago'}
                            style={{
                              display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 999,
                              cursor: 'pointer', fontSize: '0.74rem', fontWeight: 600,
                              border: `1px solid ${l.pago_mes_atual ? '#166534' : atrasado ? '#7f1d1d' : '#3f3f46'}`,
                              background: l.pago_mes_atual ? '#052e16' : atrasado ? '#2a1215' : '#18181b',
                              color: l.pago_mes_atual ? '#4ade80' : atrasado ? '#fca5a5' : '#a1a1aa',
                            }}>
                            {l.pago_mes_atual
                              ? <><CheckCircle2 size={13} /> pago {dataCurta(l.pago_em)}</>
                              : <><Clock size={13} /> {atrasado ? 'atrasado' : 'vence'} {venc ? dataCurta(venc) : ''}</>}
                          </button>
                        )}
                      </td>
                      <td style={td}>
                        <button type="button" onClick={() => alternarSuspensao(l)} disabled={salvandoId === l.user_id}
                          title={l.suspenso ? 'Reativar a conta' : 'Suspender: o bot para de responder'}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 999,
                            cursor: 'pointer', fontSize: '0.74rem', fontWeight: 600,
                            border: `1px solid ${l.suspenso ? '#7f1d1d' : '#3f3f46'}`,
                            background: l.suspenso ? '#2a1215' : '#18181b',
                            color: l.suspenso ? '#fca5a5' : '#a1a1aa',
                          }}>
                          {l.suspenso ? 'suspensa' : 'ativa'}
                        </button>
                        <div style={{ display: 'flex', gap: 4, marginTop: 4, flexWrap: 'wrap' }}>
                          {[['bot', 'bot', l.bot_contratado], ['disparos', 'disparos', l.disparos_contratado]].map(([campo, rotulo, ativo]) => (
                            <button key={campo} type="button" onClick={() => alternarPlano(l, campo)}
                              disabled={salvandoId === l.user_id}
                              title={ativo ? `${rotulo} incluso no plano. Clique pra tirar.` : `${rotulo} fora do plano. Clique pra incluir.`}
                              style={{
                                padding: '2px 8px', borderRadius: 999, cursor: 'pointer',
                                fontSize: '0.68rem', fontWeight: 600,
                                border: `1px solid ${ativo ? '#1e3a8a' : '#3f3f46'}`,
                                background: ativo ? '#0f1e3d' : '#18181b',
                                color: ativo ? '#93c5fd' : '#52525b',
                                textDecoration: ativo ? 'none' : 'line-through',
                              }}>
                              {rotulo}
                            </button>
                          ))}
                          <button type="button" onClick={() => configurarCapi(l)}
                            disabled={salvandoId === l.user_id}
                            title={l.capi_enabled
                              ? `Conversões indo pro dataset ${l.capi_dataset_id}. Clique pra trocar ou desligar.`
                              : 'Sem devolução de conversão pra Meta. Clique pra configurar o dataset.'}
                            style={{
                              padding: '2px 8px', borderRadius: 999, cursor: 'pointer',
                              fontSize: '0.68rem', fontWeight: 600,
                              border: `1px solid ${l.capi_enabled ? '#134e4a' : '#3f3f46'}`,
                              background: l.capi_enabled ? '#0c2624' : '#18181b',
                              color: l.capi_enabled ? '#5eead4' : '#52525b',
                              textDecoration: l.capi_enabled ? 'none' : 'line-through',
                            }}>
                            anúncios
                          </button>
                          {(() => {
                            // Estado da cobranca no cartao, ao lado do plano.
                            // 'isento' aparece discreto de proposito: e o normal
                            // de quem paga por fora, nao um alerta.
                            const a = l.assinatura_status || 'isento';
                            const cores = {
                              ativa:          ['#14532d', '#052e16', '#86efac'],
                              isento:         ['#3f3f46', '#18181b', '#a1a1aa'],
                              atrasada:       ['#78350f', '#271707', '#fcd34d'],
                              cancelada:      ['#7f1d1d', '#2a1215', '#fca5a5'],
                              sem_assinatura: ['#3f3f46', '#18181b', '#71717a'],
                            };
                            const [borda, fundo, texto] = cores[a] ?? cores.sem_assinatura;
                            const rotulo = a === 'sem_assinatura' ? 'sem assinatura' : a;
                            return (
                              <span
                                title={l.proximo_vencimento
                                  ? `Proxima cobranca em ${dataCurta(l.proximo_vencimento)}`
                                  : 'Cobranca no cartao pelo Asaas'}
                                style={{
                                  padding: '2px 8px', borderRadius: 999,
                                  fontSize: '0.68rem', fontWeight: 600,
                                  border: `1px solid ${borda}`, background: fundo, color: texto,
                                }}>
                                {rotulo}
                              </span>
                            );
                          })()}
                          <button type="button" onClick={() => removerDoisFatores(l)}
                            disabled={salvandoId === l.user_id}
                            title="Perdeu o celular? Remove a verificação em duas etapas desta conta."
                            style={{
                              padding: '2px 8px', borderRadius: 999, cursor: 'pointer',
                              fontSize: '0.68rem', fontWeight: 600,
                              border: '1px solid #3f3f46', background: '#18181b', color: '#a1a1aa',
                            }}>
                            2FA
                          </button>
                        </div>
                        {!l.bot_enabled && !l.suspenso && l.bot_contratado && (
                          <div style={{ fontSize: '0.68rem', color: '#f59e0b', marginTop: 3 }}>bot desligado pela loja</div>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {!dados.lojas.length && (
                  <tr><td colSpan={10} style={{ padding: 26, textAlign: 'center', color: '#6b6b76' }}>Nenhuma loja cadastrada.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {lojaAberta && (
            <DetalheLoja
              loja={lojaAberta}
              dias={dias}
              cotacao={cotacao}
              chamar={chamar}
              onFechar={() => setLojaAberta(null)}
            />
          )}

          <p style={{ marginTop: 14, fontSize: '0.76rem', color: '#6b6b76', lineHeight: 1.6, maxWidth: 780 }}>
            Custo calculado sobre os tokens reais, com os preços do claude-sonnet-4-6:
            entrada US$ 3,00 e saída US$ 15,00 por milhão. Leitura de cache entra separada
            a US$ 0,30 — somá-la como entrada multiplicaria a conta por dez, e este bot usa
            cache pesado. <strong>Lead completo</strong> é o p90 do custo por conversa: a
            que vai do "olá" até marcar visita é justamente uma das caras.
          </p>
        </>
      ) : null}
    </div>
  );
};

// ─── Raiz do painel ───────────────────────────────────────────────────────────
const AdminPanel = () => {
  const [sessao, setSessao] = useState(undefined); // undefined = ainda verificando

  useEffect(() => {
    supabaseAdmin.auth.getSession().then(({ data }) => setSessao(data.session ?? null));
    const { data: sub } = supabaseAdmin.auth.onAuthStateChange((_e, s) => setSessao(s ?? null));
    return () => sub?.subscription?.unsubscribe();
  }, []);

  if (sessao === undefined) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0b0b0f' }}>
        <Loader2 size={26} style={{ color: '#818cf8' }} />
      </div>
    );
  }

  if (!sessao) return <LoginAdmin onEntrou={() => { /* onAuthStateChange atualiza */ }} />;

  return <Painel onSair={() => supabaseAdmin.auth.signOut()} />;
};

export default AdminPanel;
