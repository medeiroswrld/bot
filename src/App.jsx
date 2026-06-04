import { useState, lazy, Suspense } from 'react';
import { Routes, Route, Link, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, CarFront, Users, Calendar, Settings,
  Bell, LogOut, ShoppingCart, Loader2, MessageCircle, Bot,
  Sun, Moon,
} from 'lucide-react';
import './App.css';

import { AppProvider, useAppContext } from './context/AppContext.jsx';

const Dashboard    = lazy(() => import('./views/Dashboard.jsx'));
const Inventory    = lazy(() => import('./views/Inventory.jsx'));
const Leads        = lazy(() => import('./views/Leads.jsx'));
const Agenda       = lazy(() => import('./views/Agenda.jsx'));
const SoldCars     = lazy(() => import('./views/SoldCars.jsx'));
const SettingsView = lazy(() => import('./views/Settings.jsx'));
const Login        = lazy(() => import('./views/Login.jsx'));
const Conversations = lazy(() => import('./views/Conversations.tsx'));
const BotSettings  = lazy(() => import('./views/BotSettings.jsx'));

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

const PageLoader = () => (
  <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', padding: 60 }}>
    <Loader2 size={24} style={{ color: 'var(--accent)', animation: 'spin 1s linear infinite' }} />
  </div>
);

const AuthenticatedApp = () => {
  const location = useLocation();
  return (
    <div className="app-container">
      <Sidebar />
      <main className="main-content">
        <Header />
        <Suspense fallback={<PageLoader />}>
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
        </Suspense>
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
  if (!isAuthenticated) {
    return (
      <Suspense fallback={<LoadingScreen />}>
        <Login />
      </Suspense>
    );
  }
  return <AuthenticatedApp />;
};

function App() {
  return (
    <AppProvider>
      <AppContent />
    </AppProvider>
  );
}

export default App;
