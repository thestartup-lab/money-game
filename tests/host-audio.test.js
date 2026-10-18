const test = require('node:test');
const assert = require('node:assert/strict');
const { fork } = require('node:child_process');
const { io } = require('socket.io-client');
const wait = (s, event, predicate = () => true) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => { s.off(event, handler); reject(Error(event)); }, 6000);
  const handler = value => { if (predicate(value)) { clearTimeout(timer); s.off(event, handler); resolve(value); } };
  s.on(event, handler);
});
const send = (s, event, payload, response, predicate) => { const done = wait(s, response, predicate); s.emit(event, payload); return done; };
test('host audio sync: authority, validation, room isolation, multiple hosts and display reconnect', { timeout: 20000 }, async t => {
  const child = fork(require.resolve('./helpers/board-v6-server.cjs'), [], { env: { ...process.env, PORT: '3431', NODE_ENV: 'test' }, silent: true });
  const sockets = [];
  t.after(() => { sockets.forEach(s => s.disconnect()); child.kill(); });
  await wait(child, 'message', m => m.ready);
  const connect = async () => { const s = io('http://127.0.0.1:3431', { transports: ['websocket'], forceNew: true }); sockets.push(s); await wait(s, 'connect'); return s; };
  const host = await connect(), display = await connect(), player = await connect(), outsider = await connect();
  const created = await send(host, 'createRoom', { roomId: 'AUD001' }, 'roomCreated');
  await send(display, 'joinDisplay', { roomId: 'AUD001' }, 'gameStateUpdate');
  await send(player, 'playerJoin', { roomCode: 'AUD001', playerName: '音訊測試' }, 'playerSession');
  await send(outsider, 'createRoom', { roomId: 'AUD002' }, 'roomCreated');
  for (const s of [display, player]) {
    const error = await send(s, 'setRoomAudio', { enabled: false }, 'error');
    assert.match(error.message, /只有本房主持人/);
  }
  for (const patch of [{ music: -1 }, { effects: 101 }, { enabled: 'true' }, { music: null }, { roomId: 'AUD002' }, []]) {
    await send(host, 'setRoomAudio', patch, 'error');
  }
  const shared = wait(display, 'gameStateUpdate', g => g.audioSettings?.music === 65);
  await send(host, 'setRoomAudio', { music: 65, effects: 0, enabled: false }, 'gameStateUpdate', g => g.audioSettings?.music === 65);
  assert.deepEqual((await shared).audioSettings, { music: 65, effects: 0, enabled: false });
  const secondHost = await connect();
  const resumed = await send(secondHost, 'adminLogin', { roomId: 'AUD001', password: created.adminCode }, 'gameStateUpdate');
  assert.equal(resumed.audioSettings.music, 65);
  const enabled = await send(secondHost, 'setRoomAudio', { enabled: true }, 'gameStateUpdate', g => g.audioSettings.enabled);
  assert.equal(enabled.audioSettings.music, 65, 'partial patch preserves volume');
  display.disconnect();
  const newDisplay = await connect();
  const restored = await send(newDisplay, 'joinDisplay', { roomId: 'AUD001' }, 'gameStateUpdate');
  assert.deepEqual(restored.audioSettings, { enabled: true, music: 65, effects: 0 });
  const other = await send(outsider, 'setRoomAudio', { effects: 80 }, 'gameStateUpdate');
  assert.equal(other.roomId, 'AUD002'); assert.equal(other.audioSettings.music, 25);
  assert.equal(other.audioSettings.enabled, true);
});
