import React, { useEffect, useState } from 'react';
import {
  Check, Loader2, AlertCircle, MessageCircle, ExternalLink, RefreshCw,
  CheckCircle2, AlertTriangle, Clock, CreditCard,
} from 'lucide-react';
import { useAppContext } from '../context/AppContext.jsx';
import { supabase } from '../lib/supabase.js';

// Plano e uso, dentro do CRM.
//
// ── Por que esta tela existe ───────────────────────────────────────────────
//
// O assunto estava partido em dois lugares que não conversavam. A escolha de
// plano morava no portão de entrada (`EscolherPlano`), que só aparece para
// conta nova; e o estado da assinatura morava num card no fim da rolagem de
// Configurações, sem nenhuma escolha — só um botão "Ativar assinatura".
//
// O resultado era o defeito que o cliente viu: o botão chamava o checkout SEM
// plano, caindo no último valor gravado no registro. Quem tinha clicado num
// cartão de R$1.497 e desistido era levado de volta àquele preço, como se
// fosse o plano dele. Loja que atende menos que isso bate de frente com o
// valor errado no pior momento possível.
//
// Aqui o único caminho para o checkout é clicar num plano específico. Não
// existe mais "ativar" sem dizer o quê.
//
// ── Por que o uso aparece junto ────────────────────────────────────────────
//
// Escolher faixa sem saber quanto se usa é chute. Com o consumo do mês na
// mesma tela, a conversa de plano acontece com um número na frente dos dois —
// e é a mesma régua que a cobrança usa, lida da mesma função do banco.

const real = (v) => Number(v || 0).toLocaleString('pt-BR', {
  style: 'currency', currency: 'BRL', minimumFractionDigits: 0, maximumFractionDigits: 0,
});

const dataCurta = (d) => {
  if (!d) return '';
  // Data pura (YYYY-MM-DD) não pode passar por new Date() sem fuso: vira o dia
  // anterior no Brasil.
  const [a, m, dia] = String(d).slice(0, 10).split('-');
  return `${dia}/${m}/${a}`;
};

// O que cada faixa entrega, em linguagem de lojista. Limites e preços vêm do
// BANCO — isto é só a descrição do que está incluído.
const BENEFICIOS = {
  crm: [
    'Estoque, leads e agenda',
    'Contrato de venda e ficha do comprador',
    'Feed do seu site com o estoque ao vivo',
    'Consulta de veículo pela placa',
  ],
  essencial: [
    'Estoque, leads, agenda e contrato de venda',
    'Atendimento automático no WhatsApp e Instagram',
    'Agendamento de visita pelo assistente',
    'Disparos em massa e mensagens de aniversário',
  ],
  crescimento: [
    'Tudo do Essencial',
    'Vários números de WhatsApp na mesma loja',
    'Identificação de quem atendeu cada cliente',
    'Retorno de conversões para os anúncios da Meta',
  ],
  performance: [
    'Tudo do Crescimento',
    'Volume para quem anuncia forte',
    'Prioridade no suporte',
    'Acompanhamento de resultado junto com a gente',
  ],
};

const ESTADOS = {
  ativa:     { cor: '#15803d', fundo: '#f0fdf4', borda: '#bbf7d0', titulo: 'Assinatura ativa',           icone: CheckCircle2 },
  isento:    { cor: '#1d4ed8', fundo: '#eff6ff', borda: '#bfdbfe', titulo: 'Cobrança combinada à parte', icone: CheckCircle2 },
  trial:     { cor: '#1d4ed8', fundo: '#eff6ff', borda: '#bfdbfe', titulo: 'Período de teste',           icone: Clock },
  atrasada:  { cor: '#b45309', fundo: '#fffbeb', borda: '#fde68a', titulo: 'Pagamento pendente',         icone: AlertTriangle },
  cancelada: { cor: '#b91c1c', fundo: '#fef2f2', borda: '#fecaca', titulo: 'Assinatura cancelada',       icone: AlertTriangle },
  sem_assinatura: { cor: '#3f3f46', fundo: '#fafafa', borda: '#e4e4e7', titulo: 'Sem assinatura ativa',  icone: AlertTriangle },
};

