const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// Execute the actual frontend helpers with an isolated SDK, without credentials or network.
function loadFrontend(name, dependencies = {}, location = { origin: 'https://game.cjlead.com.tw', search: '' }) {
  const filename = path.join(__dirname, '../frontend/src', name + '.ts');
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(source, {
    module, exports: module.exports, URL, URLSearchParams, window: { location },
    require: id => {
      if (id in dependencies) return dependencies[id];
      if (id === './lineBrand') return loadFrontend('lineBrand');
      if (id === './lineConfig.json') return require('../frontend/src/lineConfig.json');
      throw Error('Unexpected dependency ' + id);
    },
  }, { filename });
  return module.exports;
}
const entry = loadFrontend('lineEntry');
const partner = { id: 'partner', name: '測試品牌', officialAccountId: '@test', channelId: '2999999999', liffId: '2999999999-test' };

test('合作品牌 QR 與登入返回保留品牌、房號，SDK 不混用不同品牌', async () => {
  assert.equal(entry.lineRoomUrl('abc123', partner), 'https://liff.line.me/2999999999-test?room=ABC123&brand=partner');
  assert.equal(entry.brandIdFromSearch('?liff.state=%3Froom%3DABC123%26brand%3Dpartner'), 'partner');
  assert.equal(entry.brandIdFromSearch('?brand=https://evil.test'), 'xinli');
  let initializedId; let redirect;
  const api = auth('', { init: async value => { initializedId = value.liffId; }, login: value => { redirect = value.redirectUri; } });
  await api.getLineToken(true, 'ABC123', partner);
  assert.equal(initializedId, partner.liffId);
  assert.equal(redirect, 'https://game.cjlead.com.tw/?room=ABC123&brand=partner&lineLoginReturn=1');
  await assert.rejects(api.getLineToken(false), /不同品牌/);
});

test('房間 LINE URL 固定官方入口，保留代碼、不帶主持人控制碼', () => {
  assert.equal(entry.lineRoomUrl('abc123'), 'https://liff.line.me/2011449805-9TCCT06U?room=ABC123');
  for (const room of ['', 'https://evil.test', 'ABC123&code=secret', '1234567']) {
    assert.equal(entry.lineRoomUrl(room), entry.LINE_ENTRY_URL);
  }
  for (const page of ['AdminPage', 'DisplayScreen']) {
    const source = fs.readFileSync(path.join(__dirname, '../frontend/src/pages', page + '.tsx'), 'utf8');
    assert.match(source, /const playerUrl = lineRoomUrl\(/);
    assert.match(source, /QRCodeSVG value=\{playerUrl\}/);
  }
});

test('LIFF 初次與二次跳轉都能讀取房間代碼，不採用無效代碼', () => {
  assert.equal(entry.roomCodeFromSearch('?room=ABC123'), 'ABC123');
  assert.equal(entry.roomCodeFromSearch('?liff.state=%3Froom%3DABC123'), 'ABC123');
  assert.equal(entry.roomCodeFromSearch('?liff.state=%2F%3Froom%3DABC123'), 'ABC123');
  assert.equal(entry.roomCodeFromSearch('?room=ROOM01&liff.state=%3Froom%3DROOM02'), 'ROOM01');
  assert.equal(entry.roomCodeFromSearch('?liff.state=%3Froom%3Dhttps%3A%2F%2Fevil.test'), '');
});

function auth(search = '', overrides = {}) {
  const sdk = { init: async () => {}, isLoggedIn: () => false, login: () => {}, getIDToken: () => null, logout: () => {}, ...overrides };
  return loadFrontend('lineLogin', { './lineEntry': entry, '@line/liff': sdk }, { origin: 'https://game.cjlead.com.tw', search });
}

test('一般首次開啟不誤報錯誤；登入保留房號並標記返回', async () => {
  let redirect;
  const api = auth('', { login: value => { redirect = value.redirectUri; } });
  assert.equal(await api.getLineToken(false), null);
  assert.equal(await api.getLineToken(true, 'abc123'), null);
  assert.equal(redirect, 'https://game.cjlead.com.tw/?room=ABC123&lineLoginReturn=1');
});

test('返回後未登入與取消授權提供可操作錯誤，不洩漏原始回呼內容', async () => {
  for (const search of ['?lineLoginReturn=1', '?code=private-code', '?liff.state=%3Froom%3DABC123']) {
    const api = auth(search);
    await assert.rejects(api.getLineToken(false), /返回遊戲後尚未取得 LINE 登入狀態/);
  }
  await assert.rejects(auth('?error=access_denied&error_description=private').getLineToken(false), /授權未完成或已取消/);
});

test('SDK 清除回呼後仍保留失敗判斷；成功只回傳待伺服器驗證的 token', async () => {
  const location = { origin: 'https://game.cjlead.com.tw', search: '?code=private-code' };
  const api = loadFrontend('lineLogin', { './lineEntry': entry, '@line/liff': {
    init: async () => { location.search = ''; }, isLoggedIn: () => false,
  } }, location);
  await assert.rejects(api.getLineToken(false), /返回遊戲後尚未取得/);
  assert.equal(await auth('?lineLoginReturn=1', { isLoggedIn: () => true, getIDToken: () => 'test-id-token' }).getLineToken(false), 'test-id-token');
  await assert.rejects(auth('', { isLoggedIn: () => true }).getLineToken(false), /沒有取得 LINE 身分憑證/);
});

test('SDK 初始化失敗可重試，畫面只提供安全通用訊息', async () => {
  let calls = 0;
  const api = auth('', { init: async () => { if (++calls === 1) throw Error('sensitive-sdk-details'); } });
  await assert.rejects(api.getLineToken(false));
  assert.equal(await api.getLineToken(false), null);
  assert.equal(calls, 2);
  assert.match(api.lineLoginErrorMessage(Error('sensitive-sdk-details')), /從 LINE 重新開啟此房間/);
  assert.ok(!api.lineLoginErrorMessage(Error('sensitive-sdk-details')).includes('sensitive'));
});
