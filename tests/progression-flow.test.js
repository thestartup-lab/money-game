const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { io } = require('socket.io-client');

function wait(s, event, predicate = () => true) {
  return new Promise((resolve, reject) => {
    const listener = value => { if (predicate(value)) { clearTimeout(timer); s.off(event, listener); resolve(value); } };
    const timer = setTimeout(() => { s.off(event, listener); reject(Error('Timeout: ' + event)); }, 5000);
    s.on(event, listener);
  });
}
function send(s, event, payload, response, predicate) {
  const result = wait(s, response, predicate); s.emit(event, payload); return result;
}

async function fixture(t, port, passed, passive, autoReading = true, outer = false, deal = false, seasoned = false, crisis = false) {
  // Test-only deterministic state: exercise production Socket handlers without adding a production test endpoint.
  const boot = `
    Math.random=()=>0.4;
    const logic=require('./dist/gameLogic');
    const create=logic.createPlayer;
    logic.createPlayer=(...args)=>{
      const p=create(...args);p.pre20Done=true;p.cash=200000;
      p.hasPassedSecondLife=${passed};p.stats.health=40;p.stats.careerSkill=0;
      p.isInFastTrack=${outer};p.paydayCount=${seasoned ? 6 : 0};
      p.growthStats={academic:1,health:0,social:0,resource:0};
      p.expenses={taxes:0,homeMortgagePayment:0,carLoanPayment:0,creditCardPayment:0,otherExpenses:10000};
      p.liabilities=[];p.assets=[{id:'fixture',name:'測試收入',type:'Other',cost:1,currentValue:1,monthlyCashflow:${passive}}];
      return p;
    };
    const cards=require('./dist/gameCards');
    cards.BOARD.forEach(cell=>cell.type=cards.SquareType.SecondLife);
    if (${deal}) cards.BOARD.forEach(cell=>{cell.type=cards.SquareType.SmallDeal;cell.label='小交易';});
    if (${crisis}) { cards.BOARD.forEach(cell=>{cell.type=cards.SquareType.Crisis;cell.label='危機事件';}); cards.CRISIS_POOL_BY_STAGE.Youth.splice(0, cards.CRISIS_POOL_BY_STAGE.Youth.length, 'cr-001'); }
    if (${outer}) cards.FAST_TRACK_BOARD.forEach(cell=>{cell.type=cards.FastTrackSquareType.TaxPlanning;cell.label='稅務規劃';});
    require('./dist/socketServer');
  `;
  const server = spawn(process.execPath, ['-e', boot], { env: { ...process.env, PORT: String(port), NODE_ENV: 'test' }, stdio: ['ignore', 'pipe', 'pipe'] });
  const sockets = []; let logs = '';
  server.stdout.on('data', data => { logs += data; }); server.stderr.on('data', data => { logs += data; });
  t.after(() => { sockets.forEach(s => s.disconnect()); server.kill(); });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error(logs)), 5000);
    server.stdout.on('data', data => { if (String(data).includes('伺服器已啟動')) { clearTimeout(timer); resolve(); } });
    server.once('exit', () => { clearTimeout(timer); reject(Error(logs)); });
  });
  async function connect() { const s = io('http://127.0.0.1:' + port, { transports: ['websocket'], reconnection: false }); sockets.push(s); await wait(s, 'connect'); return s; }
  const admin = await connect();
  if (autoReading) admin.on('gameStateUpdate', g => { if (g.decisionPhase?.kind === 'reading') admin.emit('continueDecisionPhase', { phaseId: g.decisionPhase.id }); });
  const room = await send(admin, 'createRoom', { roomId: 'F' + port }, 'roomCreated');
  const a = await connect(), b = await connect();
  const sa = await send(a, 'playerJoin', { playerName: '甲', roomCode: room.roomId }, 'playerSession');
  const sb = await send(b, 'playerJoin', { playerName: '乙', roomCode: room.roomId }, 'playerSession');
  await send(admin, 'startGame', { force: true }, 'gameStateUpdate', g => g.gamePhase === 'RatRace');
  return { admin, a, b, sa, sb, server, connect };
}

