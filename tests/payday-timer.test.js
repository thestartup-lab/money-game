const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { io } = require('socket.io-client');

const PORT = 3293;
const URL = `http://127.0.0.1:${PORT}`;
function wait(socket, event, predicate = () => true, timeoutMs = 8_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.off(event, handler); reject(new Error(`等待 ${event} 逾時`)); }, timeoutMs);
    const handler = (payload) => { if (!predicate(payload)) return; clearTimeout(timer); socket.off(event, handler); resolve(payload); };
    socket.on(event, handler);
  });
}
function send(socket, event, payload, response, predicate) { const r = wait(socket, response, predicate); socket.emit(event, payload); return r; }
function connect() { const s = io(URL, { forceNew: true, transports: ['websocket'], reconnection: false }); return wait(s, 'connect').then(() => s); }

test('計時發薪：計時很長也會在三輪後保底發薪；決策期間倒數不凍結', { timeout: 30000 }, async (t) => {
  const server = spawn(process.execPath, ['-e', "const cards=require('./dist/gameCards');cards.BOARD.forEach(c=>c.type=cards.SquareType.SecondLife);require('./dist/socketServer');"], { cwd: process.cwd(), env: { ...process.env, PORT: String(PORT), NODE_ENV: 'test' }, stdio: ['ignore', 'pipe', 'pipe'] });
  const sockets = [];
  t.after(() => { sockets.forEach((s) => s.disconnect()); server.kill('SIGTERM'); });
  await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('boot timeout')), 5000); server.stdout.on('data', (d) => { if (String(d).includes('伺服器已啟動')) { clearTimeout(timer); resolve(); } }); });
  const open = async () => { const s = await connect(); sockets.push(s); return s; };
  const admin = await open(); const a = await open();
  let latest = null;
  admin.on('gameStateUpdate', (g) => { latest = g; if (g.decisionPhase?.kind === 'reading') admin.emit('continueDecisionPhase', { phaseId: g.decisionPhase.id }); });
  const room = await send(admin, 'createRoom', { roomId: 'T' + PORT }, 'roomCreated');
  await send(admin, 'setActionPhaseEnabled', { enabled: false }, 'gameStateUpdate', (g) => g.actionPhaseEnabled === false);
  await send(admin, 'setPaydayTimer', { minutes: 60, enabled: true }, 'gameStateUpdate', (g) => g.paydayTimer?.enabled === true && g.paydayTimer.intervalMs === 3_600_000);
  await send(a, 'playerJoin', { playerName: '甲', roomCode: room.roomId }, 'playerSession');
  await send(admin, 'startGame', { force: true }, 'gameStateUpdate', (g) => g.gamePhase === 'RatRace');
  assert.equal(latest.paydayTimer.frozen, false);
  assert.equal(latest.paydayTimer.maxRounds, 3);
  const remainingAtStart = latest.paydayTimer.remainingMs;
  for (let i = 0; i < 3; i++) {
    await send(a, 'playerRoll', { diceCount: 1 }, 'gameStateUpdate', (g) => g.turnNumber === i + 1 && (!g.decisionPhase || g.decisionPhase.kind === 'payday'));
    if (latest.decisionPhase?.kind === 'payday') break;
  }
  const phase = latest.decisionPhase?.kind === 'payday' ? latest : await wait(admin, 'gameStateUpdate', (g) => g.decisionPhase?.kind === 'payday', 8000);
  assert.equal(phase.decisionPhase.kind, 'payday', '三輪後即使計時未到也要發薪');
  assert.equal(phase.paydayTimer.roundsSince, 3);
  assert.ok(phase.paydayTimer.remainingMs < remainingAtStart, '決策期間倒數仍在走');
  assert.equal(phase.paydayTimer.frozen, true, '發薪進行中才凍結');
});
