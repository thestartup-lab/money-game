const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { io } = require('socket.io-client');

const PORT = 3219;
const URL = `http://127.0.0.1:${PORT}`;

function waitForEvent(socket, event, predicate = () => true, timeoutMs = 4_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`等待 ${event} 逾時`));
    }, timeoutMs);
    const handler = (payload) => {
      if (!predicate(payload)) return;
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(payload);
    };
    socket.on(event, handler);
  });
}

function connect(origin = 'http://127.0.0.1:5173') {
  const socket = io(URL, {
    forceNew: true,
    transports: ['websocket'],
    extraHeaders: { Origin: origin },
  });
  return waitForEvent(socket, 'connect').then(() => socket);
}

test('房間專屬控制碼、多裝置控場、零玩家防呆、來源限制與權限不能被繞過', async (t) => {
  const server = spawn(process.execPath, ['dist/socketServer.js'], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(PORT), NODE_ENV: 'test' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => server.kill('SIGTERM'));

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('測試伺服器啟動逾時')), 5_000);
    server.stdout.on('data', (chunk) => {
      if (!String(chunk).includes('伺服器已啟動')) return;
      clearTimeout(timer);
      resolve();
    });
    server.once('exit', (code) => reject(new Error(`測試伺服器提前結束：${code}`)));
  });

  const healthResponse = await fetch(`${URL}/health`);
  assert.equal(healthResponse.status, 200);
  assert.equal((await healthResponse.json()).ok, true);

  const blocked = io(URL, {
    forceNew: true,
    transports: ['websocket'],
    extraHeaders: { Origin: 'https://evil.example' },
  });
  t.after(() => blocked.disconnect());
  const blockedError = await waitForEvent(blocked, 'connect_error');
  assert.match(blockedError.message, /websocket error|不允許|xhr poll error/i);

  const admin = await connect();
  t.after(() => admin.disconnect());

  const createdPromise = waitForEvent(admin, 'roomCreated');
  admin.emit('createRoom', { roomId: 'SAFE01' });
  const created = await createdPromise;
  assert.equal(created.roomId, 'SAFE01');
  assert.match(created.adminCode, /^[A-F0-9]{12}$/);

  const noPlayerStartPromise = waitForEvent(admin, 'error');
  admin.emit('startGame');
  assert.match((await noPlayerStartPromise).message, /沒有玩家/);

  const attacker = await connect();
  t.after(() => attacker.disconnect());
  const unauthorizedPromise = waitForEvent(attacker, 'error');
  attacker.emit('triggerGlobalEvent', { roomId: 'SAFE01', eventId: 'inflation' });
  assert.match((await unauthorizedPromise).message, /權限不足/);

  const unauthorizedReviewPromise = waitForEvent(attacker, 'error');
  attacker.emit('setReviewView', { view: 'history' });
  assert.match((await unauthorizedReviewPromise).message, /權限不足/);

  const unauthorizedScenePromise = waitForEvent(attacker, 'error');
  attacker.emit('startFacilitatorScene', { kind: 'community', cardId: 'healthcare' });
  assert.match((await unauthorizedScenePromise).message, /權限不足/);

  const wrongLoginPromise = waitForEvent(attacker, 'adminLoginFail');
  attacker.emit('adminLogin', { roomId: 'SAFE01', password: '123' });
  assert.match((await wrongLoginPromise).message, /密碼錯誤/);

  const loginSuccessPromise = waitForEvent(attacker, 'adminLoginSuccess');
  attacker.emit('adminLogin', { roomId: 'SAFE01', password: created.adminCode });
  assert.equal((await loginSuccessPromise).roomId, 'SAFE01');

  const earlyReviewPromise = waitForEvent(attacker, 'error');
  attacker.emit('setReviewView', { view: 'history' });
  assert.match((await earlyReviewPromise).message, /遊戲結束後/);

  const setupEventBlocked = waitForEvent(admin, 'error');
  admin.emit('triggerGlobalEvent', { roomId: 'SAFE01', eventId: 'stock_boom' });
  assert.match((await setupEventBlocked).message, /遊戲開始後/);

  const player = await connect();
  t.after(() => player.disconnect());
  const joinedStatePromise = waitForEvent(player, 'gameStateUpdate', (state) => state.players?.length === 1);
  player.emit('playerJoin', { roomCode: 'SAFE01', playerName: '測試玩家' });
  const joinedState = await joinedStatePromise;
  const playerId = joinedState.players[0].id;

  const display = await connect();
  t.after(() => display.disconnect());
  const displayJoinedPromise = waitForEvent(display, 'joinDisplaySuccess');
  display.emit('joinDisplay', { roomId: 'SAFE01' });
  await displayJoinedPromise;

  const startedPromise = waitForEvent(display, 'gameStateUpdate', (state) => state.gamePhase === 'RatRace');
  admin.emit('startGame', { force: true, durationMinutes: 30 });
  await startedPromise;

  const scenePromptPromise = waitForEvent(display, 'gameStateUpdate', (state) =>
    state.facilitatorScene?.kind === 'community' && state.facilitatorScene.stage === 'prompt'
  );
  admin.emit('startFacilitatorScene', { kind: 'community', cardId: 'healthcare' });
  const scenePrompt = await scenePromptPromise;
  assert.equal(scenePrompt.isPaused, true);
  assert.match(scenePrompt.facilitatorScene.title, /醫療/);

  const queuedEventPromise = waitForEvent(admin, 'adaptiveDirectorStatus', (status) => status.pendingEvent);
  admin.emit('triggerGlobalEvent', { roomId: 'SAFE01', eventId: 'stock_boom' });
  const queued = await queuedEventPromise;
  assert.match(queued.pendingEvent.title, /股市/);
  const cancelled = waitForEvent(admin, 'adaptiveDirectorStatus', (status) => !status.pendingEvent);
  admin.emit('manageWorldEvent', { id: queued.pendingEvent.id, action: 'cancel' });
  await cancelled;

  const sceneResultPromise = waitForEvent(display, 'gameStateUpdate', (state) =>
    state.facilitatorScene?.stage === 'result'
  );
  admin.emit('resolveFacilitatorScene', {
    sceneId: scenePrompt.facilitatorScene.id,
    choiceId: 'safety_net',
  });
  const sceneResult = await sceneResultPromise;
  assert.match(sceneResult.facilitatorScene.resultTitle, /全場選擇/);
  assert.equal(sceneResult.players[0].eventLog.some((event) => event.type === 'community_choice'), true);

  const resumedPromise = waitForEvent(display, 'gameStateUpdate', (state) =>
    state.facilitatorScene === null && state.isPaused === false
  );
  admin.emit('closeFacilitatorScene', { sceneId: scenePrompt.facilitatorScene.id });
  await resumedPromise;

  const familyPromptPromise = waitForEvent(display, 'gameStateUpdate', (state) =>
    state.facilitatorScene?.kind === 'family' && state.facilitatorScene.stage === 'prompt'
  );
  admin.emit('startFacilitatorScene', { kind: 'family', playerId });
  const familyPrompt = await familyPromptPromise;
  assert.equal(familyPrompt.facilitatorScene.participantNames[0], '測試玩家');
  assert.equal(familyPrompt.facilitatorScene.reminderEndsAt, undefined);

  const directMarriageBlockedPromise = waitForEvent(player, 'error');
  player.emit('proposeMarriage', { type: 'love' });
  assert.match((await directMarriageBlockedPromise).message, /大螢幕|主持人/);

  const familyClosedPromise = waitForEvent(display, 'gameStateUpdate', (state) =>
    state.facilitatorScene === null && state.isPaused === false
  );
  admin.emit('closeFacilitatorScene', { sceneId: familyPrompt.facilitatorScene.id });
  await familyClosedPromise;

  const lowDrsPromise = waitForEvent(admin, 'error');
  admin.emit('startFacilitatorScene', { kind: 'marriage', marriageRoute: 'love', playerId });
  assert.match((await lowDrsPromise).message, /關係經營值/);

  const relationshipStatePromise = waitForEvent(display, 'gameStateUpdate', (state) =>
    state.players?.find((candidate) => candidate.id === playerId)?.relationshipPoints === 40
  );
  admin.emit('triggerRelationship', { targetPlayerId: playerId });
  const relationshipState = await relationshipStatePromise;
  assert.equal(relationshipState.players.find((candidate) => candidate.id === playerId).relationshipActive, true);

  // 世界事件在拍賣結束後才登場；登場、延後都不套用效果。
  const auctionReady = waitForEvent(display, 'gameStateUpdate', (state) => state.decisionPhase?.kind === 'auction');
  admin.emit('triggerSpecialAuction', {});
  const auction = await auctionReady;
  const invalidBid = waitForEvent(player, 'error');
  player.emit('bidDeal', { auctionId: 'invalid', bidAmount: '100000' });
  assert.match((await invalidBid).message, /正整數/);
  const overlapBlocked = waitForEvent(admin, 'error');
  admin.emit('triggerSpecialAuction', {});
  assert.match((await overlapBlocked).message, /完成目前決策/);
  const queuedInflation = waitForEvent(admin, 'adaptiveDirectorStatus', (status) => status.pendingEvent?.title === '通貨膨脹');
  admin.emit('triggerGlobalEvent', { eventId: 'inflation' });
  await queuedInflation;
  const worldPrompt = waitForEvent(display, 'gameStateUpdate', (state) => state.facilitatorScene?.kind === 'global_event');
  attacker.emit('continueDecisionPhase', { phaseId: auction.decisionPhase.id });
  const world = await worldPrompt;
  const expenseBefore = world.players[0].totalExpenses;
  assert.equal(world.facilitatorScene.stage, 'prompt');
  assert.equal(world.players[0].eventLog.some((event) => event.type === 'global_event'), false);
  const reminderReady = waitForEvent(display, 'gameStateUpdate', (state) =>
    state.facilitatorScene?.reminderEndsAt > Date.now() + 80_000);
  attacker.emit('setFacilitatorReminder', { sceneId: world.facilitatorScene.id, seconds: 90 });
  await reminderReady;
  const deferred = waitForEvent(admin, 'adaptiveDirectorStatus', (status) => status.pendingEvent?.deferred);
  admin.emit('resolveFacilitatorScene', { sceneId: world.facilitatorScene.id, choiceId: 'defer' });
  const deferredStatus = await deferred;
  const reopened = waitForEvent(display, 'gameStateUpdate', (state) => state.facilitatorScene?.kind === 'global_event');
  admin.emit('manageWorldEvent', { id: deferredStatus.pendingEvent.id, action: 'open' });
  const ready = await reopened;
  const unauthorisedApply = waitForEvent(player, 'error');
  player.emit('resolveFacilitatorScene', { sceneId: ready.facilitatorScene.id, choiceId: 'apply' });
  assert.match((await unauthorisedApply).message, /權限不足/);
  const applied = waitForEvent(display, 'gameStateUpdate', (state) => state.facilitatorScene?.stage === 'result');
  attacker.emit('resolveFacilitatorScene', { sceneId: ready.facilitatorScene.id, choiceId: 'apply' });
  const result = await applied;
  assert.equal(result.players[0].totalExpenses, expenseBefore + 4500);
  assert.equal(result.facilitatorScene.impacts[0].cashflowDelta, -4500);
  assert.equal(result.players[0].eventLog.filter((event) => event.type === 'global_event').length, 1);
  const duplicate = waitForEvent(admin, 'error');
  admin.emit('resolveFacilitatorScene', { sceneId: ready.facilitatorScene.id, choiceId: 'apply' });
  assert.match((await duplicate).message, /已更新/);
  const closedWorld = waitForEvent(display, 'gameStateUpdate', (state) => !state.facilitatorScene);
  admin.emit('closeFacilitatorScene', { sceneId: ready.facilitatorScene.id });
  await closedWorld;
  const limited = waitForEvent(admin, 'error');
  admin.emit('triggerGlobalEvent', { eventId: 'pandemic' });
  assert.match((await limited).message, /本季已發生/);

  const deletedPromise = waitForEvent(admin, 'deleteRoomResult');
  admin.emit('deleteRoom');
  assert.equal((await deletedPromise).success, true);

  const refreshedRoomsPromise = waitForEvent(attacker, 'roomList');
  attacker.emit('listRooms');
  const refreshedRooms = await refreshedRoomsPromise;
  assert.equal(refreshedRooms.some((room) => room.roomId === 'SAFE01'), false);
});
