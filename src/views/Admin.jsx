import React, { useState, useEffect, useCallback } from 'react';
import { ShieldCheck, RefreshCw, Loader2, AlertCircle } from 'lucide-react';
import { supabase } from '../lib/supabase.js';

// Painel do dono do sistema: quanto cada loja consome e quanto custa um lead.
//
// Os dados vêm da edge function admin-metrics, que confere se quem chama está
// na lista de administradores. Esta tela não tem privilégio nenhum por si — se
// alguém abrir a rota na mão, a função devolve 403.

const PERIODOS = [
  { dias: 7,  label: '7 dias'  },
  { dias: 30, label: '30 dias' },
  { dias: 90, label: '90 dias' },
];

const usd = (v) => `US$ ${Number(v ?? 0).toFixed(4)}`;
const brl = (v, cotacao) => `R$ ${(Number(v ?? 0) * cotacao).toFixed(2)}`;

const Admin = () => {
  const [dias, setDias]       = useState(30);
  const [dados, setDados]     = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro]       = useState('');
  // Cotação editável em vez de buscar de API: o número muda pouco no dia e uma
  // dependência externa quebraria o painel inteiro quando ela caísse.
  const [cotacao, setCotacao] = useState(5.4);

  const buscar = useCallback(async () => {
    setCarregando(true); setErro('');
    const { data, error } = await supabase.functions.invoke('admin-metrics', { body: { dias } });
    setCarregando(false);
    if (error || data?.error) {
      let msg = data?.error || error?.message || 'Falha ao carregar.';
      try {
        const corpo = await error?.context?.json?.();
        if (corpo?.error) msg = corpo.error;
      } catch { /* mantém a mensagem genérica */ }
      setErro(msg);
      return;
    }
    setDados(data);
  }, [dias]);

  useEffect(() => { buscar(); }, [buscar]);

  const cardStyle = {
    background: 'var(--bg-card)', border: '1px solid var(--border)',
    borderRadius: 12, padding: '14px 16px', flex: '1 1 180px',
  };

  return (
    <div className="view-content">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
        <ShieldCheck size={22} style={{ color: 'var(--primary)' }} />
        <h1 style={{ margin: 0, fontSize: '1.3rem' }}>Painel do Administrador</h1>
      </div>
      <p style={{ margin: '0 0 18px', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
        Consumo e custo por loja. Só conta conversa em que o bot respondeu — atendimento
        100% humano não gera custo de modelo e não aparece aqui.
      </p>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
        {PERIODOS.map((p) => (
          <button key={p.dias} type="button" onClick={() => setDias(p.dias)}
            style={{
              padding: '6px 14px', borderRadius: 8, cursor: 'pointer', fontSize: '0.82rem',
              border: '1px solid var(--border)', fontWeight: dias === p.dias ? 700 : 500,
              background: dias === p.dias ? 'var(--primary)' : 'var(--input-bg)',
              color: dias === p.dias ? '#fff' : 'var(--text-primary)',
            }}>
            {p.label}
          </button>
        ))}
        <button type="button" onClick={buscar} title="Atualizar"
          style={{ padding: '6px 10px', borderRadius: 8, cursor: 'pointer', border: '1px solid var(--border)', background: 'var(--input-bg)', display: 'flex', alignItems: 'center' }}>
          <RefreshCw size={15} />
        </button>
        <label style={{ marginLeft: 'auto', fontSize: '0.8rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 6 }}>
          Dólar
          <input type="number" step="0.01" value={cotacao}
            onChange={(e) => setCotacao(Number(e.target.value) || 0)}
            style={{ width: 80, padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--input-bg)', color: 'var(--text-primary)' }} />
        </label>
      </div>

      {erro && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '10px 14px', borderRadius: 8, background: '#fef2f2', color: '#b91c1c', fontSize: '0.85rem', marginBottom: 16 }}>
          <AlertCircle size={16} /> {erro}
        </div>
      )}

      {carregando ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
          <Loader2 size={28} className="spin" style={{ color: 'var(--primary)' }} />
        </div>
      ) : dados ? (
        <>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
            <div style={cardStyle}>
              <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Custo total</p>
              <p style={{ margin: '2px 0 0', fontSize: '1.35rem', fontWeight: 700 }}>{brl(dados.total.custo_usd, cotacao)}</p>
              <p style={{ margin: 0, fontSize: '0.72rem', color: 'var(--text-secondary)' }}>{usd(dados.total.custo_usd)}</p>
            </div>
            <div style={cardStyle}>
              <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Conversas com bot</p>
              <p style={{ margin: '2px 0 0', fontSize: '1.35rem', fontWeight: 700 }}>{dados.total.conversas}</p>
            </div>
            <div style={cardStyle}>
              <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Custo por conversa</p>
              <p style={{ margin: '2px 0 0', fontSize: '1.35rem', fontWeight: 700 }}>{brl(dados.total.custo_por_conversa_usd, cotacao)}</p>
              <p style={{ margin: 0, fontSize: '0.72rem', color: 'var(--text-secondary)' }}>{usd(dados.total.custo_por_conversa_usd)}</p>
            </div>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--text-secondary)', fontSize: '0.75rem' }}>
                  <th style={{ padding: '8px 10px' }}>Loja</th>
                  <th style={{ padding: '8px 10px', textAlign: 'right' }}>Conversas</th>
                  <th style={{ padding: '8px 10px', textAlign: 'right' }}>Custo total</th>
                  <th style={{ padding: '8px 10px', textAlign: 'right' }}>Médio/conversa</th>
                  <th style={{ padding: '8px 10px', textAlign: 'right' }} title="90% das conversas custam até este valor. É a estimativa de um lead que percorreu o funil inteiro.">
                    Lead completo (p90)
                  </th>
                  <th style={{ padding: '8px 10px' }}>Última atividade</th>
                </tr>
              </thead>
              <tbody>
                {dados.lojas.map((l) => (
                  <tr key={l.user_id} style={{ borderTop: '1px solid var(--border)' }}>
                    <td style={{ padding: '10px' }}>
                      <div style={{ fontWeight: 600 }}>{l.empresa || 'Sem nome'}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{l.email}</div>
                    </td>
                    <td style={{ padding: '10px', textAlign: 'right' }}>{l.conversas_bot}</td>
                    <td style={{ padding: '10px', textAlign: 'right' }}>{brl(l.custo_total_usd, cotacao)}</td>
                    <td style={{ padding: '10px', textAlign: 'right' }}>{brl(l.custo_medio_usd, cotacao)}</td>
                    <td style={{ padding: '10px', textAlign: 'right', fontWeight: 600 }}>{brl(l.custo_p90_usd, cotacao)}</td>
                    <td style={{ padding: '10px', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                      {l.ultima_atividade ? new Date(l.ultima_atividade).toLocaleString('pt-BR') : '—'}
                    </td>
                  </tr>
                ))}
                {!dados.lojas.length && (
                  <tr><td colSpan={6} style={{ padding: 24, textAlign: 'center', color: 'var(--text-secondary)' }}>
                    Nenhuma conversa com bot no período.
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>

          <p style={{ marginTop: 16, fontSize: '0.78rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
            Custo calculado sobre os tokens reais de cada chamada, com os preços do
            claude-sonnet-4-6: entrada US$ 3,00 e saída US$ 15,00 por milhão. Leitura de
            cache entra separada, a US$ 0,30 — somá-la como entrada multiplicaria o custo
            por dez. <strong>Lead completo (p90)</strong> é o valor abaixo do qual estão 90%
            das conversas: a conversa que vai do "olá" até marcar visita é justamente uma
            das caras, então esse número é a melhor referência pra precificar.
          </p>
        </>
      ) : null}
    </div>
  );
};

export default Admin;
