const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { io } = require('socket.io-client');
const { createPlayer } = require('../dist/gameLogic');
const { previewCareerChange } = require('../dist/careerStage');
const { executeCareerChange } = require('../dist/statsSystem');
const { validateSocketPayload } = require('../dist/socketValidation');

test('轉職預覽保留 getter、不修改玩家、收支與正式執行一致', () => {
  const p = createPlayer('p', '玩家', 'teacher'); p.stats.careerSkill = 100; p.stats.health = 80; p.cash = 1000000;
  const before = JSON.stringify(p);
  const preview = previewCareerChange(p, 'doctor');
  assert.equal(preview.error, undefined); assert.equal(JSON.stringify(p), before);
  assert.ok(!preview.description.includes('NaN')); assert.ok(!preview.description.includes('undefined'));
  executeCareerChange(p, 'doctor');
  assert.equal(p.monthlyCashflow, preview.projected.monthlyCashflow);
  assert.equal(p.totalExpenses, preview.projected.totalExpenses);
  assert.ok(previewCareerChange(p, 'teacher').error);
  assert.equal(validateSocketPayload('confirmCareerScene', { sceneId: 'x', accepted: 'true' }), false);
  assert.equal(validateSocketPayload('startCareerScene', {}), false);
});

function wait(s, event, predicate = () => true) {
  return new Promise((resolve, reject) => {
    const listener = v => { if (predicate(v)) { clearTimeout(timer); s.off(event, listener); resolve(v); } };
    const timer = setTimeout(() => { s.off(event, listener); reject(Error('Timeout: ' + event)); }, 5000);
    s.on(event, listener);
  });
}
function send(s, event, payload, response, predicate) { const p = wait(s, response, predicate); s.emit(event, payload); return p; }

