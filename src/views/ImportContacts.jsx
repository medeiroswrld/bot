import React, { useMemo, useState } from 'react';
import { X, ClipboardPaste, Check, AlertTriangle, Users } from 'lucide-react';
import { useAppContext } from '../context/AppContext.jsx';
import { normalizarTelefone, formatarTelefone, parsearContatos } from '../lib/phone.js';

// Importação da base antiga de clientes.
//
// É caixa de texto pra COLAR, não upload de arquivo, de propósito: quando o
// lojista seleciona duas colunas no Excel e dá Ctrl+C, o que vai pra área de
// transferência já é "nome<TAB>telefone" por linha. Lendo isso direto a gente
// evita upload, tela de mapear coluna e — principalmente — o inferno de
// encoding do CSV do Excel no Windows, que já corrompeu acento neste projeto.

const EXEMPLO = `João Silva\t(11) 99999-9999
Maria Souza\t11 98888-7777
Pedro Alves\t5511977776666`;

const ImportContacts = ({ onClose }) => {
  const { leads, importLeads, addToast } = useAppContext();
  const [texto, setTexto] = useState('');
  const [etapa, setEtapa] = useState('colar');   // colar | conferir | pronto
  const [salvando, setSalvando] = useState(false);
  const [resultado, setResultado] = useState(null);
  // Classificação em massa + exceções por linha. Padrão 'antigo': quem importa
  // planilha está trazendo carteira velha, e sem isso o contato entraria como
  // "novo" por 30 dias só porque o cadastro no sistema é de hoje.
  const [tipoPadrao, setTipoPadrao] = useState('antigo');
  const [tipoPorLinha, setTipoPorLinha] = useState({});

  // Telefones que já existem, na forma canônica (ignora o nono dígito).
  const jaExistem = useMemo(() => {
    const set = new Set();
    for (const l of leads ?? []) {
      const n = normalizarTelefone(l.phone);
      if (n.ok) set.add(n.chave);
    }
    return set;
  }, [leads]);

  // Analisa linha a linha. Duplicado é tanto contra o banco quanto contra o
  // próprio texto colado — planilha antiga costuma ter o mesmo cliente 2x.
  const analise = useMemo(() => {
    const vistos = new Set();
    return parsearContatos(texto).map((c) => {
      const n = normalizarTelefone(c.telefone);
      if (!n.ok) return { ...c, situacao: 'invalido', detalhe: n.motivo };
      if (jaExistem.has(n.chave)) return { ...c, situacao: 'duplicado', e164: n.e164, detalhe: 'já está na sua base' };
      if (vistos.has(n.chave)) return { ...c, situacao: 'duplicado', e164: n.e164, detalhe: 'repetido na lista colada' };
      vistos.add(n.chave);
      return { ...c, situacao: 'novo', e164: n.e164 };
    });
  }, [texto, jaExistem]);

  const novos       = analise.filter((a) => a.situacao === 'novo');
  const duplicados  = analise.filter((a) => a.situacao === 'duplicado');
  const invalidos   = analise.filter((a) => a.situacao === 'invalido');

  const confirmar = async () => {
    setSalvando(true);
    try {
      const res = await importLeads(
        novos.map((n) => ({
          // `name` é NOT NULL no banco; sem nome, o telefone formatado é mais
          // útil que "Cliente" — dá pra identificar na lista.
          name: n.nome || formatarTelefone(n.e164),
          phone: n.e164,
          client_type: tipoPorLinha[n.e164] ?? tipoPadrao,
        })),
      );
      setResultado(res);
      setEtapa('pronto');
    } catch (e) {
      addToast(`Falha ao importar: ${e.message ?? e}`, 'error');
    } finally {
      setSalvando(false);
    }
  };

  const CORES = {
    novo:      { bg: '#ecfdf5', cor: '#059669', rotulo: 'novo' },
    duplicado: { bg: '#fff7ed', cor: '#d97706', rotulo: 'já existe' },
    invalido:  { bg: '#fef2f2', cor: '#dc2626', rotulo: 'inválido' },
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" style={{ maxWidth: 720, width: '100%' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--border)' }}>
          <h2 style={{ margin: 0, fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Users size={18} /> Importar clientes antigos
          </h2>
          <button className="icon-btn" onClick={onClose}><X size={18} /></button>
        </div>

        {etapa === 'colar' && (
          <div style={{ padding: '1.5rem' }}>
            <p style={{ marginTop: 0, color: 'var(--text-secondary)', fontSize: '0.9rem', lineHeight: 1.5 }}>
              Abra sua planilha, selecione as colunas de <strong>nome</strong> e <strong>telefone</strong>,
              copie (Ctrl+C) e cole aqui. Um contato por linha. Se tiver só os telefones, também funciona.
            </p>
            <textarea
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              placeholder={EXEMPLO}
              rows={12}
              style={{
                width: '100%', padding: '0.75rem', borderRadius: 8, resize: 'vertical',
                border: '1px solid var(--border)', background: 'var(--card-bg)',
                color: 'var(--text-primary)', fontFamily: 'monospace', fontSize: '0.85rem',
              }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1rem' }}>
              <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                {analise.length > 0 ? `${analise.length} linha${analise.length !== 1 ? 's' : ''} detectada${analise.length !== 1 ? 's' : ''}` : ''}
              </span>
              <button className="btn-primary" disabled={!analise.length} onClick={() => setEtapa('conferir')}>
                <ClipboardPaste size={15} /> Conferir
              </button>
            </div>
          </div>
        )}

        {etapa === 'conferir' && (
          <div style={{ padding: '1.5rem' }}>
            <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
              {[['novo', novos.length], ['duplicado', duplicados.length], ['invalido', invalidos.length]].map(([k, n]) => (
                <span key={k} style={{ padding: '0.35rem 0.7rem', borderRadius: 999, background: CORES[k].bg, color: CORES[k].cor, fontSize: '0.8rem', fontWeight: 600 }}>
                  {n} {CORES[k].rotulo}{n !== 1 ? 's' : ''}
                </span>
              ))}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: '0.85rem', paddingBottom: '0.85rem', borderBottom: '1px solid var(--border)' }}>
              <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>Classificar todos como:</span>
              {['antigo', 'novo'].map((t) => (
                <button
                  key={t}
                  type="button"
                  className={`inv-filter-btn ${tipoPadrao === t ? 'active' : ''}`}
                  onClick={() => { setTipoPadrao(t); setTipoPorLinha({}); }}
                >
                  {t === 'antigo' ? 'Clientes antigos' : 'Clientes novos'}
                </button>
              ))}
              <span style={{ fontSize: '0.76rem', color: 'var(--text-secondary)' }}>
                (dá pra mudar um a um na lista)
              </span>
            </div>

            <div style={{ maxHeight: 320, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                <tbody>
                  {analise.slice(0, 300).map((a, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '0.5rem 0.75rem' }}>{a.nome || <em style={{ color: 'var(--text-secondary)' }}>sem nome</em>}</td>
                      <td style={{ padding: '0.5rem 0.75rem', fontFamily: 'monospace' }}>
                        {a.e164 ? formatarTelefone(a.e164) : a.telefone}
                      </td>
                      <td style={{ padding: '0.5rem 0.75rem', textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {a.situacao === 'novo' ? (
                          // Só o que vai entrar pode ser reclassificado — mudar
                          // o tipo de uma linha ignorada não faria nada.
                          <button
                            type="button"
                            onClick={() => setTipoPorLinha((p) => ({
                              ...p,
                              [a.e164]: (p[a.e164] ?? tipoPadrao) === 'antigo' ? 'novo' : 'antigo',
                            }))}
                            title="Clique pra alternar entre antigo e novo"
                            style={{
                              border: '1px solid var(--border)', borderRadius: 999,
                              padding: '2px 10px', fontSize: '0.75rem', fontWeight: 600,
                              cursor: 'pointer', background: 'transparent',
                              color: (tipoPorLinha[a.e164] ?? tipoPadrao) === 'novo' ? '#059669' : '#475569',
                            }}
                          >
                            {(tipoPorLinha[a.e164] ?? tipoPadrao) === 'novo' ? 'novo' : 'antigo'}
                          </button>
                        ) : (
                          <span style={{ color: CORES[a.situacao].cor }}>{a.detalhe ?? CORES[a.situacao].rotulo}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {analise.length > 300 && (
                <p style={{ padding: '0.6rem 0.75rem', margin: 0, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                  … e mais {analise.length - 300} linhas (todas serão importadas)
                </p>
              )}
            </div>

            {invalidos.length > 0 && (
              <p style={{ display: 'flex', gap: 6, alignItems: 'flex-start', marginTop: '0.85rem', fontSize: '0.82rem', color: '#b45309' }}>
                <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 2 }} />
                Linhas inválidas são ignoradas. Volte e corrija se algum número importante estiver aí.
              </p>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '1.25rem' }}>
              <button className="btn-secondary" onClick={() => setEtapa('colar')}>Voltar</button>
              <button className="btn-primary" disabled={!novos.length || salvando} onClick={confirmar}>
                {salvando ? 'Importando…' : `Importar ${novos.length} contato${novos.length !== 1 ? 's' : ''}`}
              </button>
            </div>
          </div>
        )}

        {etapa === 'pronto' && (
          <div style={{ padding: '2rem 1.5rem', textAlign: 'center' }}>
            <Check size={40} style={{ color: '#10b981' }} />
            <h3 style={{ margin: '0.75rem 0 0.25rem' }}>{resultado?.inseridos ?? 0} contatos importados</h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', lineHeight: 1.5, maxWidth: 440, margin: '0.5rem auto 0' }}>
              Eles entraram como <strong>base importada</strong> e ficam fora do funil do dia a dia.
              Pra disparar campanha só pra eles, escolha o público <strong>“Base importada”</strong> em Marketing.
            </p>
            <p style={{ display: 'flex', gap: 6, textAlign: 'left', alignItems: 'flex-start', maxWidth: 440, margin: '1.25rem auto 0', fontSize: '0.82rem', color: '#b45309' }}>
              <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 2 }} />
              Dispare em lotes, começando pelos clientes mais recentes. Mensagem em massa pra
              quem não espera contato gera bloqueio, e bloqueio derruba a reputação do seu número
              no WhatsApp.
            </p>
            <button className="btn-primary" style={{ marginTop: '1.5rem' }} onClick={onClose}>Fechar</button>
          </div>
        )}
      </div>
    </div>
  );
};

export default ImportContacts;
