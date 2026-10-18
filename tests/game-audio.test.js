const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function fixture() {
  const contexts = [], timers = new Set();
  class Param {
    value = 0;
    setValueAtTime(v) { this.value = v; }
    linearRampToValueAtTime(v) { this.value = v; }
    exponentialRampToValueAtTime(v) { this.value = v; }
    setTargetAtTime(v) { this.value = v; }
  }
  class Context {
    state = 'suspended'; currentTime = 0; destination = {}; gains = []; oscillators = [];
    constructor() { contexts.push(this); }
    async resume() { this.state = 'running'; }
    async close() { this.state = 'closed'; }
    createGain() { const g = { gain: new Param(), connect() {}, disconnect() {} }; this.gains.push(g); return g; }
    createOscillator() {
      const o = { frequency: new Param(), connect() {}, disconnect() {}, start() {}, stop(t) { if (t === undefined) this.stopped = true; } };
      this.oscillators.push(o); return o;
    }
  }
  const sandbox = { exports: {}, AudioContext: Context, setInterval(fn) { timers.add(fn); return fn; }, clearInterval(fn) { timers.delete(fn); } };
  const code = ts.transpileModule(fs.readFileSync('frontend/src/lib/gameAudio.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, sandbox);
  return { ...sandbox.exports, contexts, timers };
}
test('display audio stays silent until enabled, mutes queued notes and cleans up', async () => {
  const f = fixture(), a = new f.GameAudio();
  a.configure({ music: 25, effects: 45 }, 'lobby', true); a.play('dice');
  assert.equal(f.contexts.length, 0);
  await a.enable(); const ctx = f.contexts[0];
  assert.equal(f.timers.size, 1); assert.ok(ctx.oscillators.length > 0);
  const before = ctx.oscillators.length;
  a.play('dice'); assert.equal(ctx.oscillators.length, before + 6);
  a.play('dice'); assert.equal(ctx.oscillators.length, before + 6, 'rapid duplicates throttled');
  a.mute(); assert.equal(f.timers.size, 0); assert.equal(ctx.gains[0].gain.value, 0);
  assert.ok(ctx.oscillators.every(o => o.stopped));
  a.play('turn'); assert.equal(ctx.oscillators.length, before + 6);
  await a.enable(); assert.equal(f.contexts.length, 1); assert.equal(f.timers.size, 1);
  a.dispose(); assert.equal(ctx.state, 'closed'); assert.equal(f.timers.size, 0);
  await a.enable(); assert.equal(f.contexts.length, 1);
});
test('decisions duck music, pause stops audio, separate volumes and invalid preferences are safe', async () => {
  const f = fixture(), a = new f.GameAudio();
  assert.equal(f.normalizeAudioSettings({ music: Infinity, effects: -1 }).music, 25);
  assert.equal(f.normalizeAudioSettings({ music: 500, effects: -1 }).effects, 0);
  await a.enable(); const ctx = f.contexts[0], normal = ctx.gains[0].gain.value;
  a.configure({ music: 25, effects: 45 }, 'decision', true);
  assert.ok(ctx.gains[0].gain.value < normal);
  a.configure({ music: 25, effects: 45 }, 'journey', false);
  assert.equal(f.timers.size, 0); assert.equal(ctx.gains[1].gain.value, 0);
  const count = ctx.oscillators.length; a.play('milestone'); assert.equal(ctx.oscillators.length, count);
  a.configure({ music: 0, effects: 45 }, 'outer', true);
  assert.equal(f.timers.size, 0); a.play('turn'); assert.equal(ctx.oscillators.length, count + 2);
  a.dispose();
});
