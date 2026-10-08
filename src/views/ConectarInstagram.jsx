import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AtSign, CheckCircle, AlertCircle, RefreshCw, Loader2, Unplug } from 'lucide-react';
import { useAppContext } from '../context/AppContext.jsx';
import { supabase } from '../lib/supabase.js';

// Conectar o Direct do Instagram em um passo.
//
// Duas peças no mesmo arquivo porque são as duas metades de UM fluxo, e separá-las
// faria alguém mudar o `scope` de um lado e não do outro:
//
//   ConectarInstagram — o cartão nas Configurações, com o botão que sai daqui.
//   RetornoInstagram  — a rota /conectar/instagram, onde o Instagram devolve.
//
// ── Por que redirect, e não popup como o WhatsApp ──────────────────────────
//
// O WhatsApp usa FB.login, que é popup. Este fluxo é do Instagram, e o
// Instagram só oferece redirect: o navegador SAI do CRM e volta. A sessão do
// Supabase sobrevive porque vive no localStorage — mas qualquer estado em
// memória morre, e é por isso que o `state` anti-CSRF vai para o
// sessionStorage em vez de um useRef.

// ID público do app do Instagram, do painel da Meta (Instagram → API setup with
// Instagram login). NÃO é o mesmo que o App ID do Facebook usado no WhatsApp:
// o produto Instagram tem ID e chave secreta próprios.
const INSTAGRAM_APP_ID = '1446088727343645';

// O que a loja autoriza. Exatamente as duas permissões que estão em análise —
// pedir mais do que se usa é motivo de reprovação no App Review.
const ESCOPO = 'instagram_business_basic,instagram_business_manage_messages';

const caminhoDeRetorno = () => `${window.location.origin}/conectar/instagram`;

const CHAVE_STATE = 'ig_oauth_state';

const irParaAutorizacao = () => {
  // Aleatório de verdade: `Math.random` aqui seria um state adivinhável, que é
  // o mesmo que não ter state.
  const state = Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map((b) => b.toString(16).padStart(2, '0')).join('');
  sessionStorage.setItem(CHAVE_STATE, state);

  const url = new URL('https://www.instagram.com/oauth/authorize');
  url.searchParams.set('client_id', INSTAGRAM_APP_ID);
  url.searchParams.set('redirect_uri', caminhoDeRetorno());
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', ESCOPO);
  url.searchParams.set('state', state);
  window.location.href = url.toString();
};

// ─── O cartão, nas Configurações ────────────────────────────────────────────

