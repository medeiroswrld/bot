import React, { useEffect, useState } from 'react';
import { CreditCard, CheckCircle2, AlertTriangle, Loader2, ExternalLink, RefreshCw } from 'lucide-react';
import { useAppContext } from '../context/AppContext.jsx';
import { supabase } from '../lib/supabase.js';

// Seção "Assinatura" da tela de Configurações.
//
// O cartão NUNCA é digitado aqui. O botão chama a edge function, recebe uma URL
// do Checkout do Asaas e manda o lojista pra lá — página deles, certificada
// PCI. É a razão de o Amply não guardar dado de cartão em lugar nenhum.

const real = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const dataCurta = (d) => {
  if (!d) return '';
  // Data pura (YYYY-MM-DD) não pode passar por new Date() sem fuso: vira o dia
  // anterior no Brasil.
  const [a, m, dia] = String(d).slice(0, 10).split('-');
  return `${dia}/${m}/${a}`;
};

const ESTADOS = {
  ativa:          { cor: '#15803d', fundo: '#f0fdf4', borda: '#bbf7d0', titulo: 'Assinatura ativa' },
  isento:         { cor: '#1d4ed8', fundo: '#eff6ff', borda: '#bfdbfe', titulo: 'Cobrança combinada à parte' },
  atrasada:       { cor: '#b45309', fundo: '#fffbeb', borda: '#fde68a', titulo: 'Pagamento pendente' },
  cancelada:      { cor: '#b91c1c', fundo: '#fef2f2', borda: '#fecaca', titulo: 'Assinatura cancelada' },
  sem_assinatura: { cor: '#3f3f46', fundo: '#fafafa', borda: '#e4e4e7', titulo: 'Sem assinatura ativa' },
};

