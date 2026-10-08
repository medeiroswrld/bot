import React, { useEffect, useState } from 'react';
import { Check, MessageCircle, MoonStar, Zap, ArrowRight } from 'lucide-react';
import { supabase } from '../lib/supabase.js';

// Preços, antes de criar conta.
//
// ── Por que esta página existe ─────────────────────────────────────────────
//
// Até agora o preço só aparecia depois do cadastro. Quem está comparando
// fornecedor não cria conta para descobrir quanto custa — ele fecha a aba. E é
// exatamente de quem compara que vem a recusa por preço.
//
// ── Por que ela lê do banco ────────────────────────────────────────────────
//
// Mesma tabela que o sistema cobra. Página de preço escrita à mão desencontra
// do que a cobrança faz no primeiro reajuste, e aí o lojista vê um valor no
// site e outro no checkout — que é a pior hora possível para ele descobrir
// uma diferença.
//
// ── O que NÃO tem aqui ─────────────────────────────────────────────────────
//
// Selo de "mais escolhido", contador de clientes, depoimento. Com duas lojas
// na base, tudo isso seria invenção — e lojista reconhece. A prova que existe
// é real e está nos números do rodapé.

const real = (v) => Number(v || 0).toLocaleString('pt-BR', {
  style: 'currency', currency: 'BRL', minimumFractionDigits: 0, maximumFractionDigits: 0,
});

const INCLUI = {
  essencial: [
    'Estoque, leads, agenda e contrato de venda',
    'Atendimento automático no WhatsApp e Instagram',
    'Agendamento de visita pelo assistente',
    'Feed do seu site com o estoque ao vivo',
  ],
  crescimento: [
    'Tudo do Essencial',
    'Vários números de WhatsApp na mesma loja',
    'Disparos em massa e mensagem de aniversário',
    'Retorno de conversões para os anúncios da Meta',
  ],
  performance: [
    'Tudo do Crescimento',
    'Volume para quem anuncia forte',
    'Prioridade no suporte',
    'Acompanhamento de resultado junto com a gente',
  ],
};

