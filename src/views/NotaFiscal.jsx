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
  const [ncm, setNcm]           = useState('');
  const [cst, setCst]           = useState('');
  const [aliquota, setAliquota] = useState('');
  const [reducao, setReducao]   = useState('');
  const [modoBase, setModoBase] = useState('');
  const [cfopTrib, setCfopTrib] = useState('');
  const [infoComp, setInfoComp] = useState('');
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
    setNcm(companySettings.nf_ncm ?? '');
    setCst(companySettings.nf_cst ?? '');
    setAliquota(companySettings.nf_icms_aliquota ?? '');
    setReducao(companySettings.nf_icms_reducao_base ?? '');
    setModoBase(companySettings.nf_base_modo ?? '');
    setCfopTrib(companySettings.nf_cfop_tributado ?? '');
    setInfoComp(companySettings.nf_info_complementar ?? '');
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
        nf_ncm: ncm.replace(/\D/g, '') || null,
        nf_cst: cst.trim() || null,
        // Nulo, nunca zero: zero e uma aliquota valida e o sistema nao pode
        // confundir "o contador disse 0%" com "ninguem preencheu".
        nf_icms_aliquota: aliquota === '' ? null : Number(aliquota),
        nf_icms_reducao_base: reducao === '' ? null : Number(reducao),
        nf_base_modo: modoBase || null,
        nf_cfop_tributado: cfopTrib.trim() || null,
        nf_info_complementar: infoComp.trim() || null,
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

            {/* Tributacao.
                Tudo aqui vem do contador da loja. O sistema nao escolhe
                imposto e RECUSA emitir enquanto estiver em branco — base
                errada nao e bug nosso, e autuacao no cliente. */}
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <div className="form-group" style={{ flex: '1 1 150px' }}>
                <label>NCM padrão</label>
                <input type="text" value={ncm} onChange={(e) => setNcm(e.target.value)}
                  placeholder="8 dígitos" />
                <p style={{ fontSize: '0.76rem', color: 'var(--text-secondary)', marginTop: 4, lineHeight: 1.5 }}>
                  Carro e moto têm NCM diferente. O cadastro do veículo pode ter o próprio.
                </p>
              </div>

              <div className="form-group" style={{ flex: '1 1 130px' }}>
                <label>CST / CSOSN</label>
                <input type="text" value={cst} onChange={(e) => setCst(e.target.value)}
                  placeholder="Ex.: 20" />
                <p style={{ fontSize: '0.76rem', color: 'var(--text-secondary)', marginTop: 4, lineHeight: 1.5 }}>
                  <strong>20</strong> é o de redução de base. Sem zero na frente.
                </p>
              </div>

              <div className="form-group" style={{ flex: '1 1 120px' }}>
                <label>Alíquota de ICMS (%)</label>
                <input type="number" step="0.01" value={aliquota}
                  onChange={(e) => setAliquota(e.target.value)} placeholder="Ex.: 18" />
              </div>
            </div>

            <div className="form-group">
              <label>Como a base de cálculo é apurada</label>
              <select value={modoBase} onChange={(e) => setModoBase(e.target.value)}
                style={{ width: '100%', padding: '0.65rem 1rem', borderRadius: 10,
                         border: '1px solid var(--border)', background: 'var(--card-bg)',
                         color: 'var(--text-primary)' }}>
                <option value="">Pergunte ao seu contador…</option>
                <option value="margem">Sobre a margem (venda − compra)</option>
                <option value="reducao">Redução percentual sobre o valor da venda</option>
                <option value="integral">Valor integral da venda</option>
              </select>
              <p style={{ fontSize: '0.76rem', color: 'var(--text-secondary)', marginTop: 4, lineHeight: 1.5 }}>
                São mecanismos <strong>diferentes</strong>, e qual vale muda por estado e por
                regime. Esta é a pergunta mais importante da lista — é ela que define sobre
                quanto o imposto incide.
              </p>
            </div>

            {modoBase === 'reducao' && (
              <div className="form-group" style={{ maxWidth: 220 }}>
                <label>Redução da base (%)</label>
                <input type="number" step="0.01" value={reducao}
                  onChange={(e) => setReducao(e.target.value)} placeholder="Ex.: 90" />
                <p style={{ fontSize: '0.76rem', color: 'var(--text-secondary)', marginTop: 4, lineHeight: 1.5 }}>
                  Varia por estado e já mudou no tempo. Confirme o percentual vigente.
                </p>
              </div>
            )}

            <div className="form-group">
              <label>CFOP para veículo que entrou com ICMS</label>
              <input type="text" value={cfopTrib} onChange={(e) => setCfopTrib(e.target.value)}
                placeholder="Deixe em branco se não se aplica" />
              <p style={{ fontSize: '0.76rem', color: 'var(--text-secondary)', marginTop: 4, lineHeight: 1.5 }}>
                Veículo comprado de pessoa física costuma entrar no benefício; comprado com
                ICMS destacado, nem sempre. Quando for o caso, a nota sai por este CFOP — e
                o veículo é marcado no cadastro dele.
              </p>
            </div>

            <div className="form-group">
              <label>Informações complementares</label>
              <textarea rows={2} value={infoComp} onChange={(e) => setInfoComp(e.target.value)}
                placeholder="Citação da legislação que concede a redução da base"
                style={{ resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5 }} />
              <p style={{ fontSize: '0.76rem', color: 'var(--text-secondary)', marginTop: 4, lineHeight: 1.5 }}>
                É o que fundamenta o benefício na nota. Sem a citação, o fiscal não tem de
                onde a base menor saiu.
              </p>
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
