const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { mkdtempSync, rmSync, readdirSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { io } = require('socket.io-client');

const PORT = 3295;
const URL = `http://127.0.0.1:${PORT}`;

function wait(socket, event, predicate = () => true, timeoutMs = 8_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.off(event, handler); reject(new Error(`等待 ${event} 逾時`)); }, timeoutMs);
    const handler = (payload) => { if (!predicate(payload)) return; clearTimeout(timer); socket.off(event, handler); resolve(payload); };
    socket.on(event, handler);
  });
}
function send(socket, event, payload, response, predicate) {
  const result = wait(socket, response, predicate);
  if (payload === undefined) socket.emit(event); else socket.emit(event, payload);
  return result;
}
function connect() {
  const s = io(URL, { forceNew: true, transports: ['websocket'], reconnection: false });
  return wait(s, 'connect').then(() => s);
}
function boot(stateDir) {
  const server = spawn(process.execPath, ['-e', 'Math.random=()=>0.4; require("./dist/socketServer")'], {
    cwd: process.cwd(), env: { ...process.env, PORT: String(PORT), NODE_ENV: 'test', STATE_DIR: stateDir }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  server.stdout.on('data', (d) => { log += d; });
  server.stderr.on('data', (d) => { log += d; });
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`boot timeout: ${log}`)), 6000);
    server.stdout.on('data', (d) => { if (String(d).includes('伺服器已啟動')) { clearTimeout(timer); resolve(); } });
  });
  const exited = new Promise((resolve) => server.once('exit', resolve));
  return { server, ready, exited, log: () => log };
}

test('伺服器重啟後還原房間：主持人用原控制碼登入、玩家用原身分續玩、遊戲暫停等主持人繼續', { timeout: 40000 }, async (t) => {
  const stateDir = mkdtempSync(join(tmpdir(), 'money-game-state-'));
  const sockets = [];
  let current = boot(stateDir);
  t.after(() => { sockets.forEach((s) => s.disconnect()); current.server.kill('SIGKILL'); rmSync(stateDir, { recursive: true, force: true }); });
  await current.ready;
  const open = async () => { const s = await connect(); sockets.push(s); return s; };

  // ── 第一次開機：建房、兩人加入、開局、走完一輪 ──
  const admin = await open();
  admin.on('gameStateUpdate', (g) => { if (g.decisionPhase?.kind === 'reading') admin.emit('continueDecisionPhase', { phaseId: g.decisionPhase.id }); });
  const room = await send(admin, 'createRoom', { roomId: 'SAVE01' }, 'roomCreated');
  await send(admin, 'setActionPhaseEnabled', { enabled: false }, 'gameStateUpdate', (g) => g.actionPhaseEnabled === false);
  await send(admin, 'setPaydayTimer', { enabled: false }, 'gameStateUpdate', (g) => g.paydayTimer?.enabled === false);
  const a = await open(); const b = await open();
  const sa = await send(a, 'playerJoin', { playerName: '甲', roomCode: room.roomId }, 'playerSession');
  const sb = await send(b, 'playerJoin', { playerName: '乙', roomCode: room.roomId }, 'playerSession');
  await send(admin, 'startGame', { force: true }, 'gameStateUpdate', (g) => g.gamePhase === 'RatRace');
  await send(a, 'playerRoll', { diceCount: 1 }, 'gameStateUpdate', (g) => g.currentPlayerTurnId === sb.playerId && !g.decisionPhase && !g.turnInProgress);
  const before = await send(b, 'playerRoll', { diceCount: 1 }, 'gameStateUpdate', (g) => g.turnNumber === 1 && g.currentPlayerTurnId === sa.playerId && !g.decisionPhase && !g.turnInProgress);
  await new Promise((r) => setTimeout(r, 800)); // 等防抖存檔寫入
  assert.ok(readdirSync(join(stateDir, 'rooms')).includes('SAVE01.json'), '靜止時會寫存檔');
  const health1 = await (await fetch(`${URL}/health`)).json();
  assert.equal(health1.persistence, 'volume');

  // ── 模擬部署：SIGTERM 關機 → 重新開機 ──
  sockets.forEach((s) => s.disconnect());
  sockets.length = 0;
  current.server.kill('SIGTERM');
  await current.exited;
  current = boot(stateDir);
  await current.ready;
  assert.match(current.log(), /已還原房間 SAVE01/);
  const health2 = await (await fetch(`${URL}/health`)).json();
  assert.equal(health2.rooms, 1);
  assert.equal(health2.restoredRooms, 1);

  // ── 主持人用原本的控制碼登入 ──
  const admin2 = await open();
  const login = wait(admin2, 'gameStateUpdate', (g) => g.gameId === 'SAVE01');
  admin2.emit('adminLogin', { roomId: 'SAVE01', password: room.adminCode });
  const restored = await login;
  assert.equal(restored.turnNumber, before.turnNumber, '輪數還原');
  assert.equal(restored.gamePhase, 'RatRace');
  assert.equal(restored.isPaused, true, '還原後暫停，等主持人按繼續');
  assert.ok(restored.restoredAt, '標記為從存檔還原');
  for (const p of before.players) {
    const r = restored.players.find((x) => x.id === p.id);
    assert.equal(r.cash, p.cash, `${p.name} 現金還原`);
    assert.equal(r.monthlyCashflow, p.monthlyCashflow, `${p.name} 現金流還原（getter 正常）`);
    assert.equal(r.profession.name, p.profession.name);
    assert.equal(r.isDisconnected, true, '還沒回來的玩家標為斷線');
  }

  // ── 玩家用手機存的身分自動續玩 ──
  const a2 = await open();
  const rejoined = await send(a2, 'playerRejoin', { playerName: '甲', roomCode: 'SAVE01', reconnectToken: sa.reconnectToken }, 'rejoinSuccess');
  assert.equal(rejoined.playerId, sa.playerId);
  const b2 = await open();
  await send(b2, 'playerRejoin', { playerName: '乙', roomCode: 'SAVE01', reconnectToken: sb.reconnectToken }, 'rejoinSuccess');

  // ── 主持人按繼續後照常進行 ──
  admin2.on('gameStateUpdate', (g) => { if (g.decisionPhase?.kind === 'reading') admin2.emit('continueDecisionPhase', { phaseId: g.decisionPhase.id }); });
  const resumed = await send(admin2, 'resumeGame', {}, 'gameStateUpdate', (g) => !g.isPaused);
  assert.equal(resumed.restoredAt, null);
  // 擲骰被接受（開始行動或進入落格說明）就代表遊戲已正常恢復
  const rolled = await send(a2, 'playerRoll', { diceCount: 1 }, 'gameStateUpdate', (g) => g.turnInProgress || Boolean(g.decisionPhase));
  assert.ok(rolled.players.find((x) => x.id === sa.playerId).currentPosition !== before.players.find((x) => x.id === sa.playerId).currentPosition || rolled.turnInProgress);

});
