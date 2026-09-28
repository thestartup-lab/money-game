// 整場回歸測試：三位電腦玩家從 20 歲玩到終局，檢查「整場流程不會卡住、會發薪、存錢的人有路脫離內圈」。
// 單一機制的測試抓不到機制之間的交互問題（例如計時發薪在決策期間凍結、整場沒發薪），這支專門抓那一類。
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { io } = require('socket.io-client');

const PORT = 3297;
const URL = `http://127.0.0.1:${PORT}`;
const SEED = 7;

function wait(s, ev, pred = () => true, ms = 8000) {
  return new Promise((res, rej) => {
    const t = setTimeout(() => { s.off(ev, h); rej(new Error(`等待 ${ev} 逾時`)); }, ms);
    const h = (v) => { if (!pred(v)) return; clearTimeout(t); s.off(ev, h); res(v); };
    s.on(ev, h);
  });
}
function send(s, ev, p, r, pred, ms) { const w = wait(s, r, pred, ms); s.emit(ev, p); return w; }

test('整場回歸：玩到終局不卡住、計時發薪至少 5 次、有人靠被動收入進外圈', { timeout: 240_000 }, async (t) => {
  // 固定亂數種子，讓每次跑出同一場
  const boot = `let seed=${SEED};Math.random=()=>{seed=(seed*1103515245+12345)%2147483648;return seed/2147483648;};require('./dist/socketServer');`;
  const server = spawn(process.execPath, ['-e', boot], { env: { ...process.env, PORT: String(PORT), NODE_ENV: 'test' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  server.stderr.on('data', (d) => { stderr += d; });
  const sockets = [];
  t.after(() => { sockets.forEach((s) => s.disconnect()); server.kill('SIGTERM'); });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('boot timeout')), 6000);
    server.stdout.on('data', (d) => { if (String(d).includes('已啟動')) { clearTimeout(timer); resolve(); } });
  });
  const conn = async () => { const s = io(URL, { transports: ['websocket'], reconnection: false }); sockets.push(s); await wait(s, 'connect'); return s; };
  const admin = await conn();
  const players = [await conn(), await conn(), await conn()];
  const names = ['甲', '乙', '丙'];
  const ids = [];
  let latest = null;
  const me = (g, i) => g.players.find((p) => p.id === ids[i]);

  // 電腦主持人：所有決策、舞台都自動放行；電腦玩家：固定、合理的理財策略
  admin.on('gameStateUpdate', (g) => {
    latest = g;
    const phase = g.decisionPhase;
    if (phase?.kind === 'reading') admin.emit('continueDecisionPhase', { phaseId: phase.id });
    if (phase?.kind === 'payday') {
      players.forEach((s, i) => {
        const p = me(g, i); if (!p?.isAlive) return;
        const offers = g.basicInvestmentOffers ?? [];
        const best = offers[offers.length - 1];
        const qty = best ? Math.max(0, Math.min(10, Math.floor((p.cash - 50_000) / best.cost))) : 0;
        s.emit('submitPaydayPlan', {
          phaseId: phase.id,
          stockDCAAmount: p.cash > 400_000 ? 150_000 : p.cash > 150_000 ? 30_000 : 0,
          buyInsuranceTypes: p.cash > 60_000 && !p.insurance.hasMedicalInsurance ? ['medical'] : [],
          investInHealthMaintenance: p.stats.health < 70 && p.cash > 30_000,
          investInHealthBoost: p.stats.health < 50 && p.cash > 40_000,
          investInSkillTraining: p.stats.careerSkill < 60 && p.cash > 30_000,
          lifestyle: 'normal',
          healthHabit: ['active', 'normal', 'overwork'][i],
          // 閒置現金留 30 萬，其餘轉進債券基金
          bondAmount: Math.max(0, Math.floor((p.cash - 300_000) / 1000) * 1000),
          ...(qty > 0 ? { basicInvestmentId: best.id, basicInvestmentQuantity: qty } : {}),
        });
      });
    }
    if (phase && !['reading', 'payday', 'actions'].includes(phase.kind)) {
      const i = ids.indexOf(phase.playerId);
      if (phase.kind === 'deal' && i >= 0) players[i].emit('submitCardDecision', { phaseId: phase.id, accept: true, useLeverage: true });
      else if (phase.kind === 'charity' && i >= 0) players[i].emit('submitCardDecision', { phaseId: phase.id, donate: true });
      else if (phase.kind === 'relationship' && i >= 0) players[i].emit('submitCardDecision', { phaseId: phase.id, accept: true });
      else setTimeout(() => admin.emit('continueDecisionPhase', { phaseId: phase.id }), 150);
    }
    if (phase?.kind === 'actions') {
      players.forEach((s, i) => {
        const p = me(g, i); if (!p?.isAlive) return;
        const home = (p.homeOffers ?? []).filter((o) => o.affordable && p.cash - o.cashNeeded > 100_000).pop();
        if (home && p.housing === 'rent') s.emit('buyHome', { optionId: home.id });
        s.emit('finishActionPhase');
      });
    }
    const scene = g.facilitatorScene;
    if (scene?.kind === 'retirement' && scene.stage === 'prompt' && !scene.careerConfirmed) {
      const i = ids.indexOf(scene.careerPlayerId);
      if (i >= 0) players[i].emit('chooseRetirement', { sceneId: scene.id, choice: ['retire', 'consultant', 'retire'][i] });
    }
    if (scene?.stage === 'prompt' && (scene.kind !== 'retirement' || scene.careerConfirmed)) {
      const opt = (scene.options ?? [])[0];
      if (opt) setTimeout(() => admin.emit('resolveFacilitatorScene', { sceneId: scene.id, choiceId: opt.id }), 100);
    }
    if (scene?.stage === 'result') setTimeout(() => admin.emit('closeFacilitatorScene', { sceneId: scene.id }), 80);
  });

  const room = await send(admin, 'createRoom', { roomId: 'FULL97' }, 'roomCreated');
  for (const [i, s] of players.entries()) ids.push((await send(s, 'playerJoin', { playerName: names[i], roomCode: room.roomId }, 'playerSession')).playerId);
  await send(admin, 'startGame', { force: true }, 'gameStateUpdate', (g) => g.gamePhase === 'RatRace');
  assert.equal(latest.paydayTimer.enabled, true, '用預設的計時發薪跑（驗證保底三輪）');

  const reachedOuterTrack = new Set();
  const deadline = Date.now() + 200_000;
  let lastProgressAt = Date.now();
  let lastTurn = -1;
  while (latest.gamePhase !== 'GameOver' && Date.now() < deadline) {
    for (const p of latest.players) if (p.isInFastTrack) reachedOuterTrack.add(p.name);
    if (latest.turnNumber !== lastTurn) { lastTurn = latest.turnNumber; lastProgressAt = Date.now(); }
    assert.ok(Date.now() - lastProgressAt < 45_000, `第 ${latest.turnNumber} 輪卡住超過 45 秒：${JSON.stringify({ decision: latest.decisionPhase?.kind, scene: latest.facilitatorScene?.kind, payday: latest.globalPaydayInProgress })}`);
    const i = ids.indexOf(latest.currentPlayerTurnId);
    if (latest.decisionPhase || latest.facilitatorScene || latest.turnInProgress || latest.globalPaydayInProgress || i < 0) {
      await new Promise((r) => setTimeout(r, 100)); continue;
    }
    await send(players[i], 'playerRoll', { diceCount: 2 }, 'gameStateUpdate',
      (g) => g.currentPlayerTurnId !== latest.currentPlayerTurnId || g.decisionPhase || g.facilitatorScene || g.gamePhase === 'GameOver', 6000).catch(() => {});
    await new Promise((r) => setTimeout(r, 40));
  }
  for (const p of latest.players) if (p.isInFastTrack) reachedOuterTrack.add(p.name);

  assert.equal(latest.gamePhase, 'GameOver', '整場要能玩到終局');
  assert.ok(latest.globalPaydayNumber >= 5, `整場至少發薪 5 次（實際 ${latest.globalPaydayNumber}）`);
  assert.ok(reachedOuterTrack.size >= 1, '至少一位靠被動收入進入外圈');
  assert.ok(latest.players.every((p) => p.salaryGrowthMultiplier > 1), '每個人都有年資加薪');
  assert.ok(latest.players.some((p) => (p.assets ?? []).some((a) => a.id === 'bond-fund')), '債券基金有被使用');
  assert.equal(stderr.trim(), '', `伺服器不應有錯誤輸出：${stderr.slice(0, 500)}`);
});
