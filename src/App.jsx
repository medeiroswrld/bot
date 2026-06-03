import React from 'react';
import { Routes, Route, Link, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, CarFront, Users, Calendar, Settings,
  Search, Bell, LogOut, ShoppingCart, Loader2, MessageCircle, Bot
} from 'lucide-react';
import './App.css';

import { AppProvider, useAppContext } from './context/AppContext.jsx';
import Dashboard from './views/Dashboard.jsx';
import Inventory from './views/Inventory.jsx';
import Leads from './views/Leads.jsx';
import Agenda from './views/Agenda.jsx';
import SoldCars from './views/SoldCars.jsx';
import SettingsView from './views/Settings.jsx';
import Login from './views/Login.jsx';
import Conversations from './views/Conversations.tsx';
import BotSettings from './views/BotSettings.jsx';

const Sidebar = () => {
  const location = useLocation();
  const { logout } = useAppContext();
  const menuItems = [
    { name: 'Início', icon: <LayoutDashboard size={20} />, path: '/' },
    { name: 'Estoque', icon: <CarFront size={20} />, path: '/estoque' },
    { name: 'Vendidos', icon: <ShoppingCart size={20} />, path: '/vendidos' },
    { name: 'Leads', icon: <Users size={20} />, path: '/leads' },
    { name: 'Agenda', icon: <Calendar size={20} />, path: '/agenda' },
    { name: 'Conversas', icon: <MessageCircle size={20} />, path: '/conversas' },
    { name: 'Assistente', icon: <Bot size={20} />, path: '/assistente' },
    { name: 'Configurações', icon: <Settings size={20} />, path: '/configuracoes' },
  ];

  const handleLogout = (e) => {
    e.preventDefault();
    e.stopPropagation();
    console.log('[SIDEBAR] Botão Sair clicado!');
    logout();
  };

  return (
    <aside className="sidebar">
      <Link to="/" className="sidebar-logo" style={{ textDecoration: 'none' }}>
        <div className="logo-icon">A</div>
        <span className="logo-text">Automatic<span>Gen</span></span>
      </Link>

      <nav className="sidebar-nav">
        <ul>
          {menuItems.map((item) => (
            <li key={item.name}>
              <Link
                to={item.path}
                className={`nav-item ${(item.path === '/' ? location.pathname === '/' : location.pathname.startsWith(item.path)) ? 'active' : ''}`}
              >
                {item.icon}
                <span>{item.name}</span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <div className="sidebar-footer">
        <button type="button" className="logout-btn" onClick={handleLogout}>
          <LogOut size={20} />
          <span>Sair</span>
        </button>
      </div>
    </aside>
  );
};

const Header = () => {
  const { company, profile, user } = useAppContext();
  const navigate = useNavigate();

  // Prioridade: perfil Supabase > company local > fallback
  const displayName = profile?.company_name || company?.name || 'Minha Empresa';
  const userEmail = user?.email || '';

  const getInitials = (name) => {
    if (!name) return 'ME';
    const words = name.trim().split(/\s+/);
    if (words.length === 0) return 'ME';
    return words
      .map(word => word[0])
      .join('')
      .slice(0, 2)
      .toUpperCase();
  };

  return (
    <header className="main-header">
      <div className="header-search">
        <Search size={18} />
        <input type="text" placeholder="Buscar carros, leads..." />
      </div>
      <div className="header-actions">
        <button className="icon-btn"><Bell size={20} /></button>
        <div className="user-profile" onClick={() => navigate('/configuracoes')} style={{ cursor: 'pointer' }}>
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

const AuthenticatedApp = () => {
  const location = useLocation();
  return (
    <div className="app-container">
      <Sidebar />
      <main className="main-content">
        <Header />
        <div key={location.pathname} className="page-transition">
          <Routes location={location}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/estoque" element={<Inventory />} />
            <Route path="/vendidos" element={<SoldCars />} />
            <Route path="/leads" element={<Leads />} />
            <Route path="/agenda" element={<Agenda />} />
            <Route path="/conversas" element={<Conversations />} />
            <Route path="/assistente" element={<BotSettings />} />
            <Route path="/configuracoes" element={<SettingsView />} />
          </Routes>
        </div>
      </main>
    </div>
  );
};

// Loading screen enquanto verifica sessão
const LoadingScreen = () => (
  <div className="login-layout" style={{ justifyContent: 'center', alignItems: 'center' }}>
    <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem' }}>
      <div className="logo-icon-large" style={{ animation: 'pulse 1.5s ease-in-out infinite' }}>A</div>
      <Loader2 className="spinner" size={28} style={{ color: 'var(--primary)', animation: 'spin 1s linear infinite' }} />
      <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Carregando...</p>
    </div>
  </div>
);

const AppContent = () => {
  const { isAuthenticated, isLoading, session } = useAppContext();
  console.log('[AppContent] render — isAuthenticated:', isAuthenticated, 'isLoading:', isLoading, 'session:', !!session);

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
