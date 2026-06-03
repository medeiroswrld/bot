import React, { useState } from 'react';
import { Mail, Lock, Eye, EyeOff, AlertCircle, Loader2, User } from 'lucide-react';
import { useAppContext } from '../context/AppContext.jsx';

const Login = () => {
  const { login, signup } = useAppContext();
  
  const [isSignUp, setIsSignUp] = useState(false);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    // Validações básicas
    if (!email || !password) {
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

    if (password.length < 6) {
      setError('A senha deve ter pelo menos 6 caracteres.');
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
      }
      // Se sucesso, o onAuthStateChange no context redireciona automaticamente
    } catch (err) {
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
          <div className="logo-icon-large">A</div>
          <h1>Automatic<span>Gen</span></h1>
          <p>Potencialize as vendas e a gestão da sua concessionária com a plataforma definitiva.</p>
        </div>
      </div>

      {/* Direita: Formulário */}
      <div className="login-form-container">
        <div className="login-card">
          <div className="login-header">
            <h2>{isSignUp ? 'Criar sua conta' : 'Bem-vindo de volta'}</h2>
            <p>{isSignUp ? 'Preencha os dados para começar' : 'Acesse sua conta para continuar'}</p>
          </div>

          <form onSubmit={handleSubmit} className="login-form">
            {error && (
              <div className="auth-error">
                <AlertCircle size={18} />
                <span>{error}</span>
              </div>
            )}

            {isSignUp && (
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
                  <a href="#esqueceu">Esqueceu sua senha?</a>
                </div>
              )}
            </div>

            <button 
              type="submit" 
              className={`btn-primary btn-login ${isLoading ? 'loading' : ''}`}
              disabled={isLoading}
            >
              {isLoading ? (
                <>
                  <Loader2 className="spinner" size={20} /> {isSignUp ? 'Criando conta...' : 'Entrando...'}
                </>
              ) : (
                isSignUp ? 'Criar conta' : 'Entrar'
              )}
            </button>
          </form>
          
          <div className="login-footer">
            <p>
              {isSignUp ? 'Já tem uma conta? ' : 'Ainda não tem conta? '}
              <a href="#toggle" onClick={(e) => { e.preventDefault(); toggleMode(); }}>
                {isSignUp ? 'Entrar' : 'Criar conta'}
              </a>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Login;
