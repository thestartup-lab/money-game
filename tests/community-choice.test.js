// 全場共同抉擇在發薪後自動出現、手機投票多數決；開著行動時間時，財務行動只在行動時間進行。
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { io } = require('socket.io-client');

const PORT = 3301;
const URL = `http://127.0.0.1:${PORT}`;
function wait(s, ev, pred = () => true, ms = 8000) {
  return new Promise((res, rej) => {
    const t = setTimeout(() => { s.off(ev, h); rej(new Error(`等待 ${ev} 逾時`)); }, ms);
    const h = (v) => { if (!pred(v)) return; clearTimeout(t); s.off(ev, h); res(v); };
    s.on(ev, h);
  });
}
function send(s, ev, p, r, pred, ms) { const w = wait(s, r, pred, ms); if (p === undefined) s.emit(ev); else s.emit(ev, p); return w; }

test('行動時段限制與發薪後共同抉擇投票', { timeout: 60_000 }, async (t) => {
  const boot = "const cards=require('./dist/gameCards');cards.BOARD.forEach(c=>c.type=cards.SquareType.SecondLife);require('./dist/socketServer');";
  const server = spawn(process.execPath, ['-e', boot], { env: { ...process.env, PORT: String(PORT), NODE_ENV: 'test' }, stdio: ['ignore', 'pipe', 'pipe'] });
  const sockets = [];
  t.after(() => { sockets.forEach((s) => s.disconnect()); server.kill('SIGTERM'); });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('boot timeout')), 6000);
    server.stdout.on('data', (d) => { if (String(d).includes('已啟動')) { clearTimeout(timer); resolve(); } });
  });
  const conn = async () => { const s = io(URL, { transports: ['websocket'], reconnection: false }); sockets.push(s); await wait(s, 'connect'); return s; };
  const admin = await conn(); const a = await conn(); const b = await conn();
  let latest = null;
  admin.on('gameStateUpdate', (g) => { latest = g; if (g.decisionPhase?.kind === 'reading') admin.emit('continueDecisionPhase', { phaseId: g.decisionPhase.id }); });
  const room = await send(admin, 'createRoom', { roomId: 'VOTE01' }, 'roomCreated');
  await send(admin, 'setPaydayTimer', { enabled: false }, 'gameStateUpdate', (g) => g.paydayTimer?.enabled === false);
  const sa = await send(a, 'playerJoin', { playerName: '甲', roomCode: room.roomId }, 'playerSession');
  const sb = await send(b, 'playerJoin', { playerName: '乙', roomCode: room.roomId }, 'playerSession');
  const started = await send(admin, 'startGame', { force: true }, 'gameStateUpdate', (g) => g.decisionPhase?.kind === 'actions');
  assert.equal(started.communityChoiceAuto, true, '預設開啟');

  // 行動時間內可以操作（旅遊、聯誼也要能用：行動時間本身是決策階段，不能被當成「決策中」擋掉）
  await send(a, 'buyInsurance', { insuranceType: 'life' }, 'insuranceUpdated');
  const trip = await send(b, 'goTravel', { destinationId: 'taiwan_cycling' }, 'travelResult');
  assert.ok(trip.success || /現金不足/.test(trip.message), `旅遊應被受理：${trip.message}`);
  const social = await send(b, 'attendSocialEvent', undefined, 'socialEventResult');
  assert.ok(social.success || /現金不足|健康|已婚|空閒/.test(social.message), `聯誼應被受理：${social.message}`);
  // 行動時間結束後（輪到擲骰時）不行
  await send(a, 'finishActionPhase', undefined, 'gameStateUpdate', (g) => (g.actionPhaseDone ?? []).includes(sa.playerId));
  await send(b, 'finishActionPhase', undefined, 'gameStateUpdate', (g) => !g.decisionPhase);
  const blocked = await send(a, 'buyInsurance', { insuranceType: 'medical' }, 'error');
  assert.match(blocked.message, /全體行動時間/);

  // 走三輪觸發發薪 → 發薪結算後自動出現共同抉擇
  const roll = async () => {
    for (let guard = 0; guard < 60 && latest.gamePhase === 'RatRace'; guard++) {
      const g = latest;
      if (g.decisionPhase?.kind === 'actions') { a.emit('finishActionPhase'); b.emit('finishActionPhase'); }
      else if (g.decisionPhase?.kind === 'payday') {
        for (const s of [a, b]) s.emit('submitPaydayPlan', { phaseId: g.decisionPhase.id, stockDCAAmount: 0, buyInsuranceTypes: [] });
      } else if (g.facilitatorScene?.kind === 'community') return g;
      else if (g.facilitatorScene?.stage === 'result') admin.emit('closeFacilitatorScene', { sceneId: g.facilitatorScene.id });
      else if (g.facilitatorScene?.stage === 'prompt') admin.emit('resolveFacilitatorScene', { sceneId: g.facilitatorScene.id, choiceId: (g.facilitatorScene.options ?? [])[0]?.id ?? 'reveal' });
      else if (!g.decisionPhase && !g.turnInProgress && !g.facilitatorScene) (g.currentPlayerTurnId === sa.playerId ? a : b).emit('playerRoll', { diceCount: 1 });
      await new Promise((r) => setTimeout(r, 200));
    }
    return latest;
  };
  const scene = (await roll()).facilitatorScene;
  assert.equal(scene?.kind, 'community', '發薪後自動出現全場共同抉擇');
  assert.equal(latest.globalPaydayNumber, 1);
  assert.equal(scene.voterCount, 2);
  const [first, second] = scene.options;

  // 投票：甲投 A、乙投 B、甲改投 B → B 兩票
  await send(a, 'voteCommunityChoice', { sceneId: scene.id, optionId: first.id }, 'communityVoteRecorded');
  await send(b, 'voteCommunityChoice', { sceneId: scene.id, optionId: second.id }, 'communityVoteRecorded');
  const changed = await send(a, 'voteCommunityChoice', { sceneId: scene.id, optionId: second.id }, 'gameStateUpdate', (g) => g.facilitatorScene?.votes?.[second.id] === 2);
  assert.equal(changed.facilitatorScene.votedCount, 2, '改票不重複計算');
  assert.equal(changed.facilitatorScene.votes[first.id], 0);
  // 重複投同一票不會再廣播
  let extraUpdates = 0;
  const countUpdates = () => { extraUpdates += 1; };
  admin.on('gameStateUpdate', countUpdates);
  await send(a, 'voteCommunityChoice', { sceneId: scene.id, optionId: second.id }, 'communityVoteRecorded');
  await new Promise((r) => setTimeout(r, 200));
  admin.off('gameStateUpdate', countUpdates);
  assert.equal(extraUpdates, 0, '同一票重送不觸發全房更新');
  assert.match((await send(admin, 'voteCommunityChoice', { sceneId: scene.id, optionId: first.id }, 'error')).message, /玩家/, '主持人不能投票');

  const result = await send(admin, 'resolveFacilitatorScene', { sceneId: scene.id, choiceId: 'majority' }, 'gameStateUpdate', (g) => g.facilitatorScene?.stage === 'result');
  assert.match(result.facilitatorScene.resultTitle, new RegExp(second.label), '多數決選出得票最多的選項');
  assert.match(result.facilitatorScene.resultDescription, /2／2 人投票/);
  assert.match((await send(a, 'voteCommunityChoice', { sceneId: scene.id, optionId: first.id }, 'error')).message, /結束/, '揭曉後不能再投');
});
