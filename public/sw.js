// Service worker do Amply.
//
// Existe por dois motivos:
//  1. Sem ele o navegador não considera o site instalável — e no iPhone
//     notificação web SÓ funciona com o app na tela de início.
//  2. É quem recebe o push quando o CRM está fechado. A API Notification que o
//     app já usava só dispara com a aba aberta, que é justamente quando o
//     lojista NÃO precisa ser avisado.
//
// Deliberadamente sem cache de assets: o CRM depende de dados ao vivo, e cache
// mal feito serve tela velha achando que está ajudando.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let dados = { titulo: 'Amply', corpo: 'Nova mensagem de cliente', url: '/conversas' };
  try {
    if (event.data) dados = { ...dados, ...event.data.json() };
  } catch {
    // payload não-JSON: mantém o texto padrão em vez de engolir a notificação
  }

  event.waitUntil(
    self.registration.showNotification(dados.titulo, {
      body: dados.corpo,
      icon: '/logo.png',
      badge: '/logo.png',
      // Mesma tag = mensagens seguidas do mesmo cliente se substituem em vez de
      // empilharem cinco notificações na tela de bloqueio.
      tag: dados.tag || 'amply-mensagem',
      renotify: true,
      data: { url: dados.url },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const destino = event.notification.data?.url || '/conversas';

  // Se o CRM já está aberto numa aba, foca ela em vez de abrir outra.
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((abas) => {
      for (const aba of abas) {
        if ('focus' in aba) { aba.navigate(destino); return aba.focus(); }
      }
      return self.clients.openWindow(destino);
    }),
  );
});
