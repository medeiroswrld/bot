import { useState, useEffect, useRef, lazy, Suspense } from 'react';
import { Routes, Route, Link, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, CarFront, Users, Calendar, Settings,
  Bell, LogOut, Loader2, MessageCircle, Bot,
  Sun, Moon, Megaphone, Menu, LifeBuoy, Wallet,
} from 'lucide-react';
import './App.css';

import { AppProvider, useAppContext } from './context/AppContext.jsx';
import { precisaDesafio } from './lib/doisFatores.js';

const Dashboard    = lazy(() => import('./views/Dashboard.jsx'));
const AdminPanel   = lazy(() => import('./views/AdminPanel.jsx'));
const Inventory    = lazy(() => import('./views/Inventory.jsx'));
const Leads        = lazy(() => import('./views/Leads.jsx'));
const Agenda       = lazy(() => import('./views/Agenda.jsx'));
const SoldCars     = lazy(() => import('./views/SoldCars.jsx'));
const SettingsView = lazy(() => import('./views/Settings.jsx'));
const Login        = lazy(() => import('./views/Login.jsx'));
const DesafioMFA   = lazy(() => import('./views/DesafioMFA.jsx'));
const NovaSenha    = lazy(() => import('./views/NovaSenha.jsx'));
const EscolherPlano = lazy(() => import('./views/EscolherPlano.jsx'));
const Conversations = lazy(() => import('./views/Conversations.tsx'));
const BotSettings  = lazy(() => import('./views/BotSettings.jsx'));
const WaitingList  = lazy(() => import('./views/WaitingList.jsx'));
const Templates    = lazy(() => import('./views/Templates.jsx'));
const Campaigns    = lazy(() => import('./views/Campaigns.jsx'));
const CampaignDetails = lazy(() => import('./views/CampaignDetails.jsx'));
const Financeiro   = lazy(() => import('./views/Financeiro.jsx'));
const Anuncios     = lazy(() => import('./views/Anuncios.jsx'));
// Rota de RETORNO do Instagram: o navegador sai do CRM, autoriza no
// instagram.com e volta aqui com o `code`. Precisa ser rota de verdade porque a
// URI é registrada no painel da Meta e conferida por ela a cada conexão.
const RetornoInstagram = lazy(() =>
  import('./views/ConectarInstagram.jsx').then((m) => ({ default: m.RetornoInstagram })));

// ─── Sidebar ─────────────────────────────────────────────────────────────────

// Telas do mesmo assunto viram ABAS dentro de um item só da barra lateral.
// `path` é pra onde o item leva; `tabs` (quando existe) é o que aparece no topo
// da página. De 11 itens pra 8 — e a barra deixa de estourar a altura da tela.
const NAV_ITEMS = [
  { name: 'Início',    icon: <LayoutDashboard size={18} />, path: '/' },
  {
    name: 'Veículos',  icon: <CarFront size={18} />,        path: '/estoque',
    tabs: [
      { name: 'Estoque',  path: '/estoque' },
      { name: 'Vendidos', path: '/vendidos' },
    ],
  },
  {
    name: 'Clientes',  icon: <Users size={18} />,           path: '/leads',
    tabs: [
      { name: 'Leads',           path: '/leads' },
      { name: 'Lista de Espera', path: '/lista-de-espera' },
    ],
  },
  { name: 'Financeiro', icon: <Wallet size={18} />,         path: '/financeiro' },
  { name: 'Agenda',    icon: <Calendar size={18} />,        path: '/agenda' },
  { name: 'Conversas', icon: <MessageCircle size={18} />,   path: '/conversas' },
  {
    name: 'Marketing', icon: <Megaphone size={18} />,       path: '/campanhas',
    tabs: [
      { name: 'Disparos em massa', path: '/campanhas' },
      { name: 'Templates', path: '/templates' },
      { name: 'Anúncios',  path: '/anuncios' },
    ],
  },
  { name: 'Assistente',    icon: <Bot size={18} />,      path: '/assistente' },
  { name: 'Configurações', icon: <Settings size={18} />, path: '/configuracoes' },
];

// Todos os caminhos que um item cobre (o próprio + os das abas).
const itemPaths = (item) => (item.tabs ? item.tabs.map((t) => t.path) : [item.path]);

