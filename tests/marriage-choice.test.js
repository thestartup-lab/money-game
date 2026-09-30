// 主動相親達門檻 → 下一個空檔自動開求婚舞台 → 主持人不能代答應 → 本人在手機決定
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { io } = require('socket.io-client');

const PORT = 3315;
function wait(s, ev, pred = () => true, ms = 8000) {
  return new Promise((res, rej) => {
    const t = setTimeout(() => { s.off(ev, h); rej(new Error(`等待 ${ev} 逾時`)); }, ms);
    const h = (v) => { if (!pred(v)) return; clearTimeout(t); s.off(ev, h); res(v); };
    s.on(ev, h);
  });
}
const send = (s, ev, p, r, pred, ms) => { const w = wait(s, r, pred, ms); s.emit(ev, p); return w; };

test('主動相親、自動開求婚舞台、本人決定答應或婉拒', { timeout: 40_000 }, async (t) => {
  const boot = `
    Math.random = () => 0.99;
    const cards = require('./dist/gameCards'); cards.BOARD.forEach((c) => { c.type = cards.SquareType.SecondLife; });
    const logic = require('./dist/gameLogic'); const create = logic.createPlayer;
    logic.createPlayer = (...a) => { const p = create(...a); p.cash = 500000; p.stats.health = 90;
      if (a[1] === '單身') { p.relationshipActive = true; p.relationshipPoints = 80; } return p; };
    require('./dist/socketServer');`;
  const server = spawn(process.execPath, ['-e', boot], { env: { ...process.env, PORT: String(PORT), NODE_ENV: 'test' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = ''; server.stderr.on('data', (d) => { stderr += d; });
  const sockets = [];
  t.after(() => { sockets.forEach((s) => s.disconnect()); server.kill('SIGTERM'); });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('boot timeout')), 6000);
    server.stdout.on('data', (d) => { if (String(d).includes('已啟動')) { clearTimeout(timer); resolve(); } });
  });
  const conn = async () => { const s = io(`http://127.0.0.1:${PORT}`, { transports: ['websocket'], reconnection: false }); sockets.push(s); await wait(s, 'connect'); return s; };
  const admin = await conn();
  let latest = null; admin.on('gameStateUpdate', (g) => { latest = g; });
  const until = async (pred, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { if (latest && pred(latest)) return latest; await new Promise((r) => setTimeout(r, 30)); } throw new Error('狀態沒有如預期更新：' + JSON.stringify({ d: latest?.decisionPhase?.kind, s: latest?.facilitatorScene?.kind })); };
  const room = await send(admin, 'createRoom', { roomId: 'WED01' }, 'roomCreated');
  const single = await conn(); const other = await conn();
  const singleId = (await send(single, 'playerJoin', { playerName: '單身', roomCode: room.roomId }, 'playerSession')).playerId;
  await send(other, 'playerJoin', { playerName: '朋友', roomCode: room.roomId }, 'playerSession');
  await send(admin, 'startGame', { force: true }, 'gameStateUpdate', (g) => g.decisionPhase?.kind === 'actions', 8000);

  const result = await send(single, 'seekMarriage', undefined, 'matchmakingResult');
  assert.equal(result.reached, true, '相親後達到門檻');
  assert.match((await send(single, 'seekMarriage', undefined, 'error')).message, /這一輪/);
  for (const s of [single, other]) s.emit('finishActionPhase');
  await until((g) => !g.decisionPhase);

  // 走一步，回合結束後的空檔自動開求婚舞台
  const mover = latest.currentPlayerTurnId === singleId ? single : other;
  mover.emit('playerRoll', { diceCount: 1 });
  const scene = (await until((g) => g.facilitatorScene?.kind === 'marriage', 12000)).facilitatorScene;
  assert.equal(scene.careerPlayerId, singleId);
  assert.match(scene.description, /配偶每月實拿/);

  // 主持人不能代為答應；本人答應後揭曉
  assert.match((await send(admin, 'resolveFacilitatorScene', { sceneId: scene.id, choiceId: 'accept' }, 'error')).message, /手機決定/);
  single.emit('answerMarriage', { sceneId: scene.id, accept: true });
  await until((g) => g.facilitatorScene?.careerConfirmed === true);
  admin.emit('resolveFacilitatorScene', { sceneId: scene.id, choiceId: 'reveal' });
  const married = await until((g) => g.facilitatorScene?.stage === 'result');
  assert.equal(married.players.find((p) => p.id === singleId).isMarried, true);
  assert.equal(stderr.trim(), '', stderr.slice(0, 300));
});
