import introJs from 'intro.js';
import 'intro.js/introjs.css';
import { supabase } from './supabase.js';

// Tour de boas-vindas — atravessa as telas, não só a primeira.
//
// Divide tarefa com a lista de Primeiros Passos, e os dois precisam existir:
//
//   tour   → "onde fica cada coisa", uma vez só, no primeiro login
//   lista  → "o que ainda falta", toda vez, até terminar
//
// ── Por que capítulos, e não uma lista de passos ───────────────────────────
//
// O Intro.js destaca elementos da tela ATUAL. Um tour de verdade precisa levar
// o lojista até Configurações, porque é lá que está o botão sem o qual nada
// funciona. Então o roteiro é dividido por rota: termina o capítulo, navega,
// espera a tela montar e continua de onde parou.
//
// Termina em Configurações de propósito. A última coisa que a pessoa vê é
// "conecte o seu WhatsApp" — que é exatamente o que ela precisa fazer a seguir.
//
// ── A fragilidade de todo tour ─────────────────────────────────────────────
//
// Tour quebra quando o seletor some: alguém renomeia algo e o passo aponta
// para o nada, deixando a tela escurecida sem saída — pior que não ter tour.
// Aqui cada passo é conferido antes de entrar, e capítulo que ficou vazio é
// pulado inteiro. No celular, com a barra lateral fechada, isso descarta os
// passos dela sozinho, sem uma linha de código de celular.

const ROTEIRO = [
  {
    rota: '/',
    tela: 'Início',
    passos: [
      { titulo: 'Bem-vindo à Amply',
        texto: 'Em um minuto eu te mostro onde fica cada coisa. Pode pular quando quiser.' },
      { alvo: '[data-tour="primeiros-passos"]', posicao: 'bottom',
        titulo: 'Comece por aqui',
        texto: 'Esta lista mostra o que falta para o assistente atender o seu primeiro cliente. Ela some sozinha quando você terminar.' },
      { alvo: '[data-tour="/conversas"]', posicao: 'right',
        titulo: 'O menu da esquerda',
        texto: 'Tudo fica aqui. Vou te levar pelas telas que você mais usa no começo.' },
    ],
  },
  {
    rota: '/estoque',
    tela: 'Veículos',
    passos: [
      { alvo: '[data-tour="estoque-adicionar"]', posicao: 'bottom',
        titulo: 'Seus veículos',
        texto: 'Cadastre por aqui. Dá para puxar os dados pela placa, e o carro cadastrado já aparece na conversa com o cliente, no seu site e no contrato de venda.' },
    ],
  },
  {
    rota: '/conversas',
    tela: 'Conversas',
    passos: [
      { alvo: '[data-tour="conversas-lista"]', posicao: 'right',
        titulo: 'As conversas',
        texto: 'Tudo que chega pelo WhatsApp e pelo Instagram cai aqui. Quando quiser falar você mesmo, é só assumir a conversa — o assistente sai de cena na hora e volta quando você mandar.' },
    ],
  },
  {
    rota: '/assistente',
    tela: 'Assistente',
    passos: [
      { alvo: '[data-tour="assistente-instrucoes"]', posicao: 'bottom',
        titulo: 'Como ele fala',
        texto: 'Conte o que a sua loja tem de diferente: desconto à vista, se pega carro na troca, o que não pode ser prometido. Dois parágrafos já mudam muito.' },
    ],
  },
  {
    rota: '/configuracoes',
    tela: 'Configurações',
    passos: [
      { alvo: '[data-tour="cfg-empresa"]', posicao: 'bottom',
        titulo: 'Os dados da loja',
        texto: 'Nome, endereço e telefone. O assistente usa pra se apresentar, e o contrato de venda sai com eles.' },
      { alvo: '[data-tour="cfg-whatsapp"]', posicao: 'bottom',
        titulo: 'O passo que liga tudo',
        texto: 'Aqui você conecta o WhatsApp da loja. Entra com a conta do Facebook do negócio, autoriza, e pronto — a partir daí o cliente conversa com o assistente.' },
      { alvo: '[data-tour="cfg-social"]', posicao: 'bottom',
        titulo: 'Instagram também',
        texto: 'O mesmo assistente atende no Direct. Dá pra conectar agora ou deixar pra depois.' },
      { alvo: '[data-tour="cfg-contrato"]', posicao: 'bottom',
        titulo: 'O contrato de venda',
        texto: 'Ao registrar uma venda, o contrato sai pronto com os dados do comprador e do veículo. Você pode usar o modelo da Amply ou colar o da sua loja.' },
      { titulo: 'É isso',
        texto: 'Se travar em algo, o botão de Suporte no fim do menu abre o nosso WhatsApp. Bom trabalho!' },
    ],
  },
];

