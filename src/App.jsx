import { useState } from 'react';
import { Routes, Route, Link, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, CarFront, Users, Calendar, Settings,
  Bell, LogOut, ShoppingCart, Loader2, MessageCircle, Bot,
  Sun, Moon,
} from 'lucide-react';
import './App.css';

import { AppProvider, useAppContext } from './context/AppContext.jsx';
import Dashboard    from './views/Dashboard.jsx';
import Inventory    from './views/Inventory.jsx';
import Leads        from './views/Leads.jsx';
import Agenda       from './views/Agenda.jsx';
import SoldCars     from './views/SoldCars.jsx';
import SettingsView from './views/Settings.jsx';
import Login        from './views/Login.jsx';
import Conversations from './views/Conversations.tsx';
import BotSettings  from './views/BotSettings.jsx';

// ─── Sidebar ─────────────────────────────────────────────────────────────────

const NAV_ITEMS = [
  { name: 'Início',        icon: <LayoutDashboard size={18} />, path: '/' },
  { name: 'Estoque',       icon: <CarFront size={18} />,        path: '/estoque' },
  { name: 'Vendidos',      icon: <ShoppingCart size={18} />,    path: '/vendidos' },
  { name: 'Leads',         icon: <Users size={18} />,           path: '/leads' },
  { name: 'Agenda',        icon: <Calendar size={18} />,        path: '/agenda' },
  { name: 'Conversas',     icon: <MessageCircle size={18} />,   path: '/conversas' },
  { name: 'Assistente',    icon: <Bot size={18} />,             path: '/assistente' },
  { name: 'Configurações', icon: <Settings size={18} />,        path: '/configuracoes' },
];

const Sidebar = () => {
  const location = useLocation();
  const { logout } = useAppContext();

  const [isDark, setIsDark] = useState(
    () => document.documentElement.classList.contains('dark'),
  );

  const toggleTheme = () => {
    const next = !isDark;
    setIsDark(next);
    document.documentElement.classList.toggle('dark', next);
    localStorage.setItem('amply-theme', next ? 'dark' : 'light');
  };

  const isActive = (path) =>
    path === '/' ? location.pathname === '/' : location.pathname.startsWith(path);

  return (
    <aside className="sidebar">
      {/* Logo */}
      <Link to="/" className="sidebar-logo-link">
        <img src="/logo.png" className="sidebar-logo-img" alt="" />
        <span className="sidebar-label sidebar-brand-label">Amply</span>
      </Link>

      {/* Navigation */}
      <nav className="sidebar-nav">
        <ul>
          {NAV_ITEMS.map((item) => (
            <li key={item.name}>
              <Link
                to={item.path}
                className={`sidebar-nav-item${isActive(item.path) ? ' active' : ''}`}
                data-tooltip={item.name}
              >
                <span className="sidebar-nav-icon">{item.icon}</span>
                <span className="sidebar-label">{item.name}</span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {/* Footer */}
      <div className="sidebar-footer">
        <button
          className="sidebar-footer-btn"
          onClick={toggleTheme}
          data-tooltip={isDark ? 'Modo Claro' : 'Modo Escuro'}
        >
          <span className="sidebar-nav-icon">
            {isDark ? <Sun size={17} /> : <Moon size={17} />}
          </span>
          <span className="sidebar-label">{isDark ? 'Modo Claro' : 'Modo Escuro'}</span>
        </button>
        <button
          type="button"
          className="sidebar-footer-btn logout-btn"
          onClick={(e) => { e.preventDefault(); logout(); }}
          data-tooltip="Sair"
        >
          <span className="sidebar-nav-icon"><LogOut size={17} /></span>
          <span className="sidebar-label">Sair</span>
        </button>
      </div>
    </aside>
  );
};

// ─── Header ──────────────────────────────────────────────────────────────────

const Header = () => {
  const { company, profile } = useAppContext();
  const navigate = useNavigate();

  const displayName = profile?.company_name || company?.name || 'Minha Empresa';

  const getInitials = (name) => {
    if (!name) return 'ME';
    return name.trim().split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  };

  return (
    <header className="main-header">
      <div className="header-search">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-secondary)', flexShrink: 0 }}>
          <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
        <input type="text" placeholder="Buscar carros, leads..." />
      </div>
      <div className="header-actions">
        <button className="icon-btn"><Bell size={18} /></button>
        <div
          className="user-profile"
          onClick={() => navigate('/configuracoes')}
          title="Configurações"
        >
          <div className="profile-img">{getInitials(displayName)}</div>
          <div className="profile-info">
            <p className="profile-name">{displayName}</p>
            <p className="profile-role">Administrador</p>
          </div>
        </div>
      </div>
    </header>
  );
};

// ─── Authenticated app ────────────────────────────────────────────────────────

const AuthenticatedApp = () => {
  const location = useLocation();
  return (
    <div className="app-container">
      <Sidebar />
      <main className="main-content">
        <Header />
        <div key={location.pathname} className="page-transition">
          <Routes location={location}>
            <Route path="/"              element={<Dashboard />} />
            <Route path="/estoque"       element={<Inventory />} />
            <Route path="/vendidos"      element={<SoldCars />} />
            <Route path="/leads"         element={<Leads />} />
            <Route path="/agenda"        element={<Agenda />} />
            <Route path="/conversas"     element={<Conversations />} />
            <Route path="/assistente"    element={<BotSettings />} />
            <Route path="/configuracoes" element={<SettingsView />} />
          </Routes>
        </div>
      </main>
    </div>
  );
};

// ─── Loading screen ───────────────────────────────────────────────────────────

const LoadingScreen = () => (
  <div className="login-layout" style={{ justifyContent: 'center', alignItems: 'center', background: 'var(--bg-app)' }}>
    <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
      <img src="/logo.png" alt="Amply" style={{ width: 72, height: 72, borderRadius: 18, animation: 'pulse 1.5s ease-in-out infinite' }} />
      <Loader2 size={24} style={{ color: 'var(--accent)', animation: 'spin 1s linear infinite' }} />
    </div>
  </div>
);

// ─── Root ─────────────────────────────────────────────────────────────────────

const AppContent = () => {
  const { isAuthenticated, isLoading } = useAppContext();
  if (isLoading) return <LoadingScreen />;
  return isAuthenticated ? <AuthenticatedApp /> : <Login />;
};

function App() {
  return (
    <AppProvider>
      <AppContent />
    </AppProvider>
  );
}

export default App;
