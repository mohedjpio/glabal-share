'use strict';

const http    = require('http');
const path    = require('path');
const express = require('express');
const cors    = require('cors');

const { setupSignaling } = require('./signaling');
const { startDiscovery, getLanIp } = require('./discovery');
const session = require('./session');
const { PORT, PUBLIC_URL, ICE_SERVERS } = require('./config');

const app = express();

app.use(cors({ origin: '*' }));
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'client')));

// ── Resolve the URL that goes into QR codes ──────────────────────────────────
// In production: PUBLIC_URL is the platform's domain (e.g. https://myapp.railway.app)
// In local dev:  fall back to the LAN IP so phones on same Wi-Fi can connect
function getAppUrl() {
  if (PUBLIC_URL) return PUBLIC_URL;
  const ip = getLanIp();
  return `http://${ip}:${PORT}`;
}

// ── REST ─────────────────────────────────────────────────────────────────────

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', appUrl: getAppUrl(), ...session.stats(), ts: Date.now() });
});

app.get('/api/ice-servers', (_req, res) => {
  res.json({ iceServers: ICE_SERVERS });
});

app.post('/api/room', (_req, res) => {
  res.json({ roomId: session.generateRoomId() });
});

// KEY ENDPOINT — client calls this to get the URL to put in the QR code.
// Returns the public HTTPS URL in production, LAN IP in local dev.
app.get('/api/server-info', (_req, res) => {
  res.json({
    appUrl:       getAppUrl(),                 // ← what goes in the QR
    isProduction: !!PUBLIC_URL,
    lanUrl:       `http://${getLanIp()}:${PORT}`,
  });
});

// ── HTTP + WebSocket ──────────────────────────────────────────────────────────
const server = http.createServer(app);
setupSignaling(server);

server.listen(PORT, '0.0.0.0', () => {
  const appUrl = getAppUrl();
  console.log('');
  console.log('┌─────────────────────────────────────────┐');
  console.log('│           SmartShare  🚀                 │');
  console.log('├─────────────────────────────────────────┤');
  console.log(`│  App URL : ${appUrl.padEnd(29)} │`);
  console.log(`│  Local   : http://localhost:${PORT}          │`);
  console.log(`│  Signal  : ws(s)://…/signal              │`);
  console.log('└─────────────────────────────────────────┘');
  console.log('');
  if (!PUBLIC_URL) startDiscovery(PORT);
});

process.on('SIGTERM', () => server.close(() => process.exit(0)));
process.on('SIGINT',  () => server.close(() => process.exit(0)));