test('落格閱讀保留超過舊時限、主持人逐張確認、重連恢復、不能提早擲骰或越權跳過', { timeout: 15000 }, async t => {
  const { admin, a, b, sa, sb, connect } = await fixture(t, 3229, false, 0, false);
  const first = await send(a, 'playerRoll', { diceCount: 1 }, 'gameStateUpdate', g => g.decisionPhase?.kind === 'reading');
  assert.match(first.decisionPhase.title, /走到了/);
  assert.ok(first.decisionPhase.description);
  assert.equal(first.currentPlayerTurnId, sa.playerId);
  await send(a, 'continueDecisionPhase', { phaseId: first.decisionPhase.id }, 'error');
  await send(b, 'playerRoll', {}, 'error');
  await send(a, 'submitCardDecision', { phaseId: first.decisionPhase.id, accepted: true }, 'error');
  await new Promise(resolve => setTimeout(resolve, 5200));
  const display = await connect();
  const afterTimeout = await send(display, 'joinDisplay', { roomId: first.roomId }, 'gameStateUpdate');
  assert.equal(afterTimeout.decisionPhase.id, first.decisionPhase.id);
  assert.equal(afterTimeout.isPaused, true);
  a.disconnect();
  const resumed = await connect();
  const recovered = await send(resumed, 'playerRejoin', { playerName: '甲', roomCode: first.roomId, reconnectToken: sa.reconnectToken }, 'gameStateUpdate');
  assert.equal(recovered.decisionPhase.id, first.decisionPhase.id);
  const second = await send(admin, 'continueDecisionPhase', { phaseId: first.decisionPhase.id }, 'gameStateUpdate', g => g.decisionPhase?.kind === 'reading' && g.decisionPhase.id !== first.decisionPhase.id);
  assert.equal(second.decisionPhase.title, '第二人生');
  assert.equal(second.currentPlayerTurnId, sa.playerId);
  await send(admin, 'continueDecisionPhase', { phaseId: first.decisionPhase.id }, 'error');
  await send(admin, 'continueDecisionPhase', {}, 'error');
  const next = await send(admin, 'continueDecisionPhase', { phaseId: second.decisionPhase.id }, 'gameStateUpdate', g => !g.decisionPhase && !g.turnInProgress && g.currentPlayerTurnId === sb.playerId);
  assert.equal(next.isPaused, false);
});

test('閱讀完成才發出私人交易卡並開始完整決策倒數', { timeout: 10000 }, async t => {
  const { admin, a } = await fixture(t, 3232, false, 0, false, false, true);
  let cards = 0;
  a.on('dealCardsDrawn', () => cards++);
  const reading = await send(a, 'playerRoll', { diceCount: 1 }, 'gameStateUpdate', g => g.decisionPhase?.kind === 'reading');
  assert.equal(cards, 0);
  const decision = await send(admin, 'continueDecisionPhase', { phaseId: reading.decisionPhase.id }, 'gameStateUpdate', g => g.decisionPhase?.kind === 'deal');
  assert.equal(cards, 1);
  assert.ok(decision.decisionPhase.reminderEndsAt - Date.now() > 55000);
});

test('外圈也先閱讀落格再顯示結果，不提前跳至下一位', { timeout: 10000 }, async t => {
  const { admin, a, sa, sb } = await fixture(t, 3231, true, 0, false, true);
  const first = await send(a, 'playerRoll', { diceCount: 1 }, 'gameStateUpdate', g => g.decisionPhase?.kind === 'reading');
  assert.match(first.decisionPhase.title, /稅務規劃/);
  assert.equal(first.currentPlayerTurnId, sa.playerId);
  const second = await send(admin, 'continueDecisionPhase', { phaseId: first.decisionPhase.id }, 'gameStateUpdate', g => g.decisionPhase?.kind === 'reading' && g.decisionPhase.id !== first.decisionPhase.id);
  assert.equal(second.decisionPhase.title, 'FT 稅務規劃');
  await send(admin, 'continueDecisionPhase', { phaseId: second.decisionPhase.id }, 'gameStateUpdate', g => !g.decisionPhase && g.currentPlayerTurnId === sb.playerId);
});

test('結算達標免再擲骰：既有舞台不被蓋住、兩位依序揭曉、重複揭曉不重複進圈', { timeout: 20000 }, async t => {
  const { admin, a, sa, sb } = await fixture(t, 3223, true, 10000, true, false, false, true);
  let announced = 0; admin.on('ratRaceEscaped', () => announced++);
  const first = await send(admin, 'setPlayerStats', { targetPlayerId: sa.playerId, stats: { hp: 70 } }, 'gameStateUpdate', g => g.facilitatorScene?.kind === 'second_life');
  assert.equal(first.facilitatorScene.participantNames[0], '甲');
  assert.equal(first.players.find(p => p.id === sa.playerId).isInFastTrack, false);
  await send(a, 'resolveFacilitatorScene', { sceneId: first.facilitatorScene.id, choiceId: 'reveal' }, 'error');
  await send(admin, 'setPlayerStats', { targetPlayerId: sb.playerId, stats: { hp: 70 } }, 'gameStateUpdate', g => g.players.find(p => p.id === sb.playerId).stats.health === 70);
  const result = await send(admin, 'resolveFacilitatorScene', { sceneId: first.facilitatorScene.id, choiceId: 'reveal' }, 'gameStateUpdate', g => g.facilitatorScene?.stage === 'result');
  assert.equal(result.players.find(p => p.id === sa.playerId).isInFastTrack, true);
  assert.equal(result.players.find(p => p.id === sb.playerId).isInFastTrack, false);
  await send(admin, 'resolveFacilitatorScene', { sceneId: first.facilitatorScene.id, choiceId: 'reveal' }, 'error');
  const second = await send(admin, 'closeFacilitatorScene', { sceneId: first.facilitatorScene.id }, 'gameStateUpdate', g => g.facilitatorScene?.stage === 'prompt' && g.facilitatorScene.participantNames[0] === '乙');
  await send(admin, 'resolveFacilitatorScene', { sceneId: second.facilitatorScene.id, choiceId: 'reveal' }, 'gameStateUpdate', g => g.facilitatorScene?.stage === 'result');
  const end = await send(admin, 'closeFacilitatorScene', { sceneId: second.facilitatorScene.id }, 'gameStateUpdate', g => !g.facilitatorScene);
  assert.equal(end.isPaused, false); assert.equal(announced, 2);
});