export const ConectarInstagram = () => {
  const { companySettings, refreshCompanySettings } = useAppContext();
  const [saindo, setSaindo] = useState(false);
  const [erroSaida, setErroSaida] = useState('');

  const conectado = Boolean(companySettings?.ig_user_id);
  const arroba    = companySettings?.ig_username;
  const vence     = companySettings?.ig_token_expira_em
    ? new Date(companySettings.ig_token_expira_em)
    : null;

  // Conta antiga, conectada colando ID e token à mão: tem ig_user_id mas nunca
  // teve validade gravada. Merece um empurrão para reconectar, porque é
  // justamente a que vai morrer em silêncio quando o token vencer.
  const naMao = conectado && !vence;

  const faltaConfigurar = !INSTAGRAM_APP_ID;

  const desconectar = async () => {
    // Confirmação com o @ dentro. "Desconectar?" é fácil de clicar por engano,
    // e quem faz isso sem querer numa loja em produção derruba o atendimento
    // do Direct até alguém perceber.
    const quem = arroba ? `@${arroba}` : 'esta conta';
    if (!window.confirm(
      `Desconectar ${quem} do Instagram?\n\n`
      + 'O bot para de responder no Direct. As conversas que já existem continuam '
      + 'guardadas, e dá pra reconectar quando quiser.',
    )) return;

    setErroSaida(''); setSaindo(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/conectar-instagram`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session?.access_token ?? ''}`,
          },
          body: JSON.stringify({ desconectar: true }),
        },
      );
      const j = await res.json();
      if (!res.ok || !j.success) {
        setErroSaida(j.error || 'Não consegui desconectar.');
        return;
      }
      await refreshCompanySettings?.();
    } catch (e) {
      setErroSaida(e?.message || 'Falha de rede ao desconectar.');
    } finally {
      setSaindo(false);
    }
  };

  return (
    <div style={{
      border: '1px solid var(--border)', borderRadius: 10,
      padding: '14px 16px', marginBottom: 14,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <AtSign size={17} />
        <strong style={{ fontSize: '0.9rem' }}>Instagram Direct</strong>
        <span style={{
          fontSize: '0.7rem', fontWeight: 700, padding: '1px 8px', borderRadius: 999,
          background: conectado ? '#dcfce7' : 'var(--input-bg)',
          color: conectado ? '#15803d' : 'var(--color-text-muted)',
        }}>
          {conectado ? 'conectado' : 'não conectado'}
        </span>
      </div>

      {conectado ? (
        <p style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)', lineHeight: 1.55, marginBottom: 10 }}>
          {arroba ? <>Atendendo como <strong>@{arroba}</strong>. </> : 'Conta conectada. '}
          {vence
            ? <>A autorização vale até <strong>{vence.toLocaleDateString('pt-BR')}</strong> e se renova sozinha.</>
            : <>Esta conta foi conectada manualmente. Reconecte pelo botão para a
               autorização passar a se renovar sozinha — <strong>token colado à mão vence
               em 60 dias e para de responder sem avisar</strong>.</>}
        </p>
      ) : (
        <p style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)', lineHeight: 1.55, marginBottom: 10 }}>
          Você entra com a conta do Instagram da loja e autoriza. Não precisa de
          Página do Facebook, e a gente cuida do resto.
        </p>
      )}

      {faltaConfigurar ? (
        <p style={{ display: 'flex', gap: 6, alignItems: 'flex-start', fontSize: '0.8rem', color: '#b45309', lineHeight: 1.5 }}>
          <AlertCircle size={15} style={{ flexShrink: 0, marginTop: 2 }} />
          Falta o ID do app do Instagram no código. Pegue em Meta → seu app →
          Instagram → API setup with Instagram login.
        </p>
      ) : (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <button
            type="button"
            className={conectado && !naMao ? 'btn-outline' : 'btn-primary'}
            onClick={irParaAutorizacao}
            disabled={saindo}
            style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.85rem' }}
          >
            <AtSign size={16} />
            {conectado ? 'Reconectar Instagram' : 'Conectar Instagram'}
          </button>

          {conectado && (
            <button
              type="button"
              className="btn-secondary"
              onClick={desconectar}
              disabled={saindo}
              style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.85rem', color: '#dc2626' }}
            >
              {saindo
                ? <><Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} /> Desconectando...</>
                : <><Unplug size={15} /> Desconectar</>}
            </button>
          )}
        </div>
      )}

      {erroSaida && (
        <p style={{ display: 'flex', gap: 6, alignItems: 'flex-start', fontSize: '0.8rem', color: '#dc2626', marginTop: 8, lineHeight: 1.5 }}>
          <AlertCircle size={15} style={{ flexShrink: 0, marginTop: 2 }} /> {erroSaida}
        </p>
      )}

      {conectado && (
        <p style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: 8, lineHeight: 1.5 }}>
          Reconectar não derruba o atendimento: o token novo só entra depois que
          a Meta confirma tudo.
        </p>
      )}
    </div>
  );
};

// ─── A volta: /conectar/instagram ───────────────────────────────────────────

