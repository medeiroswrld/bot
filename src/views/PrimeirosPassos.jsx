import React from 'react';
import { Link } from 'react-router-dom';
import { Check, ArrowRight, Store, Car, MessageSquare, Bot, AtSign } from 'lucide-react';
import { useAppContext } from '../context/AppContext.jsx';

// O que falta para a loja receber o primeiro cliente pelo bot.
//
// ── Por que um checklist e nao um assistente passo a passo ─────────────────
//
// Assistente obriga uma ordem. Lojista que acabou de entrar quer cadastrar os
// carros primeiro, ou conectar o WhatsApp primeiro, e cada um tem um motivo
// proprio. Pior: assistente que trava no meio deixa a pessoa presa, e a
// primeira experiencia no produto vira "nao consegui passar da tela 2".
//
// Lista marca o que ja esta pronto, deixa a ordem com ele e some quando
// acabar.
//
// ── Por que so quatro passos ───────────────────────────────────────────────
//
// Contrato de venda e Instagram ficaram DE FORA, e nao por esquecimento. Sao
// bons, mas nenhum dos dois impede o bot de atender. Passo opcional dentro de
// barra de progresso faz os 100% nunca chegarem, e barra que nao fecha
// desanima em vez de guiar.
//
// O criterio foi um so: isto aqui impede o primeiro cliente de ser atendido?
// Se nao impede, nao entra.

const PrimeirosPassos = () => {
  const { companySettings: s, inventory } = useAppContext();

  // Enquanto as configuracoes nao chegaram, nao da para saber o que falta — e
  // mostrar "0 de 4" para uma loja pronta seria pior que nao mostrar nada.
  if (!s) return null;

  const cheio = (v) => typeof v === 'string' && v.trim().length > 0;
  const carros = Array.isArray(inventory) ? inventory.length : 0;

  const passos = [
    {
      feito: cheio(s.company_name) && cheio(s.address) && cheio(s.phone_number),
      icone: <Store size={17} />,
      titulo: 'Complete os dados da loja',
      porque: 'Nome, endereço e telefone. O assistente usa pra se apresentar, e o contrato de venda sai com eles.',
      para: '/configuracoes',
      acao: 'Preencher',
    },
    {
      feito: carros > 0,
      icone: <Car size={17} />,
      titulo: 'Cadastre os veículos',
      porque: 'É o que o assistente oferece ao cliente. Sem estoque ele não tem o que mostrar.',
      para: '/estoque',
      acao: 'Cadastrar',
    },
    {
      feito: cheio(s.whatsapp_phone_number_id),
      icone: <MessageSquare size={17} />,
      titulo: 'Conecte o WhatsApp',
      porque: 'É por onde o cliente chega. Você entra com a conta do Facebook do negócio e autoriza.',
      para: '/configuracoes',
      acao: 'Conectar',
    },
    {
      feito: cheio(s.bot_custom_instructions),
      icone: <Bot size={17} />,
      titulo: 'Ajuste o jeito do assistente',
      porque: 'Conte como a sua loja fala, o que não pode ser dito e o que destacar. Dois parágrafos já mudam muito.',
      para: '/assistente',
      acao: 'Ajustar',
    },
  ];

  const prontos = passos.filter((p) => p.feito).length;

  // Tudo pronto: o cartao sai da frente para sempre. Loja que ja trabalha nao
  // precisa de lembrete do primeiro dia ocupando o topo do Inicio.
  if (prontos === passos.length) return null;

  const pct = Math.round((prontos / passos.length) * 100);

  return (
    <section className="card" style={{ padding: '1.4rem 1.5rem', marginBottom: '1.5rem' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 4 }}>
        <h2 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700 }}>Primeiros passos</h2>
        <span style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)' }}>
          {prontos} de {passos.length}
        </span>
      </div>

      <p style={{ margin: '0 0 14px', fontSize: '0.85rem', color: 'var(--color-text-muted)', lineHeight: 1.55 }}>
        Falta pouco para o assistente atender o primeiro cliente da sua loja.
      </p>

      {/* Barra de progresso. Fecha de verdade: so ha passos obrigatorios aqui. */}
      <div style={{
        height: 5, borderRadius: 999, background: 'var(--input-bg)',
        overflow: 'hidden', marginBottom: 18,
      }}>
        <div style={{
          width: `${pct}%`, height: '100%', background: 'var(--accent)',
          borderRadius: 999, transition: 'width .4s ease',
        }} />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {passos.map((p, i) => (
          <div key={i} style={{
            display: 'flex', alignItems: 'flex-start', gap: 12,
            padding: '11px 0',
            borderTop: i === 0 ? 'none' : '1px solid var(--border-color)',
            opacity: p.feito ? 0.55 : 1,
          }}>
            <span style={{
              width: 26, height: 26, borderRadius: '50%', flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: p.feito ? '#dcfce7' : 'var(--input-bg)',
              color: p.feito ? '#15803d' : 'var(--color-text-muted)',
              marginTop: 1,
            }}>
              {p.feito ? <Check size={15} /> : p.icone}
            </span>

            <div style={{ flex: 1, minWidth: 0 }}>
              <strong style={{
                fontSize: '0.9rem', display: 'block',
                textDecoration: p.feito ? 'line-through' : 'none',
                textDecorationColor: 'var(--border-color)',
              }}>
                {p.titulo}
              </strong>
              {!p.feito && (
                <p style={{ margin: '3px 0 0', fontSize: '0.82rem', color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
                  {p.porque}
                </p>
              )}
            </div>

            {!p.feito && (
              <Link
                to={p.para}
                className="btn-secondary"
                style={{
                  flexShrink: 0, fontSize: '0.8rem', padding: '5px 12px',
                  display: 'flex', alignItems: 'center', gap: 5, textDecoration: 'none',
                  alignSelf: 'center',
                }}
              >
                {p.acao} <ArrowRight size={14} />
              </Link>
            )}
          </div>
        ))}
      </div>

      {/* O Instagram fica aqui embaixo, fora da conta: e ganho real, mas nao
          impede o bot de trabalhar, entao nao pode segurar a barra em 80%. */}
      {!cheio(s.ig_user_id) && (
        <p style={{
          display: 'flex', gap: 7, alignItems: 'flex-start', marginTop: 14,
          fontSize: '0.8rem', color: 'var(--color-text-muted)', lineHeight: 1.5,
        }}>
          <AtSign size={15} style={{ flexShrink: 0, marginTop: 2 }} />
          <span>
            O mesmo assistente também atende no Direct do Instagram.{' '}
            <Link to="/configuracoes" style={{ color: 'var(--accent)' }}>Conectar depois</Link>.
          </span>
        </p>
      )}
    </section>
  );
};

export default PrimeirosPassos;
