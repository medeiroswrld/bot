import React, { useState } from 'react';
import { Mail, Lock, Eye, EyeOff, AlertCircle, Loader2 } from 'lucide-react';
import { useAppContext } from '../context/AppContext.jsx';

const Login = () => {
  const { login } = useAppContext();
  
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

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      setError('Por favor, insira um e-mail válido.');
      return;
    }

    setIsLoading(true);
    try {
      // Mock login com delay
      await login(email, password);
    } catch (err) {
      setError('E-mail ou senha incorretos.');
      setIsLoading(false);
    }
  };

  return (
    <div className="login-layout">
      {/* Esquerda: Parte decorativa / Branding (Opcional, mas dá cara de SaaS premium) */}
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
            <h2>Bem-vindo de volta</h2>
            <p>Acesse sua conta para continuar</p>
          </div>

          <form onSubmit={handleSubmit} className="login-form">
            {error && (
              <div className="auth-error">
                <AlertCircle size={18} />
                <span>{error}</span>
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
                  placeholder="Sua senha segura"
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
              <div className="forgot-password">
                <a href="#esqueceu">Esqueceu sua senha?</a>
              </div>
            </div>

            <button 
              type="submit" 
              className={`btn-primary btn-login ${isLoading ? 'loading' : ''}`}
              disabled={isLoading}
            >
              {isLoading ? (
                <>
                  <Loader2 className="spinner" size={20} /> Entrando...
                </>
              ) : (
                'Entrar'
              )}
            </button>
          </form>
          
          <div className="login-footer">
            <p>Precisa de ajuda? <a href="#suporte">Fale com o suporte</a></p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Login;