export const RetornoInstagram = () => {
  const navigate = useNavigate();
  const { refreshCompanySettings } = useAppContext();
  const [estado, setEstado] = useState('trocando');   // trocando | ok | erro
  const [erro, setErro]     = useState('');
  const [etapas, setEtapas] = useState([]);

  // O `code` só pode ser usado UMA vez. Em desenvolvimento o React chama o
  // efeito duas vezes, e sem esta trava a segunda chamada falharia sempre —
  // com uma mensagem de erro que não teria nada a ver com o problema real.
  const jaTrocou = useRef(false);

  useEffect(() => {
    if (jaTrocou.current) return;
    jaTrocou.current = true;

    (async () => {
      const params  = new URLSearchParams(window.location.search);
      const code    = params.get('code');
      const state   = params.get('state');
      const negado  = params.get('error');
      const guardado = sessionStorage.getItem(CHAVE_STATE);
      sessionStorage.removeItem(CHAVE_STATE);

      // Limpa a barra de endereços antes de qualquer outra coisa: o code não
      // precisa ficar no histórico do navegador.
      window.history.replaceState({}, '', '/conectar/instagram');

      if (negado) {
        setErro(params.get('error_description') || 'Você cancelou a autorização.');
        setEstado('erro');
        return;
      }
      if (!code) {
        setErro('A Meta não devolveu o código de autorização.');
        setEstado('erro');
        return;
      }
      if (!state || !guardado || state !== guardado) {
        // Não é firula: sem conferir, um link montado por outra pessoa
        // conectaria o Instagram DELA na conta desta loja.
        setErro('A autorização não confere com a que começou neste navegador. Tente de novo.');
        setEstado('erro');
        return;
      }

      try {
        const { data: { session } } = await supabase.auth.getSession();
        const res = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/conectar-instagram`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${session?.access_token ?? ''}`,
            },
            body: JSON.stringify({ code, redirect_uri: caminhoDeRetorno() }),
          },
        );
        const j = await res.json();
        setEtapas(j.etapas ?? []);
        if (!res.ok || !j.success) {
          setErro(j.error || 'Não consegui concluir a conexão.');
          setEstado('erro');
          return;
        }
        await refreshCompanySettings?.();
        setEstado('ok');
        setTimeout(() => navigate('/assistente/canais'), 2500);
      } catch (e) {
        setErro(e?.message || 'Falha de rede ao concluir a conexão.');
        setEstado('erro');
      }
    })();
  }, [navigate, refreshCompanySettings]);

  return (
    <section className="settings-section card" style={{ maxWidth: 560, margin: '2rem auto' }}>
      <div className="section-title">
        <AtSign size={20} />
        <h2>Conectando o Instagram</h2>
      </div>

      <div className="settings-form">
        {estado === 'trocando' && (
          <p style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: '0.88rem' }}>
            <Loader2 size={18} style={{ animation: 'spin 1s linear infinite' }} />
            Concluindo com a Meta…
          </p>
        )}

        {estado === 'ok' && (
          <p style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: '0.88rem', color: '#16a34a' }}>
            <CheckCircle size={18} /> Pronto. Levando você de volta às configurações…
          </p>
        )}

        {estado === 'erro' && (
          <>
            <p style={{ display: 'flex', gap: 6, alignItems: 'flex-start', fontSize: '0.86rem', color: '#ef4444', lineHeight: 1.5 }}>
              <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 2 }} /> {erro}
            </p>
            <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
              <button type="button" className="btn-primary" onClick={irParaAutorizacao}
                style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.85rem' }}>
                <RefreshCw size={16} /> Tentar de novo
              </button>
              <button type="button" className="btn-outline" onClick={() => navigate('/assistente/canais')}
                style={{ fontSize: '0.85rem' }}>
                Voltar às configurações
              </button>
            </div>
          </>
        )}

        {/* Onde parou, em vez de "deu erro" */}
        {etapas.length > 0 && (
          <ul style={{ listStyle: 'none', padding: 0, margin: '1rem 0 0', fontSize: '0.8rem' }}>
            {etapas.map((e, i) => (
              <li key={i} style={{ color: e.ok ? '#16a34a' : '#ef4444', padding: '2px 0' }}>
                {e.ok ? '✓' : '✕'} {e.etapa}{e.detalhe ? ` — ${e.detalhe}` : ''}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
};

export default ConectarInstagram;
