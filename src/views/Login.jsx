import React, { useState } from 'react';
import { Mail, Lock, Eye, EyeOff, AlertCircle, Loader2, User, MailCheck, ArrowLeft } from 'lucide-react';
import { useAppContext } from '../context/AppContext.jsx';

const Login = () => {
  const { login, signup, recuperarSenha, reenviarConfirmacao, confirmarCadastro } = useAppContext();
  
  const [isSignUp, setIsSignUp] = useState(false);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  // Modo "esqueci minha senha": o link existia na tela desde sempre, mas
  // apontava para `#esqueceu` e nao fazia absolutamente nada.
  const [modoEsqueci, setModoEsqueci] = useState(false);
  // Painel de "confirme seu e-mail", mostrado depois de criar a conta.
  const [aguardandoConfirmacao, setAguardandoConfirmacao] = useState(false);
  const [aviso, setAviso] = useState('');
  const [codigo, setCodigo] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    // Validações básicas
    if (!email || (!password && !modoEsqueci)) {
      setError('Por favor, preencha todos os campos.');
      return;
    }

    if (isSignUp && !fullName.trim()) {
      setError('Por favor, informe seu nome completo.');
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      setError('Por favor, insira um e-mail válido.');
      return;
    }

    if (!modoEsqueci && password.length < 6) {
      setError('A senha deve ter pelo menos 6 caracteres.');
      return;
    }

    // Recuperação de senha: só precisa do e-mail.
    //
    // A mensagem é a MESMA exista a conta ou não, de propósito. Dizer "esse
    // e-mail não está cadastrado" transformaria esta tela num verificador de
    // clientes: com uma lista de e-mails, qualquer um descobriria quem usa o
    // Amply.
    if (modoEsqueci) {
      setIsLoading(true);
      const r = await recuperarSenha(email);
      setIsLoading(false);
      if (!r.success) { setError(r.error); return; }
      setAviso('Se existir uma conta com esse e-mail, o link para criar uma nova senha já está a caminho. Confira também a caixa de spam.');
      return;
    }

    setIsLoading(true);
    try {
      let result;
      if (isSignUp) {
        result = await signup(email, password, fullName.trim());
      } else {
        result = await login(email, password);
      }

      if (!result.success) {
        setError(result.error);
        setIsLoading(false);
        return;
      }

      // Cadastro que exige confirmação NÃO cria sessão, então o
      // onAuthStateChange nunca dispara e a tela ficaria com o botão girando
      // pra sempre. Era exatamente o que acontecia desde que a confirmação de
      // e-mail foi ligada.
      if (result.needsConfirmation) {
        setIsLoading(false);
        setAguardandoConfirmacao(true);
        return;
      }
      // Login normal: o onAuthStateChange no context redireciona sozinho.
    } catch {
      setError('Ocorreu um erro inesperado. Tente novamente.');
      setIsLoading(false);
    }
  };

  const toggleMode = () => {
    setIsSignUp(!isSignUp);
    setError('');
    setFullName('');
  };

  return (
    <div className="login-layout">
      {/* Esquerda: Parte decorativa / Branding */}
      <div className="login-visuals">
        <div className="login-brand">
          <img src="/logo.png" className="login-logo-img" alt="Amply" />
          <h1>Amply</h1>
          <p>Potencialize as vendas e a gestão da sua concessionária com a plataforma definitiva.</p>
        </div>
      </div>

      {/* Direita: Formulário */}
      <div className="login-form-container">
        {aguardandoConfirmacao ? (
          <div className="login-card">
            <div style={{ textAlign: 'center' }}>
              <MailCheck size={42} style={{ color: 'var(--accent)' }} />
              <h2 style={{ margin: '1rem 0 0.5rem' }}>Confirme seu e-mail</h2>
              <p style={{ fontSize: '0.9rem', color: 'var(--color-text-muted)', lineHeight: 1.6 }}>
                Enviamos um código de 6 dígitos para <strong>{email}</strong>.
                Digite ele abaixo para ativar sua conta.
              </p>

              <form onSubmit={async (e) => {
                e.preventDefault();
                setError(''); setAviso('');
                const limpo = codigo.replace(/\D/g, '');
                if (limpo.length !== 6) { setError('O código tem 6 dígitos.'); return; }
                setIsLoading(true);
                const r = await confirmarCadastro(email, limpo);
                if (!r.success) {
                  setIsLoading(false);
                  setError(r.error);
                  setCodigo('');
                  return;
                }
                // Sucesso: o verifyOtp cria a sessão e o App troca pro CRM sozinho.
              }}>
                <input
                  value={codigo}
                  onChange={(ev) => setCodigo(ev.target.value)}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  autoFocus
                  maxLength={7}
                  placeholder="000000"
                  style={{
                    width: '100%', textAlign: 'center', fontSize: '1.7rem',
                    letterSpacing: '0.45rem', padding: '0.65rem', fontFamily: 'monospace',
                    marginTop: '1.25rem',
                  }}
                />
                <button className="btn-primary" type="submit" disabled={isLoading}
                  style={{ width: '100%', marginTop: '0.9rem' }}>
                  {isLoading ? 'Confirmando...' : 'Confirmar e entrar'}
                </button>
              </form>
              <p style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)', marginTop: '1.25rem', lineHeight: 1.6 }}>
                Não chegou? Olhe no spam — é o primeiro e-mail que você recebe da gente,
                e alguns provedores desconfiam da estreia. O código vale por 1 hora.
              </p>

              {aviso && <p style={{ fontSize: '0.82rem', color: '#15803d', marginTop: '1rem' }}>{aviso}</p>}
              {error && <p style={{ fontSize: '0.82rem', color: '#dc2626', marginTop: '1rem' }}>{error}</p>}

              <button
                disabled={isLoading}
                onClick={async () => {
                  setError(''); setAviso(''); setCodigo(''); setIsLoading(true);
                  const r = await reenviarConfirmacao(email);
                  setIsLoading(false);
                  if (r.success) setAviso('Enviamos um código novo. O anterior deixou de valer.');
                  else setError(r.error);
                }}
                style={{ width: '100%', marginTop: '0.75rem', background: 'none',
                         border: '1px solid var(--border-color, #d9d9e3)', borderRadius: 9,
                         padding: '0.6rem', cursor: 'pointer', fontSize: '0.85rem',
                         color: 'var(--color-text-muted)' }}>
                {isLoading ? 'Enviando...' : 'Reenviar código'}
              </button>

              <button
                onClick={() => { setAguardandoConfirmacao(false); setIsSignUp(false); setPassword(''); setAviso(''); setError(''); setCodigo(''); }}
                style={{ width: '100%', marginTop: '1rem', background: 'none', border: 'none', cursor: 'pointer',
                         color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
                Voltar para o login
              </button>
            </div>
          </div>
        ) : (
        <div className="login-card">
          <div className="login-header">
            <h2>{modoEsqueci ? 'Recuperar acesso' : isSignUp ? 'Criar sua conta' : 'Bem-vindo de volta'}</h2>
            <p>{modoEsqueci
              ? 'Informe seu e-mail e enviamos um link para criar uma nova senha'
              : isSignUp ? 'Preencha os dados para começar' : 'Acesse sua conta para continuar'}</p>
          </div>

          <form onSubmit={handleSubmit} className="login-form">
            {error && (
              <div className="auth-error">
                <AlertCircle size={18} />
                <span>{error}</span>
              </div>
            )}

            {isSignUp && !modoEsqueci && (
              <div className="form-group">
                <label htmlFor="fullName">Nome completo</label>
                <div className="input-with-icon">
                  <User className="input-icon" size={18} />
                  <input
                    type="text"
                    id="fullName"
                    placeholder="Seu nome completo"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    disabled={isLoading}
                  />
                </div>
              </div>
            )}

            <div className="form-group">
              <label htmlFor="email">E-mail corporativo</label>
              <div className="input-with-icon">
                <Mail className="input-icon" size={18} />
                <input
                  type="email"
                  id="email"
                  placeholder="exemplo@concessionaria.com.br"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={isLoading}
                />
              </div>
            </div>

            {!modoEsqueci && (
            <div className="form-group">
              <label htmlFor="password">Senha</label>
              <div className="input-with-icon">
                <Lock className="input-icon" size={18} />
                <input
                  type={showPassword ? "text" : "password"}
                  id="password"
                  placeholder={isSignUp ? "Mínimo 6 caracteres" : "Sua senha segura"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={isLoading}
                />
                <button 
                  type="button" 
                  className="icon-btn-toggle"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
              {!isSignUp && (
                <div className="forgot-password">
                  <a href="#esqueceu" onClick={(e) => {
                    e.preventDefault();
                    setModoEsqueci(true); setError(''); setAviso(''); setPassword('');
                  }}>Esqueceu sua senha?</a>
                </div>
              )}
            </div>
            )}

            {aviso && (
              <p style={{ fontSize: '0.85rem', color: '#15803d', lineHeight: 1.5, margin: '4px 0' }}>{aviso}</p>
            )}

            <button 
              type="submit" 
              className={`btn-primary btn-login ${isLoading ? 'loading' : ''}`}
              disabled={isLoading}
            >
              {isLoading ? (
                <>
                  <Loader2 className="spinner" size={20} /> {modoEsqueci ? 'Enviando...' : isSignUp ? 'Criando conta...' : 'Entrando...'}
                </>
              ) : (
                modoEsqueci ? 'Enviar link de recuperação' : isSignUp ? 'Criar conta' : 'Entrar'
              )}
            </button>
          </form>
          
          <div className="login-footer">
            {modoEsqueci ? (
              <p>
                <a href="#voltar" onClick={(e) => { e.preventDefault(); setModoEsqueci(false); setError(''); setAviso(''); }}
                   style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <ArrowLeft size={14} /> Voltar para o login
                </a>
              </p>
            ) : (
              <p>
                {isSignUp ? 'Já tem uma conta? ' : 'Ainda não tem conta? '}
                <a href="#toggle" onClick={(e) => { e.preventDefault(); toggleMode(); }}>
                  {isSignUp ? 'Entrar' : 'Criar conta'}
                </a>
              </p>
            )}
          </div>
        </div>
        )}
      </div>
    </div>
  );
};

export default Login;
