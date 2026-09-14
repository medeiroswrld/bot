import React, { useState } from 'react';
import { Lock, Loader2, AlertCircle, Eye, EyeOff } from 'lucide-react';
import { useAppContext } from '../context/AppContext.jsx';

// Tela de "definir senha nova", para quem chegou pelo link de recuperacao.
//
// Existe porque o link do e-mail JA cria uma sessao valida. Sem esta tela, a
// pessoa cairia direto no CRM logada — e sairia de la sem nunca ter trocado a
// senha que ela nao lembra, voltando ao mesmo problema no proximo login.
const NovaSenha = () => {
  const { definirNovaSenha, logout } = useAppContext();
  const [senha, setSenha]       = useState('');
  const [conf, setConf]         = useState('');
  const [mostrar, setMostrar]   = useState(false);
  const [erro, setErro]         = useState('');
  const [salvando, setSalvando] = useState(false);

  const enviar = async (e) => {
    e.preventDefault();
    setErro('');
    if (senha.length < 6)  { setErro('A senha precisa de pelo menos 6 caracteres.'); return; }
    if (senha !== conf)    { setErro('As duas senhas não são iguais.'); return; }

    setSalvando(true);
    const r = await definirNovaSenha(senha);
    if (!r.success) { setErro(r.error); setSalvando(false); return; }
    // Sem redirecionamento manual: ao limpar `precisaNovaSenha`, o App troca
    // sozinho para o CRM, ja com a sessao valida.
  };

  return (
    <div className="login-layout" style={{ justifyContent: 'center', alignItems: 'center', background: 'var(--bg-app)' }}>
      <div className="card" style={{ width: '100%', maxWidth: 380, padding: '2rem' }}>
        <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
          <Lock size={36} style={{ color: 'var(--accent)' }} />
          <h2 style={{ margin: '0.75rem 0 0.25rem' }}>Criar nova senha</h2>
          <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
            Escolha a senha que você vai usar para entrar daqui pra frente.
          </p>
        </div>

        <form onSubmit={enviar}>
          <div className="form-group">
            <label>Nova senha</label>
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                type={mostrar ? 'text' : 'password'}
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
                autoComplete="new-password"
                placeholder="Mínimo 6 caracteres"
                autoFocus
                style={{ flex: 1 }}
              />
              <button type="button" onClick={() => setMostrar(!mostrar)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)' }}>
                {mostrar ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          <div className="form-group" style={{ marginTop: 12 }}>
            <label>Repita a nova senha</label>
            <input
              type={mostrar ? 'text' : 'password'}
              value={conf}
              onChange={(e) => setConf(e.target.value)}
              autoComplete="new-password"
            />
          </div>

          {erro && (
            <p style={{ display: 'flex', gap: 6, alignItems: 'flex-start', fontSize: '0.82rem', color: '#dc2626', marginTop: 10, lineHeight: 1.4 }}>
              <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 1 }} /> {erro}
            </p>
          )}

          <button className="btn-primary" type="submit" disabled={salvando}
            style={{ width: '100%', marginTop: '1.25rem', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8 }}>
            {salvando ? <><Loader2 size={18} style={{ animation: 'spin 1s linear infinite' }} /> Salvando...</> : 'Salvar e entrar'}
          </button>
        </form>

        <button onClick={logout}
          style={{ width: '100%', marginTop: '1rem', background: 'none', border: 'none', cursor: 'pointer',
                   color: 'var(--color-text-muted)', fontSize: '0.82rem' }}>
          Cancelar
        </button>
      </div>
    </div>
  );
};

export default NovaSenha;
