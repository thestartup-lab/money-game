const test = require('node:test');
const assert = require('node:assert/strict');
const { persistenceStorageKind } = require('../dist/roomPersistence');

test('存檔健康狀態：資料夾不代表永久磁碟、路徑不能跳出 volume', (t) => {
  const keys = ['STATE_DIR', 'RAILWAY_ENVIRONMENT', 'RAILWAY_VOLUME_MOUNT_PATH'];
  const previous = keys.map(k => process.env[k]);
  t.after(() => keys.forEach((k, i) => {
    if (previous[i] === undefined) delete process.env[k]; else process.env[k] = previous[i];
  }));
  keys.forEach(k => delete process.env[k]);
  assert.equal(persistenceStorageKind(), 'local-disk');
  process.env.RAILWAY_ENVIRONMENT = 'production';
  process.env.STATE_DIR = '/tmp/game-state';
  assert.equal(persistenceStorageKind(), 'container-disk');
  process.env.RAILWAY_VOLUME_MOUNT_PATH = '/data';
  assert.equal(persistenceStorageKind(), 'container-disk');
  for (const dir of ['/data', '/data/rooms']) {
    process.env.STATE_DIR = dir;
    assert.equal(persistenceStorageKind(), 'volume');
  }
  for (const dir of ['/data-other', '/data/../tmp']) {
    process.env.STATE_DIR = dir;
    assert.equal(persistenceStorageKind(), 'container-disk');
  }
  delete process.env.STATE_DIR;
  assert.equal(persistenceStorageKind(), 'volume');
});
