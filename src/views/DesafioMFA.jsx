import React, { useState } from 'react';
import { ShieldCheck, Loader2, AlertCircle, LogOut } from 'lucide-react';
import { responderDesafio } from '../lib/doisFatores.js';
import { useAppContext } from '../context/AppContext.jsx';

// Tela do segundo fator, entre a senha e o sistema.
//
// Ela aparece porque o Supabase JÁ considera o usuário logado depois da senha —
// só que numa sessão de nível 'aal1'. Quem tem aplicativo cadastrado precisa
// chegar em 'aal2', e é este código que faz a ponte. Sem este portão o sistema
// abriria normalmente com a senha sozinha, e o 2FA seria enfeite.
//
// O botão de sair é obrigatório: sem ele, quem perdeu o celular fica preso numa
// tela sem saída, nem conseguindo voltar pro login pra tentar outra conta.
const DesafioMFA = ({ onConfirmado }) => {
  const { logout } = useAppContext();
  const [codigo, setCodigo]   = useState('');
  const [erro, setErro]       = useState('');
  const [enviando, setEnviando] = useState(false);

  const enviar = async (e) => {
    e.preventDefault();
    setErro('');
    const limpo = codigo.replace(/\D/g, '');
    if (limpo.length !== 6) { setErro('O código tem 6 dígitos.'); return; }

    setEnviando(true);
    try {
      await responderDesafio(limpo);
      onConfirmado?.();
    } catch (err) {
      // O erro do Supabase aqui é em inglês e genérico; o que o usuário precisa
      // saber é que código do autenticador expira a cada 30 segundos.
      setErro('Código inválido ou vencido. Confira no aplicativo e tente de novo — ele troca a cada 30 segundos.');
      setCodigo('');
      setEnviando(false);
    }
  };

  return (
    <div className="login-layout" style={{ justifyContent: 'center', alignItems: 'center', background: 'var(--bg-app)' }}>
      <div className="card" style={{ width: '100%', maxWidth: 380, padding: '2rem' }}>
        <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
          <ShieldCheck size={40} style={{ color: 'var(--accent)' }} />
          <h2 style={{ margin: '0.75rem 0 0.25rem' }}>Verificação em duas etapas</h2>
          <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
            Abra seu aplicativo autenticador e digite o código de 6 dígitos.
          </p>
        </div>

        <form onSubmit={enviar}>
          <input
            value={codigo}
            onChange={(e) => setCodigo(e.target.value)}
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            maxLength={7}
            placeholder="000000"
            style={{
              width: '100%', textAlign: 'center', fontSize: '1.6rem',
              letterSpacing: '0.4rem', padding: '0.6rem', fontFamily: 'monospace',
            }}
          />

          {erro && (
            <p style={{ display: 'flex', gap: 6, alignItems: 'flex-start', fontSize: '0.82rem', color: '#dc2626', marginTop: 10, lineHeight: 1.4 }}>
              <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 1 }} /> {erro}
            </p>
          )}

          <button className="btn-primary" type="submit" disabled={enviando}
            style={{ width: '100%', marginTop: '1rem', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8 }}>
            {enviando ? <><Loader2 size={18} style={{ animation: 'spin 1s linear infinite' }} /> Verificando...</> : 'Entrar'}
          </button>
        </form>

        <button onClick={logout}
          style={{ width: '100%', marginTop: '1rem', background: 'none', border: 'none', cursor: 'pointer',
                   color: 'var(--color-text-muted)', fontSize: '0.82rem', display: 'flex',
                   justifyContent: 'center', alignItems: 'center', gap: 6 }}>
          <LogOut size={14} /> Sair e usar outra conta
        </button>

        <p style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: '1.25rem', textAlign: 'center', lineHeight: 1.5 }}>
          Perdeu o acesso ao aplicativo? Fale com o suporte para remover a verificação da sua conta.
        </p>
      </div>
    </div>
  );
};

export default DesafioMFA;