const Assinatura = () => {
  const { companySettings, refreshCompanySettings } = useAppContext();
  const [carregando, setCarregando] = useState(false);
  const [uso, setUso] = useState(null);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');

  const status = companySettings?.assinatura_status ?? 'sem_assinatura';
  const visual = ESTADOS[status] ?? ESTADOS.sem_assinatura;
  const valor  = Number(companySettings?.billing_amount) || 0;

  // Quem volta do checkout chega com ?assinatura=ok. O pagamento em si é
  // confirmado pelo webhook, não por essa URL — ela serve só pra saber que vale
  // a pena reconsultar o estado, que costuma chegar em poucos segundos.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const r = p.get('assinatura');
    if (!r) return;

    if (r === 'ok') {
      setAviso('Pagamento recebido. Estamos confirmando com a operadora — pode levar alguns segundos.');
      refreshCompanySettings();
      const t = setTimeout(() => refreshCompanySettings(), 6000);
      // Limpa a URL pra um F5 não repetir a mensagem.
      window.history.replaceState({}, '', window.location.pathname);
      return () => clearTimeout(t);
    }
    if (r === 'cancelada') setAviso('Pagamento cancelado. Você pode tentar de novo quando quiser.');
    if (r === 'expirada')  setAviso('O link expirou. Gere um novo abaixo.');
    window.history.replaceState({}, '', window.location.pathname);
  }, [refreshCompanySettings]);

  // Consumo do mês. Vem de uma função no banco, e não de uma consulta direta,
  // porque a tabela de uso guarda CUSTO — o lojista vê quantas conversas usou,
  // não quanto cada uma custou.
  useEffect(() => {
    let vivo = true;
    (async () => {
      const { data, error } = await supabase.rpc('meu_uso_do_mes');
      if (!vivo || error) return;
      const linha = Array.isArray(data) ? data[0] : data;
      if (linha) setUso(linha);
    })();
    return () => { vivo = false; };
  }, [companySettings?.plano]);

  const abrirCheckout = async () => {
    setErro(''); setAviso(''); setCarregando(true);
    try {
      const { data, error } = await supabase.functions.invoke('assinatura-criar', { body: {} });

      // A função responde 409 com uma explicação quando ainda não há valor
      // combinado. O supabase-js trata isso como erro, então o motivo real vem
      // no corpo e precisa ser lido de lá — senão o lojista veria só
      // "Edge Function returned a non-2xx status code".
      if (error) {
        let msg = 'Não consegui abrir o pagamento. Tente de novo em instantes.';
        try {
          const corpo = await error.context?.json?.();
          if (corpo?.error) msg = corpo.error;
        } catch { /* fica a mensagem genérica */ }
        setErro(msg);
        return;
      }
      if (data?.error) { setErro(data.error); return; }
      if (!data?.link) { setErro('O pagamento não retornou um link válido.'); return; }

      // Aba nova: se o lojista desistir, ele não perde o que estava fazendo no CRM.
      window.open(data.link, '_blank', 'noopener');
      setAviso('Abrimos o pagamento em outra aba. Assim que concluir, esta tela atualiza sozinha.');
    } catch (e) {
      setErro(e?.message || 'Falha inesperada ao abrir o pagamento.');
    } finally {
      setCarregando(false);
    }
  };

  return (
    <section className="settings-section card">
      <div className="section-title">
        <CreditCard size={20} />
        <h2>Assinatura</h2>
      </div>

      <div className="settings-form">
        <div style={{
          background: visual.fundo, border: `1px solid ${visual.borda}`,
          borderRadius: 10, padding: '14px 16px', marginBottom: '1rem',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: visual.cor, fontWeight: 600 }}>
            {status === 'ativa' ? <CheckCircle2 size={18} />
              : status === 'isento' ? <CheckCircle2 size={18} />
              : <AlertTriangle size={18} />}
            {visual.titulo}
          </div>

          <div style={{ marginTop: 8, fontSize: '0.86rem', color: '#52525b', lineHeight: 1.6 }}>
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
                Reative abaixo quando quiser voltar.
              </div>
            )}
            {status === 'sem_assinatura' && (
              <div>
                {valor > 0
                  ? <>Seu plano é de <strong>{real(valor)}</strong> por mês. Ative abaixo para liberar o atendimento automático.</>
                  : <>Assim que combinarmos o valor do seu plano, ele aparece aqui para você ativar.</>}
              </div>
            )}
          </div>
        </div>

        {/* Consumo do mês.
            A barra existe pra conversa comercial acontecer ANTES do estouro: o
            limite nunca corta o bot (isso seria o lojista perdendo venda por
            causa do nosso plano), então o aviso é a única coisa que separa uma
            conversa tranquila de uma fatura surpresa. */}
        {uso && uso.limite > 0 && (() => {
          const usadas = Number(uso.usadas || 0);
          const limite = Number(uso.limite);
          const pct = Math.min(100, Math.round((usadas / limite) * 100));
          const perto = pct >= 80;
          const cor = pct >= 100 ? '#b45309' : perto ? '#b45309' : '#5B5BFF';
          return (
            <div style={{ marginBottom: '1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', color: '#52525b' }}>
                <span>Plano <strong>{uso.plano_nome}</strong> — conversas deste mês</span>
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

        {uso && uso.limite === null && uso.plano_slug === 'personalizado' && (
          <p style={{ fontSize: '0.82rem', color: '#52525b', marginBottom: '1rem' }}>
            Plano <strong>personalizado</strong>, sem limite de conversas.
            Você fez <strong>{Number(uso.usadas || 0)}</strong> este mês.
          </p>
        )}

        {aviso && <p style={{ fontSize: '0.84rem', color: '#15803d', marginBottom: 10 }}>{aviso}</p>}
        {erro &&  <p style={{ fontSize: '0.84rem', color: '#dc2626', marginBottom: 10 }}>{erro}</p>}

        {status !== 'isento' && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {(status !== 'ativa') && (
              <button className="btn-primary" onClick={abrirCheckout} disabled={carregando}
                style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {carregando
                  ? <><Loader2 size={18} style={{ animation: 'spin 1s linear infinite' }} /> Abrindo...</>
                  : <><ExternalLink size={18} /> {status === 'sem_assinatura' ? 'Ativar assinatura' : 'Regularizar pagamento'}</>}
              </button>
            )}
            <button className="btn-secondary" onClick={refreshCompanySettings}
              style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <RefreshCw size={16} /> Atualizar
            </button>
          </div>
        )}

        <p style={{ fontSize: '0.76rem', color: 'var(--color-text-muted)', marginTop: '1rem', lineHeight: 1.5 }}>
          O pagamento acontece numa página segura do Asaas. <strong>A Amply não recebe nem
          armazena os dados do seu cartão.</strong>
        </p>
      </div>
    </section>
  );
};

export default Assinatura;
