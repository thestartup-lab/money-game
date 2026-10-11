const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { io } = require('socket.io-client');
const { verifyLineIdToken } = require('../dist/lineAuth');
const { validateSocketPayload } = require('../dist/socketValidation');
const { encode, decode } = require('../dist/roomPersistence');

const claims = () => ({ iss: 'https://access.line.me', aud: '2011449805', sub: 'U' + '1'.repeat(32),
  exp: Math.floor(Date.now() / 1000) + 3600, iat: Math.floor(Date.now() / 1000), name: 'LINE 玩家', picture: 'https://profile.line-scdn.net/test' });

test('LINE 憑證由官方驗證，檢查 channel／期限／發行者，拒絕偽造與過期資料', async () => {
  const valid = await verifyLineIdToken('signed-test-token-long-enough', async (url, options) => {
    assert.equal(url, 'https://api.line.me/oauth2/v2.1/verify');
    assert.equal(options.body.get('client_id'), '2011449805');
    assert.equal(options.body.get('id_token'), 'signed-test-token-long-enough');
    return new Response(JSON.stringify(claims()), { status: 200 });
  });
  assert.equal(valid.displayName, 'LINE 玩家');
  assert.equal(valid.accountKey.length, 64);
  assert.ok(!JSON.stringify(valid).includes(claims().sub));
  assert.equal(decode(encode({ lineAccountKey: valid.accountKey })).lineAccountKey, valid.accountKey);
  for (const bad of [{ aud: 'another-channel' }, { iss: 'https://evil.example' }, { sub: 'fake-user' }, { exp: 1 }, { iat: 99999999999 }]) {
    await assert.rejects(verifyLineIdToken('signed-test-token-long-enough', async () => new Response(JSON.stringify({ ...claims(), ...bad }))));
  }
  await assert.rejects(verifyLineIdToken('signed-test-token-long-enough', async () => new Response('{}', { status: 400 })));
  await assert.rejects(verifyLineIdToken('signed-test-token-long-enough', async () => { throw new Error('offline'); }));
  assert.equal(validateSocketPayload('lineAuthenticate', { idToken: 'a'.repeat(8001) }), false);
  assert.equal(validateSocketPayload('lineAuthenticate', { idToken: 'a'.repeat(30), userId: 'forged' }), false);
  assert.equal(validateSocketPayload('setLineLoginRequired', { enabled: 'false' }), false);
});

function wait(socket, event, predicate = () => true) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.off(event, handler); reject(Error('Timeout ' + event)); }, 5000);
    const handler = value => { if (!predicate(value)) return; clearTimeout(timer); socket.off(event, handler); resolve(value); };
    socket.on(event, handler);
  });
}
function send(socket, event, payload, response, predicate) {
  const result = wait(socket, response, predicate); socket.emit(event, payload); return result;
}

test('LINE 登入→入房→同帳號跨裝置恢復；不冒名、不洩漏識別碼、臨時加入由主持人控制', { timeout: 15000 }, async t => {
  // Test process only: isolate LINE dependency, no test bypass exists in the production server.
  const boot = `const auth=require('./dist/lineAuth');
    auth.verifyLineIdToken=async token=>{
      if(!['account-one-token-for-test','account-two-token-for-test'].includes(token)) throw Error('invalid');
      return {accountKey:token==='account-one-token-for-test'?'private-one':'private-two',displayName:'LINE測試',expiresAt:Date.now()+3600000};
    }; require('./dist/socketServer');`;
  const server = spawn(process.execPath, ['-e', boot], { env: { ...process.env, PORT: '3367', NODE_ENV: 'test' }, stdio: ['ignore', 'pipe', 'pipe'] });
  const sockets = []; let stderr = '';
  server.stderr.on('data', d => { stderr += d; });
  t.after(() => { sockets.forEach(s => s.disconnect()); server.kill(); });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('boot timeout')), 5000);
    server.stdout.on('data', d => { if (String(d).includes('已啟動')) { clearTimeout(timer); resolve(); } });
  });
  const connect = async () => { const s = io('http://127.0.0.1:3367', { transports: ['websocket'], reconnection: false }); sockets.push(s); await wait(s, 'connect'); return s; };
  const host = await connect();
  const room = await send(host, 'createRoom', { roomId: 'LINE67' }, 'roomCreated');
  await send(host, 'setLineLoginRequired', { enabled: true }, 'gameStateUpdate', g => g.lineLoginRequired);
  const a = await connect();
  assert.match((await send(a, 'playerJoin', { playerName: '甲', roomCode: room.roomId }, 'error')).message, /LINE/);
  await send(a, 'setLineLoginRequired', { enabled: false }, 'error', e => /主持人/.test(e.message));
  await send(a, 'lineAuthenticate', { idToken: 'invalid-token-not-trusted' }, 'lineLoginFailed');
  const profile = await send(a, 'lineAuthenticate', { idToken: 'account-one-token-for-test' }, 'lineAuthenticated');
  assert.deepEqual(profile, { displayName: 'LINE測試' });
  const statePromise = wait(host, 'gameStateUpdate', g => g.players.length === 1);
  const joined = await send(a, 'playerJoin', { playerName: '甲', roomCode: room.roomId }, 'playerSession');
  const state = await statePromise;
  assert.ok(!JSON.stringify(state).includes('private-one'));
  const display = await connect();
  const publicState = await send(display, 'joinDisplay', { roomId: room.roomId }, 'gameStateUpdate');
  assert.ok(!JSON.stringify(publicState).includes('private-one'));
  const other = await connect();
  await send(other, 'lineAuthenticate', { idToken: 'account-two-token-for-test' }, 'lineAuthenticated');
  await send(other, 'playerJoin', { playerName: '甲', roomCode: room.roomId }, 'error', e => /名字/.test(e.message));
  const resumed = await connect();
  await send(resumed, 'lineAuthenticate', { idToken: 'account-one-token-for-test' }, 'lineAuthenticated');
  const taken = wait(a, 'sessionTakenOver');
  const restored = await send(resumed, 'playerJoin', { playerName: '改名也不能再開角色', roomCode: room.roomId }, 'playerSession');
  assert.equal(restored.playerId, joined.playerId); assert.equal(restored.playerName, '甲');
  await taken;
  await send(host, 'setLineLoginRequired', { enabled: false }, 'gameStateUpdate', g => !g.lineLoginRequired);
  const guest = await connect();
  await send(guest, 'playerJoin', { playerName: '臨時玩家', roomCode: room.roomId }, 'playerSession');
  await send(host, 'startGame', { force: true }, 'gameStateUpdate', g => g.gamePhase === 'RatRace');
  await send(host, 'setLineLoginRequired', { enabled: true }, 'error', e => /開局前/.test(e.message));
  const lateRejoin = await connect();
  await send(lateRejoin, 'lineAuthenticate', { idToken: 'account-one-token-for-test' }, 'lineAuthenticated');
  const afterStart = await send(lateRejoin, 'playerJoin', { playerName: '甲', roomCode: room.roomId }, 'playerSession');
  assert.equal(afterStart.playerId, joined.playerId);
  assert.equal(stderr, '');
});
