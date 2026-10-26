// Service worker minimo: serve solo a rendere l'agenda installabile sul telefono.
// Non salva nulla in cache, così si vedono sempre gli appuntamenti aggiornati.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
