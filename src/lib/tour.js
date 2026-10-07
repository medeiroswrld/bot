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
      { alvo: '[data-tour="menu"]', posicao: 'right',
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

// ─── O fio ──────────────────────────────────────────────────────────────────
//
// Liga a caixa ao elemento que ela explica. Substitui a setinha triangular da
// biblioteca, que aponta mas não CONDUZ: num tour que atravessa cinco telas, o
// olho precisa de um caminho para seguir, não de um bico.
//
// Desenhado em SVG por cima da página e ABAIXO da caixa (z-index entre o
// destaque e o tooltip), para o fio se enfiar sob a borda do cartão em vez de
// encostar nela — é o que faz os dois lerem como peças ligadas.

const ID_FIO = 'amply-tour-fio';

const removerFio = () => document.getElementById(ID_FIO)?.remove();

/** Curva de uma borda à outra, sempre saindo e entrando perpendicular.
 *  Controles perpendiculares são o que dá o formato de chicote da referência —
 *  linha reta ligaria os dois pontos sem sugerir direção nenhuma. */
const caminho = (de, para) => {
  const folga = Math.min(Math.max(Math.abs(de.x - para.x) * 0.5, 40), 120);
  const c1 = de.eixo === 'x'   ? [de.x + de.sinal * folga, de.y]   : [de.x, de.y + de.sinal * folga];
  const c2 = para.eixo === 'x' ? [para.x + para.sinal * folga, para.y] : [para.x, para.y + para.sinal * folga];
  return `M ${de.x} ${de.y} C ${c1[0]} ${c1[1]}, ${c2[0]} ${c2[1]}, ${para.x} ${para.y}`;
};

/** De qual borda sair, e para qual entrar. Decide pelo eixo dominante: caixa à
 *  direita do alvo sai pela esquerda dela e entra pela direita dele. */
const bordas = (t, a) => {
  const dx = (a.left + a.width / 2) - (t.left + t.width / 2);
  const dy = (a.top + a.height / 2) - (t.top + t.height / 2);

  if (Math.abs(dx) >= Math.abs(dy)) {
    const paraDireita = dx > 0;
    return [
      { x: paraDireita ? t.right : t.left, y: t.top + t.height / 2, eixo: 'x', sinal: paraDireita ? 1 : -1 },
      { x: paraDireita ? a.left : a.right, y: a.top + a.height / 2, eixo: 'x', sinal: paraDireita ? -1 : 1 },
    ];
  }
  const paraBaixo = dy > 0;
  return [
    { x: t.left + t.width / 2, y: paraBaixo ? t.bottom : t.top, eixo: 'y', sinal: paraBaixo ? 1 : -1 },
    { x: a.left + a.width / 2, y: paraBaixo ? a.top : a.bottom, eixo: 'y', sinal: paraBaixo ? -1 : 1 },
  ];
};

const desenharFio = (alvo) => {
  removerFio();
  const caixa = document.querySelector('.introjs-tooltip');
  if (!alvo || !caixa) return;

  const t = caixa.getBoundingClientRect();
  const a = alvo.getBoundingClientRect();
  if (!t.width || !a.width) return;

  const [de, para] = bordas(t, a);
  const d = caminho(de, para);

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.id = ID_FIO;
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML =
    `<path class="amply-fio-halo" d="${d}" />` +
    `<path class="amply-fio-nucleo" d="${d}" />`;
  document.body.appendChild(svg);

  // Desenha de uma ponta à outra, no sentido caixa -> elemento: o traço em si
  // conta para onde olhar.
  const nucleo = svg.querySelector('.amply-fio-nucleo');
  const halo   = svg.querySelector('.amply-fio-halo');
  const comprimento = nucleo.getTotalLength();
  const suave = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  for (const p of [nucleo, halo]) {
    p.style.strokeDasharray = comprimento;
    p.style.strokeDashoffset = suave ? 0 : comprimento;
  }
  if (!suave) {
    requestAnimationFrame(() => {
      for (const p of [nucleo, halo]) {
        p.style.transition = 'stroke-dashoffset 460ms cubic-bezier(.22,1,.36,1)';
        p.style.strokeDashoffset = 0;
      }
    });
  }
};

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
      // Escurecido forte: o alvo às vezes é um ícone de 18px numa barra já
      // escura, e com pouco contraste o destaque simplesmente não se lê.
      overlayOpacity: 0.72,
      scrollToElement: true,
    });

    // O Intro.js dispara `onexit` TAMBÉM ao concluir. Sem esta separação, cada
    // capítulo terminado seria lido como desistência e o tour pararia no
    // primeiro — a bandeira distingue os dois.
    // O fio precisa das medidas JA posicionadas, e a biblioteca coloca o
    // tooltip depois de disparar o evento — dai o quadro de espera.
    let redesenhar = null;
    tour.onafterchange(function (elemento) {
      requestAnimationFrame(() => desenharFio(elemento));
      if (redesenhar) {
        window.removeEventListener('scroll', redesenhar, true);
        window.removeEventListener('resize', redesenhar);
      }
      // Rolagem e redimensionamento movem as duas pontas. Sem redesenhar, o
      // fio fica ligando lugares onde nada mais esta.
      redesenhar = () => requestAnimationFrame(() => desenharFio(elemento));
      window.addEventListener('scroll', redesenhar, true);
      window.addEventListener('resize', redesenhar);
    });

    const limparFio = () => {
      removerFio();
      if (redesenhar) {
        window.removeEventListener('scroll', redesenhar, true);
        window.removeEventListener('resize', redesenhar);
        redesenhar = null;
      }
    };

    tour.oncomplete(() => { avancando = true; limparFio(); proximo(); });
    tour.onexit(() => {
      limparFio();
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
