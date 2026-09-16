const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { io } = require('socket.io-client');

const PORT = 3241;
const URL = `http://127.0.0.1:${PORT}`;

function wait(socket, event, predicate = () => true, timeoutMs = 4_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.off(event, handler); reject(new Error(`等待 ${event} 逾時`)); }, timeoutMs);
    const handler = (payload) => {
      if (!predicate(payload)) return;
      clearTimeout(timer); socket.off(event, handler); resolve(payload);
    };
    socket.on(event, handler);
  });
}
function send(socket, event, payload, response, predicate) {
  const result = wait(socket, response, predicate); socket.emit(event, payload); return result;
}
function connect() {
  const socket = io(URL, { forceNew: true, transports: ['websocket'], reconnection: false });
  return wait(socket, 'connect').then(() => socket);
}

test('離線且未完成設定的玩家會擋開局；強制開始後主持人可跳過回合；舊頁面被接手時會收到通知', { timeout: 20000 }, async (t) => {
  const server = spawn(process.execPath, ['dist/socketServer.js'], {
    cwd: process.cwd(), env: { ...process.env, PORT: String(PORT), NODE_ENV: 'test' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const sockets = [];
  t.after(() => { sockets.forEach((s) => s.disconnect()); server.kill('SIGTERM'); });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server boot timeout')), 5000);
    server.stdout.on('data', (d) => { if (String(d).includes('伺服器已啟動')) { clearTimeout(timer); resolve(); } });
  });
  const open = async () => { const s = await connect(); sockets.push(s); return s; };

  const admin = await open();
  const room = await send(admin, 'createRoom', { roomId: 'H' + PORT }, 'roomCreated');
  await send(admin, 'setActionPhaseEnabled', { enabled: false }, 'gameStateUpdate', g => g.actionPhaseEnabled === false);
  const a = await open(); const b = await open();
  const sa = await send(a, 'playerJoin', { playerName: '甲', roomCode: room.roomId }, 'playerSession');
  await send(b, 'playerJoin', { playerName: '乙', roomCode: room.roomId }, 'playerSession');

  // 甲在投胎前就斷線：不算就緒，非強制開始必須被擋下並點名
  a.disconnect();
  await wait(admin, 'gameStateUpdate', (g) => g.players.find((p) => p.id === sa.playerId)?.isDisconnected === true);
  const blocked = await send(admin, 'startGame', {}, 'error');
  assert.match(blocked.message, /甲（離線）/);

  // 強制開始：所有人（含離線者）都被補齊真正的職業
  const started = await send(admin, 'startGame', { force: true }, 'gameStateUpdate', (g) => g.gamePhase === 'RatRace');
  for (const p of started.players) {
    assert.equal(p.pre20Done, true);
    assert.notEqual(p.profession.id, '__placeholder__');
    assert.ok(p.profession.startingSalary > 0);
  }
  assert.equal(started.readingAutoContinueMs, 10000);
  assert.equal(started.isManuallyPaused, false);

  // 遊戲中再送 startGame 會被拒絕，年齡不會被歸零
  const again = await send(admin, 'startGame', { force: true }, 'error');
  assert.match(again.message, /已經開始/);

  // 輪到離線的甲：主持人可以直接跳過，換乙行動
  const first = started.currentPlayerTurnId;
  const skipped = await send(admin, 'skipTurn', {}, 'gameStateUpdate', (g) => g.currentPlayerTurnId !== first);
  assert.notEqual(skipped.currentPlayerTurnId, first);

  // 玩家自己不能跳過回合
  const denied = await send(b, 'skipTurn', {}, 'error');
  assert.match(denied.message, /管理員/);

  // 落格說明自動放行設定
  const paced = await send(admin, 'setReadingAutoContinue', { seconds: 5 }, 'gameStateUpdate', (g) => g.readingAutoContinueMs === 5000);
  assert.equal(paced.readingAutoContinueMs, 5000);

});

test('舊頁面在身分被接手時會收到 sessionTakenOver', { timeout: 20000 }, async (t) => {
  const port = PORT + 1;
  const server = spawn(process.execPath, ['dist/socketServer.js'], {
    cwd: process.cwd(), env: { ...process.env, PORT: String(port), NODE_ENV: 'test' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const sockets = [];
  t.after(() => { sockets.forEach((s) => s.disconnect()); server.kill('SIGTERM'); });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server boot timeout')), 5000);
    server.stdout.on('data', (d) => { if (String(d).includes('伺服器已啟動')) { clearTimeout(timer); resolve(); } });
  });
  const open = async () => {
    const s = io(`http://127.0.0.1:${port}`, { forceNew: true, transports: ['websocket'], reconnection: false });
    await wait(s, 'connect'); sockets.push(s); return s;
  };
  const admin = await open();
  const room = await send(admin, 'createRoom', { roomId: 'T' + port }, 'roomCreated');
  const oldPage = await open();
  const session = await send(oldPage, 'playerJoin', { playerName: '丙', roomCode: room.roomId }, 'playerSession');
  const takenOver = wait(oldPage, 'sessionTakenOver');
  const disconnected = wait(oldPage, 'disconnect');
  const newPage = await open();
  await send(newPage, 'playerRejoin', { playerName: '丙', roomCode: room.roomId, reconnectToken: session.reconnectToken }, 'rejoinSuccess');
  const notice = await takenOver;
  assert.match(notice.message, /另一個/);
  assert.equal(await disconnected, 'io server disconnect');
});
