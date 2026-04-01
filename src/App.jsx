import React from 'react';
import { Routes, Route, Link, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, CarFront, Users, Calendar, Settings,
  Search, Bell, LogOut, ShoppingCart
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

const Sidebar = () => {
  const location = useLocation();
  const { logout } = useAppContext();
  const menuItems = [
    { name: 'Início', icon: <LayoutDashboard size={20} />, path: '/' },
    { name: 'Estoque', icon: <CarFront size={20} />, path: '/estoque' },
    { name: 'Vendidos', icon: <ShoppingCart size={20} />, path: '/vendidos' },
    { name: 'Leads', icon: <Users size={20} />, path: '/leads' },
    { name: 'Agenda', icon: <Calendar size={20} />, path: '/agenda' },
    { name: 'Configurações', icon: <Settings size={20} />, path: '/configuracoes' },
  ];

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
        <button className="logout-btn" onClick={logout}>
          <LogOut size={20} />
          <span>Sair</span>
        </button>
      </div>
    </aside>
  );
};

const Header = () => (
  <header className="main-header">
    <div className="header-search">
      <Search size={18} />
      <input type="text" placeholder="Buscar carros, leads..." />
    </div>
    <div className="header-actions">
      <button className="icon-btn"><Bell size={20} /></button>
      <div className="user-profile">
        <div className="profile-img">JD</div>
        <div className="profile-info">
          <p className="profile-name">John Doe</p>
          <p className="profile-role">Administrador</p>
        </div>
      </div>
    </div>
  </header>
);

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
            <Route path="/configuracoes" element={<SettingsView />} />
          </Routes>
        </div>
      </main>
    </div>
  );
};

const AppContent = () => {
  const { isAuthenticated } = useAppContext();
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
