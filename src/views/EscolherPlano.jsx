import React, { useEffect, useState } from 'react';
import { Check, Loader2, LogOut, AlertCircle, MessageCircle, ShieldCheck, BadgeCheck, Lock } from 'lucide-react';
import { useAppContext } from '../context/AppContext.jsx';
import { supabase } from '../lib/supabase.js';

// Escolha de plano, para quem se cadastrou e ainda não assinou.
//
// Aparece DEPOIS do login, e não antes: antes do login ela seria página de
// marketing, e quem chega no amply.ia.br já é cliente querendo trabalhar.
// Depois do login ela resolve um problema de verdade — hoje quem se cadastra
// fica parado esperando alguém definir o plano dele no painel.
//
// Quem já pagou alguma vez NUNCA cai aqui, mesmo em atraso: conta inadimplente
// mantém o CRM acessível com aviso, porque segurar os dados de quem já foi
// cliente é o tipo de coisa que vira reclamação pública. Ver o portão no App.

const real = (v) => Number(v || 0).toLocaleString('pt-BR', {
  style: 'currency', currency: 'BRL', minimumFractionDigits: 0, maximumFractionDigits: 0,
});

// O que cada faixa entrega, em linguagem de lojista. Os limites e preços vêm do
// BANCO — isto aqui é só a descrição do que está incluído.
const BENEFICIOS = {
  crm: [
    'Estoque, leads e agenda',
    'Contrato de venda e ficha do comprador',
    'Feed do seu site com o estoque ao vivo',
    'Consulta de veículo pela placa',
  ],
  essencial: [
    'Tudo do CRM',
    'Atendimento automático no WhatsApp e Instagram',
    'Agendamento de visita pelo bot',
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

const EscolherPlano = () => {
  const { logout, refreshCompanySettings } = useAppContext();
  const [planos, setPlanos] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [pagando, setPagando] = useState('');
  const [erro, setErro] = useState('');

  useEffect(() => {
    let vivo = true;
    (async () => {
      const { data, error } = await supabase
        .from('planos')
        .select('slug, nome, limite_conversas, preco, inclui_bot, ordem')
        .order('ordem');
      if (!vivo) return;
      if (error) setErro('Não consegui carregar os planos. Atualize a página.');
      else setPlanos(data ?? []);
      setCarregando(false);
    })();
    return () => { vivo = false; };
  }, []);

  const assinar = async (slug) => {
    setErro(''); setPagando(slug);
    try {
      const { data, error } = await supabase.functions.invoke('assinatura-criar', {
        body: { plano: slug },
      });

      // O supabase-js transforma qualquer status fora do 2xx num erro genérico
      // ("non-2xx status code") e engole a explicação. Ler o corpo é o que faz
      // o cliente ver o motivo em vez de um código.
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

      refreshCompanySettings();
      window.location.href = data.link;
    } catch (e) {
      setErro(e?.message || 'Falha inesperada ao abrir o pagamento.');
    } finally {
      setPagando('');
    }
  };

  const pagos = planos.filter((p) => p.preco !== null && p.preco !== undefined);
  const personalizado = planos.find((p) => p.preco === null || p.preco === undefined);

  if (carregando) {
    return (
      <div className="planos-tela" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Loader2 size={26} style={{ color: 'var(--accent)', animation: 'spin 1s linear infinite' }} />
      </div>
    );
  }

  return (
    <div className="planos-tela">
      <div className="planos-cabecalho">
        <h1>Escolha seu plano</h1>
        <p>
          Sua conta está criada. Escolha a faixa que combina com o movimento da sua loja —
          dá para trocar depois, a qualquer momento.
        </p>
      </div>

      {erro && (
        <p style={{
          maxWidth: 620, margin: '0 auto 20px', display: 'flex', gap: 8, alignItems: 'flex-start',
          fontSize: '0.86rem', color: '#dc2626', lineHeight: 1.5,
        }}>
          <AlertCircle size={17} style={{ flexShrink: 0, marginTop: 1 }} /> {erro}
        </p>
      )}

      <div className="planos-grade">
        {pagos.map((p) => {
          // O destaque é o Crescimento por medida, não por gosto: é onde cai
          // uma revenda que anuncia — a DSC, com 218 conversas/mês, está nele.
          const destaque = p.slug === 'crescimento';
          const itens = BENEFICIOS[p.slug] ?? [];
          return (
            <div key={p.slug} className={`plano-card${destaque ? ' destaque' : ''}`}>
              {destaque && <span className="plano-selo">MAIS ESCOLHIDO</span>}

              <p className="plano-nome">{p.nome}</p>
              <div className="plano-preco">
                <strong>{real(p.preco)}</strong>
                <span>/mês</span>
              </div>
              <p className="plano-limite">
                {p.inclui_bot
                  ? <>Até <strong>{p.limite_conversas}</strong> conversas atendidas por mês</>
                  : <>Sem atendimento automático</>}
              </p>

              <ul className="plano-itens">
                {itens.map((t, i) => (
                  <li key={i}><Check size={15} /> <span>{t}</span></li>
                ))}
              </ul>

              <button
                className={destaque ? 'btn-primary plano-botao' : 'btn-secondary plano-botao'}
                onClick={() => assinar(p.slug)}
                disabled={!!pagando}
                style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {pagando === p.slug
                  ? <><Loader2 size={17} style={{ animation: 'spin 1s linear infinite' }} /> Abrindo...</>
                  : 'Assinar'}
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
              Passa de 500 conversas por mês, tem mais de uma loja ou precisa de algo sob medida?
              O valor a gente fecha conversando.
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

      {/* Faixa de confianca.
          Cada frase aqui e verificavel. NAO existe "Meta Business Partner" nem
          "parceiro oficial": esse selo vem de um programa formal com diretorio
          publico, e usar sem estar listado e violacao de marca — com o app
          derrubado como consequencia, o que tiraria todos os clientes do ar. */}
      <div className="selos-confianca">
        <div className="selo-confianca">
          <BadgeCheck size={19} />
          <div>
            <strong>API oficial do WhatsApp Business</strong>
            <span>
              Integração direta com a Cloud API da Meta. Não usamos automação de
              WhatsApp Web nem aparelho conectado no escritório.
            </span>
          </div>
        </div>

        <div className="selo-confianca">
          <ShieldCheck size={19} />
          <div>
            <strong>Seu número não corre risco de banimento</strong>
            <span>
              É a diferença que importa: ferramenta não oficial derruba o número da
              loja, e com ele o histórico de conversa dos seus clientes.
            </span>
          </div>
        </div>

        <div className="selo-confianca">
          <Lock size={19} />
          <div>
            <strong>Pagamento em ambiente certificado</strong>
            <span>
              O cartão é digitado numa página do Asaas, instituição de pagamento
              autorizada pelo Banco Central e certificada PCI-DSS.
            </span>
          </div>
        </div>
      </div>

      <p className="planos-rodape">
        Uma <strong>conversa</strong> é um cliente atendido no mês, não importa quantas mensagens
        ele troque — quem volta no mesmo mês continua contando uma vez.
        Passar do limite <strong>não desliga nada</strong>: a gente avisa e conversa sobre subir de plano.
        <br />
        O pagamento acontece numa página segura do Asaas. A Amply não recebe nem armazena os dados do seu cartão.
      </p>

      <div style={{ textAlign: 'center', marginTop: 26 }}>
        <button onClick={logout}
          style={{
            background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)',
            fontSize: '0.84rem', display: 'inline-flex', alignItems: 'center', gap: 6,
          }}>
          <LogOut size={15} /> Sair
        </button>
      </div>
    </div>
  );
};

export default EscolherPlano;
