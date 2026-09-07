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

test('主持人通用密碼、多裝置控場、零玩家防呆、來源限制與權限不能被繞過', async (t) => {
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
  assert.equal((await createdPromise).roomId, 'SAFE01');

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
  attacker.emit('adminLogin', { roomId: 'SAFE01', password: 'wrong-password' });
  assert.match((await wrongLoginPromise).message, /密碼錯誤/);

  const loginSuccessPromise = waitForEvent(attacker, 'adminLoginSuccess');
  attacker.emit('adminLogin', { roomId: 'SAFE01', password: '123' });
  assert.equal((await loginSuccessPromise).roomId, 'SAFE01');

  const earlyReviewPromise = waitForEvent(attacker, 'error');
  attacker.emit('setReviewView', { view: 'history' });
  assert.match((await earlyReviewPromise).message, /遊戲結束後/);

  const originalAdminAnnouncement = waitForEvent(admin, 'globalEventAnnouncement');
  const secondControllerAnnouncement = waitForEvent(attacker, 'globalEventAnnouncement');
  admin.emit('triggerGlobalEvent', { roomId: 'SAFE01', eventId: 'stock_boom' });
  const [originalAdminEvent, secondControllerEvent] = await Promise.all([
    originalAdminAnnouncement,
    secondControllerAnnouncement,
  ]);
  assert.equal(originalAdminEvent.event.id, 'stock_boom');
  assert.equal(secondControllerEvent.event.id, 'stock_boom');

  const announcementPromise = waitForEvent(attacker, 'globalEventAnnouncement');
  attacker.emit('triggerGlobalEvent', { roomId: 'SAFE01', eventId: 'inflation' });
  assert.equal((await announcementPromise).event.id, 'inflation');

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

  const blockedGlobalEventPromise = waitForEvent(admin, 'error');
  admin.emit('triggerGlobalEvent', { roomId: 'SAFE01', eventId: 'stock_boom' });
  assert.match((await blockedGlobalEventPromise).message, /舞台事件/);

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

  const deletedPromise = waitForEvent(admin, 'deleteRoomResult');
  admin.emit('deleteRoom');
  assert.equal((await deletedPromise).success, true);

  const refreshedRoomsPromise = waitForEvent(attacker, 'roomList');
  attacker.emit('listRooms');
  const refreshedRooms = await refreshedRoomsPromise;
  assert.equal(refreshedRooms.some((room) => room.roomId === 'SAFE01'), false);
});
