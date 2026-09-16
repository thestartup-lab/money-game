const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { io } = require('socket.io-client');

const PORT = 3291;
const URL = `http://127.0.0.1:${PORT}`;
function wait(socket, event, predicate = () => true, timeoutMs = 6_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.off(event, handler); reject(new Error(`等待 ${event} 逾時`)); }, timeoutMs);
    const handler = (payload) => { if (!predicate(payload)) return; clearTimeout(timer); socket.off(event, handler); resolve(payload); };
    socket.on(event, handler);
  });
}
function send(socket, event, payload, response, predicate) { const r = wait(socket, response, predicate); socket.emit(event, payload); return r; }
function connect() { const s = io(URL, { forceNew: true, transports: ['websocket'], reconnection: false }); return wait(s, 'connect').then(() => s); }

test('手機端 secondLifeProgress：內圈玩家拿到缺口明細，與資格判定一致', { timeout: 20000 }, async (t) => {
  const server = spawn(process.execPath, ['dist/socketServer.js'], { cwd: process.cwd(), env: { ...process.env, PORT: String(PORT), NODE_ENV: 'test' }, stdio: ['ignore', 'pipe', 'pipe'] });
  const sockets = [];
  t.after(() => { sockets.forEach((s) => s.disconnect()); server.kill('SIGTERM'); });
  await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('boot timeout')), 5000); server.stdout.on('data', (d) => { if (String(d).includes('伺服器已啟動')) { clearTimeout(timer); resolve(); } }); });
  const open = async () => { const s = await connect(); sockets.push(s); return s; };
  const admin = await open(); const a = await open();
  const room = await send(admin, 'createRoom', { roomId: 'S' + PORT }, 'roomCreated');
  await send(admin, 'setActionPhaseEnabled', { enabled: false }, 'gameStateUpdate', (g) => g.actionPhaseEnabled === false);
  const sa = await send(a, 'playerJoin', { playerName: '甲', roomCode: room.roomId }, 'playerSession');
  const gs = await send(admin, 'startGame', { force: true }, 'gameStateUpdate', (g) => g.gamePhase === 'RatRace');
  const me = gs.players.find((p) => p.id === sa.playerId);
  const pg = me.secondLifeProgress;
  assert.ok(pg, '內圈玩家應有 secondLifeProgress');
  assert.equal(pg.eligible, false);
  assert.equal(pg.seasoned, false);
  assert.equal(pg.minPaydays, 6);
  assert.equal(pg.totalExpenses, me.totalExpenses);
  assert.equal(pg.indicators.length, 4);
  for (const i of pg.indicators) assert.equal(i.gap, Math.max(0, i.threshold - i.value));
  const bl = pg.routes.balancedLife, fb = pg.routes.financialBreakthrough;
  assert.equal(bl.coverageRequired, 0.75); assert.equal(fb.coverageRequired, 1);
  assert.equal(bl.targetEffectivePassiveIncome, Math.ceil(pg.totalExpenses * 0.75));
  assert.equal(bl.effectivePassiveGap, Math.max(0, bl.targetEffectivePassiveIncome - pg.effectivePassiveIncome));
  assert.equal(bl.rawPassiveGap, Math.ceil(bl.effectivePassiveGap / pg.fqMultiplier));
  assert.ok(fb.effectivePassiveGap >= bl.effectivePassiveGap, '財務突破的缺口不會比平衡人生小');
  assert.equal(bl.indicatorGap, Math.max(0, 2 - pg.achievedIndicatorCount));
  assert.equal(fb.indicatorGap, Math.max(0, 1 - pg.achievedIndicatorCount));
  assert.equal(Math.abs(pg.coverageRatio - pg.effectivePassiveIncome / pg.totalExpenses) < 0.001, true);
});
