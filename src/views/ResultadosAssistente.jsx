import React, { useEffect, useState } from 'react';
import { MoonStar, Users, Zap, Image, CalendarCheck } from 'lucide-react';
import { useAppContext } from '../context/AppContext.jsx';
import { supabase } from '../lib/supabase.js';

// O que o assistente fez nos últimos 30 dias.
//
// ── Por que isto existe ────────────────────────────────────────────────────
//
// Veio de "está caro". Ao medir a DSC, o preço não era o problema: o sistema
// atendia 135 pessoas por mês e nunca tinha dito isso a ninguém. O lojista
// pagava e não via. Este painel é a prova que faltava — e o lugar dele é
// dentro do produto, visto todo dia, não num PDF de vendas.
//
// ── O número que lidera ────────────────────────────────────────────────────
//
// "Fora do horário" vem primeiro porque é o único que o lojista não consegue
// contestar. Ele pode achar que o vendedor dele responde igual; não pode achar
// que o vendedor responde às 22h de domingo. É a diferença entre um recurso e
// uma coisa que só existe aqui.
//
// ── O que NÃO está aqui ────────────────────────────────────────────────────
//
// "Vendas geradas pelo assistente". A atribuição hoje depende de alguém marcar
// a venda na mão, e isso quase nunca acontece — mostraria ZERO na maioria dos
// meses. Indicador que exibe zero com o produto funcionando não é
// transparência, é um argumento contra nós mesmos, entregue justamente na
// conversa de renovação. Entra quando existir o botão "esta venda veio do
// assistente" e dois meses de uso dele.

const tempo = (seg) => {
  if (seg == null) return null;
  const s = Number(seg);
  if (s < 60) return `${Math.round(s)} seg`;
  const m = Math.floor(s / 60);
  return `${m} min${s % 60 >= 30 ? ' e meio' : ''}`;
};

const Numero = ({ icone, valor, rotulo, destaque }) => (
  <div style={{
    flex: '1 1 150px',
    padding: '14px 16px',
    borderRadius: 12,
    background: destaque ? 'color-mix(in srgb, var(--accent) 10%, transparent)' : 'var(--input-bg)',
    border: `1px solid ${destaque ? 'color-mix(in srgb, var(--accent) 30%, transparent)' : 'transparent'}`,
  }}>
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6,
      color: destaque ? 'var(--accent)' : 'var(--text-secondary)',
    }}>
      {icone}
    </div>
    <div style={{
      fontSize: '1.5rem', fontWeight: 700, lineHeight: 1.1,
      letterSpacing: '-.02em', fontVariantNumeric: 'tabular-nums',
      color: destaque ? 'var(--accent)' : 'var(--text-primary)',
    }}>
      {valor}
    </div>
    <div style={{ fontSize: '.78rem', color: 'var(--text-secondary)', marginTop: 4, lineHeight: 1.4 }}>
      {rotulo}
    </div>
  </div>
);

const ResultadosAssistente = () => {
  const { user, companySettings } = useAppContext();
  const [dados, setDados] = useState(null);

  useEffect(() => {
    if (!user?.id) return;
    let vivo = true;
    (async () => {
      const { data } = await supabase
        .from('resultados_assistente')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle();
      if (vivo) setDados(data ?? null);
    })();
    return () => { vivo = false; };
  }, [user?.id]);

  // Loja sem assistente contratado não vê nada: os números existiriam (as
  // mensagens chegam igual), mas atribuí-los ao assistente seria falso.
  if (companySettings?.bot_contratado !== true) return null;
  if (!dados || !dados.pessoas_atendidas) return null;

  const resposta = tempo(dados.resposta_mediana_seg);

  return (
    <section className="card" style={{ padding: '1.4rem 1.5rem', marginBottom: '1.5rem' }}>
      <div style={{ marginBottom: 14 }}>
        <h2 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700, letterSpacing: '-.015em' }}>
          O que o assistente fez
        </h2>
        <p style={{ margin: '4px 0 0', fontSize: '.82rem', color: 'var(--text-secondary)' }}>
          Últimos 30 dias
        </p>
      </div>

      {/* A frase vem antes dos números porque número solto não convence
          ninguém — quem convence é o que ele significa. */}
      {dados.fora_do_horario > 0 && (
        <p style={{
          margin: '0 0 16px', fontSize: '.95rem', lineHeight: 1.6,
          color: 'var(--text-primary)', maxWidth: '62ch',
        }}>
          <strong>{dados.fora_do_horario.toLocaleString('pt-BR')} mensagens</strong> chegaram
          com a loja fechada{resposta && <> e foram respondidas em <strong>{resposta}</strong></>}.
          Sem o assistente, essas pessoas teriam esperado até a loja abrir.
        </p>
      )}

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <Numero
          destaque
          icone={<MoonStar size={16} />}
          valor={dados.fora_do_horario.toLocaleString('pt-BR')}
          rotulo="mensagens fora do horário"
        />
        <Numero
          icone={<Users size={16} />}
          valor={dados.pessoas_atendidas.toLocaleString('pt-BR')}
          rotulo="pessoas atendidas"
        />
        {resposta && (
          <Numero icone={<Zap size={16} />} valor={resposta} rotulo="para responder, em média" />
        )}
        {dados.fotos_enviadas > 0 && (
          <Numero
            icone={<Image size={16} />}
            valor={dados.fotos_enviadas.toLocaleString('pt-BR')}
            rotulo="fotos de veículos enviadas"
          />
        )}
        <Numero
          icone={<CalendarCheck size={16} />}
          valor={dados.visitas_agendadas.toLocaleString('pt-BR')}
          rotulo="visitas agendadas"
        />
      </div>
    </section>
  );
};

export default ResultadosAssistente;
