import React, { useEffect, useState } from 'react';
import { TrendingUp, Info } from 'lucide-react';
import { useAppContext } from '../context/AppContext.jsx';
import { supabase } from '../lib/supabase.js';

// Clientes atendidos pelo assistente que compraram.
//
// ── Por que a lista, e não só o total ──────────────────────────────────────
//
// O total é o número que vende; a LISTA é o que faz o lojista acreditar nele.
// Ele lê "Vanderlei, CG 160 FAN", lembra do rapaz, e a conta deixa de ser uma
// alegação nossa para virar um fato dele. Total sozinho é sempre discutível.
//
// ── O que o título afirma, e por quê ───────────────────────────────────────
//
// "Clientes atendidos que compraram", nunca "vendas geradas pelo assistente".
// O dado prova que a pessoa conversou pelo sistema, que o assistente
// participou e que depois comprou — não prova causa. Reivindicar causa é o
// tipo de exagero que o lojista desmente na primeira olhada, e aí ele para de
// acreditar no resto do painel também.
//
// ── A ressalva vira instrução ──────────────────────────────────────────────
//
// Venda sem telefone do comprador não pode ser ligada a nada. Em vez de
// esconder esse buraco, o painel mostra: o lojista entende por que o número
// está menor do que ele esperava, e passa a preencher o campo. O próprio
// indicador dele melhora no mês seguinte.

const real = (v) => Number(v || 0).toLocaleString('pt-BR', {
  style: 'currency', currency: 'BRL', minimumFractionDigits: 0, maximumFractionDigits: 0,
});

const VendasDoAssistente = () => {
  const { user, companySettings } = useAppContext();
  const [vendas, setVendas] = useState(null);
  const [semFone, setSemFone] = useState(0);

  useEffect(() => {
    if (!user?.id) return;
    let vivo = true;
    (async () => {
      const desde = new Date(Date.now() - 180 * 864e5).toISOString();
      const [{ data: v }, { data: s }] = await Promise.all([
        supabase.from('vendas_do_assistente')
          .select('car_id, brand, model, buyer_name, price, sold_at, channel')
          .eq('user_id', user.id).gte('sold_at', desde).order('sold_at', { ascending: false }),
        supabase.from('vendas_sem_telefone')
          .select('quantidade').eq('user_id', user.id).maybeSingle(),
      ]);
      if (!vivo) return;
      setVendas(v ?? []);
      setSemFone(s?.quantidade ?? 0);
    })();
    return () => { vivo = false; };
  }, [user?.id]);

  if (companySettings?.bot_contratado !== true) return null;
  if (!vendas || !vendas.length) return null;

  const total = vendas.reduce((soma, v) => soma + Number(v.price || 0), 0);
  const mostrar = vendas.slice(0, 6);

  return (
    <section className="card" style={{ padding: '1.4rem 1.5rem', marginBottom: '1.5rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <TrendingUp size={18} style={{ color: 'var(--accent)' }} />
        <h2 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700, letterSpacing: '-.015em' }}>
          Clientes atendidos que compraram
        </h2>
      </div>
      <p style={{ margin: '0 0 16px', fontSize: '.82rem', color: 'var(--text-secondary)' }}>
        Últimos 6 meses
      </p>

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 18 }}>
        <strong style={{
          fontSize: '2rem', fontWeight: 700, letterSpacing: '-.03em',
          color: 'var(--accent)', fontVariantNumeric: 'tabular-nums', lineHeight: 1,
        }}>
          {real(total)}
        </strong>
        <span style={{ fontSize: '.92rem', color: 'var(--text-secondary)' }}>
          em {vendas.length} {vendas.length === 1 ? 'venda' : 'vendas'}
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {mostrar.map((v, i) => (
          <div key={v.car_id} style={{
            display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap',
            padding: '10px 0',
            borderTop: i === 0 ? 'none' : '1px solid var(--border)',
          }}>
            <strong style={{ fontSize: '.88rem', flex: '1 1 170px' }}>
              {v.buyer_name || 'Comprador'}
            </strong>
            <span style={{ fontSize: '.84rem', color: 'var(--text-secondary)', flex: '1 1 150px' }}>
              {[v.brand, v.model].filter(Boolean).join(' ')}
            </span>
            <span style={{
              fontSize: '.86rem', fontWeight: 600, fontVariantNumeric: 'tabular-nums',
            }}>
              {real(v.price)}
            </span>
          </div>
        ))}
      </div>

      {vendas.length > mostrar.length && (
        <p style={{ margin: '10px 0 0', fontSize: '.82rem', color: 'var(--text-secondary)' }}>
          e mais {vendas.length - mostrar.length}.
        </p>
      )}

      {/* O buraco vira instrução: o lojista entende o número menor e passa a
          preencher o campo que o corrige. */}
      {semFone > 0 && (
        <p style={{
          display: 'flex', gap: 7, alignItems: 'flex-start', marginTop: 16,
          fontSize: '.8rem', color: 'var(--text-secondary)', lineHeight: 1.5,
        }}>
          <Info size={15} style={{ flexShrink: 0, marginTop: 2 }} />
          <span>
            Outras <strong>{semFone}</strong> vendas não entraram aqui porque o telefone do
            comprador não foi preenchido no registro da venda. Preenchendo, elas passam a
            aparecer.
          </span>
        </p>
      )}
    </section>
  );
};

export default VendasDoAssistente;