/** Existe E ocupa espaço? Barra lateral fechada no celular tem largura zero, e
 *  destacar o invisível deixa o tour apontando para o vazio. */
const visivel = (sel) => {
  const el = document.querySelector(sel);
  if (!el) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
};

/** Espera um elemento aparecer depois da navegação. As telas são lazy: a rota
 *  troca na hora, o conteúdo chega alguns quadros depois. */
export const esperar = (sel, limiteMs = 4000) => new Promise((resolve) => {
  const inicio = Date.now();
  const tenta = () => {
    if (visivel(sel)) return resolve(true);
    if (Date.now() - inicio > limiteMs) return resolve(false);
    setTimeout(tenta, 120);
  };
  tenta();
});

const marcarComoVisto = async (userId) => {
  if (!userId) return;
  try {
    await supabase
      .from('company_settings')
      .update({ tour_visto_em: new Date().toISOString() })
      .eq('user_id', userId);
  } catch {
    // Falhar aqui só faz o tour reaparecer no próximo login. Chato, não
    // quebrado — e não vale travar a entrada do lojista por isso.
  }
};

// O corpo leva um "eyebrow" com o nome da tela. Ele responde "onde eu estou?",
// que e a pergunta que um tour de cinco telas precisa responder o tempo todo —
// e vale mais que barra de progresso, que reiniciaria a cada tela e enganaria.
const montarEtapas = (cap) => cap.passos
  .filter((p) => !p.alvo || visivel(p.alvo))
  .map((p) => ({
    ...(p.alvo ? { element: document.querySelector(p.alvo) } : {}),
    title: p.titulo,
    intro: `<span class="amply-tour-eyebrow">${cap.tela}</span>${p.texto}`,
    ...(p.posicao ? { position: p.posicao } : {}),
  }));

/**
 * Roda o tour inteiro, atravessando as telas.
 *
 * `navigate` vem do react-router: sem ele o tour fica preso na tela de Início,
 * que é justamente o que não queremos.
 */
export function rodarTour(userId, { navigate, aoFechar } = {}) {
  let capitulo = 0;
  let avancando = false;   // separa "terminou o capítulo" de "o lojista saiu"

  const encerrar = () => { marcarComoVisto(userId); aoFechar?.(); };

  const proximo = async () => {
    capitulo += 1;
    if (capitulo >= ROTEIRO.length) return encerrar();

    const cap = ROTEIRO[capitulo];
    navigate?.(cap.rota);

    // Espera o primeiro alvo do capítulo. Se não vier, pula o capítulo
    // inteiro em vez de abrir um tour apontando para o nada.
    const primeiro = cap.passos.find((p) => p.alvo);
    if (primeiro) {
      const veio = await esperar(primeiro.alvo);
      if (!veio) return proximo();
    }
    rodarCapitulo();
  };

  const rodarCapitulo = () => {
    const etapas = montarEtapas(ROTEIRO[capitulo]);
    if (!etapas.length) return proximo();

    const tour = introJs();
    tour.setOptions({
      steps: etapas,
      nextLabel: 'Próximo',
      prevLabel: 'Voltar',
      doneLabel: capitulo === ROTEIRO.length - 1 ? 'Entendi' : 'Continuar',
      skipLabel: 'Pular',
      showBullets: false,
      // Sem barra: ela e por capitulo, entao reiniciaria em cada tela e diria
      // "quase la" cinco vezes. O nome da tela no topo informa melhor.
      showProgress: false,
      tooltipClass: 'amply-tour',
      highlightClass: 'amply-tour-ring',
      exitOnOverlayClick: false,   // clique fora não deve encerrar sem querer
      disableInteraction: true,
      scrollToElement: true,
    });

    // O Intro.js dispara `onexit` TAMBÉM ao concluir. Sem esta separação, cada
    // capítulo terminado seria lido como desistência e o tour pararia no
    // primeiro — a bandeira distingue os dois.
    tour.oncomplete(() => { avancando = true; proximo(); });
    tour.onexit(() => {
      if (avancando) { avancando = false; return; }
      encerrar();   // pulou de verdade: respeitamos e não insistimos
    });

    tour.start();
  };

  // Não abre com um slide só: ou a tela ainda não montou, ou é um layout que
  // não conhecemos.
  if (montarEtapas(ROTEIRO[0]).length < 2) return false;
  rodarCapitulo();
  return true;
}
