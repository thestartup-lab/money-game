const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { io } = require('socket.io-client');

function wait(s, event, predicate = () => true, timeout = 6000) {
  const origin = new Error(`Waiting for ${event}`);
  return new Promise((resolve, reject) => {
    const handler = value => { if (predicate(value)) { clearTimeout(timer); s.off(event, handler); resolve(value); } };
    const timer = setTimeout(() => { s.off(event, handler); reject(origin); }, timeout);
    s.on(event, handler);
  });
}
function send(s, event, payload, response, predicate) {
  const result = wait(s, response, predicate);
  if (payload === undefined) s.emit(event); else s.emit(event, payload);
  return result.catch(error => { throw new Error(`${event} → ${response}: ${error.message}`); });
}

test('本機端到端：異常封包不崩潰、禁止中途加入、暫停操作、可信重連及決策續接', { timeout: 30000 }, async t => {
  const port = 3221, sockets = [];
  const server = spawn(process.execPath, ['-e', 'Math.random=()=>0.4; require("./dist/socketServer")'], {
    env: { ...process.env, PORT: String(port), NODE_ENV: 'test' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let errors = '';
  server.stderr.on('data', d => { errors += d; });
  let output = '';
  server.stdout.on('data', d => { output += d; });
  t.after(() => { if (!completed) t.diagnostic(output + errors); sockets.forEach(s => s.disconnect()); server.kill('SIGTERM'); });
  let completed = false;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error(`Startup timeout: ${errors}`)), 5000);
    server.stdout.on('data', d => { if (String(d).includes('伺服器已啟動')) { clearTimeout(timer); resolve(); } });
    server.once('exit', c => { clearTimeout(timer); reject(Error(`Server exited ${c}: ${errors}`)); });
  });
  async function connect() {
    const s = io(`http://127.0.0.1:${port}`, { transports: ['websocket'], reconnection: false });
    sockets.push(s); await wait(s, 'connect'); return s;
  }
  const admin = await connect();
  await send(admin, 'playerJoin', null, 'error');
  await send(admin, 'playerJoin', { playerName: {}, roomCode: 'TEST01' }, 'error');
  assert.equal((await (await fetch(`http://127.0.0.1:${port}/health`)).json()).ok, true);
  await send(admin, 'createRoom', { roomId: 'TEST01' }, 'roomCreated');
  const p = await connect(), q = await connect();
  const pSession = await send(p, 'playerJoin', { playerName: '甲', roomCode: 'TEST01' }, 'playerSession');
  await send(q, 'playerJoin', { playerName: '乙', roomCode: 'TEST01' }, 'playerSession');
  await send(p, 'rollSocialClass', undefined, 'socialClassRolled');
  await send(p, 'rollSocialClass', undefined, 'error');
  await send(admin, 'startGame', { force: true }, 'gameStateUpdate', g => g.gamePhase === 'RatRace');
  const stranger = await connect();
  assert.match((await send(stranger, 'playerJoin', { playerName: '新玩家', roomCode: 'TEST01' }, 'error')).message, /已開始/);
  await send(admin, 'pauseGame', {}, 'gameStateUpdate', g => g.isPaused);
  assert.match((await send(p, 'investStockDCA', { amount: 1 }, 'error')).message, /自由操作/);
  await send(p, 'loanOffer', { targetPlayerId: q.id, amount: -1000, monthlyRate: 0.01 }, 'error');
  await send(admin, 'resumeGame', {}, 'gameStateUpdate', g => !g.isPaused);
  const offered = await send(p, 'loanOffer', { targetPlayerId: q.id, amount: 1000, monthlyRate: 0.01 }, 'loanOfferReceived');
  const lent = await send(q, 'loanResponse', { offerId: offered.offerId, accepted: true }, 'gameStateUpdate', g => g.players.some(x => x.liabilities.some(l => l.id.startsWith('p2p-'))));
  const debt = lent.players.find(x => x.id === q.id).liabilities.find(l => l.id.startsWith('p2p-'));
  const repaid = await send(q, 'repayLoan', { liabilityId: debt.id, amount: 1000 }, 'gameStateUpdate', g => !g.players.find(x => x.id === q.id).liabilities.some(l => l.id === debt.id));
  assert.equal(repaid.players.find(x => x.id === p.id).cash, lent.players.find(x => x.id === p.id).cash + 1000);

  // Fixed dice land on a decision cell. The replacement socket must retain the original character.
  const decision = await send(p, 'playerRoll', {}, 'gameStateUpdate', g => g.decisionPhase?.playerId === pSession.playerId);
  const disconnected = wait(admin, 'gameStateUpdate', g => g.players.find(x => x.id === pSession.playerId)?.isDisconnected);
  p.disconnect(); await disconnected;
  await send(stranger, 'playerRejoin', { playerName: '甲', roomCode: 'TEST01' }, 'rejoinFailed');
  await send(stranger, 'playerRejoin', { playerName: '甲', roomCode: 'TEST01', reconnectToken: 'invalid' }, 'rejoinFailed');
  const restored = await connect();
  const replay = wait(restored, 'dealCardsDrawn');
  const snapshot = wait(restored, 'gameStateUpdate', g => g.decisionPhase?.id === decision.decisionPhase.id);
  const rejoined = await send(restored, 'playerRejoin', pSession, 'rejoinSuccess');
  assert.equal(rejoined.playerId, pSession.playerId);
  assert.notEqual(rejoined.playerId, restored.id);
  assert.ok((await replay).cards.length > 0, '重新連線後必須補送仍待決策的卡片');
  const state = await snapshot;
  assert.equal(state.currentPlayerTurnId, pSession.playerId);
  const event = decision.decisionPhase.kind === 'payday' ? 'submitPaydayPlan' : 'submitCardDecision';
  await send(restored, event, { phaseId: 'stale', accepted: false }, 'error');
  await send(restored, event, { phaseId: decision.decisionPhase.id, accepted: false }, 'decisionSubmitted');
  const nextTurn = wait(admin, 'gameStateUpdate', g => !g.decisionPhase && g.currentPlayerTurnId === q.id);
  admin.on('decisionPhaseStarted', phase => {
    if (phase.kind === 'auction') admin.emit('continueDecisionPhase', { phaseId: phase.id });
  });
  admin.emit('continueDecisionPhase', { phaseId: decision.decisionPhase.id });
  await nextTurn;
  assert.equal(server.exitCode, null, errors);
  completed = true;
});
