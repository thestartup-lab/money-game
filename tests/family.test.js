// 家庭行動：主動求子、領養、助養、付費婚配條件、主動離婚；家庭分數計入家庭連結
const test = require('node:test');
const assert = require('node:assert/strict');
const { createPlayer, calculateLifeScore, createSpouse } = require('../dist/gameLogic');
const { GameState } = require('../dist/gameDataModels');
const fam = require('../dist/family');
const cfg = require('../dist/gameConfig');

function setup(age = 32) {
  const gs = new GameState('F');
  const p = createPlayer('p', '玩家', 'teacher'); p.salary = p.profession.startingSalary; p.cash = 1_000_000; p.stats.health = 90;
  gs.addPlayer(p); gs.turnNumber = Math.round((age - 20) / 4); p.currentAge = age;
  return { gs, p };
}

test('主動求子：未婚不行；已婚、黃金期機率較高；成功多一個孩子，每輪一次', () => {
  const { gs, p } = setup(32);
  assert.match(fam.fertilityBlock(gs, p), /結婚後/);
  p.isMarried = true; createSpouse(p);
  assert.equal(fam.fertilityBlock(gs, p), null);
  assert.equal(fam.fertilityChance(gs, p), cfg.FERTILITY_PROBABILITY_PEAK);
  const orig = Math.random; Math.random = () => 0;
  const r = fam.tryForBaby(gs, p); Math.random = orig;
  assert.equal(r.success, true); assert.equal(p.numberOfChildren, 1);
  assert.equal(p.cash, 1_000_000 - cfg.FERTILITY_COST);
  assert.match(fam.fertilityBlock(gs, p), /這一輪|不到/);
});

test('領養：單身也可以、孩子 3 歲算子女支出、60 歲以後不行', () => {
  const { gs, p } = setup(40);
  assert.equal(fam.adoptionBlock(gs, p), null);
  const before = p.totalExpenses;
  fam.adoptChild(gs, p);
  assert.equal(p.numberOfChildren, 1);
  assert.equal(p.childBirthAges[0], 40 - cfg.ADOPTED_CHILD_AGE);
  assert.ok(p.totalExpenses > before, '開始有子女支出');
  const old = setup(64);
  assert.match(fam.adoptionBlock(old.gs, old.p), /60/);
});

test('家庭分數：不結婚、不生小孩，靠助養、照顧長輩、指導後輩最多拿到 50', () => {
  const { gs, p } = setup(40);
  const base = calculateLifeScore(p, 40).family;
  assert.equal(base, 0);
  fam.sponsorChild(p); fam.sponsorChild(p);
  assert.match(fam.sponsorBlock(p), /最多/);
  assert.equal(p.familyTiePoints, 20);
  assert.equal(p.recurringExpenses.filter((r) => r.label === '助養兒童').length, 2);
  p.familyTiePoints = 80;
  assert.equal(calculateLifeScore(p, 40).family, cfg.FAMILY_TIE_CAP, '家庭連結最多 50');
  p.isMarried = true;
  assert.equal(calculateLifeScore(p, 40).family, 75);
  void gs;
});

test('付費婚配條件與主動離婚：律師費、分財產、失去配偶、孩子留下', () => {
  const { gs, p } = setup(30);
  assert.equal(fam.arrangedBlock(gs, p), null);
  p.isMarried = true; createSpouse(p); p.numberOfChildren = 1; p.childBirthAges = [28];
  assert.match(fam.arrangedBlock(gs, p), /已婚/);
  const hp = p.stats.health;
  fam.fileDivorce(p);
  assert.equal(p.isMarried, false); assert.equal(p.spouse, null); assert.equal(p.spouseLivingExpenses, 0);
  assert.equal(p.cash, Math.round((1_000_000 - cfg.DIVORCE_LEGAL_FEE) * (1 - cfg.DIVORCE_CASH_SHARE)));
  assert.equal(p.stats.health, hp - cfg.DIVORCE_HP_COST);
  assert.equal(p.numberOfChildren, 1, '孩子留在身邊');
});
