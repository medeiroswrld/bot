import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  Bot, UserCheck, MessageCircle, Send, RefreshCw,
  PhoneCall, Search, Loader2, AlertCircle,
} from 'lucide-react';
import { supabaseTyped } from '../lib/supabase-typed';
// useAppContext is from a .jsx file — cast to known shape below
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import { useAppContext } from '../context/AppContext.jsx';
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

function StatusBadge({ status }: { status: Conversation['status'] }) {
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
}

// ─── ConvItem ─────────────────────────────────────────────────────────────────

function ConvItem({
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
}

// ─── Bubble ───────────────────────────────────────────────────────────────────

function Bubble({ msg }: { msg: Message }) {
  const isCustomer = msg.role === 'customer';
  const isBot      = msg.role === 'bot';
  const time = new Date(msg.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const bg    = isCustomer ? 'var(--bg-card)' : isBot ? '#e8f5e9' : '#e3f2fd';
  const align: React.CSSProperties['justifyContent'] = isCustomer ? 'flex-start' : 'flex-end';

  return (
    <div style={{ display: 'flex', justifyContent: align, marginBottom: 8 }}>
      <div style={{ maxWidth: '75%', background: bg, borderRadius: 12, padding: '8px 12px', boxShadow: '0 1px 2px rgba(0,0,0,0.06)' }}>
        {!isCustomer && (
          <div style={{ fontSize: '0.65rem', fontWeight: 600, color: isBot ? '#388e3c' : '#1976d2', marginBottom: 2 }}>
            {isBot ? 'Bot' : 'Atendente'}
          </div>
        )}
        <p style={{ margin: 0, fontSize: '0.875rem', lineHeight: 1.4, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {msg.content}
        </p>
        <p style={{ margin: '4px 0 0', fontSize: '0.65rem', color: 'var(--text-secondary)', textAlign: 'right' }}>
          {time}
        </p>
      </div>
    </div>
  );
}

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
  const [loading, setLoading]             = useState(true);
  const [msgLoading, setMsgLoading]       = useState(false);
  const [sending, setSending]             = useState(false);
  const [agentInput, setAgentInput]       = useState('');
  const [filter, setFilter]               = useState<FilterValue>('');
  const [search, setSearch]               = useState('');
  const [alertConvIds, setAlertConvIds]   = useState<Set<string>>(new Set());

  const messagesEndRef   = useRef<HTMLDivElement>(null);
  const conversationsRef = useRef<Conversation[]>([]);
  // AudioContext criado na primeira interação do usuário para respeitar política de autoplay
  const audioCtxRef      = useRef<AudioContext | null>(null);
  const supabaseUrl      = import.meta.env.VITE_SUPABASE_URL as string;

  const selectedConv = conversations.find((c) => c.id === selectedId) ?? null;

  // ── AudioContext: inicializa/resume na primeira interação ─────────────────

  useEffect(() => {
    const unlock = () => {
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

  // Solicita permissão de notificação desktop na montagem
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  // Mantém ref sincronizada para detectar transições no realtime
  useEffect(() => { conversationsRef.current = conversations; }, [conversations]);

  // ── fetch helpers ─────────────────────────────────────────────────────────

  const fetchConversations = useCallback(async () => {
    if (!user?.id) return;
    const { data } = await supabaseTyped
      .from('conversations')
      .select('*')
      .eq('user_id', user.id)
      .order('last_message_at', { ascending: false });
    setConversations(data ?? []);
    setLoading(false);
  }, [user?.id]);

  const fetchLastMessages = useCallback(async (convIds: string[]) => {
    if (!convIds.length) return;
    const { data } = await supabaseTyped
      .from('messages')
      .select('*')
      .in('conversation_id', convIds)
      .order('created_at', { ascending: false });
    if (!data) return;
    const map: Record<string, Message> = {};
    for (const msg of data) {
      if (!map[msg.conversation_id]) map[msg.conversation_id] = msg;
    }
    setLastMessages(map);
  }, []);

  const fetchMessages = useCallback(async (convId: string) => {
    setMsgLoading(true);
    const { data } = await supabaseTyped
      .from('messages')
      .select('*')
      .eq('conversation_id', convId)
      .order('created_at', { ascending: true });
    setMessages(data ?? []);
    setMsgLoading(false);
  }, []);

  // ── effects ───────────────────────────────────────────────────────────────

  useEffect(() => { fetchConversations(); }, [fetchConversations]);

  useEffect(() => {
    if (conversations.length) fetchLastMessages(conversations.map((c) => c.id));
  }, [conversations.length, fetchLastMessages]);

  useEffect(() => {
    if (selectedId) fetchMessages(selectedId);
    else setMessages([]);
  }, [selectedId, fetchMessages]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  const selectConversation = useCallback((id: string) => {
    setSelectedId(id);
    setAlertConvIds((prev) => { const s = new Set(prev); s.delete(id); return s; });
  }, []);

  // ── realtime: conversations ───────────────────────────────────────────────

  useEffect(() => {
    if (!user?.id) return;
    const uid = user.id;

    const channel = supabaseTyped
      .channel(`conv-list-${uid}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'conversations', filter: `user_id=eq.${uid}` },
        (payload) => {
          const { eventType } = payload;
          if (eventType === 'INSERT') {
            const added = payload.new as Conversation;
            setConversations((prev) => [added, ...prev]);
          } else if (eventType === 'UPDATE') {
            const updated = payload.new as Conversation;

            // Dispara alerta quando status muda para 'pending' (atendente solicitado)
            const prevConv = conversationsRef.current.find((c) => c.id === updated.id);
            if (prevConv && prevConv.status !== 'pending' && updated.status === 'pending') {
              const convId = updated.id;
              const name   = updated.customer_name ?? updated.customer_phone;

              // 1. Notificação OS-level (funciona em segundo plano, persiste até o clique)
              if ('Notification' in window && Notification.permission === 'granted') {
                const notif = new Notification(`${name} precisa de atendimento!`, {
                  body: 'Clique para abrir a conversa',
                  tag: `handoff-${convId}`,
                  requireInteraction: true,
                });
                notif.onclick = () => {
                  window.focus();
                  selectConversation(convId);
                  notif.close();
                };
              }
              // 2. Web Audio ding (bônus)
              playDing();
              // 3. Destaque visual na lista
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
      .subscribe();

    return () => { supabaseTyped.removeChannel(channel); };
  }, [user?.id, playDing, selectConversation]);

  // ── realtime: messages for selected conversation ──────────────────────────

  useEffect(() => {
    if (!selectedId) return;

    const channel = supabaseTyped
      .channel(`msgs-${selectedId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${selectedId}` },
        (payload) => {
          const newMsg = payload.new as Message;
          setMessages((prev) => prev.some((m) => m.id === newMsg.id) ? prev : [...prev, newMsg]);
          setLastMessages((prev) => ({ ...prev, [selectedId]: newMsg }));
        },
      )
      .subscribe();

    return () => { supabaseTyped.removeChannel(channel); };
  }, [selectedId]);

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
    try {
      const res = await fetch(`${supabaseUrl}/functions/v1/send-agent-message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ conversation_id: selectedId, text }),
      });
      if (!res.ok) {
        console.error('[Conversations] Erro ao enviar mensagem');
        setAgentInput(text);
      }
    } catch (e) {
      console.error('[Conversations] Erro de rede:', e);
      setAgentInput(text);
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendAgentMessage(); }
  };

  // ── filtered list ─────────────────────────────────────────────────────────

  const filtered = conversations.filter((c) => {
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
    <div style={{ display: 'flex', height: 'calc(100vh - 80px)', overflow: 'hidden' }}>

      {/* ── lista ──────────────────────────────────────────────────────────── */}
      <div style={{ width: 320, flexShrink: 0, borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', background: 'var(--bg-main)' }}>
        <div style={{ padding: '16px 16px 8px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <MessageCircle size={20} style={{ color: 'var(--primary)' }} />
            <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 700 }}>Conversas WhatsApp</h2>
          </div>
          <div style={{ position: 'relative', marginBottom: 8 }}>
            <Search size={14} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)' }} />
            <input
              type="text" placeholder="Buscar nome ou telefone..." value={search}
              onChange={(e) => setSearch(e.target.value)}
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
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', color: 'var(--text-secondary)', gap: 8 }}>
          <MessageCircle size={48} style={{ opacity: 0.2 }} />
          <p style={{ margin: 0, fontSize: '0.9rem' }}>Selecione uma conversa para ver as mensagens.</p>
        </div>
      ) : (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* header */}
          <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--bg-card)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'var(--primary)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.8rem', fontWeight: 700 }}>
                {initials(selectedConv.customer_name, selectedConv.customer_phone)}
              </div>
              <div>
                <p style={{ margin: 0, fontWeight: 600, fontSize: '0.9rem' }}>{selectedConv.customer_name ?? 'Sem nome'}</p>
                <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                  <PhoneCall size={11} style={{ marginRight: 3 }} />{selectedConv.customer_phone}
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
            </div>
          </div>

          {/* messages */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', background: 'var(--bg-main)' }}>
            {msgLoading
              ? <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 40 }}><Loader2 size={24} style={{ animation: 'spin 1s linear infinite', color: 'var(--primary)' }} /></div>
              : messages.length === 0
                ? <div style={{ textAlign: 'center', color: 'var(--text-secondary)', paddingTop: 40, fontSize: '0.85rem' }}>Nenhuma mensagem ainda.</div>
                : messages.map((msg) => <Bubble key={msg.id} msg={msg} />)}
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
                  ? 'Bot respondendo — atendente notificado. Assuma para intervir ou devolva ao bot.'
                  : 'Conversa encerrada.'}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