test('轉職排隊→暫停舞台→本人確認→主持揭曉→繼續；權限、重連、取消、重複提交與重驗證', { timeout: 30000 }, async t => {
  const boot = `const l=require('./dist/gameLogic');const c=l.createPlayer;l.createPlayer=(...a)=>{const p=c(...a);p.pre20Done=true;p.stats.careerSkill=100;p.stats.health=80;p.cash=1000000;return p;};require('./dist/socketServer');`;
  const server = spawn(process.execPath, ['-e', boot], { env: { ...process.env, PORT: '3227', NODE_ENV: 'test' }, stdio: ['ignore', 'pipe', 'pipe'] });
  const sockets = []; let logs = '';
  t.after(() => { sockets.forEach(s => s.disconnect()); server.kill(); });
  server.stdout.on('data', d => logs += d); server.stderr.on('data', d => logs += d);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error(logs)), 5000);
    server.stdout.on('data', d => { if (String(d).includes('伺服器已啟動')) { clearTimeout(timer); resolve(); } });
    server.once('exit', () => { clearTimeout(timer); reject(Error(logs)); });
  });
  async function connect() { const s = io('http://127.0.0.1:3227', { transports: ['websocket'], reconnection: false }); sockets.push(s); await wait(s, 'connect'); return s; }
  const admin = await connect(), a = await connect(), b = await connect();
  const room = await send(admin, 'createRoom', { roomId: 'CRTEST' }, 'roomCreated');
  const sa = await send(a, 'playerJoin', { playerName: '甲', roomCode: room.roomId }, 'playerSession');
  const sb = await send(b, 'playerJoin', { playerName: '乙', roomCode: room.roomId }, 'playerSession');
  const start = await send(admin, 'startGame', { force: true }, 'gameStateUpdate', g => g.gamePhase === 'RatRace');
  const original = start.players.find(p => p.id === sa.playerId);
  const target = original.profession.id === 'doctor' ? 'teacher' : 'doctor';
  const q = await send(a, 'requestCareerChange', { newProfessionId: target }, 'gameStateUpdate', g => g.careerRequests?.length === 1);
  assert.equal(q.players.find(p => p.id === sa.playerId).cash, original.cash);
  assert.equal(q.players.find(p => p.id === sa.playerId).profession.id, original.profession.id);
  await send(a, 'requestCareerChange', { newProfessionId: target }, 'error');
  const q2 = await send(b, 'requestCareerChange', { newProfessionId: start.players.find(p => p.id === sb.playerId).profession.id === 'doctor' ? 'teacher' : 'doctor' }, 'gameStateUpdate', g => g.careerRequests?.length === 2);
  await send(a, 'startCareerScene', { requestId: q.careerRequests[0].id }, 'error');
  await send(admin, 'startCareerScene', { requestId: q2.careerRequests[1].id }, 'error');
  const sceneState = await send(admin, 'startCareerScene', { requestId: q.careerRequests[0].id }, 'gameStateUpdate', g => g.facilitatorScene?.kind === 'career');
  const sceneId = sceneState.facilitatorScene.id;
  assert.equal(sceneState.isPaused, true);
  await send(a, 'playerRoll', { diceCount: 1 }, 'error');
  await send(b, 'confirmCareerScene', { sceneId, accepted: true }, 'error');
  await send(admin, 'resolveFacilitatorScene', { sceneId, choiceId: 'reveal' }, 'error');
  await send(admin, 'startCareerScene', { requestId: q2.careerRequests[1].id }, 'error');
  a.disconnect();
  const rejoined = await connect();
  const recovered = await send(rejoined, 'playerRejoin', { playerName: '甲', roomCode: room.roomId, reconnectToken: sa.reconnectToken }, 'gameStateUpdate', g => g.facilitatorScene?.id === sceneId);
  assert.equal(recovered.facilitatorScene.careerConfirmed, false);
  await send(rejoined, 'confirmCareerScene', { sceneId, accepted: true }, 'gameStateUpdate', g => g.facilitatorScene?.careerConfirmed);
  const result = await send(admin, 'resolveFacilitatorScene', { sceneId, choiceId: 'reveal' }, 'gameStateUpdate', g => g.facilitatorScene?.stage === 'result');
  const changed = result.players.find(p => p.id === sa.playerId);
  assert.equal(changed.profession.id, target); assert.equal(changed.stats.careerSkill, 0); assert.equal(result.isPaused, true);
  await send(admin, 'resolveFacilitatorScene', { sceneId, choiceId: 'reveal' }, 'error');
  const closed = await send(admin, 'closeFacilitatorScene', { sceneId }, 'gameStateUpdate', g => !g.facilitatorScene);
  assert.equal(closed.isPaused, false);
  const next = await send(admin, 'startCareerScene', { requestId: q2.careerRequests[1].id }, 'gameStateUpdate', g => g.facilitatorScene?.kind === 'career');
  await send(b, 'confirmCareerScene', { sceneId: next.facilitatorScene.id, accepted: false }, 'gameStateUpdate', g => g.facilitatorScene?.stage === 'result');
  const cancelled = await send(admin, 'closeFacilitatorScene', { sceneId: next.facilitatorScene.id }, 'gameStateUpdate', g => !g.facilitatorScene);
  assert.equal(cancelled.players.find(p => p.id === sb.playerId).stats.careerSkill, 100);
  const bTarget = q2.careerRequests[1].professionId;
  const pending = await send(b, 'requestCareerChange', { newProfessionId: bTarget }, 'gameStateUpdate', g => g.careerRequests?.length === 1);
  await send(admin, 'setPlayerStats', { targetPlayerId: sb.playerId, stats: { hp: 10 } }, 'gameStateUpdate', g => g.players.find(p => p.id === sb.playerId).stats.health === 10);
  await send(admin, 'startCareerScene', { requestId: pending.careerRequests[0].id }, 'error');
  const cleaned = await send(admin, 'setPlayerStats', { targetPlayerId: sb.playerId, stats: { hp: 80 } }, 'gameStateUpdate');
  assert.equal(cleaned.careerRequests.length, 0);
  // An existing scene must remain uninterrupted; applications can still queue.
  const community = await send(admin, 'startFacilitatorScene', { kind: 'community', cardId: 'healthcare' }, 'gameStateUpdate', g => g.facilitatorScene?.kind === 'community');
  const queuedBusy = await send(b, 'requestCareerChange', { newProfessionId: bTarget }, 'gameStateUpdate', g => g.careerRequests?.length === 1);
  assert.equal(queuedBusy.facilitatorScene.id, community.facilitatorScene.id);
  await send(admin, 'startCareerScene', { requestId: queuedBusy.careerRequests[0].id }, 'error');
  await send(admin, 'closeFacilitatorScene', { sceneId: community.facilitatorScene.id }, 'gameStateUpdate', g => !g.facilitatorScene);
  const revised = await send(admin, 'startCareerScene', { requestId: queuedBusy.careerRequests[0].id }, 'gameStateUpdate', g => g.facilitatorScene?.kind === 'career');
  const revisedId = revised.facilitatorScene.id;
  await send(b, 'confirmCareerScene', { sceneId: revisedId, accepted: true }, 'gameStateUpdate', g => g.facilitatorScene?.careerConfirmed);
  await send(admin, 'setPlayerStats', { targetPlayerId: sb.playerId, stats: { sk: 0 } }, 'gameStateUpdate', g => g.players.find(p => p.id === sb.playerId).stats.careerSkill === 0);
  const rejected = await send(admin, 'resolveFacilitatorScene', { sceneId: revisedId, choiceId: 'reveal' }, 'gameStateUpdate', g => g.facilitatorScene?.stage === 'result');
  assert.equal(rejected.facilitatorScene.resultTitle, '本次轉職未執行');
  assert.equal(rejected.players.find(p => p.id === sb.playerId).profession.id, start.players.find(p => p.id === sb.playerId).profession.id);
});
