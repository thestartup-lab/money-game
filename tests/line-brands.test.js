const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { spawn } = require('node:child_process');
const { io } = require('socket.io-client');
const { parseLineBrands, roomLineBrand } = require('../dist/lineBrands');
const { verifyLineIdToken } = require('../dist/lineAuth');
const { encode, decode } = require('../dist/roomPersistence');
const { GameState } = require('../dist/gameDataModels');
const accessCode = 'test-only-partner-access-code-12345';
const partner = { id: 'partner', name: '測試品牌', officialAccountId: '@test', channelId: '2999999999', liffId: '2999999999-test',
  enabled: true, creationCodeHash: createHash('sha256').update(accessCode).digest('hex') };

test('品牌註冊嚴格驗證、保護鑫力設定，舊房間與快照不混牌', () => {
  assert.equal(parseLineBrands(JSON.stringify([partner]))[0].id, 'partner');
  for (const invalid of [{ ...partner, id: 'xinli' }, { ...partner, creationCodeHash: '' }, { ...partner, channelId: '2011449805' },
    { ...partner, liffId: 'https://evil.test' }, { ...partner, liffId: '2888888888-test' }, { ...partner, enabled: 'yes' }]) {
    assert.throws(() => parseLineBrands(JSON.stringify([invalid])));
  }
  assert.throws(() => parseLineBrands(JSON.stringify([partner, partner])));
  const gs = new GameState('TEST01');
  assert.equal(roomLineBrand(decode(encode(gs))).id, 'xinli');
  gs.lineBrand = roomLineBrand({ lineBrand: partner });
  assert.equal(roomLineBrand(decode(encode(gs))).id, 'partner');
  assert.ok(!JSON.stringify(encode(gs)).includes('creationCodeHash'));
});

test('合作品牌憑證驗證使用指定 channel，不能挪用鑫力憑證且維持原識別碼', async () => {
  const sub = 'U' + '1'.repeat(32);
  const claims = { iss: 'https://access.line.me', aud: partner.channelId, sub, exp: Date.now() / 1000 + 3600, iat: Date.now() / 1000 };
  const identity = await verifyLineIdToken('test-token-long-enough', async (_url, options) => {
    assert.equal(options.body.get('client_id'), partner.channelId);
    return new Response(JSON.stringify(claims));
  }, partner);
  await assert.rejects(verifyLineIdToken('test-token-long-enough', async () => new Response(JSON.stringify({ ...claims, aud: '2011449805' })), partner));
  const xinli = await verifyLineIdToken('test-token-long-enough', async () => new Response(JSON.stringify({ ...claims, aud: '2011449805' })));
  assert.notEqual(identity.accountKey, xinli.accountKey);
  assert.equal(xinli.accountKey, createHash('sha256').update(`baisui:2011449805:${sub}`).digest('hex'));
});

function wait(socket, event, predicate = () => true) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.off(event, handler); reject(Error('Timeout ' + event)); }, 5000);
    const handler = value => { if (!predicate(value)) return; clearTimeout(timer); socket.off(event, handler); resolve(value); };
    socket.on(event, handler);
  });
}
function send(socket, event, payload, response, predicate) {
  const p = wait(socket, response, predicate); socket.emit(event, payload); return p;
}

test('多品牌開場權限、伺服器決定品牌、跨品牌拒絕、同品牌續玩與未啟用帳號', { timeout: 20000 }, async t => {
  const boot = `const auth=require('./dist/lineAuth');
    auth.verifyLineIdToken=async (token,_request,brand)=>{
      if(token!==brand.id+'-test-token-long-enough') throw Error('wrong channel');
      return {accountKey:'private-'+brand.id,displayName:'測試學員',brandId:brand.id,expiresAt:Date.now()+3600000};
    }; require('./dist/socketServer');`;
  const server = spawn(process.execPath, ['-e', boot], { env: { ...process.env, PORT: '3368', NODE_ENV: 'test', LINE_BRANDS_JSON: JSON.stringify([partner]) }, stdio: ['ignore', 'pipe', 'pipe'] });
  const sockets = [];
  t.after(() => { sockets.forEach(s => s.disconnect()); server.kill(); });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('boot timeout')), 8000);
    server.stdout.on('data', d => { if (String(d).includes('已啟動')) { clearTimeout(timer); resolve(); } });
  });
  const connect = async () => { const s = io('http://127.0.0.1:3368', { transports: ['websocket'], reconnection: false }); sockets.push(s); await wait(s, 'connect'); return s; };
  const host = await connect();
  const list = await send(host, 'listLineBrands', {}, 'lineBrandList');
  assert.equal(list.find(b => b.id === 'partner').requiresAccessCode, true);
  assert.equal(list.find(b => b.officialAccountId === '@225mphca').status, 'pending');
  assert.ok(!JSON.stringify(list).includes(partner.creationCodeHash));
  await send(host, 'createRoom', { roomId: 'NOAUTH', lineBrandId: 'partner' }, 'error', e => /授權碼/.test(e.message));
  await send(host, 'createRoom', { roomId: 'WRONG1', lineBrandId: 'partner', brandAccessCode: 'wrong-code-long-enough-12345' }, 'error');
  await send(host, 'createRoom', { roomId: 'PEND01', lineBrandId: 'oa225mphca', brandAccessCode: accessCode }, 'error');
  const state = wait(host, 'gameStateUpdate', g => g.roomId === 'BRAND1');
  const room = await send(host, 'createRoom', { roomId: 'BRAND1', lineBrandId: 'partner', brandAccessCode: accessCode }, 'roomCreated');
  const gs = await state;
  assert.equal(gs.lineBrand.id, 'partner');
  assert.ok(!JSON.stringify(gs).includes('creationCodeHash'));
  assert.ok(!JSON.stringify(gs).includes(accessCode));
  const host2 = await connect();
  await send(host2, 'createRoom', { roomId: 'XINLI1' }, 'roomCreated');
  const a = await connect();
  const ctx = await a.timeout(3000).emitWithAck('getLineBrand', { roomCode: room.roomId, brandId: 'xinli' });
  assert.equal(ctx.brand.id, 'partner', 'room overrides client hint');
  assert.ok((await a.timeout(3000).emitWithAck('getLineBrand', { roomCode: 'NOPE01' })).error);
  await send(a, 'lineAuthenticate', { idToken: 'xinli-test-token-long-enough', roomCode: room.roomId }, 'lineLoginFailed');
  await send(a, 'lineAuthenticate', { idToken: 'xinli-test-token-long-enough' }, 'lineAuthenticated');
  await send(a, 'playerJoin', { playerName: '甲', roomCode: room.roomId }, 'lineLoginFailed', e => /不屬於/.test(e.message));
  await send(a, 'lineAuthenticate', { idToken: 'partner-test-token-long-enough', roomCode: room.roomId }, 'lineAuthenticated');
  const joined = await send(a, 'playerJoin', { playerName: '甲', roomCode: room.roomId }, 'playerSession');
  const b = await connect();
  await send(b, 'lineAuthenticate', { idToken: 'partner-test-token-long-enough', roomCode: room.roomId }, 'lineAuthenticated');
  const restored = await send(b, 'playerJoin', { playerName: '新名字', roomCode: room.roomId }, 'playerSession');
  assert.equal(restored.playerId, joined.playerId);
  // Unknown mutation must not change the pinned room brand.
  host.emit('setLineBrand', { lineBrandId: 'xinli' });
  assert.equal((await host.timeout(3000).emitWithAck('getLineBrand', { roomCode: room.roomId })).brand.id, 'partner');
});