const Sidebar = ({ aberta = false, onFechar = () => {} }) => {
  const location = useLocation();
  const { logout, matchedCount, company, profile } = useAppContext();

  const [isDark, setIsDark] = useState(
    () => document.documentElement.classList.contains('dark'),
  );

  const toggleTheme = () => {
    const next = !isDark;
    setIsDark(next);
    document.documentElement.classList.toggle('dark', next);
    localStorage.setItem('amply-theme', next ? 'dark' : 'light');
  };

  // O suporte abre o WhatsApp com a loja JA identificada na mensagem. Sem isso
  // chega um numero desconhecido e a primeira troca serve so pra descobrir quem
  // esta falando — com varias lojas no mesmo sistema, isso custa caro.
  const nomeDaLoja = profile?.company_name || company?.name || '';
  const suporteHref = `https://wa.me/5515988372081?text=${encodeURIComponent(
    nomeDaLoja
      ? `Olá! Sou da ${nomeDaLoja} e preciso de ajuda com o Amply.`
      : 'Olá! Preciso de ajuda com o Amply.',
  )}`;

  // Item de grupo fica aceso quando QUALQUER uma das suas abas está aberta.
  const isActive = (item) =>
    itemPaths(item).some((p) =>
      p === '/' ? location.pathname === '/' : location.pathname.startsWith(p),
    );

  return (
    <aside className={`sidebar${aberta ? ' aberta' : ''}`}>
      {/* Logo */}
      <Link to="/" className="sidebar-logo-link">
        <img src="/logo.png" className="sidebar-logo-img" alt="" />
        <span className="sidebar-label sidebar-brand-label">Amply</span>
      </Link>

      {/* Navigation */}
      <nav className="sidebar-nav">
        <ul>
          {NAV_ITEMS.map((item) => {
            // O aviso da lista de espera agora vive no grupo que a contém.
            const showBadge = itemPaths(item).includes('/lista-de-espera') && matchedCount > 0;
            return (
              <li key={item.name}>
                <Link
                  to={item.path}
                  className={`sidebar-nav-item${isActive(item) ? ' active' : ''}`}
                  onClick={onFechar}
                  data-tooltip={item.name}
                  data-tour={item.path}
                >
                  <span className="sidebar-nav-icon" style={{ position: 'relative' }}>
                    {item.icon}
                    {showBadge && (
                      <span style={{
                        position: 'absolute', top: -6, right: -8,
                        minWidth: 16, height: 16, padding: '0 4px',
                        borderRadius: 8, background: '#f59e0b', color: '#fff',
                        fontSize: '0.62rem', fontWeight: 700,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        lineHeight: 1,
                      }}>
                        {matchedCount}
                      </span>
                    )}
                  </span>
                  <span className="sidebar-label">{item.name}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Footer */}
      <div className="sidebar-footer">
        <a
          className="sidebar-footer-btn suporte-btn"
          href={suporteHref}
          target="_blank"
          rel="noopener noreferrer"
          onClick={onFechar}
          data-tooltip="Suporte no WhatsApp"
          data-tour="suporte"
        >
          <span className="sidebar-nav-icon"><LifeBuoy size={17} /></span>
          <span className="sidebar-label">Suporte</span>
        </a>
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

const Header = ({ onAbrirMenu = () => {} }) => {
  const { company, profile } = useAppContext();
  const navigate = useNavigate();

  const displayName = profile?.company_name || company?.name || 'Minha Empresa';

  const getInitials = (name) => {
    if (!name) return 'ME';
    return name.trim().split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  };

  return (
    <header className="main-header">
      {/* So aparece no mobile (CSS): no desktop a barra lateral esta sempre visivel. */}
      <button className="menu-toggle" onClick={onAbrirMenu} aria-label="Abrir menu">
        <Menu size={20} />
      </button>
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

// Abas do grupo atual. Fica fora do <Routes> de propósito: assim as telas
// agrupadas não precisam saber que viraram abas — nenhuma view foi alterada.
const PageTabs = () => {
  const location = useLocation();
  const grupo = NAV_ITEMS.find(
    (i) => i.tabs && i.tabs.some((t) => location.pathname.startsWith(t.path)),
  );
  if (!grupo) return null;
  return (
    <div className="page-tabs">
      {grupo.tabs.map((t) => (
        <Link
          key={t.path}
          to={t.path}
          className={`page-tab${location.pathname.startsWith(t.path) ? ' active' : ''}`}
        >
          {t.name}
        </Link>
      ))}
    </div>
  );
};

// Aviso de conta suspensa. Sem isso o lojista veria o bot mudo sem explicacao e
// abriria chamado achando que quebrou.
const AvisoSuspensao = () => {
  const { companySettings } = useAppContext();
  const navigate = useNavigate();

  // Duas causas diferentes param o atendimento, e o lojista precisa saber QUAL
  // — porque a saida de cada uma e outra. Suspensao se resolve falando com o
  // suporte; assinatura se resolve com um clique dele mesmo.
  const suspenso = companySettings?.suspenso === true;
  const assinatura = companySettings?.assinatura_status;
  const devendo = assinatura === 'atrasada' || assinatura === 'cancelada' || assinatura === 'sem_assinatura';

  if (!suspenso && !devendo) return null;

  const podeResolverSozinho = !suspenso && devendo;

  return (
    <div style={{
      margin: '10px 20px 0', padding: '10px 14px', borderRadius: 10,
      background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c',
      fontSize: '0.85rem', lineHeight: 1.5,
    }}>
      {suspenso ? (
        <>
          <strong>Conta suspensa.</strong> O atendimento automático está pausado. As mensagens
          dos seus clientes continuam chegando e ficam em Conversas — nada se perde. Fale com o
          suporte para reativar.
        </>
      ) : (
        <>
          <strong>
            {assinatura === 'atrasada' ? 'Pagamento pendente.' : 'Assinatura inativa.'}
          </strong>{' '}
          O atendimento automático está pausado. As mensagens dos seus clientes continuam
          chegando e ficam em Conversas — nada se perde.
        </>
      )}
      {podeResolverSozinho && (
        <button
          onClick={() => navigate('/configuracoes')}
          style={{
            marginLeft: 8, background: 'none', border: 'none', padding: 0,
            color: '#b91c1c', fontWeight: 700, textDecoration: 'underline',
            cursor: 'pointer', fontSize: '0.85rem',
          }}>
          Regularizar agora
        </button>
      )}
    </div>
  );
};

const AuthenticatedApp = () => {
  const location = useLocation();
  const [menuAberto, setMenuAberto] = useState(false);
  const { user, companySettings, refreshCompanySettings } = useAppContext();
  const navigate = useNavigate();

  // Tour de boas-vindas, uma vez por loja.
  //
  // Espera meio segundo de proposito: as telas sao lazy e os cartoes do Inicio
  // montam depois do primeiro quadro. Abrir antes disso faria o tour descartar
  // justamente os passos que importam, porque os elementos ainda nao existem.
  //
  // So na tela de Inicio: comecar o tour por cima da tela de Estoque, porque
  // foi la que a pessoa caiu, e explicar a casa a partir do quarto dos fundos.
  const tourPedido = useRef(false);
  useEffect(() => {
    if (tourPedido.current) return;
    if (!companySettings || companySettings.tour_visto_em) return;

    tourPedido.current = true;
    let vivo = true;

    (async () => {
      // LEVA pro Início em vez de desistir.
      //
      // A versão anterior só disparava quando a rota já era '/', e quem
      // recarregou a página estando em Configurações nunca via o tour — que é
      // exatamente quem mais precisa dele.
      if (window.location.pathname !== '/') navigate('/');

      const { rodarTour, esperar } = await import('./lib/tour.js');

      // Espera o ALVO existir, em vez de apostar num tempo fixo. As telas são
      // lazy: 500ms acertava às vezes, e quando errava o tour se perdia para
      // sempre, porque nada fazia o efeito rodar de novo.
      const pronto = await esperar('[data-tour="/conversas"]', 8000);
      if (!vivo) return;
      if (!pronto) { tourPedido.current = false; return; }

      const abriu = rodarTour(user?.id, {
        navigate,
        aoFechar: () => refreshCompanySettings?.(),
      });
      if (!abriu) tourPedido.current = false;
    })().catch(() => { tourPedido.current = false; });

    return () => { vivo = false; };
    // `location.pathname` fica FORA das dependências de propósito: o próprio
    // tour navega entre telas, e reagir a isso reiniciaria o efeito no meio.
  }, [companySettings, user?.id, refreshCompanySettings, navigate]);

  // Fecha ao trocar de rota. Sem isso o drawer fica aberto por cima da tela
  // nova, e no celular ele cobre quase tudo.
  useEffect(() => { setMenuAberto(false); }, [location.pathname]);

  return (
    <div className="app-container">
      <Sidebar aberta={menuAberto} onFechar={() => setMenuAberto(false)} />
      {menuAberto && (
        <div className="sidebar-backdrop" onClick={() => setMenuAberto(false)} />
      )}
      <main className="main-content">
        <Header onAbrirMenu={() => setMenuAberto(true)} />
        <AvisoSuspensao />
        <PageTabs />
        <Suspense fallback={<PageLoader />}>
          <div key={location.pathname} className="page-transition">
            <Routes location={location}>
              <Route path="/"              element={<Dashboard />} />
              <Route path="/estoque"       element={<Inventory />} />
              <Route path="/vendidos"      element={<SoldCars />} />
            <Route path="/financeiro" element={<Financeiro />} />
            <Route path="/anuncios"   element={<Anuncios />} />
              <Route path="/leads"         element={<Leads />} />
              <Route path="/agenda"        element={<Agenda />} />
              <Route path="/conversas"     element={<Conversations />} />
              <Route path="/lista-de-espera" element={<WaitingList />} />
              <Route path="/templates"     element={<Templates />} />
              <Route path="/campanhas"     element={<Campaigns />} />
              <Route path="/campanhas/:id" element={<CampaignDetails />} />
              <Route path="/assistente"    element={<BotSettings />} />
              <Route path="/configuracoes" element={<SettingsView />} />
              <Route path="/conectar/instagram" element={<RetornoInstagram />} />
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
  const { isAuthenticated, isLoading, precisaNovaSenha, companySettings } = useAppContext();

  // Portao do segundo fator.
  //
  // O Supabase considera o usuario LOGADO assim que a senha confere — so que
  // numa sessao de nivel 'aal1'. Quem cadastrou aplicativo autenticador precisa
  // chegar em 'aal2', e sem este portao o sistema abriria inteiro com a senha
  // sozinha: o 2FA viraria enfeite.
  //
  // 'verificando' e o estado inicial de proposito. Assumir 'liberado' mostraria
  // o CRM por um instante antes de trocar pela tela do codigo — vazamento curto,
  // mas vazamento.
  const [etapa, setEtapa] = useState('verificando');

  useEffect(() => {
    if (!isAuthenticated) { setEtapa('verificando'); return; }
    let vivo = true;
    precisaDesafio()
      .then((precisa) => { if (vivo) setEtapa(precisa ? 'desafio' : 'liberado'); })
      // Falha aqui nao pode trancar ninguem do lado de fora: quem nao tem fator
      // cadastrado (a maioria) passaria a nao conseguir entrar por um erro de rede.
      .catch(() => { if (vivo) setEtapa('liberado'); });
    return () => { vivo = false; };
  }, [isAuthenticated]);

  if (isLoading) return <LoadingScreen />;
  if (!isAuthenticated) {
    return (
      <Suspense fallback={<LoadingScreen />}>
        <Login />
      </Suspense>
    );
  }
  if (precisaNovaSenha) {
    return (
      <Suspense fallback={<LoadingScreen />}>
        <NovaSenha />
      </Suspense>
    );
  }
  // Conta NOVA, que nunca pagou, escolhe o plano antes de entrar.
  //
  // A regra tem duas metades, e a segunda importa mais que a primeira:
  //
  //   nunca pagou      -> escolhe o plano agora (nao ha o que acessar ainda)
  //   ja pagou um dia  -> NUNCA cai aqui, mesmo em atraso ou cancelada
  //
  // Quem ja foi cliente mantem o CRM acessivel com o aviso no topo. Segurar o
  // estoque e os leads de uma loja como refem de fatura e o tipo de coisa que
  // vira reclamacao publica — e o bot ja esta pausado, que e pressao suficiente.
  //
  // `isento` fica de fora por definicao: e quem paga por fora.
  const assinatura = companySettings?.assinatura_status;
  const nuncaPagou = !companySettings?.ultimo_pagamento_em;
  if (companySettings && assinatura === 'sem_assinatura' && nuncaPagou) {
    return (
      <Suspense fallback={<LoadingScreen />}>
        <EscolherPlano />
      </Suspense>
    );
  }

  if (etapa === 'verificando') return <LoadingScreen />;
  if (etapa === 'desafio') {
    return (
      <Suspense fallback={<LoadingScreen />}>
        <DesafioMFA onConfirmado={() => setEtapa('liberado')} />
      </Suspense>
    );
  }
  return <AuthenticatedApp />;
};

function App() {
  // O painel do administrador e um app A PARTE: nao passa pelo AppProvider nem
  // pelo shell do CRM, e usa sessao propria (storageKey diferente, ver
  // supabaseAdmin.js). Assim da pra estar logado como lojista no CRM e como
  // administrador no /admin ao mesmo tempo, no mesmo navegador — antes um
  // derrubava o outro, e o painel abria logado com a conta errada.
  if (typeof window !== 'undefined' && window.location.pathname.startsWith('/admin')) {
    return (
      <Suspense fallback={<LoadingScreen />}>
        <AdminPanel />
      </Suspense>
    );
  }

  return (
    <AppProvider>
      <AppContent />
    </AppProvider>
  );
}

export default App;
