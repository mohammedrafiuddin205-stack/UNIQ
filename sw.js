// ═══════════════════════════════════════════════════════════════
// UNIQ Service Worker — sw.js
// Handles: Push Notifications, Call Alerts, Offline Cache
// ═══════════════════════════════════════════════════════════════

const CACHE_NAME = 'uniq-v1';
const APP_SHELL = [
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  'https://fonts.googleapis.com/css2?family=Syne:wght@400;500;600;700;800&family=DM+Sans:ital,wght@0,300;0,400;0,500;0,600;1,400&display=swap',
];

// ── INSTALL: cache app shell ──
self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      cache.addAll(APP_SHELL).catch(() => {})
    )
  );
});

// ── ACTIVATE: clean old caches ──
self.addEventListener('activate', event => {
  event.waitUntil(
    Promise.all([
      clients.claim(),
      caches.keys().then(keys =>
        Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
      )
    ])
  );
});

// ── FETCH: serve from cache with network fallback ──
self.addEventListener('fetch', event => {
  // Only cache GET requests, skip Firebase/API calls
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.hostname.includes('firebase') || url.hostname.includes('google') && url.pathname.includes('/v1/')) return;

  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        // Cache successful responses for app shell files
        if (response && response.status === 200 && event.request.url.includes(self.location.origin)) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
        }
        return response;
      }).catch(() => caches.match('./index.html'));
    })
  );
});

// ── PUSH NOTIFICATION handler ──
self.addEventListener('push', event => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch(e) {
    data = { title: 'UNIQ', body: event.data ? event.data.text() : 'New notification' };
  }

  const isCall = data.type === 'call';
  const isMessage = data.type === 'message';

  const title = data.title || 'UNIQ';
  const options = {
    body: data.body || '',
    icon: './icons/icon-192.png',
    badge: './icons/icon-96.png',
    image: data.image || undefined,
    tag: data.tag || (isCall ? 'uniq-call' : 'uniq-msg'),
    renotify: true,
    requireInteraction: isCall, // Call notifications stay until dismissed
    silent: false,
    vibrate: isCall
      ? [500, 200, 500, 200, 500, 200, 500] // Call: long vibration pattern
      : [200, 100, 200],                      // Message: short pattern
    timestamp: data.ts || Date.now(),
    data: {
      url: data.url || './',
      type: data.type,
      callType: data.callType,
      fromUid: data.fromUid,
      chatId: data.chatId,
    },
    actions: isCall ? [
      { action: 'accept', title: '✅ Accept', icon: './icons/icon-96.png' },
      { action: 'decline', title: '❌ Decline' }
    ] : isMessage ? [
      { action: 'reply', title: '💬 Reply' },
      { action: 'open', title: 'Open' }
    ] : [
      { action: 'open', title: 'Open UNIQ' }
    ]
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

// ── NOTIFICATION CLICK handler ──
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const data = event.notification.data || {};
  const action = event.action;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      // Find existing open window
      for (const client of clientList) {
        if (client.url.includes(self.location.origin)) {
          client.focus();
          if (action === 'accept' && data.type === 'call') {
            client.postMessage({ type: 'ACCEPT_CALL', callData: data });
          } else if (action === 'decline' && data.type === 'call') {
            client.postMessage({ type: 'DECLINE_CALL', callData: data });
          } else {
            client.postMessage({ type: 'OPEN_CHAT', chatId: data.chatId });
          }
          return;
        }
      }
      // Open new window
      return clients.openWindow('./index.html');
    })
  );
});

// ── NOTIFICATION CLOSE handler ──
self.addEventListener('notificationclose', event => {
  const data = event.notification.data || {};
  if (data.type === 'call') {
    // Tell the app the call notification was dismissed = user declined
    clients.matchAll({ type: 'window' }).then(list => {
      list.forEach(c => c.postMessage({ type: 'CALL_NOTIF_DISMISSED', callData: data }));
    });
  }
});

// ── MESSAGE from app ──
self.addEventListener('message', event => {
  const msg = event.data;
  if (!msg) return;

  // App sends SHOW_CALL_NOTIF when an incoming call arrives
  if (msg.type === 'SHOW_CALL_NOTIF') {
    const { callerName, callerPhoto, callType, callId, fromUid } = msg;
    const icon = callType === 'video' ? '📹' : '📞';
    self.registration.showNotification(`${icon} Incoming ${callType} call`, {
      body: `${callerName} is calling you`,
      icon: callerPhoto || './icons/icon-192.png',
      badge: './icons/icon-96.png',
      tag: `call-${callId}`,
      requireInteraction: true,
      renotify: true,
      silent: false,
      vibrate: [500,200,500,200,500,200,500,200,500],
      data: { type: 'call', callType, fromUid, callId, url: './' },
      actions: [
        { action: 'accept', title: '✅ Accept' },
        { action: 'decline', title: '❌ Decline' }
      ]
    });
  }

  // App sends SHOW_MSG_NOTIF for new messages
  if (msg.type === 'SHOW_MSG_NOTIF') {
    const { fromName, body, chatId, fromPhoto } = msg;
    self.registration.showNotification(fromName || 'UNIQ', {
      body: body || 'New message',
      icon: fromPhoto || './icons/icon-192.png',
      badge: './icons/icon-96.png',
      tag: `msg-${chatId}`,
      renotify: true,
      silent: false,
      vibrate: [200, 100, 200],
      data: { type: 'message', chatId, url: './' },
      actions: [{ action: 'open', title: 'Open' }]
    });
  }

  // Clear call notification when call is answered/ended
  if (msg.type === 'CLEAR_CALL_NOTIF') {
    self.registration.getNotifications({ tag: `call-${msg.callId}` }).then(notifs => {
      notifs.forEach(n => n.close());
    });
  }
});

// ── BACKGROUND SYNC (optional — retry failed message sends) ──
self.addEventListener('sync', event => {
  if (event.tag === 'sync-messages') {
    event.waitUntil(
      // Messages are sent via Firebase SDK which handles retries natively
      Promise.resolve()
    );
  }
});

console.log('[UNIQ SW] Service Worker loaded v1');