const PlanosPublico = () => {
  const [planos, setPlanos] = useState(null);

  useEffect(() => {
    let vivo = true;
    (async () => {
      const { data } = await supabase
        .from('planos')
        .select('slug, nome, limite_conversas, preco, inclui_bot, ordem')
        .eq('visivel', true)
        .order('ordem');
      if (vivo) setPlanos(data ?? []);
    })();
    return () => { vivo = false; };
  }, []);

  const pagos = (planos ?? []).filter((p) => p.preco != null && p.inclui_bot);
  const sobMedida = (planos ?? []).find((p) => p.preco == null);

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-app)', color: 'var(--text-primary)' }}>
      <div style={{ maxWidth: 1040, margin: '0 auto', padding: '56px 20px 72px' }}>

        <header style={{ marginBottom: 40, maxWidth: '58ch' }}>
          <img src="/logo.png" alt="Amply" width="44" height="44"
            style={{ borderRadius: 12, marginBottom: 20 }} />
          <h1 style={{
            fontSize: 'clamp(1.9rem, 5vw, 2.6rem)', fontWeight: 700,
            letterSpacing: '-.03em', lineHeight: 1.12, margin: '0 0 12px',
            textWrap: 'balance',
          }}>
            Um vendedor que não dorme, para a sua revenda
          </h1>
          <p style={{ fontSize: '1.02rem', lineHeight: 1.6, color: 'var(--text-secondary)', margin: 0 }}>
            Atende no WhatsApp e no Instagram, mostra os carros do seu estoque, manda
            foto e agenda a visita. Tudo dentro de um CRM feito para revenda.
          </p>
        </header>

        {/* A prova vem ANTES do preço: número que o lojista reconhece como
            impossível para um vendedor humano é o que faz o valor parecer
            razoável depois. Todos medidos numa loja real. */}
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 44 }}>
          {[
            { icone: <MoonStar size={17} />, numero: '1 em cada 3',
              texto: 'mensagens chegam com a loja fechada' },
            { icone: <Zap size={17} />, numero: '23 segundos',
              texto: 'para responder, em média' },
            { icone: <MessageCircle size={17} />, numero: '407 pessoas',
              texto: 'atendidas em 90 dias numa loja só' },
          ].map((m, i) => (
            <div key={i} style={{
              flex: '1 1 220px', padding: '16px 18px', borderRadius: 12,
              background: 'var(--card-bg)', border: '1px solid var(--border)',
            }}>
              <div style={{ color: 'var(--accent)', marginBottom: 8 }}>{m.icone}</div>
              <strong style={{ fontSize: '1.15rem', letterSpacing: '-.02em' }}>{m.numero}</strong>
              <p style={{ margin: '2px 0 0', fontSize: '.84rem', color: 'var(--text-secondary)', lineHeight: 1.45 }}>
                {m.texto}
              </p>
            </div>
          ))}
        </div>

        <h2 style={{ fontSize: '1.3rem', fontWeight: 700, letterSpacing: '-.02em', margin: '0 0 6px' }}>
          Planos
        </h2>
        <p style={{ fontSize: '.9rem', color: 'var(--text-secondary)', margin: '0 0 24px' }}>
          Sem fidelidade. Troca de plano quando quiser.
        </p>

        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'stretch' }}>
          {pagos.map((p) => (
            <div key={p.slug} style={{
              flex: '1 1 260px', display: 'flex', flexDirection: 'column',
              padding: '22px 22px 24px', borderRadius: 16,
              background: 'var(--card-bg)', border: '1px solid var(--border)',
            }}>
              <p style={{ margin: 0, fontSize: '.78rem', fontWeight: 700,
                          letterSpacing: '.1em', textTransform: 'uppercase',
                          color: 'var(--text-secondary)' }}>
                {p.nome}
              </p>

              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, margin: '10px 0 4px' }}>
                <strong style={{ fontSize: '2rem', fontWeight: 700, letterSpacing: '-.03em',
                                 fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
                  {real(p.preco)}
                </strong>
                <span style={{ fontSize: '.9rem', color: 'var(--text-secondary)' }}>/mês</span>
              </div>

              <p style={{ margin: '0 0 18px', fontSize: '.86rem', color: 'var(--text-secondary)' }}>
                Até <strong style={{ color: 'var(--text-primary)' }}>{p.limite_conversas}</strong>{' '}
                clientes atendidos por mês
              </p>

              <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 22px',
                           display: 'flex', flexDirection: 'column', gap: 9, flex: 1 }}>
                {(INCLUI[p.slug] ?? []).map((t, i) => (
                  <li key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start',
                                       fontSize: '.86rem', lineHeight: 1.45 }}>
                    <Check size={15} style={{ flexShrink: 0, marginTop: 3, color: 'var(--accent)' }} />
                    <span>{t}</span>
                  </li>
                ))}
              </ul>

              <a href="/" className="btn-primary"
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center',
                         gap: 7, textDecoration: 'none', fontSize: '.88rem' }}>
                Começar <ArrowRight size={16} />
              </a>
            </div>
          ))}
        </div>

        {sobMedida && (
          <div style={{
            marginTop: 16, padding: '18px 22px', borderRadius: 14,
            background: 'var(--card-bg)', border: '1px solid var(--border)',
            display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap',
          }}>
            <div style={{ flex: '1 1 320px' }}>
              <strong style={{ fontSize: '.95rem' }}>{sobMedida.nome}</strong>
              <p style={{ margin: '3px 0 0', fontSize: '.86rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                Passa de 700 clientes por mês, tem mais de uma loja ou precisa de algo
                sob medida? O valor a gente fecha conversando.
              </p>
            </div>
            <a href="https://wa.me/5515988372081?text=Quero%20falar%20sobre%20o%20Amply"
              target="_blank" rel="noopener noreferrer" className="btn-secondary"
              style={{ display: 'flex', alignItems: 'center', gap: 7,
                       textDecoration: 'none', whiteSpace: 'nowrap', fontSize: '.88rem' }}>
              <MessageCircle size={16} /> Falar com a gente
            </a>
          </div>
        )}

        <p style={{ marginTop: 32, fontSize: '.8rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          O que ultrapassar o limite do plano continua sendo atendido e é cobrado por
          cliente a mais — o assistente nunca para no meio de uma conversa.
        </p>

      </div>
    </div>
  );
};

export default PlanosPublico;
