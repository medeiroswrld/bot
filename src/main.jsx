import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);

// Registra o service worker. Sem ele o navegador nao oferece "instalar", e no
// iPhone a notificacao web nem existe fora do app na tela de inicio.
// Falha aqui nao pode derrubar o CRM: quem nao tem suporte simplesmente segue
// usando pelo navegador.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((e) => {
      console.warn('[PWA] service worker nao registrou:', e);
    });
  });
}
