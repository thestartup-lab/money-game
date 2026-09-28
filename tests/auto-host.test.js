// 全自動主持：主持人開局後完全不操作、玩家只擲骰（任何決策都不送出），整場也要能自己跑完。
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { io } = require('socket.io-client');

const PORT = 3299;
const URL = `http://127.0.0.1:${PORT}`;
function wait(s, ev, pred = () => true, ms = 8000) {
  return new Promise((res, rej) => {
    const t = setTimeout(() => { s.off(ev, h); rej(new Error(`等待 ${ev} 逾時`)); }, ms);
    const h = (v) => { if (!pred(v)) return; clearTimeout(t); s.off(ev, h); res(v); };
    s.on(ev, h);
  });
}
function send(s, ev, p, r, pred, ms) { const w = wait(s, r, pred, ms); s.emit(ev, p); return w; }

test('全自動主持：主持人不按任何按鈕、玩家不送任何決策，整場仍能跑到終局並照常發薪', { timeout: 240_000 }, async (t) => {
  const boot = "let seed=3;Math.random=()=>{seed=(seed*1103515245+12345)%2147483648;return seed/2147483648;};require('./dist/socketServer');";
  const server = spawn(process.execPath, ['-e', boot], {
    env: { ...process.env, PORT: String(PORT), NODE_ENV: 'test', AUTO_HOST_TIME_SCALE: '0.004', AUTO_HOST_TICK_MS: '40' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = ''; let autoLog = '';
  server.stderr.on('data', (d) => { stderr += d; });
  server.stdout.on('data', (d) => { if (String(d).includes('[autoHost]')) autoLog += d; });
  const sockets = [];
  t.after(() => { sockets.forEach((s) => s.disconnect()); server.kill('SIGTERM'); });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('boot timeout')), 6000);
    server.stdout.on('data', (d) => { if (String(d).includes('已啟動')) { clearTimeout(timer); resolve(); } });
  });
  const conn = async () => { const s = io(URL, { transports: ['websocket'], reconnection: false }); sockets.push(s); await wait(s, 'connect'); return s; };
  const admin = await conn();
  let latest = null;
  admin.on('gameStateUpdate', (g) => { latest = g; });
  const room = await send(admin, 'createRoom', { roomId: 'AUTO99' }, 'roomCreated');
  const players = [await conn(), await conn(), await conn()];
  const ids = [];
  for (const [i, s] of players.entries()) ids.push((await send(s, 'playerJoin', { playerName: `P${i}`, roomCode: room.roomId }, 'playerSession')).playerId);
  await send(admin, 'startGame', { force: true }, 'gameStateUpdate', (g) => g.gamePhase === 'RatRace');
  const on = await send(admin, 'setAutoHost', { enabled: true }, 'gameStateUpdate', (g) => g.autoHost === true);
  assert.equal(on.autoHost, true);

  // 從這裡開始主持人不再送任何事件；玩家只在輪到自己時擲骰
  const deadline = Date.now() + 210_000;
  let lastTurn = -1; let lastProgress = Date.now();
  while (latest.gamePhase !== 'GameOver' && Date.now() < deadline) {
    if (latest.turnNumber !== lastTurn) { lastTurn = latest.turnNumber; lastProgress = Date.now(); }
    assert.ok(Date.now() - lastProgress < 60_000, `第 ${latest.turnNumber} 輪卡住：${JSON.stringify({ decision: latest.decisionPhase?.kind, scene: latest.facilitatorScene?.kind, stage: latest.facilitatorScene?.stage, paused: latest.isPaused })}`);
    const i = ids.indexOf(latest.currentPlayerTurnId);
    if (latest.decisionPhase || latest.facilitatorScene || latest.turnInProgress || latest.globalPaydayInProgress || latest.isPaused || i < 0) {
      await new Promise((r) => setTimeout(r, 60)); continue;
    }
    players[i].emit('playerRoll', { diceCount: 2 });
    await new Promise((r) => setTimeout(r, 80));
  }
  assert.equal(latest.gamePhase, 'GameOver', '沒有主持人也能跑到終局');
  assert.ok(latest.globalPaydayNumber >= 5, `至少發薪 5 次（實際 ${latest.globalPaydayNumber}）`);
  assert.match(autoLog, /倒數結束，收束/, '決策沒人送出時會在倒數結束收束');
  assert.equal(stderr.trim(), '', `伺服器不應有錯誤輸出：${stderr.slice(0, 400)}`);
});
