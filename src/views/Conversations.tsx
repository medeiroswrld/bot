import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
  Bot, UserCheck, MessageCircle, Send, RefreshCw,
  PhoneCall, Search, Loader2, AlertCircle, Bell, BellOff, Trash2, Mic, ChevronLeft, CarFront,
} from 'lucide-react';
import { supabaseTyped } from '../lib/supabase-typed';
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
  conv, lastMsg, active, isAlert, onClick,
}: {
  conv: Conversation;
  lastMsg: Message | null;
  active: boolean;
  isAlert: boolean;
  onClick: () => void;
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
          {lastMsg && (
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

const Bubble = React.memo(function Bubble({ msg, campanha }: { msg: Message; campanha?: CampanhaInfo }) {
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
            <span style={{ fontSize: '0.65rem', fontWeight: 700, color: labelColor }}>
              {campanha ? 'Campanha' : isBot ? 'Bot' : 'Atendente'}
            </span>
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

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [lastMessages, setLastMessages]   = useState<Record<string, Message>>({});
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
  const [searchRaw, setSearchRaw]         = useState('');
  const [search, setSearch]               = useState('');
  const [alertConvIds, setAlertConvIds]   = useState<Set<string>>(new Set());
  const [audioUnlocked, setAudioUnlocked] = useState(false);
  const [notifPerm,      setNotifPerm]      = useState<NotificationPermission>(
    'Notification' in window ? Notification.permission : 'denied',
  );
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
        const lista = (data ?? []).filter((c) => (c as { status?: string }).status !== 'sold');
        setCarros(lista as Array<Record<string, unknown>>);
        if (!lista.length) setErroCarros('Nenhum veículo disponível no estoque.');
      });
    return () => { vivo = false; };
  }, [showCarros, carros.length, user?.id]);

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

  const requestNotifPermission = async () => {
    if (!('Notification' in window)) return;
    const perm = await Notification.requestPermission();
    setNotifPerm(perm);
    if (perm !== 'granted' || !user?.id) return;

    // Inscricao de push. A Notification acima so dispara com a ABA ABERTA - ou
    // seja, quando o lojista ja esta olhando a tela e nao precisa ser avisado.
    // O push abaixo e o que chega com o CRM fechado.
    try {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
      const reg = await navigator.serviceWorker.ready;
      const existente = await reg.pushManager.getSubscription();
      const sub = existente ?? await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64UrlParaBytes(VAPID_PUBLIC),
      });
      const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
      if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return;

      // onConflict no endpoint: reinstalar ou reativar no mesmo aparelho
      // atualiza a linha em vez de criar outra e notificar em duplicidade.
      await supabaseTyped.from('push_subscriptions').upsert({
        user_id: user.id,
        endpoint: json.endpoint,
        p256dh: json.keys.p256dh,
        auth: json.keys.auth,
        user_agent: navigator.userAgent.slice(0, 200),
      } as never, { onConflict: 'endpoint' });
    } catch (e) {
      // Nao pode quebrar a tela: sem push o CRM segue funcionando normalmente.
      console.warn('[push] nao foi possivel inscrever este aparelho:', e);
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
            setConversations((prev) => [added, ...prev]);
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

            setConversations((prev) =>
              prev
                .map((c) => (c.id === updated.id ? updated : c))
                .sort((a, b) => (b.last_message_at ?? '').localeCompare(a.last_message_at ?? '')),
            );
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

  const takeOver = async () => {
    if (!selectedId) return;
    const { error } = await supabaseTyped
      .from('conversations').update({ status: 'human' }).eq('id', selectedId);
    if (!error) setConversations((prev) => prev.map((c) => c.id === selectedId ? { ...c, status: 'human' } : c));
  };

  const returnToBot = async () => {
    if (!selectedId) return;
    const { error } = await supabaseTyped
      .from('conversations').update({ status: 'bot' }).eq('id', selectedId);
    if (!error) setConversations((prev) => prev.map((c) => c.id === selectedId ? { ...c, status: 'bot' } : c));
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
  const temMaisDeUmCanal = new Set(
    conversations.map((c) => String((c as { channel?: string }).channel ?? 'whatsapp')),
  ).size > 1;

  // ── filtered list ─────────────────────────────────────────────────────────

  const filtered = conversations.filter((c) => {
    if (filtroCanal !== 'todos') {
      // Conversa antiga pode nao ter canal gravado; nesses casos e WhatsApp.
      const canalDaConversa = String((c as { channel?: string }).channel ?? 'whatsapp');
      if (canalDaConversa !== filtroCanal) return false;
    }
    if (filter && c.status !== filter) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!(c.customer_name ?? '').toLowerCase().includes(q) && !c.customer_phone.toLowerCase().includes(q)) return false;
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <MessageCircle size={20} style={{ color: 'var(--primary)' }} />
            <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, flex: 1 }}>Conversas WhatsApp</h2>
          </div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
            <button
              type="button"
              title={`Notificações: ${notifPerm}`}
              onClick={requestNotifPermission}
              style={{
                flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                padding: '4px 8px', fontSize: '0.7rem', borderRadius: 5, cursor: 'pointer',
                border: '1px solid var(--border)',
                background: notifPerm === 'granted' ? '#ecfdf5' : notifPerm === 'denied' ? '#fef2f2' : 'transparent',
                color: notifPerm === 'granted' ? '#10b981' : notifPerm === 'denied' ? '#ef4444' : 'var(--text-secondary)',
                fontWeight: 600,
              }}
            >
              {notifPerm === 'granted' ? <Bell size={12} /> : <BellOff size={12} />}
              {notifPerm === 'granted' ? 'Notificações ativas' : notifPerm === 'denied' ? 'Bloqueadas' : 'Ativar Notificações'}
            </button>
            <button
              type="button"
              onClick={testNotification}
              style={{
                padding: '4px 8px', fontSize: '0.7rem', borderRadius: 5, cursor: 'pointer',
                border: '1px solid var(--border)', background: 'transparent',
                color: 'var(--text-secondary)', fontWeight: 600,
              }}
            >
              Testar
            </button>
          </div>
          <div style={{ position: 'relative', marginBottom: 8 }}>
            <Search size={14} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)' }} />
            <input
              type="text" placeholder="Buscar nome ou telefone..." value={searchRaw}
              onChange={(e) => setSearchRaw(e.target.value)}
              style={{ width: '100%', boxSizing: 'border-box', paddingLeft: 28, paddingRight: 8, paddingTop: 6, paddingBottom: 6, border: '1px solid var(--border)', borderRadius: 6, background: 'var(--bg-card)', fontSize: '0.8rem', color: 'var(--text-primary)' }}
            />
          </div>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {FILTER_OPTIONS.map((opt) => (
              <button key={opt.value} type="button" onClick={() => setFilter(opt.value)}
                style={{ padding: '3px 8px', fontSize: '0.7rem', borderRadius: 4, cursor: 'pointer', border: '1px solid var(--border)', background: filter === opt.value ? 'var(--primary)' : 'transparent', color: filter === opt.value ? '#fff' : 'var(--text-secondary)', fontWeight: filter === opt.value ? 600 : 400 }}>
                {opt.label}
              </button>
            ))}
          </div>

          {/* Canais. Só aparece quando a loja tem mais de um — numa loja só de
              WhatsApp, o filtro seria um controle inútil ocupando espaço. */}
          {temMaisDeUmCanal && (
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 4 }}>
              {[
                { v: 'todos',     l: 'Todos os canais' },
                { v: 'whatsapp',  l: 'WhatsApp' },
                { v: 'instagram', l: 'Instagram' },
                { v: 'messenger', l: 'Messenger' },
              ].map((opt) => (
                <button key={opt.v} type="button" onClick={() => setFiltroCanal(opt.v)}
                  style={{ padding: '3px 8px', fontSize: '0.7rem', borderRadius: 4, cursor: 'pointer', border: '1px solid var(--border)', background: filtroCanal === opt.v ? 'var(--primary)' : 'transparent', color: filtroCanal === opt.v ? '#fff' : 'var(--text-secondary)', fontWeight: filtroCanal === opt.v ? 600 : 400 }}>
                  {opt.l}
                </button>
              ))}
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
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {/* "Assumir" aparece para bot e pending; "Devolver" aparece para human e pending */}
              {selectedConv.status !== 'human' && (
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
                : messages.map((msg) => (
                    <Bubble
                      key={msg.id}
                      msg={msg}
                      campanha={msg.campaign_id ? campanhas[msg.campaign_id] : undefined}
                    />
                  ))}
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
                            {c.mileage != null ? `${Number(c.mileage).toLocaleString('pt-BR')} km · ` : ''}
                            {c.price != null ? `R$ ${Number(c.price).toLocaleString('pt-BR')}` : ''}
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
                  : 'Conversa encerrada.'}
            </div>
          )}
        </div>
      )}
    </div>

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
    </>
  );
}
