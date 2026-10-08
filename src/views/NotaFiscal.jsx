import React, { useEffect, useState } from 'react';
import { FileText, ToggleLeft, ToggleRight, Save, CheckCircle, AlertTriangle } from 'lucide-react';
import { useAppContext } from '../context/AppContext.jsx';
import { supabase } from '../lib/supabase.js';

// Configuração fiscal da loja.
//
// ── O que esta tela assume do lojista, e o que não ─────────────────────────
//
// Ela não pergunta nada que ele precise decidir sozinho. CFOP e série são
// perguntas de contador, e a tela diz isso em vez de deixar um campo vazio com
// uma sigla em cima. Lojista chutando CFOP é autuação, não erro de formulário.
//
// ── Por que nasce em homologação ───────────────────────────────────────────
//
// Nota emitida em homologação não vale como documento e não gera obrigação
// nenhuma. É o único jeito de testar o caminho inteiro — dados da loja, do
// comprador, CFOP, série — sem consequência. Virar para produção é um clique,
// e é deliberado.

const NotaFiscal = () => {
  const { user, companySettings, refreshCompanySettings } = useAppContext();

  const [ie, setIe]         = useState('');
  const [serie, setSerie]   = useState('');
  const [cfop, setCfop]     = useState('');
  const [token, setToken]   = useState('');
  const [salvando, setSalvando] = useState(false);
  const [msg, setMsg]       = useState('');

  const ativo    = companySettings?.nf_ativo === true;
  const producao = companySettings?.nf_ambiente === 'producao';
  const temToken = companySettings?.nf_token_set === true;

  useEffect(() => {
    if (!companySettings) return;
    setIe(companySettings.inscricao_estadual ?? '');
    setSerie(companySettings.nf_serie ?? '');
    setCfop(companySettings.nf_cfop ?? '');
  }, [companySettings]);

  const gravar = async (campos) => {
    if (!user?.id) return;
    setMsg(''); setSalvando(true);
    const { error } = await supabase
      .from('company_settings')
      .update({ ...campos, updated_at: new Date().toISOString() })
      .eq('user_id', user.id);
    setSalvando(false);
    if (error) { setMsg(error.message); return; }
    await refreshCompanySettings();
  };

  const salvarTudo = async () => {
    setMsg(''); setSalvando(true);

    const { error } = await supabase
      .from('company_settings')
      .update({
        inscricao_estadual: ie.trim() || null,
        nf_serie: serie ? Number(serie) : null,
        nf_cfop: cfop.trim() || null,
        nf_provedor: 'focus',
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', user.id);

    if (error) { setSalvando(false); setMsg(error.message); return; }

    if (token.trim()) {
      const { data, error: tokErr } = await supabase.functions.invoke('set-nf-token', {
        body: { token: token.trim() },
      });
      if (tokErr || data?.error) {
        setSalvando(false);
        setMsg(data?.error || 'Não consegui salvar o token.');
        return;
      }
      setToken('');
    }

    setSalvando(false);
    setMsg('Salvo ✓');
    await refreshCompanySettings();
  };

  return (
    <section className="settings-section card">
      <div className="section-title">
        <FileText size={20} />
        <h2>Nota Fiscal</h2>
      </div>

      <div className="settings-form">
        <div style={{
          display: 'flex', gap: 12, alignItems: 'flex-start',
          border: '1px solid var(--border)', borderRadius: 12,
          padding: '14px 16px', marginBottom: 16,
        }}>
          <button onClick={() => gravar({ nf_ativo: !ativo })} disabled={salvando}
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                     color: ativo ? 'var(--accent)' : '#94a3b8', display: 'flex', flexShrink: 0 }}>
            {ativo ? <ToggleRight size={26} /> : <ToggleLeft size={26} />}
          </button>
          <div>
            <strong style={{ fontSize: '0.9rem' }}>Emitir nota fiscal pelo Amply</strong>
            <p style={{ margin: '4px 0 0', fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.55 }}>
              Ao registrar uma venda, aparece o botão de emitir. O certificado fica no
              provedor — nós não guardamos certificado de ninguém.
            </p>
          </div>
        </div>

        {ativo && (
          <>
            {/* O ambiente é a trava mais importante da tela. */}
            <div style={{
              padding: '12px 14px', borderRadius: 10, marginBottom: 16,
              background: producao ? '#fef2f2' : 'var(--input-bg)',
              border: `1px solid ${producao ? '#fecaca' : 'var(--border)'}`,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <strong style={{ fontSize: '0.86rem', color: producao ? '#b91c1c' : 'var(--text-primary)' }}>
                  {producao ? 'PRODUÇÃO — as notas são reais' : 'Homologação — notas de teste'}
                </strong>
                <button
                  type="button"
                  className="btn-secondary"
                  style={{ fontSize: '0.78rem', padding: '4px 10px' }}
                  disabled={salvando}
                  onClick={() => gravar({ nf_ambiente: producao ? 'homologacao' : 'producao' })}
                >
                  {producao ? 'Voltar para teste' : 'Virar para produção'}
                </button>
              </div>
              <p style={{ margin: '6px 0 0', fontSize: '0.78rem', lineHeight: 1.5,
                          color: producao ? '#b91c1c' : 'var(--text-secondary)' }}>
                {producao
                  ? 'Toda nota emitida agora vale como documento fiscal e gera obrigação. Cancelamento só nas primeiras 24 horas.'
                  : 'Nota emitida aqui não vale como documento e não gera obrigação nenhuma. Teste o caminho inteiro antes de virar.'}
              </p>
            </div>

            <div className="form-group">
              <label>Inscrição Estadual</label>
              <input type="text" value={ie} onChange={(e) => setIe(e.target.value)}
                placeholder="Somente números" />
            </div>

            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <div className="form-group" style={{ flex: '1 1 140px' }}>
                <label>Série da nota</label>
                <input type="number" value={serie} onChange={(e) => setSerie(e.target.value)}
                  placeholder="Ex.: 2" />
                <p style={{ fontSize: '0.76rem', color: 'var(--text-secondary)', marginTop: 4, lineHeight: 1.5 }}>
                  Use uma série <strong>diferente</strong> da que vocês já emitem. Assim as
                  numerações não colidem e dá para voltar ao sistema antigo quando quiser.
                </p>
              </div>

              <div className="form-group" style={{ flex: '1 1 140px' }}>
                <label>CFOP</label>
                <input type="text" value={cfop} onChange={(e) => setCfop(e.target.value)}
                  placeholder="Ex.: 5102" />
                <p style={{ fontSize: '0.76rem', color: 'var(--text-secondary)', marginTop: 4, lineHeight: 1.5 }}>
                  <strong>Pergunte ao seu contador.</strong> O CFOP define a tributação, e
                  varia conforme o estado e o regime da loja.
                </p>
              </div>
            </div>

            <div className="form-group">
              <label>Token do Focus NFe</label>
              {temToken && (
                <p style={{ fontSize: '0.8rem', color: '#15803d', display: 'flex', alignItems: 'center', gap: 5, margin: '0 0 6px' }}>
                  <CheckCircle size={14} /> Token cadastrado
                </p>
              )}
              <input type="password" value={token} autoComplete="new-password"
                placeholder={temToken ? 'Em branco mantém o atual' : 'Cole o token do Focus NFe'}
                onChange={(e) => setToken(e.target.value)} />
              <p style={{ fontSize: '0.76rem', color: 'var(--text-secondary)', marginTop: 4, lineHeight: 1.5 }}>
                O Focus tem um token para homologação e outro para produção. Cole o que
                corresponde ao ambiente escolhido acima.
              </p>
            </div>

            {msg && (
              <p style={{ fontSize: '0.82rem', margin: '0 0 10px',
                          color: msg.includes('✓') ? '#15803d' : '#dc2626' }}>
                {msg}
              </p>
            )}

            <button className="btn-primary" onClick={salvarTudo} disabled={salvando}
              style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Save size={18} /> {salvando ? 'Salvando...' : 'Salvar'}
            </button>

            {/* A objeção que vai aparecer na primeira emissão, dita antes. */}
            <p style={{
              display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 16,
              fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.55,
            }}>
              <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 2, color: '#b45309' }} />
              <span>
                A emissão exige o <strong>preço de compra do veículo</strong>. Em veículo
                usado o imposto incide sobre a margem, não sobre o valor da venda — sem
                esse dado a nota sairia com a base de cálculo errada, então o sistema
                recusa emitir em vez de arriscar.
              </span>
            </p>
          </>
        )}
      </div>
    </section>
  );
};

export default NotaFiscal;
