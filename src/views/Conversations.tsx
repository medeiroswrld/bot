import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
  Bot, UserCheck, MessageCircle, Send, RefreshCw,
  PhoneCall, Search, Loader2, AlertCircle, Bell, BellOff, Trash2, Mic, ChevronLeft, CarFront,
  Archive, ArchiveRestore, MessageSquarePlus,
} from 'lucide-react';
import { supabaseTyped } from '../lib/supabase-typed';
import { estoqueEmTexto } from '../lib/estoqueTexto.js';
import { useDinheiro } from '../lib/useDinheiro.js';
// useAppContext is from a .jsx file — cast to known shape below
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import { useAppContext } from '../context/AppContext.jsx';

// Chave VAPID publica. E publica por design: identifica o servidor que assina o
// push. A privada vive so no secret VAPID_PRIVATE_KEY da edge function.
const VAPID_PUBLIC = 'BMaOd4xS2zTUsc1KM3M_ErMUITFqN8UZtFxPVBSfn9xbHYoLeRN0voZeoTfRwl63kkntbI9pU2vV5Z_tIQmnFec';

// applicationServerKey exige bytes, nao a string base64url.
const base64UrlParaBytes = (b64: string): Uint8Array => {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const bin = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};
import type { Tables } from '../lib/database.types';

// Atalho para colunas que existem no banco mas ainda não em database.types.ts.
//
// O arquivo de tipos é gerado e não foi regerado desde várias migrations —
// `team_members`, `atendente` e as colunas da ficha de compra estão no Postgres
// e não no tipo. Sem isto, cada consulta a elas exigiria um cast inline, e foi
// exatamente por escrever um desses errado que /conversas ficou em branco.
//
// Regerar os tipos resolve de verdade; até lá, um ponto só de escape.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabaseTyped as any;

type Conversation = Tables<'conversations'>;
type Message      = Tables<'messages'>;

type FilterValue = '' | 'bot' | 'pending' | 'human' | 'closed';

interface AppCtxShape {
  user: { id: string } | null;
  session: { access_token: string } | null;
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function relativeTime(iso: string | null): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1)  return 'agora';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

function initials(name: string | null, phone: string): string {
  if (name) return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  return phone.slice(-2);
}

// ─── AtendenteBadge ───────────────────────────────────────────────────────────
//
// Qual vendedor está nesta conversa. A loja atende pelo mesmo WhatsApp em três
// celulares, então "Humano" sozinho não diz nada — o dono precisa saber QUAL
// humano. O nome vem da assinatura que a equipe já escreve ("me chamo rodrigo"),
// lida pelo webhook, ou de uma escolha à mão quando ela falha.
//
// Cor derivada do nome, não sorteada: o mesmo vendedor precisa ter sempre a
// mesma cor pra ser reconhecido de relance ao correr a lista.
const CORES_ATENDENTE = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#14b8a6'];

function corDoNome(nome: string): string {
  let h = 0;
  for (let i = 0; i < nome.length; i++) h = (h * 31 + nome.charCodeAt(i)) >>> 0;
  return CORES_ATENDENTE[h % CORES_ATENDENTE.length];
}

const AtendenteBadge = React.memo(function AtendenteBadge({ nome }: { nome?: string | null }) {
  const limpo = String(nome ?? '').trim();
  if (!limpo) return null;
  const cor = corDoNome(limpo);
  const ini = limpo.split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  return (
    <span
      title={`Atendido por ${limpo}`}
      style={{
        fontSize: '0.6rem', fontWeight: 700, lineHeight: 1,
        width: 18, height: 18, borderRadius: '50%', flexShrink: 0,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        background: cor, color: '#fff',
      }}
    >
      {ini}
    </span>
  );
});

// ─── StatusBadge ──────────────────────────────────────────────────────────────

const StatusBadge = React.memo(function StatusBadge({ status }: { status: Conversation['status'] }) {
  const map: Record<string, { label: string; color: string }> = {
    bot:     { label: 'Bot',       color: 'var(--primary)' },
    pending: { label: 'Pendente',  color: '#f59e0b' },
    human:   { label: 'Humano',    color: '#10b981' },
    closed:  { label: 'Encerrada', color: 'var(--text-secondary)' },
  };
  const cfg = map[status] ?? map.bot;
  return (
    <span style={{
      fontSize: '0.65rem', fontWeight: 600,
      padding: '2px 6px', borderRadius: 4,
      background: `${cfg.color}22`, color: cfg.color,
      textTransform: 'uppercase', letterSpacing: '0.04em',
    }}>
      {cfg.label}
    </span>
  );
});

// ─── ConvItem ─────────────────────────────────────────────────────────────────

const ConvItem = React.memo(function ConvItem({
  conv, lastMsg, active, isAlert, onClick, rotuloNumero, anuncio, trecho,
}: {
  conv: Conversation;
  lastMsg: Message | null;
  active: boolean;
  isAlert: boolean;
  onClick: () => void;
  // Qual número NOSSO recebeu esta conversa. Só chega preenchido quando a loja
  // tem mais de um — com um só, seria a mesma etiqueta em toda linha.
  rotuloNumero?: string;
  // Qual anúncio trouxe a pessoa. É o que o vendedor precisa saber ANTES de
  // puxar assunto: quem clicou em "quero consignar meu veículo" quer vender o
  // carro dele, e tratar como comprador é começar errado.
  anuncio?: string;
  // Pedaço da mensagem que casou com a busca. Preenchido só quando a conversa
  // entrou na lista pelo TEXTO, não pelo nome.
  trecho?: string;
}) {
  const showAlert = isAlert && !active;
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        width: '100%', textAlign: 'left',
        padding: '12px 16px',
        background: showAlert ? undefined : active ? 'var(--bg-card)' : 'transparent',
        border: 'none',
        borderLeft: showAlert
          ? '3px solid #f59e0b'
          : active ? '3px solid var(--primary)' : '3px solid transparent',
        cursor: 'pointer', transition: 'background 0.15s',
        display: 'flex', gap: 10, alignItems: 'flex-start',
        position: 'relative',
        animation: showAlert ? 'alert-pulse 1s ease-in-out infinite' : undefined,
      }}
    >
      <div style={{
        width: 38, height: 38, borderRadius: '50%', flexShrink: 0,
        background: showAlert ? '#f59e0b' : 'var(--primary)', color: '#fff',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: '0.8rem', fontWeight: 700,
      }}>
        {initials(conv.customer_name, conv.customer_phone)}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 4 }}>
          <span style={{ fontWeight: 600, fontSize: '0.875rem', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {conv.customer_name ?? conv.customer_phone}
          </span>
          <CanalBadge canal={(conv as { channel?: string }).channel} />
          <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', flexShrink: 0 }}>
            {relativeTime(conv.last_message_at)}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 2 }}>
          <StatusBadge status={conv.status} />
          <AtendenteBadge nome={(conv as { atendente?: string | null }).atendente} />
          {anuncio && (
            <span
              title={`Veio do anúncio: ${anuncio}`}
              style={{
                fontSize: '0.62rem', fontWeight: 700, padding: '1px 6px', borderRadius: 999,
                background: '#ede9fe', color: '#6d28d9', border: '1px solid #c4b5fd',
                flexShrink: 1, minWidth: 0, overflow: 'hidden',
                textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}
            >
              {anuncio}
            </span>
          )}
          {rotuloNumero && (
            <span
              title={`Cliente falou com o número ${rotuloNumero}`}
              style={{
                fontSize: '0.62rem', fontWeight: 700, padding: '1px 6px', borderRadius: 999,
                background: 'var(--input-bg)', color: 'var(--text-secondary)',
                border: '1px solid var(--border)', flexShrink: 0, whiteSpace: 'nowrap',
              }}
            >
              {rotuloNumero}
            </span>
          )}
          {/* Buscando por texto, o trecho que CASOU vale mais que a última
              mensagem: é ele que diz se vale abrir a conversa. */}
          {trecho ? (
            <span
              title={trecho}
              style={{
                fontSize: '0.75rem', color: 'var(--text-primary)', overflow: 'hidden',
                textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1,
                background: '#fef9c3', borderRadius: 4, padding: '0 4px',
              }}
            >
              {trecho}
            </span>
          ) : lastMsg && (
            <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
              {lastMsg.role !== 'customer' ? '← ' : ''}{lastMsg.content.substring(0, 50)}
            </span>
          )}
        </div>
      </div>
      {showAlert && (
        <AlertCircle size={16} style={{ color: '#f59e0b', flexShrink: 0, alignSelf: 'center' }} />
      )}
    </button>
  );
});

// ─── Bubble ───────────────────────────────────────────────────────────────────

// Cor por TIPO de disparo, derivada do slug do template (que é estável) e não
// do nome da campanha (que o lojista escreve à mão e muda toda vez).
// Sem isso, "Oi Jose, faz um tempo que a gente não se fala" fica idêntico a uma
// mensagem escrita pela IA — e o vendedor não sabe se o cliente respondeu a um
// atendimento ou a um disparo em massa.
const CAMPANHA_CORES: Record<string, { bg: string; cor: string }> = {
  reativacao_cliente:  { bg: '#ede9fe', cor: '#6d28d9' },
  aniversario_cliente: { bg: '#fce7f3', cor: '#be185d' },
  feirao_de_carros:    { bg: '#ffedd5', cor: '#c2410c' },
  veiculo_disponivel:  { bg: '#dbeafe', cor: '#1d4ed8' },
  lembrete_visita:     { bg: '#ccfbf1', cor: '#0f766e' },
};
const CAMPANHA_PADRAO = { bg: '#e2e8f0', cor: '#475569' };

export type CampanhaInfo = { nome: string; template: string };

/**
 * Os "vistos" do WhatsApp, na mensagem que a loja mandou.
 *
 * Vale mais do que enfeite: distingue "o cliente está ignorando" de "ele nem
 * viu ainda" — e isso muda o que o vendedor faz a seguir. Sem status (mensagem
 * antiga, ou envio pelo provider que não devolve id) não mostra nada, em vez de
 * mostrar um estado falso.
 */
// Canal de origem. Só aparece quando NÃO é WhatsApp: marcar o canal
// majoritário em toda linha seria ruído — o que informa é a exceção.
const CANAIS: Record<string, { rotulo: string; cor: string; fundo: string }> = {
  instagram: { rotulo: 'Instagram', cor: '#c2410c', fundo: '#ffedd5' },
  messenger: { rotulo: 'Messenger', cor: '#1d4ed8', fundo: '#dbeafe' },
};

const CanalBadge = ({ canal }: { canal?: string | null }) => {
  const c = CANAIS[String(canal ?? '')];
  if (!c) return null;
  return (
    <span
      title={`Conversa veio do ${c.rotulo}`}
      style={{
        fontSize: '0.62rem', fontWeight: 700, padding: '1px 6px', borderRadius: 999,
        background: c.fundo, color: c.cor, flexShrink: 0,
      }}
    >
      {c.rotulo}
    </span>
  );
};

const VistoWhats = ({ status, erro }: { status: string | null; erro?: string | null }) => {
  if (!status) return null;

  if (status === 'failed') {
    // Sem o motivo da Meta o "!" nao ajuda ninguem: o lojista nao sabe se e
    // faturamento, janela de 24h ou numero invalido. Cada um tem conserto
    // diferente, e so o codigo da Meta distingue.
    return (
      <span
        title={erro ? `Falha no envio — ${erro}` : 'Falha no envio'}
        style={{ marginLeft: 5, color: '#dc2626', fontWeight: 700, cursor: 'help' }}
      >
        !
      </span>
    );
  }

  const lido = status === 'read';
  const duplo = status === 'delivered' || lido;
  return (
    <span
      title={lido ? 'Lida' : duplo ? 'Entregue' : 'Enviada'}
      style={{ marginLeft: 5, color: lido ? '#3b82f6' : 'rgba(0,0,0,0.4)', fontWeight: 700, letterSpacing: '-0.18em' }}
    >
      {duplo ? '✓✓' : '✓'}
    </span>
  );
};

// Nome amigável do envio ativo que não vem de campanha. A coluna guarda o
// código; a tela mostra o que o lojista reconhece.
const ROTULO_ENVIO_ATIVO: Record<string, string> = {
  lista_espera: 'Lista de espera',
  lembrete:     'Lembrete de visita',
  iniciada:     'Iniciada pela loja',
};

/**
 * Põe uma conversa na lista: substitui se já existe, insere se não, e reordena.
 *
 * POR QUE NÃO DÁ PRA SÓ EMPILHAR NO INSERT (queimou em 24/11):
 * o handler de INSERT fazia `[nova, ...prev]` sem checar. Num disparo, a loja
 * viu a MESMA pessoa três vezes na lista enquanto o banco tinha uma conversa
 * só — o evento chegou mais de uma vez e cada cópia virou uma linha. O handler
 * de mensagens já se protegia assim; o de conversas, não.
 *
 * E por que o UPDATE também passa por aqui: ele usava `.map`, que descarta
 * silenciosamente a linha que não está na lista. Conversa que recebeu UPDATE
 * sem estar carregada simplesmente não aparecia até alguém recarregar a tela.
 *
 * Idempotente de propósito: não importa quantas vezes o mesmo evento chegue,
 * nem em que ordem — perseguir o ciclo de vida da inscrição do realtime é bem
 * mais arriscado que deixar a aplicação do evento ser repetível.
 */
function aplicarConversa(prev: Conversation[], row: Conversation): Conversation[] {
  const existe = prev.some((c) => c.id === row.id);
  const lista = existe
    ? prev.map((c) => (c.id === row.id ? row : c))
    : [row, ...prev];
  return lista.sort((a, b) =>
    String(b.last_message_at ?? '').localeCompare(String(a.last_message_at ?? '')));
}

