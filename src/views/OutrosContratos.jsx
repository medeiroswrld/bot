import React, { useCallback, useEffect, useState } from 'react';
import { Plus, Trash2, Save, FileText, Loader2 } from 'lucide-react';
import { useAppContext } from '../context/AppContext.jsx';
import { supabase } from '../lib/supabase.js';
import { MODELO_COMPLETO } from '../lib/contratoCompleto.js';

// "Outros modelos de contrato" — o campo a mais, embaixo do contrato principal.
//
// O contrato que a loja já tem continua exatamente onde estava, no campo acima.
// Aqui entram os OUTROS: repasse, consignação, procuração — cada um com o nome
// que a loja quiser dar. Na hora de fechar a venda, esses nomes viram as opções
// do seletor.
//
// Deliberadamente separado do editor principal: mexer no campo que o lojista já
// conhece, e que já funciona, seria resolver um problema nosso no lugar dele.

const OutrosContratos = () => {
  const { user } = useAppContext();
  const [modelos, setModelos] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState('');
  const [salvo, setSalvo] = useState('');
  const [erro, setErro] = useState('');

  const carregar = useCallback(async () => {
    if (!user?.id) return;
    const { data, error } = await supabase
      .from('contract_templates')
      .select('id, nome, html')
      .order('created_at');
    if (error) setErro('Não consegui carregar os outros modelos.');
    else setModelos((data ?? []).map((m) => ({ ...m, sujo: false })));
    setCarregando(false);
  }, [user?.id]);

  useEffect(() => { carregar(); }, [carregar]);

  const adicionar = async (nome, html) => {
    if (!user?.id) return;
    setErro('');
    const { data, error } = await supabase
      .from('contract_templates')
      .insert({ user_id: user.id, nome, html })
      .select('id, nome, html')
      .single();
    if (error) { setErro(`Não consegui criar: ${error.message}`); return; }
    setModelos((prev) => [...prev, { ...data, sujo: false }]);
  };

  const mexer = (id, campo, valor) => {
    setModelos((prev) => prev.map((m) => (m.id === id ? { ...m, [campo]: valor, sujo: true } : m)));
  };

  const salvar = async (m) => {
    setErro(''); setSalvando(m.id);
    const { error } = await supabase
      .from('contract_templates')
      .update({ nome: m.nome.trim() || 'Sem nome', html: m.html })
      .eq('id', m.id);
    setSalvando('');
    if (error) { setErro(`Não consegui salvar: ${error.message}`); return; }
    setModelos((prev) => prev.map((x) => (x.id === m.id ? { ...x, sujo: false } : x)));
    setSalvo(m.id);
    setTimeout(() => setSalvo(''), 2000);
  };

  const excluir = async (m) => {
    // Confirmação com o nome dentro: "excluir modelo?" é fácil de clicar por
    // engano quando há três na tela.
    if (!window.confirm(`Excluir o modelo "${m.nome}"?\n\nOs contratos já impressos não mudam.`)) return;
    await supabase.from('contract_templates').delete().eq('id', m.id);
    setModelos((prev) => prev.filter((x) => x.id !== m.id));
  };

  return (
    <section className="settings-section card">
      <div className="section-title">
        <FileText size={20} />
        <h2>Outros modelos de contrato</h2>
      </div>

      <div className="settings-form">
        <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', marginBottom: '1rem', lineHeight: 1.55 }}>
          O contrato acima continua sendo o principal. Aqui você acrescenta outros —
          repasse, consignação, o que a sua loja usar. <strong>Na hora de fechar a venda,
          você escolhe qual imprimir.</strong> Os mesmos marcadores valem: <code>{'{{logo}}'}</code>,{' '}
          <code>{'{{comprador_nome}}'}</code>, <code>{'{{placa}}'}</code> e os demais da lista acima.
        </p>

        {carregando ? (
          <p style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
            <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> Carregando...
          </p>
        ) : (
          <>
            {modelos.map((m) => (
              <div key={m.id} style={{
                border: '1px solid var(--border-color)', borderRadius: 12,
                padding: '14px 16px', marginBottom: 14,
              }}>
                <div className="form-group">
                  <label>Nome deste modelo</label>
                  <input
                    value={m.nome}
                    placeholder="Ex.: Contrato de repasse"
                    onChange={(e) => mexer(m.id, 'nome', e.target.value)}
                  />
                </div>

                <div className="form-group" style={{ marginTop: 10 }}>
                  <label>Texto do contrato</label>
                  <textarea
                    rows={12}
                    value={m.html}
                    placeholder="Cole aqui o contrato — pode ser texto simples, direto do Word."
                    onChange={(e) => mexer(m.id, 'html', e.target.value)}
                    style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.78rem', lineHeight: 1.55 }}
                  />
                </div>

                <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  <button type="button" className="btn-primary" style={{ fontSize: '0.82rem' }}
                    disabled={salvando === m.id || !m.sujo}
                    onClick={() => salvar(m)}>
                    {salvando === m.id
                      ? 'Salvando...'
                      : <><Save size={16} /> Salvar</>}
                  </button>
                  <button type="button" className="btn-secondary"
                    style={{ fontSize: '0.82rem', color: '#dc2626' }}
                    onClick={() => excluir(m)}>
                    <Trash2 size={16} /> Excluir
                  </button>
                  {salvo === m.id && (
                    <span style={{ fontSize: '0.8rem', color: '#15803d' }}>Salvo.</span>
                  )}
                  {m.sujo && salvo !== m.id && (
                    <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
                      Alterações não salvas
                    </span>
                  )}
                </div>
              </div>
            ))}

            {erro && <p style={{ fontSize: '0.82rem', color: '#dc2626', marginBottom: 10 }}>{erro}</p>}

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button type="button" className="btn-secondary" style={{ fontSize: '0.82rem' }}
                onClick={() => adicionar('Contrato de repasse', '')}>
                <Plus size={16} /> Adicionar modelo em branco
              </button>

              {/* Atalho pro modelo completo, para quem não tem um texto na mão.
                  Vale o mesmo aviso do contrato principal: é ponto de partida,
                  não peça jurídica pronta. */}
              <button type="button" className="btn-secondary" style={{ fontSize: '0.82rem' }}
                title="Contrato com 12 cláusulas, LGPD, autorização de imagem e duas testemunhas"
                onClick={() => adicionar('Completo (com testemunhas)', MODELO_COMPLETO)}>
                <Plus size={16} /> Adicionar modelo completo pronto
              </button>
            </div>

            <p style={{ fontSize: '0.76rem', color: 'var(--color-text-muted)', marginTop: '1rem', lineHeight: 1.5 }}>
              Os modelos aqui são ponto de partida, não peça jurídica pronta.
              Passe pelo advogado da sua loja antes de usar com cliente.
            </p>
          </>
        )}
      </div>
    </section>
  );
};

export default OutrosContratos;
