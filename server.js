// Bleep Soccer match server: matchmaking + room codes + message relay for 1v1 games.
// It does NOT simulate anything; the host's browser runs the match and this just passes messages along.
// Run: npm install && npm start   (listens on $PORT, default 8080)

const RELAY = new Set(['p', 's', 'b', 'rdy']);          // message types passed on to the opponent
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';  // no 0/O/1/I

function attach(wss) {
  const rooms = new Map();                              // room code -> game
  let queue = null;                                     // one player waiting for a random match

  const send = (ws, o) => { try { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); } catch (e) {} };
  const newCode = () => { let c; do { c = Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join(''); } while (rooms.has(c)); return c; };

  function leave(ws) {
    if (queue === ws) queue = null;
    const g = ws.game; if (!g) return;
    const other = ws === g.host ? g.guest : g.host;
    if (g.code) rooms.delete(g.code);
    ws.game = null;
    if (other) { other.game = null; send(other, { t: 'left' }); }
  }
  function start(g) { send(g.host, { t: 'matched', role: 'host' }); send(g.guest, { t: 'matched', role: 'guest' }); }

  wss.on('connection', ws => {
    ws.game = null;
    ws.on('message', raw => {
      let m; try { m = JSON.parse(raw); } catch (e) { return; }
      if (!m || typeof m.t !== 'string') return;
      if (RELAY.has(m.t)) {                              // in-game traffic
        const g = ws.game; if (!g) return;
        send(ws === g.host ? g.guest : g.host, m); return;
      }
      if (m.t === 'find') {
        leave(ws);
        if (queue && queue !== ws && queue.readyState === 1) {
          const g = { host: queue, guest: ws, code: null }; queue.game = g; ws.game = g; queue = null; start(g);
        } else { queue = ws; send(ws, { t: 'queued' }); }
      } else if (m.t === 'host') {
        leave(ws);
        const g = { host: ws, guest: null, code: newCode() }; ws.game = g; rooms.set(g.code, g);
        send(ws, { t: 'hosted', code: g.code });
      } else if (m.t === 'join') {
        leave(ws);
        const g = rooms.get(String(m.code || '').toUpperCase());
        if (!g || g.guest) { send(ws, { t: 'err', msg: g ? 'Room is full' : 'No room with that code' }); return; }
        g.guest = ws; ws.game = g; start(g);
      } else if (m.t === 'leave') leave(ws);
    });
    ws.on('close', () => leave(ws));
    ws.on('error', () => {});
  });
}
module.exports = { attach };

if (require.main === module) {
  const http = require('http');
  const { WebSocketServer } = require('ws');
  const server = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('Bleep Soccer server is running\n'); });
  const wss = new WebSocketServer({ server, maxPayload: 4096 });
  attach(wss);
  const beat = setInterval(() => wss.clients.forEach(ws => { if (ws.dead) return ws.terminate(); ws.dead = true; ws.ping(); }), 30000);
  wss.on('connection', ws => { ws.dead = false; ws.on('pong', () => { ws.dead = false; }); });
  wss.on('close', () => clearInterval(beat));
  server.listen(process.env.PORT || 8080, () => console.log('listening on ' + (process.env.PORT || 8080)));
}