/**
 * Etiqueta do dia, igual à do WhatsApp: "Hoje", "Ontem", o dia da semana na
 * última semana, e a data cheia antes disso.
 *
 * Sem isto, a conversa é uma fita contínua onde só aparece a hora — e uma
 * mensagem das 14:30 pode ser de hoje ou de setembro. O vendedor não tem como
 * saber se "amanhã eu passo aí" foi dito ontem ou há dois meses.
 */
function rotuloDoDia(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  // Compara só a data, no fuso de quem está olhando: usar a diferença em
  // milissegundos erraria "ontem" para qualquer mensagem perto da meia-noite.
  const soData = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate());
  const dias = Math.round((soData(new Date()).getTime() - soData(d).getTime()) / 86400000);
  if (dias === 0) return 'Hoje';
  if (dias === 1) return 'Ontem';
  if (dias > 1 && dias < 7) {
    const s = d.toLocaleDateString('pt-BR', { weekday: 'long' });
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/** A data vira uma pílula centrada entre os balões, como no WhatsApp. */
const DivisorDeData = React.memo(function DivisorDeData({ rotulo }: { rotulo: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', margin: '14px 0 10px' }}>
      <span style={{
        fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.02em',
        padding: '3px 11px', borderRadius: 999,
        background: 'var(--bg-card)', color: 'var(--text-secondary)',
        border: '1px solid var(--border)', textTransform: 'uppercase',
      }}>
        {rotulo}
      </span>
    </div>
  );
});

/**
 * Um pedaço da mensagem em volta do termo buscado.
 *
 * Mostrar a mensagem inteira não serve: a resposta do bot tem parágrafos, e a
 * linha da lista tem ~250px. O que o vendedor precisa ver é a FRASE onde o
 * carro foi citado — é isso que diz se vale abrir a conversa.
 */
function trechoComTermo(texto: string, termo: string, volta = 34): string {
  const limpo = texto.replace(/\s+/g, ' ').trim();
  const i = limpo.toLowerCase().indexOf(termo.toLowerCase());
  if (i < 0) return limpo.slice(0, 90);
  const ini = Math.max(0, i - volta);
  const fim = Math.min(limpo.length, i + termo.length + volta * 2);
  return `${ini > 0 ? '…' : ''}${limpo.slice(ini, fim)}${fim < limpo.length ? '…' : ''}`;
}

/** Quantas variáveis {{n}} o corpo do template tem. */
function contarVariaveis(corpo: string | null | undefined): number {
  const achados = String(corpo ?? '').match(/\{\{(\d+)\}\}/g) ?? [];
  return achados.reduce((max, m) => Math.max(max, Number(m.replace(/\D/g, '')) || 0), 0);
}

const Bubble = React.memo(function Bubble({ msg, campanha }: { msg: Message; campanha?: CampanhaInfo }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const envioAtivo = String((msg as any).envio_ativo ?? '').trim();
  const isCustomer = msg.role === 'customer';
  const isBot      = msg.role === 'bot';
  const time = new Date(msg.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

  // Mensagem de mídia vira imagem de verdade: "[foto] url" (enviada pelo bot)
  // e "[imagem] url" com legenda na linha seguinte (enviada pelo cliente).
  // Antes o CRM mostrava a URL crua e o lojista tinha que copiar e colar no
  // navegador pra ver o que o cliente mandou.
  // Instruções internas pro modelo (blocos "(sistema: ...)") não são conversa —
  // são orientação nossa. Apareciam na tela do lojista, e chegaram a entrar num
  // vídeo enviado à Meta. O modelo continua recebendo: o corte é só na exibição.
  const semSistema = String(msg.content ?? '').replace(/\n?\(sistema:[\s\S]*?\)\s*$/i, '').trim();
  const mMidia = semSistema.match(/^\[(foto|imagem|audio)\]\s*(https?:\/\/\S+)([\s\S]*)$/i);
  const midia = mMidia
    ? {
        ehAudio: mMidia[1].toLowerCase() === 'audio',
        url:     mMidia[2],
        legenda: mMidia[3].trim(),
      }
    : null;
  const align: React.CSSProperties['justifyContent'] = isCustomer ? 'flex-start' : 'flex-end';

  // Cores explícitas para garantir contraste independente do tema
  // Cliente: fundo adapta ao tema (claro=branco, escuro=cinza), texto adapta
  // Bot/Atendente: fundo pastel fixo + texto ESCURO hardcoded (nunca herda branco do dark mode)
  const bgColor   = isCustomer ? 'var(--input-bg)' : isBot ? '#dcfce7' : '#dbeafe';
  const textColor = isCustomer ? 'var(--text-primary)' : '#0A0A0B';
  const timeColor = isCustomer ? 'var(--text-secondary)' : 'rgba(0,0,0,0.45)';
  const labelColor = isBot ? '#15803d' : '#1e40af';

  return (
    <div style={{ display: 'flex', justifyContent: align, marginBottom: 8 }}>
      <div style={{ maxWidth: '75%', background: bgColor, borderRadius: 12, padding: '8px 12px', boxShadow: '0 1px 2px rgba(0,0,0,0.06)' }}>
        {!isCustomer && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3, flexWrap: 'wrap' }}>
            {/* Envio ativo sem campanha (aviso da lista de espera) também é
                "Disparo" pro lojista: foi a loja falando primeiro, não o bot
                respondendo. Chamar de "Bot" faria parecer conversa automática
                e esconderia que alguém mandou aquilo de propósito. */}
            <span style={{ fontSize: '0.65rem', fontWeight: 700, color: labelColor }}>
              {(campanha || envioAtivo) ? 'Disparo' : isBot ? 'Bot' : 'Atendente'}
            </span>
            {!campanha && envioAtivo && (
              <span
                title="Aviso enviado pela loja, fora de campanha"
                style={{
                  fontSize: '0.62rem', fontWeight: 700, padding: '1px 7px', borderRadius: 999,
                  background: CAMPANHA_PADRAO.bg, color: CAMPANHA_PADRAO.cor,
                }}
              >
                {ROTULO_ENVIO_ATIVO[envioAtivo] ?? envioAtivo}
              </span>
            )}
            {campanha && (
              <span
                title={campanha.nome}
                style={{
                  fontSize: '0.62rem', fontWeight: 700, padding: '1px 7px', borderRadius: 999,
                  background: (CAMPANHA_CORES[campanha.template] ?? CAMPANHA_PADRAO).bg,
                  color: (CAMPANHA_CORES[campanha.template] ?? CAMPANHA_PADRAO).cor,
                }}
              >
                {campanha.nome}
              </span>
            )}
          </div>
        )}
        {midia ? (
          // Foto (do bot ou do cliente) vira imagem de verdade. Antes o CRM
          // mostrava a URL crua, e o lojista tinha que copiar e colar no
          // navegador pra ver o que o cliente mandou.
          <>
            {midia.ehAudio ? (
              // Áudio que o lojista mandou pelo celular. Guardamos o arquivo em
              // vez de transcrever — quem falou foi o próprio vendedor, então o
              // valor é ouvir, não ler. (Áudio do CLIENTE continua transcrito:
              // ali o bot precisa do texto.)
              <audio
                controls
                preload="none"
                src={midia.url}
                style={{ maxWidth: '100%', display: 'block' }}
              />
            ) : (
              <a href={midia.url} target="_blank" rel="noreferrer">
                <img
                  src={midia.url}
                  alt="anexo da conversa"
                  style={{ maxWidth: '100%', maxHeight: 260, borderRadius: 8, display: 'block' }}
                />
              </a>
            )}
            {midia.legenda && (
              <p style={{ margin: '6px 0 0', fontSize: '0.875rem', lineHeight: 1.4, whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: textColor }}>
                {midia.legenda}
              </p>
            )}
          </>
        ) : (
        <p style={{ margin: 0, fontSize: '0.875rem', lineHeight: 1.4, whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: textColor }}>
          {msg.transcribed_from_audio && (
            <span title="Mensagem recebida como áudio (transcrita)">
              <Mic size={13} style={{ display: 'inline', verticalAlign: '-2px', marginRight: 4, opacity: 0.6 }} />
            </span>
          )}
          {semSistema || msg.content}
        </p>
        )}
        <p style={{ margin: '4px 0 0', fontSize: '0.65rem', color: timeColor, textAlign: 'right' }}>
          {time}
          {!isCustomer && <VistoWhats status={msg.wa_status} erro={msg.wa_error} />}
        </p>
      </div>
    </div>
  );
});

// ─── Emoji list ───────────────────────────────────────────────────────────────

const EMOJIS = [
  '😀','😊','😂','🤣','😍','😎','🤔','😅','👍','👎',
  '🙏','💪','🤝','👋','🎉','❤️','🔥','⭐','✅','❌',
  '📞','📅','💰','🚗','🏍','🔑','📝','💬','⚡','✨',
  '🏆','👏','🥳','😬','😢','😡','🤩','🤑','🎯','🛠',
];

// ─── filter options ───────────────────────────────────────────────────────────

const FILTER_OPTIONS: Array<{ label: string; value: FilterValue }> = [
  { label: 'Todas',     value: '' },
  { label: 'Bot',       value: 'bot' },
  { label: 'Pendente',  value: 'pending' },
  { label: 'Humano',    value: 'human' },
  { label: 'Encerrada', value: 'closed' },
];

// ─── Conversations view ───────────────────────────────────────────────────────

