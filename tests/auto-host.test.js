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

test('全自動主持：主持人不按任何按鈕、玩家不送任何決策，整場仍能跑到終局、照常發薪與揭曉共同抉擇', { timeout: 240_000 }, async (t) => {
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
  // 這裡的玩家完全不理財、不顧健康，可能提早全數過世；重點是流程：每 3 輪至少發薪一次
  assert.ok(latest.globalPaydayNumber >= Math.floor(latest.turnNumber / 3), `發薪次數要跟輪數相符（${latest.turnNumber} 輪、發薪 ${latest.globalPaydayNumber} 次）`);
  assert.ok(latest.globalPaydayNumber >= 3, `至少發薪 3 次（實際 ${latest.globalPaydayNumber}）`);
  assert.match(autoLog, /共同抉擇依多數決揭曉/, '發薪後的全場共同抉擇沒人投票也會依多數決揭曉');
  assert.match(autoLog, /倒數結束，收束/, '決策沒人送出時會在倒數結束收束');

  // ── 終局復盤 ──
  // 玩家手機不能拿全場完整紀錄
  const denied = await send(players[0], 'requestRoomAnalysis', undefined, 'error');
  assert.match(denied.message, /主持人/);
  const roomAnalysis = await send(admin, 'requestRoomAnalysis', undefined, 'roomAnalysis');
  assert.ok(roomAnalysis.communityChoices.length >= 1, '共同抉擇結果要能在復盤回顧');
  assert.ok(roomAnalysis.communityChoices[0].votes.length >= 2);
  for (const p of roomAnalysis.players) assert.ok(Array.isArray(p.keyDecisions), '每位玩家都有關鍵決策');
  // 個人分析與全場排名用同一份分數（離世者都用死亡時凍結的分數）
  const own = await send(players[0], 'requestPlayerAnalysis', undefined, 'playerAnalysis');
  assert.equal(own.finalScore.total, roomAnalysis.players.find((p) => p.playerId === ids[0]).score.total);
  assert.equal(typeof own.isAlive, 'boolean');
  // 大螢幕只能看主持人選來投影的那位玩家
  const display = await conn();
  await send(display, 'joinDisplay', { roomId: room.roomId }, 'joinDisplaySuccess');
  const blocked = await send(display, 'requestPlayerAnalysis', { targetPlayerId: ids[1] }, 'error');
  assert.match(blocked.message, /只能查看自己/);
  const shown = await send(admin, 'setReviewView', { view: 'player', playerId: ids[1] }, 'gameStateUpdate', (g) => g.reviewView?.view === 'player');
  assert.equal(shown.reviewView.playerId, ids[1]);
  const onScreen = await send(display, 'requestPlayerAnalysis', { targetPlayerId: ids[1] }, 'playerAnalysis');
  assert.equal(onScreen.playerId, ids[1]);
  const awards = await send(admin, 'setReviewView', { view: 'awards', step: 2 }, 'gameStateUpdate', (g) => g.reviewView?.view === 'awards');
  assert.equal(awards.reviewView.step, 2);
  const guide = await send(admin, 'setReviewView', { view: 'intro' }, 'reviewViewChanged');
  assert.equal(guide.view, 'guide', '舊版「復盤原則」按鈕對應到新的復盤引導');

  assert.equal(stderr.trim(), '', `伺服器不應有錯誤輸出：${stderr.slice(0, 400)}`);
});