test('第三輪發薪：六個月、公開選項、重複提交只購買一次、未路過不能進圈', { timeout: 20000 }, async t => {
  const { admin, a, b, sa, sb } = await fixture(t, 3224, false, 0);
  await send(admin, 'setPlayerStats', { targetPlayerId: sa.playerId, stats: { hp: 100 } }, 'gameStateUpdate', g => g.players.find(p => p.id === sa.playerId).stats.health === 100);
  await send(admin, 'setPlayerStats', { targetPlayerId: sb.playerId, stats: { hp: 100 } }, 'gameStateUpdate', g => g.players.find(p => p.id === sb.playerId).stats.health === 100);
  for (let i = 0; i < 5; i++) {
    await send(i % 2 ? b : a, 'playerRoll', { diceCount: 1 }, 'gameStateUpdate', g => g.currentPlayerTurnId === (i % 2 ? sa.playerId : sb.playerId) && !g.decisionPhase);
  }
  const dataPromise = wait(a, 'paydayPlanningRequired');
  const phase = await send(b, 'playerRoll', { diceCount: 1 }, 'gameStateUpdate', g => g.decisionPhase?.kind === 'payday');
  const data = await dataPromise;
  assert.equal(data.settlementMonths, 6); assert.equal(data.basicInvestments.length, 3);
  assert.equal(phase.basicInvestmentOffers.length, 3);
  const plan = { phaseId: phase.decisionPhase.id, basicInvestmentId: 'basic-business', stockDCAAmount: 0, buyInsuranceTypes: [] };
  await send(a, 'submitPaydayPlan', plan, 'decisionSubmitted');
  a.emit('submitPaydayPlan', plan);
  const next = await send(admin, 'continueDecisionPhase', { phaseId: plan.phaseId }, 'gameStateUpdate', g => g.decisionPhase?.playerId === sb.playerId);
  const pa = next.players.find(p => p.id === sa.playerId);
  assert.equal(pa.paydayCount, 6);
  assert.equal(pa.assets.filter(x => x.id.startsWith('basic-')).length, 1);
  assert.equal(pa.isInFastTrack, false);
  await send(b, 'submitPaydayPlan', { phaseId: next.decisionPhase.id, stockDCAAmount: 0, buyInsuranceTypes: [] }, 'decisionSubmitted');
  const end = await send(admin, 'continueDecisionPhase', { phaseId: next.decisionPhase.id }, 'gameStateUpdate', g => g.globalPaydayNumber === 1 && !g.globalPaydayInProgress);
  assert.equal(end.players.find(p => p.id === sb.playerId).paydayCount, 6);
});

test('致死危機先開自救階段：本人可借款，補不足才死亡', { timeout: 20000 }, async t => {
  // 落格說明由 fixture 自動放行；自救階段是 crisis 決策，不會被自動放行
  const { admin, a, b, sa } = await fixture(t, 3236, false, 0, true, false, false, false, true);
  const rescuePromise = wait(a, 'crisisRescueRequired', () => true, 8000);
  const rescue = await send(a, 'playerRoll', { diceCount: 1 }, 'gameStateUpdate', g => g.decisionPhase?.rescue === true);
  const required = await rescuePromise;
  assert.equal(rescue.decisionPhase.kind, 'crisis');
  assert.equal(rescue.decisionPhase.playerId, sa.playerId);
  assert.ok(required.effectiveCost > required.cash);
  // 其他玩家仍不能做財務操作；本人可申請應急借款
  await send(b, 'takeEmergencyLoan', { amount: 75000 }, 'error');
  const loan = await send(a, 'takeEmergencyLoan', { amount: 450000 }, 'loanTaken');
  assert.equal(loan.amount, 450000);
  await send(a, 'submitCardDecision', { phaseId: rescue.decisionPhase.id, rescued: false }, 'decisionSubmitted');
  const after = await send(admin, 'continueDecisionPhase', { phaseId: rescue.decisionPhase.id }, 'gameStateUpdate', g => !g.decisionPhase && !g.turnInProgress);
  const me = after.players.find(p => p.id === sa.playerId);
  assert.equal(me.isAlive, false, '借款後仍不足應死亡');
});
