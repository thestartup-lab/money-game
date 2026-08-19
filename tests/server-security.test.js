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

test('房間專屬密碼、來源限制與主持人權限不能被繞過', async (t) => {
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

  const shortPasswordErrorPromise = waitForEvent(admin, 'error');
  admin.emit('createRoom', { roomId: 'SAFE01', password: '123' });
  assert.match((await shortPasswordErrorPromise).message, /至少需要 8/);

  const createdPromise = waitForEvent(admin, 'roomCreated');
  admin.emit('createRoom', { roomId: 'SAFE01', password: 'secure-passphrase' });
  assert.equal((await createdPromise).roomId, 'SAFE01');

  const attacker = await connect();
  t.after(() => attacker.disconnect());
  const unauthorizedPromise = waitForEvent(attacker, 'error');
  attacker.emit('triggerGlobalEvent', { roomId: 'SAFE01', eventId: 'inflation' });
  assert.match((await unauthorizedPromise).message, /權限不足/);

  const wrongLoginPromise = waitForEvent(attacker, 'adminLoginFail');
  attacker.emit('adminLogin', { roomId: 'SAFE01', password: 'wrong-password' });
  assert.match((await wrongLoginPromise).message, /密碼錯誤/);

  const announcementPromise = waitForEvent(admin, 'globalEventAnnouncement');
  admin.emit('triggerGlobalEvent', { roomId: 'SAFE01', eventId: 'inflation' });
  assert.equal((await announcementPromise).event.id, 'inflation');
});
