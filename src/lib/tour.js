import introJs from 'intro.js';
import 'intro.js/introjs.css';
import { supabase } from './supabase.js';

// Tour de boas-vindas — mostra ONDE ficam as coisas.
//
// Divide tarefa com a lista de Primeiros Passos, e os dois precisam existir:
//
//   tour   → "onde fica cada coisa", uma vez só, no primeiro login
//   lista  → "o que ainda falta", toda vez, até terminar
//
// Um tour que também cobrasse tarefa viraria lembrete repetido; uma lista que
// também ensinasse a navegar viraria manual. Separados, cada um faz uma coisa.
//
// ── A fragilidade de todo tour, e como esta versão não cai nela ────────────
//
// Tour quebra quando o seletor some: alguém renomeia uma classe, o elemento
// muda de lugar, e o passo aponta para o nada. Com a biblioteca travada num
// elemento inexistente, o lojista fica com a tela escurecida e sem saída —
// pior que não ter tour nenhum.
//
// Por isso cada passo é CONFERIDO antes de entrar: elemento ausente ou
// invisível é descartado em silêncio. No celular, onde a barra lateral vive
// fechada, isso corta os passos dela sozinho — sem precisar de código de
// celular em lugar nenhum.

const passo = (seletor, titulo, texto, posicao) => ({ seletor, titulo, texto, posicao });

const PASSOS = [
  passo(null, 'Bem-vindo à Amply',
    'Em um minuto eu te mostro onde fica cada coisa. Depois é só usar.'),

  passo('[data-tour="primeiros-passos"]', 'Comece por aqui',
    'Esta lista mostra o que falta para o assistente atender o seu primeiro cliente. Ela some sozinha quando você terminar.', 'bottom'),

  passo('[data-tour="/estoque"]', 'Seus veículos',
    'É daqui que o assistente tira o que oferecer ao cliente. Carro cadastrado aqui aparece na conversa, no site e no contrato de venda.', 'right'),

  passo('[data-tour="/conversas"]', 'As conversas',
    'Tudo que chega pelo WhatsApp e pelo Instagram cai aqui. Quando quiser falar você mesmo, é só assumir a conversa — o assistente sai de cena na hora.', 'right'),

  passo('[data-tour="/agenda"]', 'As visitas',
    'O assistente agenda sozinho, respeitando o seu horário de funcionamento. As visitas marcadas aparecem aqui.', 'right'),

  passo('[data-tour="/assistente"]', 'O assistente',
    'Aqui você conta como a sua loja trabalha: financiamento, troca, formas de pagamento e horário. É o que faz ele responder como alguém da sua equipe.', 'right'),

  passo('[data-tour="/configuracoes"]', 'Configurações',
    'Os dados da loja, o contrato de venda e — o mais importante — o botão que conecta o seu WhatsApp.', 'right'),

  passo('[data-tour="suporte"]', 'Travou em algo?',
    'Este botão abre o WhatsApp da gente. Pode chamar.', 'right'),
];

/** Elemento existe E está visível? Barra lateral fechada no celular tem
 *  largura zero, e destacar o invisível deixa o tour apontando para o vazio. */
const visivel = (el) => {
  if (!el) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
};

const marcarComoVisto = async (userId) => {
  if (!userId) return;
  try {
    await supabase
      .from('company_settings')
      .update({ tour_visto_em: new Date().toISOString() })
      .eq('user_id', userId);
  } catch {
    // Falhar aqui só faz o tour aparecer de novo no próximo login. Chato,
    // não quebrado — e não vale travar a entrada do lojista por causa disso.
  }
};

/** Roda o tour. Devolve true se chegou a abrir. */
export function rodarTour(userId, { aoFechar } = {}) {
  const etapas = PASSOS
    .filter((p) => !p.seletor || visivel(document.querySelector(p.seletor)))
    .map((p) => ({
      ...(p.seletor ? { element: document.querySelector(p.seletor) } : {}),
      title: p.titulo,
      intro: p.texto,
      ...(p.posicao ? { position: p.posicao } : {}),
    }));

  // Sobrou só a boas-vindas: a tela ainda não montou, ou é um layout que não
  // conhecemos. Melhor não abrir do que abrir um tour de um slide só.
  if (etapas.length < 2) return false;

  const tour = introJs();
  tour.setOptions({
    steps: etapas,
    nextLabel: 'Próximo',
    prevLabel: 'Voltar',
    doneLabel: 'Entendi',
    skipLabel: 'Pular',
    showBullets: false,
    showProgress: true,
    exitOnOverlayClick: false,  // clique fora não deve encerrar sem querer
    disableInteraction: true,
    scrollToElement: true,
  });

  // Marca como visto tanto no fim quanto na saída: quem pulou decidiu que não
  // quer, e insistir seria transformar ajuda em incômodo.
  const encerrar = () => { marcarComoVisto(userId); aoFechar?.(); };
  tour.oncomplete(encerrar);
  tour.onexit(encerrar);
  tour.start();
  return true;
}