export default function Conversations() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { user, session } = (useAppContext() as unknown) as AppCtxShape;
  const { dinheiro, numero, moeda, locale } = useDinheiro();

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [lastMessages, setLastMessages]   = useState<Record<string, Message>>({});

  // Rótulo de cada número da loja, pra dizer na lista por qual deles o cliente
  // falou. Só vale a pena mostrar quando existe mais de um — com um número só,
  // a etiqueta apareceria igual em toda linha e viraria ruído.
  const [rotulosNumero, setRotulosNumero] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!user?.id) return;
    let vivo = true;
    db.from('whatsapp_numbers')
      .select('phone_number_id, rotulo, numero')
      .eq('ativo', true)
      .then(({ data }: { data: Array<{ phone_number_id: string; rotulo: string | null; numero: string | null }> | null }) => {
        if (!vivo || !data || data.length < 2) return;
        const mapa: Record<string, string> = {};
        for (const n of data) {
          const nome = (n.rotulo ?? '').trim() || (n.numero ?? '').trim();
          if (nome) mapa[n.phone_number_id] = nome;
        }
        setRotulosNumero(mapa);
      });
    return () => { vivo = false; };
  }, [user?.id]);

  // Equipe cadastrada em Configurações. Serve pro seletor manual de atendente
  // — o mesmo cadastro que o webhook usa pra reconhecer a assinatura.
  const [equipe, setEquipe] = useState<string[]>([]);
  useEffect(() => {
    if (!user?.id) return;
    let vivo = true;
    db
      .from('company_settings')
      .select('team_members')
      .eq('user_id', user.id)
      .maybeSingle()
      .then(({ data }: { data: { team_members?: unknown } | null }) => {
        if (!vivo) return;
        const lista = Array.isArray(data?.team_members) ? data.team_members : [];

        const membros = lista
          .map((m: unknown) => (typeof m === 'string'
            ? { nome: m, funcao: '' }
            : { nome: String((m as { nome?: string })?.nome ?? ''), funcao: String((m as { funcao?: string })?.funcao ?? '') }))
          .filter((m) => m.nome.trim());

        // Só quem vende aparece pra ser escolhido: quem atende cliente é o
        // vendedor, não o mecânico nem o financeiro.
        //
        // A função é texto livre, então casa com o que a loja realmente
        // escreve — "Vendedor", "vendedora", "Consultor de vendas",
        // "Comercial". E se o filtro esvaziar a lista (loja que não preencheu
        // função, ou escreveu de um jeito que eu não previ), volta a equipe
        // inteira. Lista vazia seria pior que uma lista com um nome a mais:
        // impediria marcar qualquer pessoa.
        const ehVendedor = /vend|vendas|comercial|consultor/i;
        const vendedores = membros.filter((m) => ehVendedor.test(m.funcao));

        setEquipe((vendedores.length ? vendedores : membros).map((m) => m.nome.trim()));
      });
    return () => { vivo = false; };
  }, [user?.id]);

  // Quem atende esta conversa, escolhido à mão.
  //
  // Grava `atendente_auto: false` de propósito: a partir daí o webhook para de
  // sobrescrever. A pessoa que clicou sabe mais do que a heurística de
  // assinatura, e ser corrigida por um robô depois seria irritante.
  const definirAtendente = async (nome: string) => {
    if (!selectedId) return;
    const valor = nome.trim() || null;
    const { error } = await db
      .from('conversations')
      .update({ atendente: valor, atendente_em: new Date().toISOString(), atendente_auto: false })
      .eq('id', selectedId);
    if (error) { console.error('[Conversations] erro ao definir atendente', error); return; }
    setConversations((prev) => prev.map((c) => (c.id === selectedId ? { ...c, atendente: valor } as Conversation : c)));
  };
  const [selectedId, setSelectedId]       = useState<string | null>(null);
  const [messages, setMessages]           = useState<Message[]>([]);
  // id da campanha → nome + slug do template, pra etiquetar a bolha.
  const [campanhas, setCampanhas]         = useState<Record<string, CampanhaInfo>>({});
  const [loading, setLoading]             = useState(true);
  const [msgLoading, setMsgLoading]       = useState(false);
  const [sending, setSending]             = useState(false);
  const [agentInput, setAgentInput]       = useState('');
  const [filter, setFilter]               = useState<FilterValue>('');
  // Filtro de CANAL, separado do de status. Sao perguntas diferentes ("quem
  // precisa de mim?" e "como esta o Instagram?") e juntar num controle so
  // obrigaria a escolher entre elas.
  const [filtroCanal, setFiltroCanal]     = useState<string>('todos');
  // Filtro por NÚMERO, separado do de canal. A loja com dois números atende
  // duas frentes diferentes (loja e oficina, matriz e filial, dois vendedores)
  // e precisa ver uma de cada vez — misturar as duas na mesma lista é o que
  // torna a caixa confusa quando o segundo número entra.
  const [filtroNumero, setFiltroNumero]   = useState<string>('todos');
  // Aba "Disparos": separa quem chegou por campanha de quem veio por conta
  // própria. Mesma ideia das abas da Agenda — "Todas" é SUPERSET e continua
  // mostrando os disparos, a aba só filtra. Assim ninguém perde conversa por
  // não saber que a aba existe.
  //
  // Serve pra análise: resposta a disparo é um público com comportamento
  // diferente (chegou porque a loja chamou, não porque procurou), e misturado
  // com o orgânico não dá pra medir se a campanha converteu.
  // De onde veio a conversa. Três perguntas diferentes, não um booleano:
  // "todas", "a loja falou primeiro" e "o cliente clicou num anúncio".
  const [origem, setOrigem]               = useState<'todas' | 'disparos' | 'anuncio'>('todas');
  // Qual anúncio, quando a origem é anúncio. Vazio = todos.
  const [adEscolhido, setAdEscolhido]     = useState('');
  // conversation_id -> headline do anúncio que trouxe a pessoa.
  const [anuncioPorConversa, setAnuncioPorConversa] = useState<Map<string, string>>(new Map());

  // ── Nova conversa (a loja fala primeiro) ─────────────────────────────────
  const [novaAberta, setNovaAberta]   = useState(false);
  const [novoFone, setNovoFone]       = useState('');
  const [novoNome, setNovoNome]       = useState('');
  const [novoTexto, setNovoTexto]     = useState('');
  const [novoTplId, setNovoTplId]     = useState('');
  const [novoVars, setNovoVars]       = useState<Record<string, string>>({});
  const [templatesOk, setTemplatesOk] = useState<Array<{ id: string; display_name: string; body_text: string | null; header_type: string | null }>>([]);
  // null = ainda não sei (telefone curto). É diferente de 'fechada': mostrar o
  // seletor de template antes de saber faria a loja gastar template à toa.
  const [janela, setJanela]           = useState<'checando' | 'aberta' | 'fechada' | null>(null);
  const [enviandoNova, setEnviandoNova] = useState(false);
  const [erroNova, setErroNova]       = useState('');
  const [convsDeDisparo, setConvsDeDisparo] = useState<Set<string>>(new Set());
  const [searchRaw, setSearchRaw]         = useState('');
  const [search, setSearch]               = useState('');
  // Conversas achadas pelo TEXTO das mensagens, com o trecho que casou.
  // Separado do filtro de nome/telefone porque vem do servidor: as mensagens
  // não estão todas carregadas na tela (são 65 mil).
  const [achadosNaConversa, setAchadosNaConversa] = useState<Map<string, string>>(new Map());
  const [buscandoTexto, setBuscandoTexto] = useState(false);
  const [alertConvIds, setAlertConvIds]   = useState<Set<string>>(new Set());
  const [audioUnlocked, setAudioUnlocked] = useState(false);
  const [notifPerm,      setNotifPerm]      = useState<NotificationPermission>(
    'Notification' in window ? Notification.permission : 'denied',
  );
  // Permissao do navegador e inscricao de push sao COISAS DIFERENTES, e tratar
  // as duas como uma so foi o bug: quem concedeu permissao la atras, quando a
  // notificacao ainda era so na aba aberta, via "Notificacoes ativas" para
  // sempre e nunca chegava a se inscrever. O webhook disparava push para zero
  // aparelhos, sem erro nenhum em lugar nenhum.
  const [pushInscrito, setPushInscrito] = useState<boolean | null>(null);
  const [testandoPush, setTestandoPush] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [showEmoji, setShowEmoji] = useState(false);

  const messagesEndRef   = useRef<HTMLDivElement>(null);
  const emojiRef         = useRef<HTMLDivElement>(null);
  const conversationsRef = useRef<Conversation[]>([]);
  const selectedIdRef    = useRef<string | null>(null);
  // AudioContext criado na primeira interação do usuário para respeitar política de autoplay
  const audioCtxRef      = useRef<AudioContext | null>(null);
  const supabaseUrl      = import.meta.env.VITE_SUPABASE_URL as string;

  const selectedConv = conversations.find((c) => c.id === selectedId) ?? null;
  const pendingCount = useMemo(
    () => conversations.filter((c) => c.status === 'pending').length,
    [conversations],
  );

  // ── AudioContext: inicializa/resume na primeira interação ─────────────────

  useEffect(() => {
    const unlock = () => {
      setAudioUnlocked(true);
      if (!audioCtxRef.current) {
        try {
          const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
          audioCtxRef.current = new Ctx();
        } catch { return; }
      }
      if (audioCtxRef.current.state === 'suspended') {
        audioCtxRef.current.resume().catch(() => undefined);
      }
    };
    document.addEventListener('click', unlock, { once: true });
    document.addEventListener('keydown', unlock, { once: true });
    return () => {
      document.removeEventListener('click', unlock);
      document.removeEventListener('keydown', unlock);
    };
  }, []);

  const playDing = useCallback(() => {
    const ctx = audioCtxRef.current;
    if (!ctx) return;
    try {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 880;
      osc.type = 'sine';
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.5);
    } catch { /* ignora se AudioContext foi fechado */ }
  }, []);

  // ── Fecha emoji picker ao clicar fora ────────────────────────────────────
  useEffect(() => {
    if (!showEmoji) return;
    const handler = (e: MouseEvent) => {
      if (emojiRef.current && !emojiRef.current.contains(e.target as Node)) {
        setShowEmoji(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showEmoji]);

  // ── Search debounce (300ms) ──────────────────────────────────────────────
  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchRaw), 300);
    return () => clearTimeout(timer);
  }, [searchRaw]);

  /**
   * Busca dentro do TEXTO das mensagens.
   *
   * POR QUE NO SERVIDOR: a tela carrega só a última mensagem de cada conversa.
   * São 65 mil mensagens no banco (53 MB) — filtrar no navegador exigiria
   * baixar tudo. O `ilike` roda em ~60ms com varredura, medido, então não
   * precisa de índice ainda. Quando passar de uns 300 mil, é hora de um GIN
   * trigram em `content` (o `pg_trgm` já está instalado).
   *
   * Isolamento por loja NÃO depende de eu filtrar aqui: a política
   * `messages_select_own` do RLS exige que a conversa seja de `auth.uid()`.
   *
   * Mínimo de 3 letras: com uma ou duas, qualquer coisa casa e a lista
   * inteira "acha" — o resultado atrapalharia em vez de ajudar.
   */
  useEffect(() => {
    const termo = search.trim();
    if (termo.length < 3) { setAchadosNaConversa(new Map()); setBuscandoTexto(false); return; }

    let cancelado = false;
    setBuscandoTexto(true);
    (async () => {
      // `%` e `_` são curingas do LIKE; sem escapar, buscar "100%" viraria
      // "qualquer coisa". A vírgula quebraria a lista de argumentos do .or().
      const limpo = termo.replace(/[%_,]/g, ' ').trim();
      if (!limpo) { if (!cancelado) { setAchadosNaConversa(new Map()); setBuscandoTexto(false); } return; }

      const { data, error } = await db
        .from('messages')
        .select('conversation_id, content, created_at')
        .ilike('content', `%${limpo}%`)
        .order('created_at', { ascending: false })
        .limit(400);

      if (cancelado) return;
      setBuscandoTexto(false);
      if (error) { console.error('[Conversations] busca em mensagens:', error.message); return; }

      // Uma linha por conversa, a MAIS RECENTE (a consulta já vem ordenada):
      // quem perguntou do Corolla três vezes interessa uma vez só, e o trecho
      // útil é o último.
      const mapa = new Map<string, string>();
      for (const m of ((data ?? []) as Array<{ conversation_id: string; content: string | null }>)) {
        const id = String(m.conversation_id);
        if (mapa.has(id)) continue;
        mapa.set(id, trechoComTermo(String(m.content ?? ''), limpo));
      }
      setAchadosNaConversa(mapa);
    })();
    return () => { cancelado = true; };
  }, [search]);

  // ── Pending notification loop: toca ding a cada 5s enquanto houver conversas pendentes ──
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;
    if (pendingCount > 0 && audioUnlocked) {
      interval = setInterval(playDing, 5000);
    }
    return () => { if (interval) clearInterval(interval); };
  }, [pendingCount, audioUnlocked, playDing]);

  // Solicita permissão de notificação desktop na montagem
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().then(setNotifPerm);
    }
  }, []);

  // Mantém ref sincronizada para detectar transições no realtime
  useEffect(() => { conversationsRef.current = conversations; }, [conversations]);

  // Campanhas do tenant, uma vez. São poucas (dezenas) e mudam raro, então não
  // vale buscar por conversa aberta — carrega tudo e resolve em memória.
  useEffect(() => {
    if (!user?.id) return;
    let cancelado = false;
    (async () => {
      const { data } = await supabaseTyped
        .from('campaigns')
        .select('id, name, template:template_id(meta_template_name)')
        .eq('user_id', user.id);
      if (cancelado) return;
      const mapa: Record<string, CampanhaInfo> = {};
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const c of ((data ?? []) as any[])) {
        mapa[c.id] = { nome: c.name, template: c.template?.meta_template_name ?? '' };
      }
      setCampanhas(mapa);
    })();
    return () => { cancelado = true; };
  }, [user?.id]);

  // Quais conversas têm mensagem de disparo.
  //
  // Busca SEM filtro de loja de propósito: a RLS de `messages` já é
  // `exists(conversations c where c.id = conversation_id and c.user_id =
  // auth.uid())`, então o banco devolve só as desta loja. A alternativa era
  // mandar os ids das conversas no `in(...)` — com mil conversas, uma URL
  // gigante que o PostgREST recusa.
  //
  // Reexecuta quando a lista de conversas MUDA DE TAMANHO: disparo novo cria
  // conversa, então é esse o sinal barato de "pode ter disparo novo". Sem isso
  // a aba só atualizaria recarregando a página.
  useEffect(() => {
    if (!user?.id) return;
    let cancelado = false;
    (async () => {
      // Campanha OU envio ativo sem campanha (aviso da lista de espera).
      // Pro lojista as duas coisas são "a loja falou primeiro" — separar na
      // tela só o faria procurar o aviso numa aba que nunca ia mostrá-lo.
      const { data, error } = await supabaseTyped
        .from('messages')
        .select('conversation_id')
        .or('campaign_id.not.is.null,envio_ativo.not.is.null');
      if (cancelado) return;
      if (error) { console.error('[Conversations] disparos por conversa:', error.message); return; }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setConvsDeDisparo(new Set(((data ?? []) as any[]).map((m) => String(m.conversation_id))));
    })();
    return () => { cancelado = true; };
  }, [user?.id, conversations.length]);

  /**
   * Qual anúncio trouxe cada conversa.
   *
   * `ad_referrals` guarda isso desde 31/08 e a tela de Conversas nunca mostrou
   * — o vendedor abria o atendimento sem saber o que a pessoa tinha clicado.
   * É a informação mais útil que existe pra quem vai puxar assunto: quem veio
   * de "quero consignar meu veículo" quer VENDER o carro, e tratar como
   * comprador é começar errado.
   *
   * Uma linha por conversa: fica a PRIMEIRA (o anúncio que originou), não a
   * última — quem clicou em dois anúncios chegou pelo primeiro.
   */
  useEffect(() => {
    if (!user?.id) return;
    let cancelado = false;
    (async () => {
      const { data, error } = await db
        .from('ad_referrals')
        .select('conversation_id, headline, created_at')
        .not('conversation_id', 'is', null)
        .order('created_at', { ascending: true });
      if (cancelado) return;
      if (error) { console.error('[Conversations] ad_referrals:', error.message); return; }
      const mapa = new Map<string, string>();
      for (const r of ((data ?? []) as Array<{ conversation_id: string; headline: string | null }>)) {
        const id = String(r.conversation_id);
        if (mapa.has(id)) continue;                 // mantém o primeiro
        mapa.set(id, String(r.headline ?? '').trim() || '(sem título)');
      }
      setAnuncioPorConversa(mapa);
    })();
    return () => { cancelado = true; };
  }, [user?.id, conversations.length]);

  const deleteConversation = async () => {
    const id = confirmDeleteId;
    if (!id) return;
    setConfirmDeleteId(null);
    // Messages deletadas em cascade pelo Supabase (FK com ON DELETE CASCADE)
    await supabaseTyped.from('messages').delete().eq('conversation_id', id);
    await supabaseTyped.from('conversations').delete().eq('id', id);
    setConversations((prev) => prev.filter((c) => c.id !== id));
    if (selectedId === id) { setSelectedId(null); setMessages([]); }
  };

  // ── Enviar veículo do estoque ─────────────────────────────────────────────
  // Ao assumir a conversa o vendedor perdia a ferramenta que o bot tem: não
  // havia como mandar foto de carro pelo CRM, e ele acabava mandando pelo
  // celular — fora do histórico.
  const [showCarros, setShowCarros] = useState(false);
  const [carros, setCarros] = useState<Array<Record<string, unknown>>>([]);
  const [buscaCarro, setBuscaCarro] = useState('');
  const [enviandoCarro, setEnviandoCarro] = useState<string | null>(null);

  const [erroCarros, setErroCarros] = useState('');

  useEffect(() => {
    if (!showCarros || carros.length || !user?.id) return;
    let vivo = true;
    setErroCarros('');
    supabaseTyped
      .from('cars')
      // Sem filtro de status na query: carro cadastrado antes da coluna existir
      // fica com status NULL, e `eq('status','available')` o descarta em
      // silêncio — a lista vinha vazia e a tela dizia "carregando" pra sempre.
      // O filtro vai abaixo, no cliente, tratando NULL como disponível.
      // No banco a coluna e `mileage`; `km` so existe no mapeamento do AppContext.
      .select('id, brand, model, version, year, mileage, price, status')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (!vivo) return;
        // O erro precisa aparecer: engoli-lo foi o que transformou uma falha de
        // consulta em spinner eterno.
        if (error) { setErroCarros(error.message); setCarros([]); return; }
        // Fora: vendido e ARQUIVADO. O arquivado não está no pátio — mandar a
        // foto dele pro cliente marca uma visita pra ver um carro que não
        // existe ali. NULL continua passando (carro cadastrado antes da coluna).
        const lista = (data ?? []).filter((c) => {
          const st = (c as { status?: string }).status;
          return st !== 'sold' && st !== 'arquivado';
        });
        setCarros(lista as Array<Record<string, unknown>>);
        if (!lista.length) setErroCarros('Nenhum veículo disponível no estoque.');
      });
    return () => { vivo = false; };
  }, [showCarros, carros.length, user?.id]);

  // Manda a lista inteira que está no seletor, em texto, sem foto.
  //
  // Para o lojista que atende pelo CRM e NÃO tem bot: em vez de escolher um
  // carro de cada vez, manda o que tem e deixa o cliente apontar. Usa o mesmo
  // envio de atendente, então vale a janela de 24h como qualquer texto livre.
  const enviarListaDeCarros = async () => {
    if (!selectedId || !session?.access_token) return;
    const visiveis = carros.filter((c) => {
      const t = `${c.brand} ${c.model} ${(c as { version?: string }).version ?? ''}`.toLowerCase();
      return t.includes(buscaCarro.toLowerCase().trim());
    });
    if (!visiveis.length) return;

    const texto = estoqueEmTexto(visiveis, { moeda, locale });
    if (!texto) return;

    setEnviandoCarro('lista');
    try {
      const res = await fetch(`${supabaseUrl}/functions/v1/send-agent-message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ conversation_id: selectedId, text: texto }),
      });
      if (!res.ok) { console.error('[Conversations] falha ao enviar a lista'); return; }
      setShowCarros(false); setBuscaCarro('');
      await fetchMessages(selectedId);
    } catch (e) {
      console.error('[Conversations] erro de rede ao enviar a lista:', e);
    } finally {
      setEnviandoCarro(null);
    }
  };

  const enviarCarro = async (carId: string) => {
    if (!selectedId || !session?.access_token) return;
    setEnviandoCarro(carId);
    try {
      const res = await fetch(`${supabaseUrl}/functions/v1/send-agent-message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ conversation_id: selectedId, car_id: carId }),
      });
      if (!res.ok) { console.error('[Conversations] falha ao enviar veículo'); return; }
      setShowCarros(false); setBuscaCarro('');
      // O realtime traz as mensagens; recarrega como rede de segurança porque
      // são várias (ficha + fotos + vídeo) e uma pode chegar fora de ordem.
      await fetchMessages(selectedId);
    } catch (e) {
      console.error('[Conversations] erro de rede ao enviar veículo:', e);
    } finally {
      setEnviandoCarro(null);
    }
  };

  // Registra ESTE aparelho para receber push. Idempotente: chamar de novo com o
  // aparelho ja inscrito so revalida a linha.
  const inscreverAparelho = useCallback(async (): Promise<boolean> => {
    if (!user?.id) return false;
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false;
    try {
      const reg = await navigator.serviceWorker.ready;
      const existente = await reg.pushManager.getSubscription();
      const sub = existente ?? await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64UrlParaBytes(VAPID_PUBLIC),
      });
      const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
      if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return false;

      // onConflict no endpoint: reinstalar ou reativar no mesmo aparelho
      // atualiza a linha em vez de criar outra e notificar em duplicidade.
      const { error } = await supabaseTyped.from('push_subscriptions').upsert({
        user_id: user.id,
        endpoint: json.endpoint,
        p256dh: json.keys.p256dh,
        auth: json.keys.auth,
        user_agent: navigator.userAgent.slice(0, 200),
      } as never, { onConflict: 'endpoint' });

      if (error) {
        // Antes esse erro era engolido: o navegador ficava inscrito, o banco
        // vazio, e a tela dizia que estava tudo certo.
        console.warn('[push] o aparelho assinou mas o registro falhou:', error.message);
        return false;
      }
      return true;
    } catch (e) {
      // Nao pode quebrar a tela: sem push o CRM segue funcionando normalmente.
      console.warn('[push] nao foi possivel inscrever este aparelho:', e);
      return false;
    }
  }, [user?.id]);

  const requestNotifPermission = async () => {
    if (!('Notification' in window)) return;
    const perm = await Notification.requestPermission();
    setNotifPerm(perm);
    if (perm !== 'granted') { setPushInscrito(false); return; }
    setPushInscrito(await inscreverAparelho());
  };

  // Permissao ja concedida significa que o lojista JA disse sim. Registrar o
  // aparelho sozinho e o que ele espera que aconteca — esperar um segundo
  // clique num botao que diz "ativas" e esperar por algo que nunca vem.
  useEffect(() => {
    if (!user?.id || notifPerm !== 'granted') { setPushInscrito(false); return; }
    let vivo = true;
    inscreverAparelho().then((ok) => { if (vivo) setPushInscrito(ok); });
    return () => { vivo = false; };
  }, [user?.id, notifPerm, inscreverAparelho]);

  // Teste de verdade: sai daqui, passa pelo servidor, pela Google/Apple e volta
  // no aparelho. O teste antigo usava `new Notification()`, que so provava que a
  // aba aberta consegue desenhar um balao — exatamente o que induziu todo mundo
  // a achar que estava funcionando.
  const testarPushReal = async () => {
    if (!user?.id) return;
    setTestandoPush(true);
    try {
      // Diagnostico junto do teste. Cada resposta "nao chegou" custava um ciclo
      // de ida e volta pra descobrir QUAL elo falhou; aqui os cinco elos
      // aparecem de uma vez, e o principal e o numero de inscricoes salvas: se
      // for 0, o aparelho nunca se registrou e o resto nem importa.
      const linhas: string[] = [];
      linhas.push(`Conta: ${user.id}`);
      linhas.push(`Permissao do navegador: ${typeof Notification !== 'undefined' ? Notification.permission : 'sem suporte'}`);

      let temSW = false, temSub = false;
      try {
        const reg = await navigator.serviceWorker.getRegistration();
        temSW = Boolean(reg);
        if (reg) temSub = Boolean(await reg.pushManager.getSubscription());
      } catch { /* sem suporte */ }
      linhas.push(`Service worker: ${temSW ? 'registrado' : 'NAO registrado'}`);
      linhas.push(`Assinatura no navegador: ${temSub ? 'sim' : 'NAO'}`);

      // Lista os aparelhos, nao so conta. "3 enviados" parece sucesso mas nao
      // diz QUAIS tres — e no iPhone o push so existe dentro do app instalado
      // na tela de inicio. Tres assinaturas de desktop com o iPhone de fora dao
      // exatamente esse numero e nenhuma notificacao no bolso do lojista.
      const { data: aparelhos } = await supabaseTyped
        .from('push_subscriptions')
        .select('user_agent, endpoint')
        .eq('user_id', user.id);

      const lista = (aparelhos ?? []) as Array<{ user_agent: string | null; endpoint: string | null }>;
      linhas.push(`Aparelhos salvos no banco: ${lista.length}`);
      lista.forEach((a, i) => {
        const ua = String(a.user_agent ?? '');
        const tipo = /iPhone|iPad/i.test(ua) ? 'iPHONE'
          : /Android/i.test(ua) ? 'Android'
          : /Macintosh/i.test(ua) ? 'Mac'
          : /Windows/i.test(ua) ? 'Windows' : 'outro';
        const servico = /apple/i.test(String(a.endpoint)) ? 'Apple'
          : /fcm|google/i.test(String(a.endpoint)) ? 'Google' : '?';
        linhas.push(`  ${i + 1}. ${tipo} via ${servico}`);
      });
      if (!lista.some((a) => /iPhone|iPad/i.test(String(a.user_agent)))) {
        linhas.push('  >> Nenhum iPhone registrado. Abra o app pela tela de inicio do iPhone.');
      }

      const { data: { session } } = await supabaseTyped.auth.getSession();
      const r = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-push`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token ?? ''}` },
        body: JSON.stringify({
          user_id: user.id,
          titulo: 'Teste do Amply',
          corpo: 'Se você está vendo isto, o push está funcionando.',
          url: '/conversas',
        }),
      });
      const j = await r.json();
      linhas.push(`Servidor: HTTP ${r.status} · enviados ${j.enviados ?? 0} de ${j.total ?? 0}`);
      if (j.subjectOk === false) linhas.push('  >> VAPID_SUBJECT invalido (a Apple recusa, a Google aceita)');
      (j.detalhes ?? []).forEach((d: Record<string, unknown>, i: number) => {
        linhas.push(d.ok
          ? `  envio ${i + 1}: ${d.servico} OK`
          : `  envio ${i + 1}: ${d.servico} FALHOU status=${d.status} ${String(d.erro ?? '').slice(0, 90)}`);
      });

      // TESTE LOCAL, sem passar pelo servidor. Separa duas coisas que eu vinha
      // tratando como uma: o service worker consegue DESENHAR uma notificação?
      // e o push CHEGA até ele?
      //
      // Local aparece e a do servidor não → o problema é entrega ou
      // descriptografia do payload. Nem a local aparece → é permissão ou o
      // próprio registro, e nenhuma correção no servidor resolveria.
      try {
        const reg = await navigator.serviceWorker.getRegistration();
        if (reg) {
          await reg.showNotification('Teste LOCAL do Amply', {
            body: 'Esta veio direto do aparelho, sem passar pelo servidor.',
            data: { url: '/conversas' },
          });
          linhas.push('Notificação local: disparada (deve aparecer agora)');
        } else {
          linhas.push('Notificação local: SEM service worker registrado');
        }
      } catch (e) {
        linhas.push(`Notificação local: FALHOU — ${(e as Error).message}`);
      }

      // Historico das tentativas REAIS, gravadas pelo servidor (066). E o que
      // separa "o webhook nao chamou" de "chamou e nao havia aparelho": a
      // primeira nao deixa linha nenhuma aqui, a segunda deixa com enviados=0.
      const { data: tentativas } = await supabaseTyped
        .from('push_log')
        .select('origem, enviados, total, detalhe, created_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(5);

      const hist = (tentativas ?? []) as Array<Record<string, unknown>>;
      linhas.push(`Últimas tentativas registradas: ${hist.length}`);
      hist.forEach((t) => {
        const hora = String(t.created_at ?? '').slice(11, 19);
        linhas.push(`  ${hora} ${t.origem} → ${t.enviados}/${t.total}`);
      });
      if (!hist.some((t) => t.origem === 'webhook')) {
        linhas.push('  >> NENHUMA tentativa vinda do webhook. Ele não está chamando.');
      }

      const texto = linhas.join('\n');
      console.log('[push] diagnostico\n' + texto);
      alert(
        (j.enviados
          ? `Enviado para ${j.enviados} aparelho(s). Feche o app e aguarde alguns segundos.`
          : 'NAO foi enviado para nenhum aparelho.')
        + '\n\n--- diagnóstico ---\n' + texto,
      );
    } catch (e) {
      alert(`Erro ao testar: ${(e as Error).message}`);
    } finally {
      setTestandoPush(false);
    }
  };

  const testNotification = () => {
    if (!('Notification' in window)) { alert('Este navegador não suporta notificações.'); return; }
    if (Notification.permission !== 'granted') { alert('Permissão não concedida. Clique em "Ativar Notificações" primeiro.'); return; }
    new Notification('Teste', { body: 'Funcionou! As notificações estão ativas.' });
    playDing();
  };

  // ── fetch helpers ─────────────────────────────────────────────────────────

  const fetchConversations = useCallback(async (signal?: AbortSignal) => {
    if (!user?.id) { setLoading(false); return; }
    // Watchdog de 10s: se a query travar (ex.: refresh de sessão preso), aborta
    // pra não deixar o spinner girando pra sempre. O polling de 8s re-tenta depois.
    const watchdog = new AbortController();
    const timer = setTimeout(() => watchdog.abort(), 10_000);
    if (signal) signal.addEventListener('abort', () => watchdog.abort(), { once: true });
    try {
      const { data, error } = await supabaseTyped
        .from('conversations')
        .select('*')
        .eq('user_id', user.id)
        .order('last_message_at', { ascending: false })
        .abortSignal(watchdog.signal);
      if (signal?.aborted) return;
      if (error) throw error;
      setConversations(data ?? []);
    } catch (e) {
      if (signal?.aborted) return; // caller cancelou (unmount / troca de user)
      if ((e as { name?: string })?.name === 'AbortError') { // watchdog estourou
        console.warn('[Conversations] fetch travou (>10s) — sessão presa? polling re-tentará.');
        return;
      }
      console.error('[Conversations] fetchConversations:', e);
    } finally {
      clearTimeout(timer);
      // Solta o spinner exceto quando foi o caller que abortou (vai re-buscar).
      if (!signal?.aborted) setLoading(false);
    }
  }, [user?.id]);

  const fetchLastMessages = useCallback(async (convIds: string[]) => {
    if (!convIds.length) return;
    // Limit agressivo: apenas as colunas necessárias e no máximo 3× o nº de conversas
    const { data } = await supabaseTyped
      .from('messages')
      .select('id, conversation_id, role, content, wa_message_id, transcribed_from_audio, campaign_id, wa_status, wa_error, created_at')
      .in('conversation_id', convIds)
      .order('created_at', { ascending: false })
      .limit(Math.max(convIds.length * 3, 60));
    if (!data) return;
    const map: Record<string, Message> = {};
    for (const msg of data) {
      if (!map[msg.conversation_id]) map[msg.conversation_id] = msg;
    }
    setLastMessages(map);
  }, []);

  const fetchMessages = useCallback(async (convId: string, signal?: AbortSignal) => {
    setMsgLoading(true);
    try {
      let query = supabaseTyped
        .from('messages')
        .select('*')
        .eq('conversation_id', convId)
        .order('created_at', { ascending: true });
      if (signal) query = query.abortSignal(signal);
      const { data } = await query;
      if (signal?.aborted) return;
      setMessages(data ?? []);
    } catch (e) {
      if (signal?.aborted || (e as { name?: string })?.name === 'AbortError') return;
      console.error('[Conversations] fetchMessages:', e);
    } finally {
      if (!signal?.aborted) setMsgLoading(false);
    }
  }, []);

  // Refresh silencioso (sem spinner) — usado pelo polling de fallback
  const refreshMessages = useCallback(async (convId: string) => {
    const { data } = await supabaseTyped
      .from('messages')
      .select('*')
      .eq('conversation_id', convId)
      .order('created_at', { ascending: true });
    if (!data) return;
    setMessages((prev) => {
      // Preserva mensagens otimistas ainda não refletidas no servidor
      const optimistic = prev.filter(
        (m) => m.id.startsWith('opt-') && !data.some((d) => d.role === m.role && d.content === m.content),
      );
      const merged = [...data, ...optimistic];
      // Evita re-render se nada mudou (mesma quantidade e mesma última msg)
      if (merged.length === prev.length && merged[merged.length - 1]?.id === prev[prev.length - 1]?.id) {
        return prev;
      }
      return merged;
    });
  }, []);

  // ── effects ───────────────────────────────────────────────────────────────

  useEffect(() => {
    const controller = new AbortController();
    fetchConversations(controller.signal);
    return () => controller.abort();
  }, [fetchConversations]);

  useEffect(() => {
    if (conversations.length) fetchLastMessages(conversations.map((c) => c.id));
  }, [conversations.length, fetchLastMessages]);

  useEffect(() => {
    selectedIdRef.current = selectedId;
    if (!selectedId) { setMessages([]); return; }
    const controller = new AbortController();
    fetchMessages(selectedId, controller.signal);
    return () => controller.abort();
  }, [selectedId, fetchMessages]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  // ── Polling de fallback + refetch ao focar a aba ──────────────────────────
  // Garante que as conversas e mensagens atualizem mesmo se o realtime cair.
  useEffect(() => {
    if (!user?.id) return;

    const refreshList = () => {
      console.log('[poll] refreshList rodando @', new Date().toLocaleTimeString());
      fetchConversations();
      const ids = conversationsRef.current.map((c) => c.id);
      if (ids.length) fetchLastMessages(ids);
    };

    // Lista de conversas a cada 8s; mensagens da conversa aberta a cada 4s
    const listInterval = setInterval(refreshList, 8000);
    const msgInterval = setInterval(() => {
      if (selectedIdRef.current) {
        console.log('[poll] refreshMessages rodando @', new Date().toLocaleTimeString());
        refreshMessages(selectedIdRef.current);
      }
    }, 4000);

    // Ao voltar o foco para a aba (ou trocar de aba), atualiza na hora
    const onFocus = () => {
      if (document.visibilityState === 'hidden') return;
      refreshList();
      if (selectedIdRef.current) refreshMessages(selectedIdRef.current);
    };
    document.addEventListener('visibilitychange', onFocus);
    window.addEventListener('focus', onFocus);

    return () => {
      clearInterval(listInterval);
      clearInterval(msgInterval);
      document.removeEventListener('visibilitychange', onFocus);
      window.removeEventListener('focus', onFocus);
    };
  }, [user?.id, fetchConversations, fetchLastMessages, refreshMessages]);

  const selectConversation = useCallback((id: string) => {
    setSelectedId(id);
    setAlertConvIds((prev) => { const s = new Set(prev); s.delete(id); return s; });
  }, []);

  // ── realtime: conversations ───────────────────────────────────────────────

  useEffect(() => {
    if (!user?.id) return;
    const uid = user.id;

    const channel = supabaseTyped
      .channel(`conv-list-${uid}-${Math.random().toString(36).slice(2)}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'conversations', filter: `user_id=eq.${uid}` },
        (payload) => {
          const { eventType } = payload;
          console.log('[RT conversations] evento recebido:', eventType);
          if (eventType === 'INSERT') {
            const added = payload.new as Conversation;
            setConversations((prev) => aplicarConversa(prev, added));
          } else if (eventType === 'UPDATE') {
            const updated = payload.new as Conversation;

            // Atualiza preview da última mensagem para esta conversa
            supabaseTyped
              .from('messages')
              .select('id, conversation_id, role, content, wa_message_id, created_at')
              .eq('conversation_id', updated.id)
              .order('created_at', { ascending: false })
              .limit(1)
              .maybeSingle()
              .then(({ data }) => {
                if (data) setLastMessages((prev) => ({ ...prev, [updated.id]: data as Message }));
              });

            // Dispara alerta quando status muda para 'pending'
            const prevConv = conversationsRef.current.find((c) => c.id === updated.id);
            if (prevConv && prevConv.status !== 'pending' && updated.status === 'pending') {
              const convId = updated.id;
              const name   = updated.customer_name ?? updated.customer_phone;
              if ('Notification' in window && Notification.permission === 'granted') {
                const notif = new Notification(`${name} precisa de atendimento!`, {
                  body: 'Clique para abrir a conversa',
                  tag: `handoff-${convId}`,
                  requireInteraction: true,
                });
                notif.onclick = () => { window.focus(); selectConversation(convId); notif.close(); };
              }
              playDing();
              setAlertConvIds((prev) => new Set([...prev, convId]));
            }

            setConversations((prev) => aplicarConversa(prev, updated));
          } else if (eventType === 'DELETE') {
            const removed = payload.old as { id: string };
            setConversations((prev) => prev.filter((c) => c.id !== removed.id));
          }
        },
      )
      .subscribe((status, err) => {
        console.log('[RT conversations] status:', status, err ? `| err: ${err.message}` : '');
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          fetchConversations();
        }
      });

    return () => { supabaseTyped.removeChannel(channel); };
  }, [user?.id, playDing, selectConversation, fetchConversations]);

  // ── realtime: messages for selected conversation ──────────────────────────

  useEffect(() => {
    if (!selectedId) return;

    const channel = supabaseTyped
      .channel(`msgs-${selectedId}-${Math.random().toString(36).slice(2)}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${selectedId}` },
        (payload) => {
          const newMsg = payload.new as Message;
          console.log('[RT messages] INSERT recebido:', newMsg.id, newMsg.role);
          setMessages((prev) => {
            // Remove mensagem otimista correspondente, depois adiciona a real
            const withoutOptimistic = prev.filter(
              (m) => !(m.id.startsWith('opt-') && m.role === newMsg.role && m.content === newMsg.content),
            );
            return withoutOptimistic.some((m) => m.id === newMsg.id)
              ? withoutOptimistic
              : [...withoutOptimistic, newMsg];
          });
          setLastMessages((prev) => ({ ...prev, [selectedId]: newMsg }));
        },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'messages', filter: `conversation_id=eq.${selectedId}` },
        (payload) => {
          const updated = payload.new as Message;
          console.log('[RT messages] UPDATE recebido:', updated.id);
          setMessages((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
          setLastMessages((prev) => (prev[selectedId]?.id === updated.id ? { ...prev, [selectedId]: updated } : prev));
        },
      )
      .subscribe((status, err) => {
        console.log('[RT messages] status:', status, 'conv:', selectedId, err ? `| err: ${err.message}` : '');
        // Se o canal cair, refaz o fetch para não perder mensagens
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          refreshMessages(selectedId);
        }
      });

    return () => { supabaseTyped.removeChannel(channel); };
  }, [selectedId, refreshMessages]);

  // ── actions ───────────────────────────────────────────────────────────────

  // Perguntar quem assumiu — uma vez por conversa.
  //
  // A escolha manual no seletor existe pra conversa que nunca passou pelo bot,
  // mas depender dela é depender de alguém lembrar. Aqui a pergunta vem no
  // único momento em que a pessoa JÁ está agindo sobre a conversa.
  //
  // Só quando ainda não há atendente: devolver pro bot e assumir de novo não
  // reabre o pop-up. Perguntar duas vezes a mesma coisa é o caminho mais curto
  // pra alguém começar a fechar sem ler.
  const [perguntandoQuem, setPerguntandoQuem] = useState(false);

  const takeOver = async () => {
    if (!selectedId) return;
    const conv = conversations.find((c) => c.id === selectedId);
    const semAtendente = !String((conv as { atendente?: string | null })?.atendente ?? '').trim();

    // Assume PRIMEIRO, pergunta depois. O que urge é o bot parar de responder;
    // segurar isso atrás de um pop-up faria o bot falar por cima do vendedor
    // enquanto ele escolhe o próprio nome.
    const { error } = await supabaseTyped
      .from('conversations').update({ status: 'human' }).eq('id', selectedId);
    if (error) return;
    setConversations((prev) => prev.map((c) => c.id === selectedId ? { ...c, status: 'human' } : c));

    if (semAtendente && equipe.length > 0) setPerguntandoQuem(true);
  };

  const returnToBot = async () => {
    if (!selectedId) return;
    const { error } = await supabaseTyped
      .from('conversations').update({ status: 'bot' }).eq('id', selectedId);
    if (!error) setConversations((prev) => prev.map((c) => c.id === selectedId ? { ...c, status: 'bot' } : c));
  };

  /**
   * Encerrar / reabrir — arquiva a conversa, SEM calar o bot.
   *
   * ── Encerrada não é conversa muda, e isso é de propósito ──────────────────
   *
   * O bot fica mudo em `human` e `pending`. `closed` NÃO entra nessa lista: se
   * o cliente escrever de novo, o webhook devolve a conversa pro bot e ela
   * reabre sozinha, como ticket de helpdesk.
   *
   * A escolha é por assimetria de risco, não por preguiça. Se algum caminho
   * falhar em reabrir, o pior caso deste desenho é o bot atender uma conversa
   * que a loja tinha arquivado — chato, e visível. Se `closed` calasse o bot, o
   * pior caso seria cliente escrevendo e ninguém vendo: já aconteceu duas vezes
   * neste sistema, em outubro, e nas duas sem gerar erro nenhum. Silêncio é o
   * modo de falha mais caro deste produto.
   *
   * De graça junto: a view `conversas_para_followup` exige `bot` ou `human`,
   * então encerrar também para o follow-up. "Encerrei, não manda mais nada"
   * funciona sem código novo.
   */
  const encerrarConversa = async () => {
    if (!selectedId) return;
    const { error } = await supabaseTyped
      .from('conversations').update({ status: 'closed' }).eq('id', selectedId);
    if (error) return;
    setConversations((prev) => prev.map((c) => c.id === selectedId ? { ...c, status: 'closed' } : c));
    // Sai da vista: com o filtro em "Todas" a encerrada não aparece mais, e
    // manter o painel aberto numa conversa que saiu da lista confunde.
    setSelectedId(null);
  };

  const reabrirConversa = async () => {
    if (!selectedId) return;
    const { error } = await supabaseTyped
      .from('conversations').update({ status: 'bot' }).eq('id', selectedId);
    if (!error) setConversations((prev) => prev.map((c) => c.id === selectedId ? { ...c, status: 'bot' } : c));
  };

  // ── Nova conversa ────────────────────────────────────────────────────────

  const fecharNova = () => {
    setNovaAberta(false);
    setNovoFone(''); setNovoNome(''); setNovoTexto('');
    setNovoTplId(''); setNovoVars({}); setJanela(null); setErroNova('');
  };

  // Só os aprovados. Template pendente ou recusado na lista seria um convite
  // pra escolher o que a Meta vai rejeitar — e a recusa não aparece na tela.
  useEffect(() => {
    if (!novaAberta || !user?.id) return;
    let cancelado = false;
    (async () => {
      const { data, error } = await db
        .from('message_templates')
        .select('id, display_name, body_text, header_type')
        .eq('user_id', user.id)
        .eq('status', 'approved')
        .order('display_name');
      if (cancelado) return;
      if (error) { console.error('[Conversations] templates:', error.message); return; }
      setTemplatesOk((data ?? []) as typeof templatesOk);
    })();
    return () => { cancelado = true; };
  }, [novaAberta, user?.id]);

  /**
   * A janela de 24h decide tudo nesta tela.
   *
   * Dentro dela, texto livre é entregue e é de graça. Fora dela, a Meta só
   * entrega template — e texto livre fora da janela devolve SUCESSO na API e
   * simplesmente não chega. Por isso a tela pergunta isto antes de oferecer o
   * campo de escrever: um textarea mostrado na hora errada é uma mensagem
   * perdida sem aviso.
   *
   * A janela conta da última mensagem DO CLIENTE, não de `last_message_at`
   * (que inclui as nossas).
   */
  useEffect(() => {
    if (!novaAberta) return;
    const digitos = novoFone.replace(/\D/g, '');
    if (digitos.length < 10) { setJanela(null); return; }

    setJanela('checando');
    let cancelado = false;
    const t = setTimeout(async () => {
      // Casa pelos 8 últimos dígitos: o mesmo número aparece com e sem o nono
      // dígito e com ou sem o 55, e comparar literal abriria conversa nova pra
      // cliente que já existe.
      const cauda = digitos.slice(-8);
      const conv = conversations.find(
        (c) => String(c.customer_phone ?? '').replace(/\D/g, '').slice(-8) === cauda,
      );
      if (!conv) { if (!cancelado) setJanela('fechada'); return; }

      const { data } = await db
        .from('messages')
        .select('created_at')
        .eq('conversation_id', conv.id)
        .eq('role', 'customer')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (cancelado) return;

      const quando = data?.created_at ? Date.parse(String(data.created_at)) : NaN;
      const horas = Number.isFinite(quando) ? (Date.now() - quando) / 3600000 : Infinity;
      setJanela(horas >= 0 && horas < 23 ? 'aberta' : 'fechada');
      if (!novoNome && conv.customer_name) setNovoNome(String(conv.customer_name));
    }, 450);

    return () => { cancelado = true; clearTimeout(t); };
    // `conversations.length` e não a lista: a referência muda a cada realtime,
    // e depender dela refaria a consulta a cada mensagem que chega.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [novaAberta, novoFone, conversations.length]);

  const tplEscolhido = templatesOk.find((t) => t.id === novoTplId) ?? null;
  const qtdVars = contarVariaveis(tplEscolhido?.body_text);

  // Pré-visualização do que o CLIENTE vai ler. É o que impede template sair com
  // "{{3}}" no meio da frase: o vendedor vê antes de mandar.
  const previaTemplate = useMemo(() => {
    let t = String(tplEscolhido?.body_text ?? '');
    for (let i = 1; i <= qtdVars; i++) {
      // split/join e não replaceAll: `replaceAll` não está no lib do tsconfig
      // deste projeto, e com padrão literal os dois fazem a mesma coisa — sem
      // o risco de escapar chaves num regex.
      t = t.split(`{{${i}}}`).join(novoVars[String(i)] || `{{${i}}}`);
    }
    return t;
  }, [tplEscolhido?.body_text, qtdVars, novoVars]);

  const enviarNovaConversa = async () => {
    if (!session?.access_token) return;
    setEnviandoNova(true);
    setErroNova('');
    try {
      const r = await fetch(`${supabaseUrl}/functions/v1/iniciar-conversa`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          phone: novoFone.replace(/\D/g, ''),
          name: novoNome,
          ...(janela === 'aberta'
            ? { texto: novoTexto }
            : { template_id: novoTplId, variaveis: novoVars }),
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j?.error) {
        setErroNova(String(j?.error ?? `Falhou (HTTP ${r.status})`));
        return;
      }
      fecharNova();
      // Recarrega pra conversa nova aparecer já na lista, com a mensagem.
      await fetchConversations();
    } catch (e) {
      setErroNova(e instanceof Error ? e.message : String(e));
    } finally {
      setEnviandoNova(false);
    }
  };

  const sendAgentMessage = async () => {
    const text = agentInput.trim();
    if (!text || !selectedId || !session?.access_token) return;
    setSending(true);
    setAgentInput('');

    // Optimistic update: aparece imediatamente, substituído pelo real quando realtime chegar
    const optimisticId = `opt-${Date.now()}`;
    const optimisticMsg: Message = {
      id: optimisticId,
      conversation_id: selectedId,
      role: 'agent',
      content: text,
      wa_message_id: null,
      transcribed_from_audio: false,
      campaign_id: null,
      wa_status: null,
      wa_error: null,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimisticMsg]);

    try {
      const res = await fetch(`${supabaseUrl}/functions/v1/send-agent-message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ conversation_id: selectedId, text }),
      });
      if (!res.ok) {
        console.error('[Conversations] Erro ao enviar mensagem');
        setMessages((prev) => prev.filter((m) => m.id !== optimisticId));
        setAgentInput(text);
      }
    } catch (e) {
      console.error('[Conversations] Erro de rede:', e);
      setMessages((prev) => prev.filter((m) => m.id !== optimisticId));
      setAgentInput(text);
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendAgentMessage(); }
  };

  // Quantos canais a loja realmente usa. Mostrar o filtro numa loja que só tem
  // WhatsApp seria oferecer uma escolha que não existe.
  // Números que REALMENTE aparecem nas conversas, não os cadastrados. Loja que
  // conectou um segundo número ontem e ainda não recebeu nada por ele não
  // precisa de filtro — seria um botão que não muda nada.
  const numerosUsados = [...new Set(
    conversations
      .map((c) => String((c as { phone_number_id?: string | null }).phone_number_id ?? ''))
      .filter(Boolean),
  )];

  const temMaisDeUmCanal = new Set(
    conversations.map((c) => String((c as { channel?: string }).channel ?? 'whatsapp')),
  ).size > 1;

  // ── filtered list ─────────────────────────────────────────────────────────

  // Quantas conversas vieram de disparo, dentro do que os OUTROS filtros já
  // deixaram passar — senão a aba anunciaria 174 e mostraria 3 com o filtro de
  // canal ligado.
  const totalDisparos = conversations.filter((c) => convsDeDisparo.has(c.id)).length;
  const totalAnuncio  = conversations.filter((c) => anuncioPorConversa.has(c.id)).length;

  // Anúncios que têm conversa carregada, com quantas cada um. Ordenado pelo
  // maior: o seletor serve pra escolher um grupo, e o grupo grande é o que a
  // loja procura primeiro.
  const anunciosDaLista = useMemo(() => {
    const conta = new Map<string, number>();
    for (const c of conversations) {
      const a = anuncioPorConversa.get(c.id);
      if (a) conta.set(a, (conta.get(a) ?? 0) + 1);
    }
    return [...conta.entries()].sort((x, y) => y[1] - x[1]);
  }, [conversations, anuncioPorConversa]);

  const filtered = conversations.filter((c) => {
    if (origem === 'disparos' && !convsDeDisparo.has(c.id)) return false;
    if (origem === 'anuncio') {
      const veioDe = anuncioPorConversa.get(c.id);
      if (!veioDe) return false;
      if (adEscolhido && veioDe !== adEscolhido) return false;
    }
    if (filtroCanal !== 'todos') {
      // Conversa antiga pode nao ter canal gravado; nesses casos e WhatsApp.
      const canalDaConversa = String((c as { channel?: string }).channel ?? 'whatsapp');
      if (canalDaConversa !== filtroCanal) return false;
    }
    if (filtroNumero !== 'todos') {
      if (String((c as { phone_number_id?: string | null }).phone_number_id ?? '') !== filtroNumero) return false;
    }
    if (filter && c.status !== filter) return false;
    // "Todas" não mostra encerrada. Encerrar existe justamente pra tirar da
    // caixa de entrada — se ela continuasse na lista, o botão não serviria pra
    // nada. Quem quiser ver escolhe "Encerrada" no filtro.
    if (!filter && c.status === 'closed') return false;
    if (search) {
      const q = search.toLowerCase();
      const bateNome  = (c.customer_name ?? '').toLowerCase().includes(q)
                     || c.customer_phone.toLowerCase().includes(q);
      // OU no texto das mensagens. É o caso de uso que motivou isto: entrou um
      // carro e a loja quer achar quem perguntou dele — o nome da pessoa não
      // ajuda nada nessa busca.
      if (!bateNome && !achadosNaConversa.has(c.id)) return false;
    }
    return true;
  });

  // ─── render ───────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 400 }}>
        <Loader2 size={28} style={{ animation: 'spin 1s linear infinite', color: 'var(--primary)' }} />
      </div>
    );
  }

  const isHumanOrPending = selectedConv?.status === 'human' || selectedConv?.status === 'pending';

  return (
    <>
    <div
      className={`conv-layout${selectedConv ? ' com-conversa' : ''}`}
      style={{ display: 'flex', height: 'calc(100vh - 80px)', overflow: 'hidden' }}
    >

      {/* ── lista ──────────────────────────────────────────────────────────── */}
      <div className="conv-lista" style={{ width: 320, flexShrink: 0, borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', background: 'var(--bg-main)' }}>
        <div style={{ padding: '16px 16px 8px', borderBottom: '1px solid var(--border)' }}>
          {/* Cabeçalho enxuto.
              Antes: título + uma faixa inteira só pro estado das notificações
              ("Notificações ativas" + "Testar"), somando quatro linhas de
              controle antes da primeira conversa. Numa tela de 320px de largura,
              isso empurrava a lista — que é o conteúdo — pra metade de baixo.
              O estado do push agora é a COR do sino: verde funcionando, âmbar
              precisa registrar, vermelho bloqueado. */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <MessageCircle size={19} style={{ color: 'var(--primary)', flexShrink: 0 }} />
            <h2 data-tour="conversas-lista" style={{ margin: 0, fontSize: '1rem', fontWeight: 700 }}>Conversas</h2>
            {filtered.length > 0 && (
              <span style={{
                fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-secondary)',
                background: 'var(--input-bg)', padding: '1px 7px', borderRadius: 999,
              }}>
                {filtered.length}
              </span>
            )}

            <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
              <button
                type="button"
                title={notifPerm === 'denied' ? 'Notificações bloqueadas no navegador'
                  : notifPerm !== 'granted' ? 'Ativar notificações'
                  : pushInscrito === null ? 'Verificando…'
                  : pushInscrito ? 'Notificações ativas neste aparelho'
                  : 'Registrar este aparelho para receber notificações'}
                onClick={requestNotifPermission}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  width: 28, height: 28, borderRadius: 7, cursor: 'pointer',
                  border: '1px solid var(--border)',
                  background: notifPerm === 'denied' ? '#fef2f2'
                    : notifPerm === 'granted' ? (pushInscrito ? '#ecfdf5' : '#fffbeb') : 'transparent',
                  color: notifPerm === 'denied' ? '#ef4444'
                    : notifPerm === 'granted' ? (pushInscrito ? '#10b981' : '#b45309') : 'var(--text-secondary)',
                }}
              >
                {notifPerm === 'granted' && pushInscrito ? <Bell size={14} /> : <BellOff size={14} />}
              </button>
              <button
                type="button"
                disabled={testandoPush}
                title="Envia um push de verdade: servidor, Google/Apple e de volta no aparelho"
                onClick={testarPushReal}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  width: 28, height: 28, borderRadius: 7, cursor: 'pointer',
                  border: '1px solid var(--border)', background: 'transparent',
                  color: 'var(--text-secondary)',
                }}
              >
                <Send size={13} />
              </button>
            </div>
          </div>
          <div style={{ position: 'relative', marginBottom: 8 }}>
            <Search size={14} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)' }} />
            <input
              type="text" placeholder="Buscar nome, telefone ou o que foi dito..." value={searchRaw}
              onChange={(e) => setSearchRaw(e.target.value)}
              style={{ width: '100%', boxSizing: 'border-box', paddingLeft: 28, paddingRight: 28, paddingTop: 6, paddingBottom: 6, border: '1px solid var(--border)', borderRadius: 6, background: 'var(--bg-card)', fontSize: '0.8rem', color: 'var(--text-primary)' }}
            />
            {buscandoTexto && (
              <Loader2 size={13} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)', animation: 'spin 1s linear infinite' }} />
            )}
          </div>
          {/* Quantas entraram pelo TEXTO. Sem isto, o lojista não sabe se a
              lista encolheu porque ninguém falou do carro ou porque a busca
              ainda não achou nada — e some depois de 3 letras, que é o mínimo
              pra consultar. */}
          {search.trim().length >= 3 && !buscandoTexto && (
            <p style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', margin: '0 0 7px' }}>
              {achadosNaConversa.size > 0
                ? `${achadosNaConversa.size} ${achadosNaConversa.size === 1 ? 'conversa cita' : 'conversas citam'} "${search.trim()}"`
                : `Ninguém falou "${search.trim()}" nas mensagens`}
            </p>
          )}
          {/* Falar primeiro com alguém que não escreveu. Fica visível, e não
              escondido num ícone, porque até aqui esse caminho não existia: o
              vendedor saía do CRM e a conversa acontecia fora do sistema. */}
          <button
            type="button"
            onClick={() => setNovaAberta(true)}
            style={{
              width: '100%', boxSizing: 'border-box', marginBottom: 8,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              padding: '7px 10px', borderRadius: 6, cursor: 'pointer',
              background: 'var(--primary-light, #e8f0fe)', border: '1px solid var(--primary)',
              color: 'var(--primary)', fontSize: '0.8rem', fontWeight: 600,
            }}
          >
            <MessageSquarePlus size={14} /> Iniciar conversa
          </button>
          {/* Origem: todas x só quem veio de disparo.
              Vem ANTES do filtro de situação porque é uma pergunta anterior
              ("de que público eu estou falando?"), e só aparece quando existe
              disparo — com zero, seria um botão que não muda nada. */}
          {(totalDisparos > 0 || totalAnuncio > 0) && (
            <>
              <div style={{
                display: 'flex', gap: 2, padding: 2, borderRadius: 8, marginBottom: 7,
                background: 'var(--input-bg)', border: '1px solid var(--border)',
              }}>
                {([
                  { v: 'todas'    as const, label: `Todas (${conversations.length})`, mostra: true },
                  { v: 'disparos' as const, label: `Disparos (${totalDisparos})`,     mostra: totalDisparos > 0 },
                  { v: 'anuncio'  as const, label: `Anúncio (${totalAnuncio})`,       mostra: totalAnuncio > 0 },
                ]).filter((o) => o.mostra).map((opt) => (
                  <button key={opt.v} type="button" onClick={() => { setOrigem(opt.v); if (opt.v !== 'anuncio') setAdEscolhido(''); }}
                    style={{
                      flex: 1, padding: '5px 2px', fontSize: '0.7rem', borderRadius: 6,
                      cursor: 'pointer', border: 'none', whiteSpace: 'nowrap',
                      background: origem === opt.v ? 'var(--bg-card)' : 'transparent',
                      color: origem === opt.v ? 'var(--text-primary)' : 'var(--text-secondary)',
                      fontWeight: origem === opt.v ? 700 : 500,
                      boxShadow: origem === opt.v ? '0 1px 3px rgba(0,0,0,0.12)' : 'none',
                    }}>
                    {opt.label}
                  </button>
                ))}
              </div>

              {/* Qual anúncio. Só na aba de anúncio, e só quando há mais de um
                  — com um anúncio só, o seletor não escolheria nada. */}
              {origem === 'anuncio' && anunciosDaLista.length > 1 && (
                <select
                  value={adEscolhido}
                  onChange={(e) => setAdEscolhido(e.target.value)}
                  style={{
                    width: '100%', boxSizing: 'border-box', marginBottom: 7,
                    padding: '5px 8px', borderRadius: 6, border: '1px solid var(--border)',
                    background: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: '0.72rem',
                  }}
                >
                  <option value="">Todos os anúncios ({totalAnuncio})</option>
                  {anunciosDaLista.map(([headline, qtd]) => (
                    <option key={headline} value={headline}>{headline} ({qtd})</option>
                  ))}
                </select>
              )}
            </>
          )}

          {/* Situação do atendimento. Segmentado, sem borda por item: cinco
              caixinhas contornadas lado a lado viravam ruído visual num
              espaço de 320px. */}
          <div style={{
            display: 'flex', gap: 2, padding: 2, borderRadius: 8,
            background: 'var(--input-bg)', border: '1px solid var(--border)',
          }}>
            {FILTER_OPTIONS.map((opt) => (
              <button key={opt.value} type="button" onClick={() => setFilter(opt.value)}
                style={{
                  flex: 1, padding: '4px 2px', fontSize: '0.68rem', borderRadius: 6,
                  cursor: 'pointer', border: 'none', whiteSpace: 'nowrap',
                  background: filter === opt.value ? 'var(--bg-card)' : 'transparent',
                  color: filter === opt.value ? 'var(--text-primary)' : 'var(--text-secondary)',
                  fontWeight: filter === opt.value ? 700 : 500,
                  boxShadow: filter === opt.value ? '0 1px 3px rgba(0,0,0,0.12)' : 'none',
                }}>
                {opt.label}
              </button>
            ))}
          </div>

          {/* Números. Só aparece quando mais de um número REALMENTE recebeu
              conversa — com um número só, seria um botão que não muda nada.
              Vem antes do filtro de canal porque, pra quem tem dois números, a
              primeira pergunta é "qual loja/frente", não "qual aplicativo". */}
          {numerosUsados.length > 1 && (
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 7 }}>
              <button type="button" onClick={() => setFiltroNumero('todos')}
                style={{
                  padding: '3px 9px', fontSize: '0.68rem', borderRadius: 999,
                  cursor: 'pointer', fontWeight: filtroNumero === 'todos' ? 700 : 500,
                  border: `1px solid ${filtroNumero === 'todos' ? 'var(--primary)' : 'var(--border)'}`,
                  background: filtroNumero === 'todos' ? 'var(--primary)' : 'transparent',
                  color: filtroNumero === 'todos' ? '#fff' : 'var(--text-secondary)',
                }}>
                Todos os números
              </button>
              {numerosUsados.map((pid) => {
                const ativo = filtroNumero === pid;
                // Sem rótulo cadastrado, mostra o fim do id — feio, mas
                // distingue. Melhor que dois botões iguais escritos "Número".
                const nome = rotulosNumero[pid] || `Número …${pid.slice(-4)}`;
                return (
                  <button key={pid} type="button" onClick={() => setFiltroNumero(pid)}
                    style={{
                      padding: '3px 9px', fontSize: '0.68rem', borderRadius: 999,
                      cursor: 'pointer', fontWeight: ativo ? 700 : 500,
                      border: `1px solid ${ativo ? 'var(--primary)' : 'var(--border)'}`,
                      background: ativo ? 'var(--primary)' : 'transparent',
                      color: ativo ? '#fff' : 'var(--text-secondary)',
                    }}>
                    {nome}
                  </button>
                );
              })}
            </div>
          )}

          {/* Canais. Só aparece quando a loja tem mais de um — numa loja só de
              WhatsApp, o filtro seria um controle inútil ocupando espaço.
              Cada canal usa a PRÓPRIA cor quando ativo, a mesma da etiqueta na
              conversa: o olho liga os dois sem precisar ler. */}
          {temMaisDeUmCanal && (
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 7 }}>
              {[
                { v: 'todos',     l: 'Todos',     cor: 'var(--primary)', fundo: 'var(--primary)' },
                { v: 'whatsapp',  l: 'WhatsApp',  cor: '#15803d',        fundo: '#dcfce7' },
                { v: 'instagram', l: 'Instagram', cor: CANAIS.instagram.cor, fundo: CANAIS.instagram.fundo },
                { v: 'messenger', l: 'Messenger', cor: CANAIS.messenger.cor, fundo: CANAIS.messenger.fundo },
              ].map((opt) => {
                const ativo = filtroCanal === opt.v;
                const ehTodos = opt.v === 'todos';
                return (
                  <button key={opt.v} type="button" onClick={() => setFiltroCanal(opt.v)}
                    style={{
                      padding: '3px 9px', fontSize: '0.68rem', borderRadius: 999,
                      cursor: 'pointer', fontWeight: ativo ? 700 : 500,
                      border: `1px solid ${ativo ? (ehTodos ? opt.cor : opt.fundo) : 'var(--border)'}`,
                      background: ativo ? (ehTodos ? opt.cor : opt.fundo) : 'transparent',
                      color: ativo ? (ehTodos ? '#fff' : opt.cor) : 'var(--text-secondary)',
                    }}>
                    {opt.l}
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {filtered.length === 0
            ? <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>Nenhuma conversa encontrada.</div>
            : filtered.map((conv) => (
              <ConvItem
                key={conv.id}
                conv={conv}
                lastMsg={lastMessages[conv.id] ?? null}
                active={conv.id === selectedId}
                isAlert={alertConvIds.has(conv.id)}
                onClick={() => selectConversation(conv.id)}
                rotuloNumero={rotulosNumero[String((conv as { phone_number_id?: string | null }).phone_number_id ?? '')]}
                anuncio={anuncioPorConversa.get(conv.id)}
                trecho={achadosNaConversa.get(conv.id)}
              />
            ))}
        </div>
      </div>

      {/* ── chat ───────────────────────────────────────────────────────────── */}
      {!selectedConv ? (
        <div className="conv-chat" style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', color: 'var(--text-secondary)', gap: 8 }}>
          <MessageCircle size={48} style={{ opacity: 0.2 }} />
          <p style={{ margin: 0, fontSize: '0.9rem' }}>Selecione uma conversa para ver as mensagens.</p>
        </div>
      ) : (
        <div className="conv-chat" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* header */}
          <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--bg-card)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {/* No celular a lista e o chat dividem a mesma tela, entao precisa
                  de um caminho de volta. No desktop os dois aparecem juntos e o
                  botao seria ruido — o CSS o esconde. */}
              <button
                type="button"
                className="conv-voltar"
                aria-label="Voltar para a lista"
                onClick={() => setSelectedId(null)}
              >
                <ChevronLeft size={20} />
              </button>
              <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'var(--primary)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.8rem', fontWeight: 700 }}>
                {initials(selectedConv.customer_name, selectedConv.customer_phone)}
              </div>
              <div>
                <p style={{ margin: 0, fontWeight: 600, fontSize: '0.9rem' }}>{selectedConv.customer_name ?? 'Sem nome'}</p>
                <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 5 }}>
                  {/* Nos canais sociais customer_phone guarda o ID interno do
                      usuário, não um telefone — mostrar aquilo como "telefone"
                      confundiria o vendedor. */}
                  {CANAIS[String((selectedConv as { channel?: string }).channel ?? '')] ? (
                    <CanalBadge canal={(selectedConv as { channel?: string }).channel} />
                  ) : (
                    <><PhoneCall size={11} />{selectedConv.customer_phone}</>
                  )}
                </p>
              </div>
              <StatusBadge status={selectedConv.status} />
              {/* Quem está atendendo. Fica ao lado do status porque é a mesma
                  pergunta: "Humano" diz que saiu do bot, isto diz qual pessoa.
                  Só aparece quando a loja cadastrou a equipe. */}
              {equipe.length > 0 && (
                <label style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <AtendenteBadge nome={(selectedConv as { atendente?: string | null }).atendente} />
                  <select
                    value={(selectedConv as { atendente?: string | null }).atendente ?? ''}
                    onChange={(e) => definirAtendente(e.target.value)}
                    title="Quem está atendendo este cliente"
                    style={{
                      fontSize: '0.72rem', padding: '2px 6px', borderRadius: 6,
                      border: '1px solid var(--border)', background: 'var(--input-bg)',
                      color: 'var(--text-primary)', maxWidth: 130,
                    }}
                  >
                    <option value="">Sem atendente</option>
                    {equipe.map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                </label>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {/* "Assumir" aparece para bot e pending; "Devolver" aparece para human e pending.
                  Encerrada não mostra nenhum dos dois: ali a única ação que faz
                  sentido é reabrir. */}
              {selectedConv.status !== 'human' && selectedConv.status !== 'closed' && (
                <button type="button" onClick={takeOver}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 6, cursor: 'pointer', background: '#f59e0b22', border: '1px solid #f59e0b', color: '#b45309', fontSize: '0.8rem', fontWeight: 600 }}>
                  <UserCheck size={14} /> Assumir conversa
                </button>
              )}
              {isHumanOrPending && (
                <button type="button" onClick={returnToBot}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 6, cursor: 'pointer', background: 'var(--primary-light, #e8f0fe)', border: '1px solid var(--primary)', color: 'var(--primary)', fontSize: '0.8rem', fontWeight: 600 }}>
                  <RefreshCw size={14} /> Devolver pro bot
                </button>
              )}
              {selectedConv.status !== 'closed' ? (
                <button type="button" onClick={encerrarConversa}
                  title="Tira da caixa de entrada. Se o cliente escrever de novo, reabre sozinha."
                  style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 6, cursor: 'pointer', background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-secondary)', fontSize: '0.8rem', fontWeight: 600 }}>
                  <Archive size={14} /> Encerrar
                </button>
              ) : (
                <button type="button" onClick={reabrirConversa}
                  title="Volta a conversa pra caixa de entrada, com o bot atendendo"
                  style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 6, cursor: 'pointer', background: 'var(--primary-light, #e8f0fe)', border: '1px solid var(--primary)', color: 'var(--primary)', fontSize: '0.8rem', fontWeight: 600 }}>
                  <ArchiveRestore size={14} /> Reabrir
                </button>
              )}
              <button type="button" onClick={() => setConfirmDeleteId(selectedConv.id)}
                title="Excluir conversa"
                style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 10px', borderRadius: 6, cursor: 'pointer', background: '#fef2f2', border: '1px solid #fca5a5', color: '#dc2626', fontSize: '0.8rem' }}>
                <Trash2 size={14} />
              </button>
            </div>
          </div>

          {/* messages */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', background: 'var(--bg-main)' }}>
            {msgLoading
              ? <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 40 }}><Loader2 size={24} style={{ animation: 'spin 1s linear infinite', color: 'var(--primary)' }} /></div>
              : messages.length === 0
                ? <div style={{ textAlign: 'center', color: 'var(--text-secondary)', paddingTop: 40, fontSize: '0.85rem' }}>Nenhuma mensagem ainda.</div>
                : messages.map((msg, i) => {
                    // Divisor quando VIRA o dia. Comparado contra a mensagem
                    // anterior, não contra hoje: é a troca de dia dentro da
                    // conversa que marca o corte.
                    const anterior = i > 0 ? messages[i - 1] : null;
                    const rotulo = rotuloDoDia(msg.created_at);
                    const mudouODia = !anterior || rotuloDoDia(anterior.created_at) !== rotulo;
                    return (
                      <React.Fragment key={msg.id}>
                        {mudouODia && rotulo && <DivisorDeData rotulo={rotulo} />}
                        <Bubble
                          msg={msg}
                          campanha={msg.campaign_id ? campanhas[msg.campaign_id] : undefined}
                        />
                      </React.Fragment>
                    );
                  })}
            <div ref={messagesEndRef} />
          </div>

          {/* agent input — disponível quando humano assumiu */}
          {selectedConv.status === 'human' ? (
            <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border)', background: 'var(--bg-card)', display: 'flex', gap: 8, alignItems: 'flex-end' }}>
              <textarea
                value={agentInput} onChange={(e) => setAgentInput(e.target.value)} onKeyDown={handleKeyDown}
                placeholder="Digite sua mensagem... (Enter para enviar)" rows={2}
                style={{ flex: 1, padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-main)', fontSize: '0.875rem', color: 'var(--text-primary)', resize: 'none', outline: 'none', fontFamily: 'inherit' }}
              />
              {/* Enviar veículo do estoque */}
              <div style={{ position: 'relative', flexShrink: 0 }}>
                <button
                  type="button"
                  onClick={() => setShowCarros((p) => !p)}
                  title="Enviar veículo do estoque"
                  style={{ width: 40, height: 40, borderRadius: 8, border: '1px solid var(--border)', background: showCarros ? 'var(--input-bg)' : 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-primary)' }}
                >
                  <CarFront size={18} />
                </button>
                {showCarros && (
                  <div style={{
                    position: 'absolute', bottom: '100%', right: 0, marginBottom: 6,
                    width: 320, maxHeight: 340, overflowY: 'auto',
                    background: 'var(--bg-card)', border: '1px solid var(--border)',
                    borderRadius: 10, padding: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.18)', zIndex: 20,
                  }}>
                    <input
                      autoFocus value={buscaCarro} onChange={(e) => setBuscaCarro(e.target.value)}
                      placeholder="Buscar modelo..."
                      style={{ width: '100%', padding: '7px 10px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--bg-main)', color: 'var(--text-primary)', fontSize: '0.83rem', marginBottom: 6 }}
                    />
                    {/* Manda TUDO que está filtrado, em texto e sem foto.
                        Serve pra quem não tem bot: em vez de escolher um carro
                        de cada vez, manda a lista e deixa o cliente apontar. */}
                    <button
                      type="button"
                      disabled={enviandoCarro !== null}
                      onClick={enviarListaDeCarros}
                      style={{
                        width: '100%', textAlign: 'left', padding: '7px 9px', borderRadius: 7,
                        border: '1px dashed var(--border)', background: 'transparent',
                        cursor: enviandoCarro ? 'wait' : 'pointer', color: 'var(--text-secondary)',
                        fontSize: '0.8rem', marginBottom: 6,
                      }}
                    >
                      {enviandoCarro === 'lista' ? 'Enviando...' : 'Enviar a lista em texto (sem fotos)'}
                    </button>

                    {carros
                      .filter((c) => {
                        const t = `${c.brand} ${c.model} ${c.version ?? ''}`.toLowerCase();
                        return t.includes(buscaCarro.toLowerCase().trim());
                      })
                      .slice(0, 40)
                      .map((c) => (
                        <button
                          key={String(c.id)}
                          type="button"
                          disabled={enviandoCarro !== null}
                          onClick={() => enviarCarro(String(c.id))}
                          style={{
                            width: '100%', textAlign: 'left', padding: '7px 9px', borderRadius: 7,
                            border: 'none', background: enviandoCarro === c.id ? 'var(--input-bg)' : 'transparent',
                            cursor: enviandoCarro ? 'wait' : 'pointer', color: 'var(--text-primary)',
                          }}
                        >
                          <div style={{ fontSize: '0.84rem', fontWeight: 600 }}>
                            {String(c.brand)} {String(c.model)} {c.version ? String(c.version) : ''}
                          </div>
                          <div style={{ fontSize: '0.74rem', color: 'var(--text-secondary)' }}>
                            {c.year ? `${c.year} · ` : ''}
                            {c.mileage != null ? `${numero(c.mileage)} km · ` : ''}
                            {c.price != null ? dinheiro(c.price) : ''}
                          </div>
                        </button>
                      ))}
                    {!carros.length && (
                      <p style={{ margin: 0, padding: 10, fontSize: '0.8rem', color: erroCarros ? '#dc2626' : 'var(--text-secondary)' }}>
                        {erroCarros || 'Carregando estoque...'}
                      </p>
                    )}
                    <p style={{ margin: '6px 0 0', padding: '0 4px', fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
                      Envia ficha, fotos e vídeo de uma vez.
                    </p>
                  </div>
                )}
              </div>

              {/* Emoji picker */}
              <div ref={emojiRef} style={{ position: 'relative', flexShrink: 0 }}>
                <button
                  type="button"
                  onClick={() => setShowEmoji((p) => !p)}
                  title="Emojis"
                  style={{ width: 40, height: 40, borderRadius: 8, border: '1px solid var(--border)', background: showEmoji ? 'var(--input-bg)' : 'transparent', cursor: 'pointer', fontSize: '1.15rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                >
                  😊
                </button>
                {showEmoji && (
                  <div style={{
                    position: 'absolute', bottom: '100%', right: 0, marginBottom: 6,
                    background: 'var(--bg-card)', border: '1px solid var(--border)',
                    borderRadius: 10, padding: 8,
                    display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: 2,
                    width: 268,
                    boxShadow: '0 8px 28px rgba(0,0,0,0.22)',
                    zIndex: 50,
                  }}>
                    {EMOJIS.map((emoji) => (
                      <button
                        key={emoji}
                        type="button"
                        onClick={() => { setAgentInput((p) => p + emoji); setShowEmoji(false); }}
                        style={{ fontSize: '1.2rem', background: 'transparent', border: 'none', cursor: 'pointer', borderRadius: 4, padding: 4, lineHeight: 1 }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--input-bg)'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <button type="button" onClick={sendAgentMessage} disabled={sending || !agentInput.trim()}
                style={{ padding: '10px 14px', borderRadius: 8, cursor: 'pointer', background: 'var(--primary)', border: 'none', color: '#fff', display: 'flex', alignItems: 'center', gap: 4, opacity: (sending || !agentInput.trim()) ? 0.5 : 1 }}>
                {sending ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : <Send size={16} />}
              </button>
            </div>
          ) : (
            <div style={{ padding: '10px 20px', borderTop: '1px solid var(--border)', background: 'var(--bg-card)', textAlign: 'center', fontSize: '0.78rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
              <Bot size={13} />
              {selectedConv.status === 'bot'
                ? 'O bot está respondendo. Clique em "Assumir conversa" para intervir.'
                : selectedConv.status === 'pending'
                  ? '⚠️ Cliente aguardando atendimento — o bot está em silêncio. Assuma para responder ou devolva ao bot.'
                  : 'Conversa encerrada — saiu da caixa de entrada. Se o cliente escrever de novo, ela reabre sozinha e o bot atende.'}
            </div>
          )}
        </div>
      )}
    </div>

    {/* Quem assumiu — aparece uma vez por conversa, logo após o "Assumir".
        A conversa JÁ está assumida quando isto abre: fechar sem escolher não
        desfaz nada, só deixa sem nome. Nunca vale travar o atendimento pra
        cobrar um campo. */}
    {perguntandoQuem && (
      <div className="modal-overlay" onClick={() => setPerguntandoQuem(false)}>
        <div className="modal-content modal-sm" onClick={(e) => e.stopPropagation()}>
          <div style={{ padding: '1.4rem 1.5rem' }}>
            <p style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '0.35rem' }}>
              Quem vai atender?
            </p>
            <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: '1.1rem', lineHeight: 1.45 }}>
              Fica marcado na conversa pra equipe saber com quem o cliente está falando.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {equipe.map((nome) => (
                <button
                  key={nome}
                  type="button"
                  onClick={async () => { await definirAtendente(nome); setPerguntandoQuem(false); }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '9px 12px', borderRadius: 8, cursor: 'pointer',
                    border: '1px solid var(--border)', background: 'var(--input-bg)',
                    color: 'var(--text-primary)', fontSize: '0.9rem', fontWeight: 600,
                    textAlign: 'left', width: '100%',
                  }}
                >
                  <AtendenteBadge nome={nome} />
                  {nome}
                </button>
              ))}
            </div>

            <button
              type="button"
              className="btn-secondary"
              onClick={() => setPerguntandoQuem(false)}
              style={{ marginTop: '1rem', width: '100%' }}
            >
              Agora não
            </button>
          </div>
        </div>
      </div>
    )}

    {confirmDeleteId && (
      <div className="modal-overlay" onClick={() => setConfirmDeleteId(null)}>
        <div className="modal-content modal-sm" onClick={(e) => e.stopPropagation()}>
          <div style={{ padding: '1.5rem', textAlign: 'center' }}>
            <p style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '1.5rem', lineHeight: 1.4 }}>
              Tem certeza que deseja excluir esta conversa e todas as mensagens? Essa ação não pode ser desfeita.
            </p>
            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center' }}>
              <button className="btn-secondary" onClick={() => setConfirmDeleteId(null)}>Cancelar</button>
              <button className="btn-primary" style={{ background: '#ef4444' }} onClick={deleteConversation}>Excluir</button>
            </div>
          </div>
        </div>
      </div>
    )}

    {/* ── Iniciar conversa ─────────────────────────────────────────────────
        A tela é organizada em torno da janela de 24h, porque é ela que decide
        se sai texto livre (grátis) ou template (pago) — e porque texto livre
        fora da janela devolve sucesso na API e NÃO chega. Oferecer os dois
        campos ao mesmo tempo seria entregar ao vendedor a chance de perder uma
        mensagem sem nunca saber. */}
    {novaAberta && (
      <div className="modal-overlay" onClick={fecharNova}>
        <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520 }}>
          <div style={{ padding: '1.25rem 1.5rem' }}>
            <h3 style={{ margin: '0 0 1rem', fontSize: '1.05rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
              <MessageSquarePlus size={18} style={{ color: 'var(--primary)' }} /> Iniciar conversa
            </h3>

            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>
              Telefone (com DDD)
            </label>
            <input
              autoFocus value={novoFone} onChange={(e) => setNovoFone(e.target.value)}
              placeholder="15 99999-9999" inputMode="tel"
              style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--bg-main)', color: 'var(--text-primary)', fontSize: '0.875rem', marginBottom: 10 }}
            />

            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>
              Nome
            </label>
            <input
              value={novoNome} onChange={(e) => setNovoNome(e.target.value)}
              placeholder="Como chamar a pessoa"
              style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--bg-main)', color: 'var(--text-primary)', fontSize: '0.875rem', marginBottom: 12 }}
            />

            {janela === 'checando' && (
              <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 6, margin: '0 0 10px' }}>
                <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> Vendo se a janela de 24h está aberta…
              </p>
            )}

            {janela === 'aberta' && (
              <>
                <p style={{ fontSize: '0.75rem', color: '#047857', background: '#ecfdf5', border: '1px solid #a7f3d0', borderRadius: 7, padding: '7px 10px', margin: '0 0 10px' }}>
                  Esta pessoa escreveu nas últimas 24h — pode mandar o que quiser, e é de graça.
                </p>
                <textarea
                  value={novoTexto} onChange={(e) => setNovoTexto(e.target.value)}
                  rows={4} placeholder="Escreva a mensagem..."
                  style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--bg-main)', color: 'var(--text-primary)', fontSize: '0.875rem', resize: 'vertical', fontFamily: 'inherit' }}
                />
              </>
            )}

            {janela === 'fechada' && (
              <>
                <p style={{ fontSize: '0.75rem', color: '#92400e', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 7, padding: '7px 10px', margin: '0 0 10px' }}>
                  Faz mais de 24h que esta pessoa não escreve (ou nunca escreveu). Fora dessa janela a Meta
                  só entrega <strong>template aprovado</strong> — mensagem escrita à mão não chega, e não avisa.
                </p>
                {templatesOk.length === 0 ? (
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: 0 }}>
                    Esta conta não tem nenhum template aprovado. Dá pra criar em Configurações → Templates.
                  </p>
                ) : (
                  <>
                    <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>
                      Template
                    </label>
                    <select
                      value={novoTplId}
                      onChange={(e) => {
                        setNovoTplId(e.target.value);
                        // Pré-preenche a 1ª variável com o primeiro nome: quase
                        // todo template começa chamando a pessoa pelo nome.
                        const primeiro = novoNome.trim().split(' ')[0];
                        setNovoVars(primeiro ? { '1': primeiro } : {});
                      }}
                      style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--bg-main)', color: 'var(--text-primary)', fontSize: '0.875rem', marginBottom: 10 }}
                    >
                      <option value="">Escolha…</option>
                      {templatesOk.map((t) => (
                        <option key={t.id} value={t.id}>{t.display_name}</option>
                      ))}
                    </select>

                    {tplEscolhido && Array.from({ length: qtdVars }, (_, i) => String(i + 1)).map((n) => (
                      <div key={n} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                        <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-secondary)', width: 34, flexShrink: 0 }}>
                          {`{{${n}}}`}
                        </span>
                        <input
                          value={novoVars[n] ?? ''}
                          onChange={(e) => setNovoVars((p) => ({ ...p, [n]: e.target.value }))}
                          style={{ flex: 1, padding: '6px 9px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-main)', color: 'var(--text-primary)', fontSize: '0.83rem' }}
                        />
                      </div>
                    ))}

                    {tplEscolhido && (
                      <div style={{ marginTop: 10, padding: '9px 11px', borderRadius: 7, background: 'var(--input-bg)', border: '1px solid var(--border)' }}>
                        <p style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--text-secondary)', margin: '0 0 5px', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                          O cliente vai ler
                        </p>
                        <p style={{ fontSize: '0.83rem', color: 'var(--text-primary)', margin: 0, whiteSpace: 'pre-wrap', lineHeight: 1.45 }}>
                          {previaTemplate}
                        </p>
                      </div>
                    )}
                  </>
                )}
              </>
            )}

            {erroNova && (
              <p style={{ fontSize: '0.78rem', color: '#dc2626', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 7, padding: '7px 10px', margin: '10px 0 0' }}>
                {erroNova}
              </p>
            )}

            <div style={{ display: 'flex', gap: '0.6rem', justifyContent: 'flex-end', marginTop: '1.1rem' }}>
              <button className="btn-secondary" onClick={fecharNova}>Cancelar</button>
              <button
                className="btn-primary"
                disabled={
                  enviandoNova
                  || novoFone.replace(/\D/g, '').length < 10
                  || (janela === 'aberta' ? !novoTexto.trim() : !novoTplId)
                  || janela === 'checando' || janela === null
                }
                onClick={enviarNovaConversa}
              >
                {enviandoNova
                  ? <Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} />
                  : janela === 'fechada' ? 'Enviar template' : 'Enviar'}
              </button>
            </div>
          </div>
        </div>
      </div>
    )}
    </>
  );
}
