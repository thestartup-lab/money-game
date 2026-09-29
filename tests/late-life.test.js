// 後半場目標：外圈玩家指導後輩、離世玩家當家族顧問（建議、投票）
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { io } = require('socket.io-client');

const PORT = 3313;
function wait(s, ev, pred = () => true, ms = 6000) {
  return new Promise((res, rej) => {
    const t = setTimeout(() => { s.off(ev, h); rej(new Error(`等待 ${ev} 逾時`)); }, ms);
    const h = (v) => { if (!pred(v)) return; clearTimeout(t); s.off(ev, h); res(v); };
    s.on(ev, h);
  });
}
const send = (s, ev, p, r, pred, ms) => { const w = wait(s, r, pred, ms); s.emit(ev, p); return w; };

test('外圈玩家每輪可指導一位內圈玩家；離世玩家每輪可給一句建議，也能在共同抉擇投票', { timeout: 30_000 }, async (t) => {
  // 測試專用：名字是「前輩」的玩家開局就在外圈，「祖父」開局就已離世
  const boot = `
    const logic = require('./dist/gameLogic'); const create = logic.createPlayer;
    logic.createPlayer = (...args) => { const p = create(...args);
      if (args[1] === '前輩') { p.isInFastTrack = true; }
      if (args[1] === '祖父') { p.isAlive = false; }
      return p; };
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
  let latest = null;
  admin.on('gameStateUpdate', (g) => { latest = g; });
  const until = async (pred, ms = 6000) => { const end = Date.now() + ms; while (Date.now() < end) { if (latest && pred(latest)) return latest; await new Promise((r) => setTimeout(r, 30)); } throw new Error('狀態沒有如預期更新'); };
  const room = await send(admin, 'createRoom', { roomId: 'LATE1' }, 'roomCreated');
  const names = ['前輩', '新人', '祖父'];
  const players = []; const ids = [];
  for (const n of names) { const s = await conn(); players.push(s); ids.push((await send(s, 'playerJoin', { playerName: n, roomCode: room.roomId }, 'playerSession')).playerId); }
  const [senior, junior, grandpa] = players;
  const started = await send(admin, 'startGame', { force: true }, 'gameStateUpdate', (g) => g.decisionPhase?.kind === 'actions', 8000);
  assert.ok(started.adviceCards.length >= 6, '建議卡清單送到畫面');

  // 指導後輩：只有外圈玩家、每輪一次
  assert.match((await send(junior, 'mentorPlayer', { targetPlayerId: ids[0] }, 'error')).message, /外圈/);
  const skillBefore = started.players.find((p) => p.id === ids[1]).stats.careerSkill;
  const mentored = await send(senior, 'mentorPlayer', { targetPlayerId: ids[1] }, 'mentorshipGiven');
  assert.equal(mentored.targetName, '新人');
  const after = await until((g) => g.players.find((p) => p.id === ids[0]).mentorCount === 1);
  assert.equal(after.players.find((p) => p.id === ids[1]).stats.careerSkill, skillBefore + 10);
  assert.match((await send(senior, 'mentorPlayer', { targetPlayerId: ids[1] }, 'error')).message, /這一輪/);

  // 家族顧問：離世玩家給建議，每輪一次；在世玩家不能用
  assert.match((await send(junior, 'sendAdvice', { targetPlayerId: ids[0], adviceId: 'insurance' }, 'error')).message, /離世/);
  const advice = await send(grandpa, 'sendAdvice', { targetPlayerId: ids[1], adviceId: 'insurance' }, 'advisorAdvice');
  assert.equal(advice.advisorName, '祖父'); assert.equal(advice.targetName, '新人');
  assert.match((await send(grandpa, 'sendAdvice', { targetPlayerId: ids[0], adviceId: 'health' }, 'error')).message, /這一輪/);

  // 家族顧問也能在全場共同抉擇投票（先結束行動時間）
  for (const s of [senior, junior]) s.emit('finishActionPhase');
  await until((g) => !g.decisionPhase);
  const scene = await send(admin, 'startFacilitatorScene', { kind: 'community', cardId: 'healthcare' }, 'gameStateUpdate', (g) => g.facilitatorScene?.kind === 'community');
  assert.equal(scene.facilitatorScene.voterCount, 3, '離世玩家也算投票人');
  const optionId = scene.facilitatorScene.options[0].id;
  await send(grandpa, 'voteCommunityChoice', { sceneId: scene.facilitatorScene.id, optionId }, 'communityVoteRecorded');
  const voted = await until((g) => g.facilitatorScene?.votedCount === 1);
  assert.equal(voted.facilitatorScene.votes[optionId], 1);
  assert.equal(stderr.trim(), '', stderr.slice(0, 300));
});
