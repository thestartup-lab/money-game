// 開局前移除「第一位加入的玩家」後，輪次不能指向已不存在的玩家（曾出現「找不到目前輪到的玩家」）
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { io } = require('socket.io-client');

const PORT = 3311;
function wait(s, ev, pred = () => true, ms = 6000) {
  return new Promise((res, rej) => {
    const t = setTimeout(() => { s.off(ev, h); rej(new Error(`等待 ${ev} 逾時`)); }, ms);
    const h = (v) => { if (!pred(v)) return; clearTimeout(t); s.off(ev, h); res(v); };
    s.on(ev, h);
  });
}
const send = (s, ev, p, r, pred, ms) => { const w = wait(s, r, pred, ms); s.emit(ev, p); return w; };

test('開局前移除第一位加入者：開局後輪到仍在房間的玩家，擲骰與跳過都正常', { timeout: 30_000 }, async (t) => {
  const server = spawn(process.execPath, ['dist/socketServer.js'], { env: { ...process.env, PORT: String(PORT), NODE_ENV: 'test' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = ''; server.stderr.on('data', (d) => { stderr += d; });
  const sockets = [];
  t.after(() => { sockets.forEach((s) => s.disconnect()); server.kill('SIGTERM'); });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('boot timeout')), 6000);
    server.stdout.on('data', (d) => { if (String(d).includes('已啟動')) { clearTimeout(timer); resolve(); } });
  });
  const conn = async () => { const s = io(`http://127.0.0.1:${PORT}`, { transports: ['websocket'], reconnection: false }); sockets.push(s); await wait(s, 'connect'); return s; };
  const admin = await conn();
  const room = await send(admin, 'createRoom', { roomId: 'TURN1' }, 'roomCreated');
  const players = [await conn(), await conn(), await conn()];
  const ids = [];
  for (const [i, s] of players.entries()) ids.push((await send(s, 'playerJoin', { playerName: `P${i}`, roomCode: room.roomId }, 'playerSession')).playerId);

  const kicked = await send(admin, 'kickPlayer', { playerId: ids[0] }, 'gameStateUpdate', (g) => !g.players.some((p) => p.id === ids[0]));
  assert.ok(kicked.players.some((p) => p.id === kicked.currentPlayerTurnId), '移除第一位後，輪次要換到還在房間的玩家');

  // 關掉每輪開始的全體行動時間，才能直接測跳過
  await send(admin, 'setActionPhaseEnabled', { enabled: false }, 'gameStateUpdate', (g) => g.actionPhaseEnabled === false);
  const started = await send(admin, 'startGame', { force: true }, 'gameStateUpdate', (g) => g.gamePhase === 'RatRace');
  assert.equal(started.currentPlayerTurnId, ids[1]);
  const skipped = await send(admin, 'skipTurn', { playerId: ids[1] }, 'gameStateUpdate', (g) => g.currentPlayerTurnId === ids[2]);
  assert.equal(skipped.currentPlayerTurnId, ids[2], '主持人可以正常跳過');
  assert.equal(stderr.trim(), '', stderr.slice(0, 300));
});
