'use strict';

// ── Detect the public-facing base URL ───────────────────────────────────────
// Works automatically on Railway, Render, Fly.io, Heroku, and any platform
// that sets PUBLIC_URL manually.
function detectPublicUrl() {
  const e = process.env;
  // Manual override — highest priority
  if (e.PUBLIC_URL)              return e.PUBLIC_URL.replace(/\/$/, '');
  // Railway — auto-injected
  if (e.RAILWAY_PUBLIC_DOMAIN)   return `https://${e.RAILWAY_PUBLIC_DOMAIN}`;
  // Render — auto-injected
  if (e.RENDER_EXTERNAL_URL)     return e.RENDER_EXTERNAL_URL.replace(/\/$/, '');
  // Fly.io
  if (e.FLY_APP_NAME)            return `https://${e.FLY_APP_NAME}.fly.dev`;
  // Heroku
  if (e.HEROKU_APP_DEFAULT_DOMAIN_NAME) return `https://${e.HEROKU_APP_DEFAULT_DOMAIN_NAME}`;
  // Vercel (preview)
  if (e.VERCEL_URL)              return `https://${e.VERCEL_URL}`;
  // Local dev fallback — caller will substitute LAN IP
  return null;
}

module.exports = {
  PORT:            process.env.PORT || 3000,
  PUBLIC_URL:      detectPublicUrl(), // null means local dev
  WS_PATH:         '/signal',

  ICE_SERVERS: [
    { urls: 'stun:stun.l.google.com:19302'  },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
  ],

  SESSION_TTL_MS:       30 * 60 * 1000,
  MAX_PEERS_PER_ROOM:   2,
  HEARTBEAT_INTERVAL_MS: 25000,
};
