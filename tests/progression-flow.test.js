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

async function fixture(t, port, passed, passive, autoReading = true, outer = false, deal = false, seasoned = false, crisis = false, charity = false, actionPhase = false, retirementRound = null) {
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
    if (${retirementRound !== null}) require('./dist/gameConfig').RETIREMENT_ROUND = ${retirementRound ?? 0};
    if (${charity}) cards.BOARD.forEach(cell=>{cell.type=cards.SquareType.Charity;cell.label='慈善捐款';});
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
  if (!actionPhase) await send(admin, 'setActionPhaseEnabled', { enabled: false }, 'gameStateUpdate', g => g.actionPhaseEnabled === false);
  // 測試用每三輪備援發薪，避免等待真實計時
  await send(admin, 'setPaydayTimer', { enabled: false }, 'gameStateUpdate', g => g.paydayTimer?.enabled === false);
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

test('第三輪發薪：全體同時規劃、六個月、公開選項、重複提交只購買一次、全員送出自動結算', { timeout: 20000 }, async t => {
  const { admin, a, b, sa, sb } = await fixture(t, 3224, false, 0);
  await send(admin, 'setPlayerStats', { targetPlayerId: sa.playerId, stats: { hp: 100 } }, 'gameStateUpdate', g => g.players.find(p => p.id === sa.playerId).stats.health === 100);
  await send(admin, 'setPlayerStats', { targetPlayerId: sb.playerId, stats: { hp: 100 } }, 'gameStateUpdate', g => g.players.find(p => p.id === sb.playerId).stats.health === 100);
  for (let i = 0; i < 5; i++) {
    await send(i % 2 ? b : a, 'playerRoll', { diceCount: 1 }, 'gameStateUpdate', g => g.currentPlayerTurnId === (i % 2 ? sa.playerId : sb.playerId) && !g.decisionPhase);
  }
  const dataPromise = wait(a, 'paydayPlanningRequired');
  const dataPromiseB = wait(b, 'paydayPlanningRequired');
  const phase = await send(b, 'playerRoll', { diceCount: 1 }, 'gameStateUpdate', g => g.decisionPhase?.kind === 'payday');
  const data = await dataPromise; await dataPromiseB;
  assert.equal(phase.decisionPhase.playerId, '__all_players__', '全體同時規劃');
  assert.equal(data.settlementMonths, 36, '三輪 × 12 個月'); assert.equal(data.growthCycles, 3); assert.equal(data.basicInvestments.length, 3);
  assert.equal(phase.basicInvestmentOffers.length, 3);
  const plan = { phaseId: phase.decisionPhase.id, basicInvestmentId: 'basic-business', stockDCAAmount: 0, buyInsuranceTypes: [] };
  const oneDone = await send(a, 'submitPaydayPlan', plan, 'gameStateUpdate', g => (g.actionPhaseDone ?? []).includes(sa.playerId));
  assert.equal(oneDone.decisionPhase?.kind, 'payday', '一人送出還不結算');
  a.emit('submitPaydayPlan', plan);
  const end = await send(b, 'submitPaydayPlan', { phaseId: phase.decisionPhase.id, stockDCAAmount: 0, buyInsuranceTypes: [] }, 'gameStateUpdate', g => g.globalPaydayNumber === 1 && !g.globalPaydayInProgress);
  const pa = end.players.find(p => p.id === sa.playerId);
  assert.equal(pa.paydayCount, 36);
  assert.equal(pa.assets.filter(x => x.id.startsWith('basic-')).length, 1, '重複送出只買一份');
  assert.equal(pa.isInFastTrack, false);
  assert.equal(end.players.find(p => p.id === sb.playerId).paydayCount, 36);
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

test('慈善卡等落格說明結束、決策階段開始後才送到手機，且不會被落格結束事件清掉', { timeout: 15000 }, async t => {
  const { admin, a } = await fixture(t, 3237, false, 0, false, false, false, false, false, true);
  const timeline = [];
  a.on('charityCardPending', () => timeline.push('card'));
  a.on('decisionPhaseEnded', () => timeline.push('ended'));
  a.on('decisionPhaseStarted', p => timeline.push('start:' + p.kind));
  const reading = await send(a, 'playerRoll', { diceCount: 1 }, 'gameStateUpdate', g => g.decisionPhase?.kind === 'reading');
  assert.deepEqual(timeline.filter(x => x === 'card'), [], '落格說明期間不應先送卡片');
  let phase = await send(admin, 'continueDecisionPhase', { phaseId: reading.decisionPhase.id }, 'gameStateUpdate', g => g.decisionPhase && g.decisionPhase.id !== reading.decisionPhase.id);
  while (phase.decisionPhase.kind === 'reading') {
    const id = phase.decisionPhase.id;
    phase = await send(admin, 'continueDecisionPhase', { phaseId: id }, 'gameStateUpdate', g => g.decisionPhase && g.decisionPhase.id !== id);
  }
  assert.equal(phase.decisionPhase.kind, 'charity');
  await new Promise(r => setTimeout(r, 200));
  const cardIdx = timeline.indexOf('card');
  const charityStart = timeline.indexOf('start:charity');
  assert.ok(cardIdx > charityStart && charityStart >= 0, '卡片必須在慈善決策開始之後才送出：' + timeline.join(','));
  assert.equal(timeline.filter(x => x === 'card').length, 1);
});

test('玩家送出後自動揭曉，不必主持人按繼續；關閉後恢復手動', { timeout: 20000 }, async t => {
  const { admin, a } = await fixture(t, 3238, false, 0, true, false, false, false, false, true);
  const phase = await send(a, 'playerRoll', { diceCount: 1 }, 'gameStateUpdate', g => g.decisionPhase?.kind === 'charity');
  assert.equal(phase.autoRevealOnSubmit, true);
  const released = wait(admin, 'decisionPhaseEnded', p => p.phaseId === phase.decisionPhase.id, 6000);
  a.emit('submitCardDecision', { phaseId: phase.decisionPhase.id, donate: false });
  const ended = await released;
  assert.equal(ended.submitted, true);
  const off = await send(admin, 'setAutoRevealOnSubmit', { enabled: false }, 'gameStateUpdate', g => g.autoRevealOnSubmit === false);
  assert.equal(off.autoRevealOnSubmit, false);
});

test('每輪開始的全體行動時間：擲骰被擋、財務操作開放、全員完成自動結束', { timeout: 20000 }, async t => {
  const { admin, a, b, sa } = await fixture(t, 3239, false, 0, true, false, false, false, false, false, true);
  // 開局後行動時間可能已經在 fixture 回傳前開啟：用一個會回傳狀態的設定請求來讀取
  const phase = await send(admin, 'setReadingAutoContinue', { seconds: 10 }, 'gameStateUpdate', g => g.decisionPhase?.kind === 'actions');
  assert.equal(phase.actionPhaseEnabled, true);
  assert.match((await send(a, 'playerRoll', { diceCount: 1 }, 'error')).message, /主持人控制/);
  const insured = await send(a, 'buyInsurance', { insuranceType: 'life' }, 'insuranceUpdated');
  assert.equal(insured.active, true, '行動時間內可自由操作');
  const one = await send(a, 'finishActionPhase', undefined, 'gameStateUpdate', g => (g.actionPhaseDone ?? []).includes(sa.playerId));
  assert.equal(one.decisionPhase?.kind, 'actions', '一人完成還不結束');
  const ended = await send(b, 'finishActionPhase', undefined, 'gameStateUpdate', g => !g.decisionPhase);
  assert.deepEqual(ended.actionPhaseDone, []);
  const rolled = await send(a, 'playerRoll', { diceCount: 1 }, 'gameStateUpdate', g => g.decisionPhase?.kind === 'reading' || g.turnInProgress);
  assert.ok(rolled);
});

test('計時發薪：主持人立即發薪要等一輪完成、排在行動結束後、結算月數＝經過輪數×12', { timeout: 20000 }, async t => {
  const { admin, a, b, sa, sb } = await fixture(t, 3240, false, 0);
  await send(admin, 'setPaydayTimer', { minutes: 10, enabled: true }, 'gameStateUpdate', g => g.paydayTimer?.enabled === true);
  assert.match((await send(admin, 'triggerPaydayNow', undefined, 'error')).message, /一輪/);
  await send(a, 'playerRoll', { diceCount: 1 }, 'gameStateUpdate', g => g.currentPlayerTurnId === sb.playerId && !g.decisionPhase && !g.turnInProgress);
  await send(b, 'playerRoll', { diceCount: 1 }, 'gameStateUpdate', g => g.currentPlayerTurnId === sa.playerId && !g.decisionPhase && !g.turnInProgress && g.turnNumber === 1);
  const phase = await send(admin, 'triggerPaydayNow', undefined, 'gameStateUpdate', g => g.decisionPhase?.kind === 'payday');
  assert.equal(phase.paydayTimer.settlementMonths, 12);
  assert.match(phase.decisionPhase.title, /1 年/);
  await send(a, 'submitPaydayPlan', { phaseId: phase.decisionPhase.id, stockDCAAmount: 0, buyInsuranceTypes: [] }, 'decisionSubmitted');
  const end = await send(b, 'submitPaydayPlan', { phaseId: phase.decisionPhase.id, stockDCAAmount: 0, buyInsuranceTypes: [] }, 'gameStateUpdate', g => g.globalPaydayNumber === 1 && !g.globalPaydayInProgress);
  assert.equal(end.players.find(p => p.id === sa.playerId).paydayCount, 12);
  assert.equal(end.paydayTimer.roundsSince, 0);
});

test('65 歲人生轉折：到達輪數後逐位開舞台，本人選退休後薪資變退休金、高齡支出啟用', { timeout: 25000 }, async t => {
  const { admin, a, b, sa, sb } = await fixture(t, 3242, false, 0, true, false, false, false, false, false, false, 1);
  // 第一輪：甲、乙各走一次 → turnNumber 1 → 轉折舞台（先甲）
  await send(a, 'playerRoll', { diceCount: 1 }, 'gameStateUpdate', g => g.currentPlayerTurnId === sb.playerId && !g.decisionPhase && !g.turnInProgress);
  const scene = await send(b, 'playerRoll', { diceCount: 1 }, 'gameStateUpdate', g => g.facilitatorScene?.kind === 'retirement');
  assert.equal(scene.facilitatorScene.careerPlayerId, sa.playerId);
  assert.equal(scene.players.find(p => p.id === sa.playerId).isSenior, true);
  // 主持人不能代選；本人選退休
  assert.match((await send(admin, 'resolveFacilitatorScene', { sceneId: scene.facilitatorScene.id, choiceId: 'reveal' }, 'error')).message, /本人/);
  await send(b, 'chooseRetirement', { sceneId: scene.facilitatorScene.id, choice: 'retire' }, 'error');
  const chosen = await send(a, 'chooseRetirement', { sceneId: scene.facilitatorScene.id, choice: 'retire' }, 'gameStateUpdate', g => g.facilitatorScene?.careerConfirmed === true);
  assert.equal(chosen.facilitatorScene.options.length, 1);
  const result = await send(admin, 'resolveFacilitatorScene', { sceneId: scene.facilitatorScene.id, choiceId: 'reveal' }, 'gameStateUpdate', g => g.facilitatorScene?.stage === 'result');
  const me = result.players.find(p => p.id === sa.playerId);
  assert.equal(me.retirementStatus, 'retired');
  assert.equal(me.salary, me.pensionMonthly);
  // 關閉後輪到乙的轉折；乙選延後
  const second = await send(admin, 'closeFacilitatorScene', { sceneId: scene.facilitatorScene.id }, 'gameStateUpdate', g => g.facilitatorScene?.kind === 'retirement' && g.facilitatorScene.careerPlayerId === sb.playerId);
  await send(b, 'chooseRetirement', { sceneId: second.facilitatorScene.id, choice: 'defer' }, 'gameStateUpdate', g => g.facilitatorScene?.careerConfirmed === true);
  const deferred = await send(admin, 'resolveFacilitatorScene', { sceneId: second.facilitatorScene.id, choiceId: 'reveal' }, 'gameStateUpdate', g => g.facilitatorScene?.stage === 'result');
  assert.equal(deferred.players.find(p => p.id === sb.playerId).retirementStatus, 'working');
  const done = await send(admin, 'closeFacilitatorScene', { sceneId: second.facilitatorScene.id }, 'gameStateUpdate', g => !g.facilitatorScene);
  assert.ok(done);
});
