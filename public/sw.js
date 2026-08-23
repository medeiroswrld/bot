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

  // Duas tentativas, e a segunda é o que salva o iPhone.
  //
  // O Safari rejeita `showNotification` inteiro quando não reconhece uma opção
  // — `renotify` e `badge` são os suspeitos — e a notificação simplesmente não
  // aparece, sem erro visível em lugar nenhum. No Chrome do desktop as mesmas
  // opções funcionam, o que faz o problema parecer "só no iPhone" e mandar a
  // investigação pro lado errado.
  //
  // Então: tenta a versão completa e, se ela falhar, mostra o mínimo que toda
  // implementação aceita. Notificação simples é infinitamente melhor que
  // notificação nenhuma.
  const titulo = dados.titulo || 'Amply';
  const minima = { body: dados.corpo, data: { url: dados.url } };
  const completa = {
    ...minima,
    icon: '/logo.png',
    badge: '/logo.png',
    // Mesma tag = mensagens seguidas do mesmo cliente se substituem em vez de
    // empilharem cinco notificações na tela de bloqueio.
    tag: dados.tag || 'amply-mensagem',
    renotify: true,
  };

  event.waitUntil(
    self.registration.showNotification(titulo, completa).catch((e) => {
      console.warn('[sw] opções completas recusadas, caindo pro mínimo:', e);
      return self.registration.showNotification(titulo, minima);
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
