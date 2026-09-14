import React, { useCallback, useEffect, useState } from 'react';
import { ShieldCheck, ShieldOff, Loader2, AlertCircle, Copy, Check } from 'lucide-react';
import { listarFatores, criarFator, confirmarFator, removerFator } from '../lib/doisFatores.js';

// Seção "Verificação em duas etapas" da tela de Configurações.
//
// Três estados: sem fator (oferece ativar), cadastrando (QR + código) e ativo
// (oferece desativar). O passo do meio existe porque cadastrar NÃO ativa: o
// fator só passa a valer depois do primeiro código conferido.

const QrCode = ({ conteudo }) => {
  // O Supabase devolve o QR ora como SVG cru, ora como data URI, dependendo da
  // versão. Aceitar os dois evita um quadrado branco sem explicação.
  if (!conteudo) return null;
  if (conteudo.trim().startsWith('<svg')) {
    return <div style={{ width: 180, height: 180 }} dangerouslySetInnerHTML={{ __html: conteudo }} />;
  }
  return <img src={conteudo} alt="QR Code do autenticador" style={{ width: 180, height: 180 }} />;
};

const DoisFatores = () => {
  const [carregando, setCarregando] = useState(true);
  const [ativo, setAtivo]     = useState(null);   // fator verificado, se houver
  const [novo, setNovo]       = useState(null);   // { id, qr, segredo } durante o cadastro
  const [codigo, setCodigo]   = useState('');
  const [msg, setMsg]         = useState('');
  const [erro, setErro]       = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [copiado, setCopiado] = useState(false);

  const recarregar = useCallback(async () => {
    setCarregando(true);
    try {
      const { ativos } = await listarFatores();
      setAtivo(ativos[0] ?? null);
    } catch {
      setErro('Não consegui verificar o estado da verificação em duas etapas.');
    }
    setCarregando(false);
  }, []);

  useEffect(() => { recarregar(); }, [recarregar]);

  const iniciar = async () => {
    setErro(''); setMsg(''); setOcupado(true);
    try {
      setNovo(await criarFator());
    } catch (e) {
      setErro(e?.message || 'Não consegui gerar o código de cadastro.');
    }
    setOcupado(false);
  };

  const confirmar = async () => {
    setErro('');
    const limpo = codigo.replace(/\D/g, '');
    if (limpo.length !== 6) { setErro('O código tem 6 dígitos.'); return; }
    setOcupado(true);
    try {
      await confirmarFator(novo.id, limpo);
      setNovo(null); setCodigo('');
      setMsg('Verificação em duas etapas ativada.');
      await recarregar();
    } catch {
      setErro('Código inválido ou vencido. O aplicativo troca o código a cada 30 segundos.');
      setCodigo('');
    }
    setOcupado(false);
  };

  const desativar = async () => {
    if (!window.confirm('Desativar a verificação em duas etapas? Sua conta volta a ser protegida só pela senha.')) return;
    setErro(''); setMsg(''); setOcupado(true);
    try {
      await removerFator(ativo.id);
      setMsg('Verificação em duas etapas desativada.');
      await recarregar();
    } catch (e) {
      setErro(e?.message || 'Não consegui desativar.');
    }
    setOcupado(false);
  };

  const copiarSegredo = async () => {
    try {
      await navigator.clipboard.writeText(novo.segredo);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      // Navegador sem permissão de área de transferência: o segredo continua
      // na tela pra copiar à mão, então não vale mostrar erro.
    }
  };

  return (
    <section className="settings-section card">
      <div className="section-title">
        {ativo ? <ShieldCheck size={20} /> : <ShieldOff size={20} />}
        <h2>Verificação em duas etapas</h2>
      </div>

      <div className="settings-form">
        {carregando ? (
          <p style={{ display: 'flex', gap: 8, alignItems: 'center', color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
            <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> Verificando...
          </p>
        ) : ativo ? (
          <>
            <p style={{ fontSize: '0.85rem', color: '#15803d', marginBottom: '0.75rem', display: 'flex', gap: 6, alignItems: 'center' }}>
              <ShieldCheck size={16} /> <strong>Ativada.</strong>
            </p>
            <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', marginBottom: '1rem', lineHeight: 1.5 }}>
              Além da senha, entrar nesta conta passa a exigir o código do seu aplicativo autenticador.
            </p>
            <button className="btn-secondary" onClick={desativar} disabled={ocupado}>
              {ocupado ? 'Aguarde...' : 'Desativar'}
            </button>
          </>
        ) : novo ? (
          <>
            <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', marginBottom: '1rem', lineHeight: 1.5 }}>
              Abra o Google Authenticator, o Authy ou o app de senhas do seu celular e
              leia o código abaixo. Depois digite os 6 dígitos que ele mostrar.
            </p>

            <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'flex-start' }}>
              <div style={{ background: '#fff', padding: 10, borderRadius: 8, lineHeight: 0 }}>
                <QrCode conteudo={novo.qr} />
              </div>

              <div style={{ flex: '1 1 220px' }}>
                <label style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
                  Não consegue ler o QR? Digite esta chave no aplicativo:
                </label>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 6 }}>
                  <code style={{ flex: 1, fontSize: '0.78rem', wordBreak: 'break-all', background: 'var(--bg-app)', padding: '6px 8px', borderRadius: 6 }}>
                    {novo.segredo}
                  </code>
                  <button onClick={copiarSegredo} title="Copiar"
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)' }}>
                    {copiado ? <Check size={16} /> : <Copy size={16} />}
                  </button>
                </div>

                <div className="form-group" style={{ marginTop: 16 }}>
                  <label>Código do aplicativo</label>
                  <input value={codigo} onChange={(e) => setCodigo(e.target.value)}
                    inputMode="numeric" autoComplete="one-time-code" maxLength={7} placeholder="000000"
                    style={{ fontFamily: 'monospace', letterSpacing: '0.2rem' }} />
                </div>

                <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                  <button className="btn-primary" onClick={confirmar} disabled={ocupado}>
                    {ocupado ? 'Conferindo...' : 'Ativar'}
                  </button>
                  <button className="btn-secondary" onClick={() => { setNovo(null); setCodigo(''); setErro(''); }} disabled={ocupado}>
                    Cancelar
                  </button>
                </div>
              </div>
            </div>
          </>
        ) : (
          <>
            <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', marginBottom: '1rem', lineHeight: 1.5 }}>
              Pede um código do celular além da senha na hora de entrar. Se alguém
              descobrir sua senha, ainda assim não entra.
            </p>
            <button className="btn-primary" onClick={iniciar} disabled={ocupado}
              style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {ocupado ? 'Gerando...' : <><ShieldCheck size={18} /> Ativar</>}
            </button>
          </>
        )}

        {erro && (
          <p style={{ display: 'flex', gap: 6, alignItems: 'flex-start', fontSize: '0.82rem', color: '#dc2626', marginTop: 10, lineHeight: 1.4 }}>
            <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 1 }} /> {erro}
          </p>
        )}
        {msg && <p style={{ fontSize: '0.82rem', color: '#15803d', marginTop: 10 }}>{msg}</p>}

        {!ativo && (
          <p style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)', marginTop: '1rem', lineHeight: 1.5 }}>
            <strong>Antes de ativar:</strong> se você trocar ou perder o celular, só o
            suporte consegue devolver seu acesso. Guarde a chave acima em lugar seguro.
          </p>
        )}
      </div>
    </section>
  );
};

export default DoisFatores;
