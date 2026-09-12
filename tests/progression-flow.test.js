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

async function fixture(t, port, passed, passive) {
  // Test-only deterministic state: exercise production Socket handlers without adding a production test endpoint.
  const boot = `
    Math.random=()=>0.4;
    const logic=require('./dist/gameLogic');
    const create=logic.createPlayer;
    logic.createPlayer=(...args)=>{
      const p=create(...args);p.pre20Done=true;p.cash=200000;
      p.hasPassedSecondLife=${passed};p.stats.health=40;p.stats.careerSkill=0;
      p.growthStats={academic:1,health:0,social:0,resource:0};
      p.expenses={taxes:0,homeMortgagePayment:0,carLoanPayment:0,creditCardPayment:0,otherExpenses:10000};
      p.liabilities=[];p.assets=[{id:'fixture',name:'測試收入',type:'Other',cost:1,currentValue:1,monthlyCashflow:${passive}}];
      return p;
    };
    const cards=require('./dist/gameCards');
    cards.BOARD.forEach(cell=>cell.type=cards.SquareType.SecondLife);
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
  const room = await send(admin, 'createRoom', { roomId: 'F' + port }, 'roomCreated');
  const a = await connect(), b = await connect();
  const sa = await send(a, 'playerJoin', { playerName: '甲', roomCode: room.roomId }, 'playerSession');
  const sb = await send(b, 'playerJoin', { playerName: '乙', roomCode: room.roomId }, 'playerSession');
  await send(admin, 'startGame', { force: true }, 'gameStateUpdate', g => g.gamePhase === 'RatRace');
  return { admin, a, b, sa, sb, server };
}

test('結算達標免再擲骰：既有舞台不被蓋住、兩位依序揭曉、重複揭曉不重複進圈', { timeout: 20000 }, async t => {
  const { admin, a, sa, sb } = await fixture(t, 3223, true, 10000);
  let announced = 0; admin.on('ratRaceEscaped', () => announced++);
  const first = await send(admin, 'setPlayerStats', { targetPlayerId: sa.playerId, stats: { hp: 60 } }, 'gameStateUpdate', g => g.facilitatorScene?.kind === 'second_life');
  assert.equal(first.facilitatorScene.participantNames[0], '甲');
  assert.equal(first.players.find(p => p.id === sa.playerId).isInFastTrack, false);
  await send(a, 'resolveFacilitatorScene', { sceneId: first.facilitatorScene.id, choiceId: 'reveal' }, 'error');
  await send(admin, 'setPlayerStats', { targetPlayerId: sb.playerId, stats: { hp: 60 } }, 'gameStateUpdate', g => g.players.find(p => p.id === sb.playerId).stats.health === 60);
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