const Plano = () => {
  const { companySettings, refreshCompanySettings } = useAppContext();
  const [planos, setPlanos] = useState([]);
  const [uso, setUso] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [pagando, setPagando] = useState('');
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');

  const status = companySettings?.assinatura_status ?? 'sem_assinatura';
  const visual = ESTADOS[status] ?? ESTADOS.sem_assinatura;
  const Icone = visual.icone;
  const valor = Number(companySettings?.billing_amount) || 0;

  // Dias de teste restantes. Arredonda para cima: no último dia o lojista lê
  // "1 dia", não "0" — zero soa como já acabou, e ele ainda pode usar hoje.
  const fimTeste = companySettings?.trial_termina_em
    ? new Date(companySettings.trial_termina_em) : null;
  const diasTeste = fimTeste
    ? Math.max(0, Math.ceil((fimTeste - Date.now()) / 864e5)) : null;

  useEffect(() => {
    let vivo = true;
    (async () => {
      const [{ data: lista, error }, { data: consumo }] = await Promise.all([
        supabase.from('planos')
          .select('slug, nome, limite_conversas, preco, inclui_bot, ordem')
          .eq('visivel', true).order('ordem'),
        supabase.rpc('meu_uso_do_mes'),
      ]);
      if (!vivo) return;
      if (error) setErro('Não consegui carregar os planos. Atualize a página.');
      else setPlanos(lista ?? []);
      const linha = Array.isArray(consumo) ? consumo[0] : consumo;
      if (linha) setUso(linha);
      setCarregando(false);
    })();
    return () => { vivo = false; };
  }, [companySettings?.plano, companySettings?.assinatura_status]);

  // Quem volta do checkout chega com ?assinatura=ok. O pagamento em si é
  // confirmado pelo webhook, não por esta URL — ela só diz que vale reconsultar.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const r = p.get('assinatura');
    if (!r) return;

    if (r === 'ok') {
      setAviso('Pagamento recebido. Estamos confirmando com a operadora — pode levar alguns segundos.');
      refreshCompanySettings?.();
      const t = setTimeout(() => refreshCompanySettings?.(), 6000);
      window.history.replaceState({}, '', window.location.pathname);
      return () => clearTimeout(t);
    }
    if (r === 'cancelada') setAviso('Pagamento cancelado. Você pode escolher um plano quando quiser.');
    if (r === 'expirada')  setAviso('O link expirou. Escolha o plano de novo abaixo.');
    window.history.replaceState({}, '', window.location.pathname);
  }, [refreshCompanySettings]);

  const assinar = async (slug) => {
    setErro(''); setAviso(''); setPagando(slug);
    try {
      const { data, error } = await supabase.functions.invoke('assinatura-criar', {
        body: { plano: slug },
      });

      // O supabase-js transforma qualquer status fora do 2xx num erro genérico
      // ("non-2xx status code") e engole a explicação. Ler o corpo é o que faz
      // o lojista ver o motivo em vez de um código.
      if (error) {
        let msg = 'Não consegui abrir o pagamento. Tente de novo em instantes.';
        try {
          const corpo = await error.context?.json?.();
          if (corpo?.error) msg = corpo.error;
        } catch { /* fica a genérica */ }
        setErro(msg);
        return;
      }
      if (data?.error) { setErro(data.error); return; }
      if (!data?.link) { setErro('O pagamento não retornou um link válido.'); return; }

      // Aba nova: se desistir, não perde o que estava fazendo no CRM.
      window.open(data.link, '_blank', 'noopener');
      setAviso('Abrimos o pagamento em outra aba. Assim que concluir, esta tela atualiza sozinha.');
      refreshCompanySettings?.();
    } catch (e) {
      setErro(e?.message || 'Falha inesperada ao abrir o pagamento.');
    } finally {
      setPagando('');
    }
  };

  const pagos = planos.filter((p) => p.preco !== null && p.preco !== undefined);
  const personalizado = planos.find((p) => p.preco === null || p.preco === undefined);
  const atual = companySettings?.plano;
  const pretendido = companySettings?.plano_pretendido;

  if (carregando) {
    return (
      <div className="view-content" style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
        <Loader2 size={26} style={{ color: 'var(--accent)', animation: 'spin 1s linear infinite' }} />
      </div>
    );
  }

  return (
    <div className="view-content">
      <header className="view-header">
        <h1>Plano e uso</h1>
        <p>O quanto sua loja usou este mês e qual faixa cobre esse movimento.</p>
      </header>

      <section className="settings-section card">
        <div className="section-title">
          <CreditCard size={20} />
          <h2>Sua assinatura</h2>
        </div>

        <div className="settings-form">
          <div style={{
            background: visual.fundo, border: `1px solid ${visual.borda}`,
            borderRadius: 10, padding: '14px 16px', marginBottom: '1rem',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: visual.cor, fontWeight: 600 }}>
              <Icone size={18} /> {visual.titulo}
            </div>

            <div style={{ marginTop: 8, fontSize: '0.86rem', color: '#52525b', lineHeight: 1.6 }}>
              {status === 'trial' && (
                <>
                  {/* O número de dias vem antes de qualquer explicação: é a
                      única informação aqui que muda a decisão de hoje. */}
                  <div>
                    {diasTeste === 0
                      ? <><strong>Hoje é o último dia.</strong> Depois disso o assistente para de responder.</>
                      : <><strong>{diasTeste} {diasTeste === 1 ? 'dia' : 'dias'}</strong> de teste {diasTeste === 1 ? 'restante' : 'restantes'}.</>}
                  </div>
                  <div style={{ marginTop: 4 }}>
                    Escolha um plano abaixo quando quiser — assinando antes do fim, nada é
                    interrompido. Seus dados e conversas ficam aqui de qualquer forma.
                  </div>
                </>
              )}
              {status === 'ativa' && (
                <>
                  {valor > 0 && <div><strong>{real(valor)}</strong> por mês, no cartão.</div>}
                  {companySettings?.proximo_vencimento && (
                    <div>Próxima cobrança em {dataCurta(companySettings.proximo_vencimento)}.</div>
                  )}
                </>
              )}
              {status === 'isento' && (
                <div>Sua mensalidade é combinada diretamente com a Amply e não passa por cartão aqui.</div>
              )}
              {status === 'atrasada' && (
                <div>
                  Não conseguimos confirmar o último pagamento — normalmente é cartão vencido ou
                  sem limite. <strong>O atendimento automático fica pausado</strong> até regularizar.
                  Suas conversas e seus dados continuam aqui, nada se perde.
                </div>
              )}
              {status === 'cancelada' && (
                <div>
                  A assinatura foi encerrada e o atendimento automático está pausado.
                  Escolha um plano abaixo para voltar.
                </div>
              )}
              {status === 'sem_assinatura' && (
                <div>
                  O atendimento automático está pausado. Escolha abaixo a faixa que combina
                  com o movimento da sua loja para liberar.
                </div>
              )}
            </div>
          </div>

          {/* Pagamento aberto e não concluído.
              Sem esta linha, quem fecha a aba do checkout no meio volta aqui e
              não entende por que continua sem plano. */}
          {pretendido && status !== 'ativa' && (
            <p style={{ fontSize: '0.84rem', color: '#b45309', marginBottom: '1rem', lineHeight: 1.5 }}>
              Você começou a assinar o plano{' '}
              <strong>{planos.find((p) => p.slug === pretendido)?.nome ?? pretendido}</strong> e
              o pagamento ainda não foi confirmado. Pode clicar de novo abaixo — não gera cobrança
              dobrada.
            </p>
          )}

          {/* Consumo do mês.
              A barra existe para a conversa comercial acontecer ANTES do
              estouro: o limite nunca corta o bot (isso seria o lojista perdendo
              venda por causa do nosso plano), então o aviso é a única coisa que
              separa uma conversa tranquila de uma fatura surpresa. */}
          {uso && uso.limite > 0 && (() => {
            const usadas = Number(uso.usadas || 0);
            const limite = Number(uso.limite);
            const pct = Math.min(100, Math.round((usadas / limite) * 100));
            const perto = pct >= 80;
            const cor = perto ? '#b45309' : '#5B5BFF';
            return (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', color: '#52525b' }}>
                  <span>
                    {status === 'trial'
                      ? <>Clientes atendidos neste mês — régua do plano <strong>{uso.plano_nome}</strong></>
                      : <>Plano <strong>{uso.plano_nome}</strong> — clientes atendidos neste mês</>}
                  </span>
                  <span style={{ fontWeight: 600, color: cor }}>{usadas} de {limite}</span>
                </div>
                <div style={{ height: 7, background: '#eeeef3', borderRadius: 99, marginTop: 6, overflow: 'hidden' }}>
                  <div style={{ width: `${pct}%`, height: '100%', background: cor, transition: 'width .3s' }} />
                </div>
                {pct >= 100 ? (
                  <p style={{ fontSize: '0.8rem', color: '#b45309', marginTop: 8, lineHeight: 1.5 }}>
                    Você passou do limite do plano. <strong>O atendimento continua funcionando normalmente</strong> —
                    nada foi desligado. Vale conversarmos sobre subir de plano.
                  </p>
                ) : perto ? (
                  <p style={{ fontSize: '0.8rem', color: '#b45309', marginTop: 8, lineHeight: 1.5 }}>
                    Você já usou {pct}% das conversas do mês. Se passar, nada é desligado —
                    só vale a gente conversar sobre o próximo plano.
                  </p>
                ) : null}
              </div>
            );
          })()}

          {uso && !uso.limite && uso.plano_slug === 'personalizado' && (
            <p style={{ fontSize: '0.82rem', color: '#52525b', margin: 0 }}>
              Plano <strong>personalizado</strong>, sem limite de conversas.
              Você atendeu <strong>{Number(uso.usadas || 0)}</strong> clientes este mês.
            </p>
          )}
        </div>
      </section>

      {aviso && (
        <p style={{ fontSize: '0.86rem', color: '#15803d', margin: '0 0 14px', lineHeight: 1.5 }}>{aviso}</p>
      )}
      {erro && (
        <p style={{
          display: 'flex', gap: 8, alignItems: 'flex-start',
          fontSize: '0.86rem', color: '#dc2626', margin: '0 0 14px', lineHeight: 1.5,
        }}>
          <AlertCircle size={17} style={{ flexShrink: 0, marginTop: 1 }} /> {erro}
        </p>
      )}

      {/* `isento` não vê escada de preço: a mensalidade dele é combinada por
          fora, e oferecer cartão a quem paga por transferência é confundir o
          cliente que mais merece clareza. */}
      {status !== 'isento' && (
        <>
          <h2 style={{ fontSize: '1.05rem', fontWeight: 700, margin: '4px 0 4px' }}>
            {atual ? 'Trocar de plano' : 'Escolher um plano'}
          </h2>
          <p style={{ fontSize: '0.86rem', color: 'var(--color-text-muted)', margin: '0 0 16px', lineHeight: 1.5 }}>
            Sem fidelidade. Dá para subir ou descer de faixa quando quiser.
          </p>

          <div className="planos-grade" style={{ margin: '0 0 16px' }}>
            {pagos.map((p) => {
              const ehAtual = atual === p.slug && status === 'ativa';
              return (
                <div key={p.slug} className={`plano-card${ehAtual ? ' destaque' : ''}`}>
                  {ehAtual && <span className="plano-selo">Seu plano</span>}

                  <p className="plano-nome">{p.nome}</p>
                  <div className="plano-preco">
                    <strong>{real(p.preco)}</strong>
                    <span>/mês</span>
                  </div>
                  <p className="plano-limite">
                    {/* "Clientes atendidos", não "conversas". O lojista divide o
                        preço pelo número e sente que paga por um "oi"; dividindo
                        por cliente, a conta é a mesma e a frase é outra. */}
                    {p.inclui_bot
                      ? <>Até <strong>{p.limite_conversas}</strong> clientes atendidos por mês</>
                      : <>Sem atendimento automático</>}
                  </p>

                  <ul className="plano-itens">
                    {(BENEFICIOS[p.slug] ?? []).map((t, i) => (
                      <li key={i}><Check size={15} /> <span>{t}</span></li>
                    ))}
                  </ul>

                  <button
                    className={ehAtual ? 'btn-secondary plano-botao' : 'btn-primary plano-botao'}
                    onClick={() => assinar(p.slug)}
                    disabled={!!pagando || ehAtual}
                    style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {pagando === p.slug
                      ? <><Loader2 size={17} style={{ animation: 'spin 1s linear infinite' }} /> Abrindo...</>
                      : ehAtual
                        ? 'Plano atual'
                        : <><ExternalLink size={16} /> Assinar</>}
                  </button>
                </div>
              );
            })}
          </div>

          {personalizado && (
            <div className="plano-personalizado">
              <div>
                <h3>{personalizado.nome}</h3>
                <p>
                  Passa de 700 clientes por mês, tem mais de uma loja ou precisa de algo
                  sob medida? O valor a gente fecha conversando.
                </p>
              </div>
              <a
                href="https://wa.me/5515988372081?text=Quero%20falar%20sobre%20o%20plano%20personalizado%20do%20Amply"
                target="_blank" rel="noopener noreferrer"
                className="btn-secondary"
                style={{ display: 'flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap' }}>
                <MessageCircle size={17} /> Falar com a gente
              </a>
            </div>
          )}
        </>
      )}

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: 20 }}>
        <button className="btn-secondary" onClick={() => refreshCompanySettings?.()}
          style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <RefreshCw size={16} /> Atualizar
        </button>
      </div>

      <p style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)', marginTop: 16, lineHeight: 1.6 }}>
        Uma <strong>conversa</strong> é um cliente atendido no mês, não importa quantas mensagens
        ele troque — quem volta no mesmo mês continua contando uma vez. Passar do limite{' '}
        <strong>não desliga nada</strong>: a gente avisa e conversa sobre subir de plano.
        <br />
        O pagamento acontece numa página segura do Asaas. <strong>A Amply não recebe nem
        armazena os dados do seu cartão.</strong>
      </p>
    </div>
  );
};

export default Plano;
