const test = require('node:test');
const assert = require('node:assert/strict');
const { createPlayer, calculateLifeScore, recordWellbeingRound } = require('../dist/gameLogic');
const { GameState } = require('../dist/gameDataModels');
const { encode, decode } = require('../dist/roomPersistence');
const { assignBucketList, getBucketGoal } = require('../dist/bucketList');
const { mentorBlockReason } = require('../dist/lateLife');

test('長期維護勝過最後補血；每輪只記一次，存檔保留歷程', () => {
  const early = createPlayer('e', '持續照顧', 'teacher');
  const late = createPlayer('l', '最後補分', 'teacher');
  for (let round = 1; round <= 5; round++) {
    early.stats.health = 80; late.stats.health = 20;
    recordWellbeingRound(early, round); recordWellbeingRound(late, round);
  }
  late.stats.health = 100; early.stats.health = 80;
  recordWellbeingRound(late, 5);
  assert.equal(late.wellbeingHistory.length, 5);
  assert.equal(calculateLifeScore(late, 60).hp, 44);
  assert.equal(calculateLifeScore(early, 60).hp, 80);
  const restored = decode(JSON.parse(JSON.stringify(encode(late))));
  assert.equal(calculateLifeScore(restored, 60).hp, 44);
  delete restored.wellbeingHistory;
  assert.equal(calculateLifeScore(restored, 60).hp, 100, '沒有歷程的舊檔不虛構歷史');
});

test('婚育與社群同上限、傳承不看子女、預設財務滿分 25 年生活費', () => {
  const p = createPlayer('p', '玩家', 'teacher');
  p.familyTiePoints = 50;
  assert.equal(calculateLifeScore(p, 60).family, 100);
  recordWellbeingRound(p, 1);
  assert.equal(calculateLifeScore(p, 60).family, 100);
  p.cash = p.totalExpenses * 300;
  const score = calculateLifeScore(p, 60);
  assert.equal(score.runwayTarget, 300);
  assert.equal(score.netWorth, 100);
  assert.equal(score.legacyScore, 100);
  p.familyTiePoints = 0; p.isMarried = true; p.numberOfChildren = 3;
  assert.equal(calculateLifeScore(p, 60).family, 100);
});

test('晚年一次性補關係不等於長期經營', () => {
  const p = createPlayer('p', '玩家', 'teacher');
  for (let r = 1; r <= 5; r++) recordWellbeingRound(p, r);
  p.familyTiePoints = 50;
  assert.equal(calculateLifeScore(p, 60).family, 30);
});

test('外圈夢想跨三類、無重複且不抽已達成；全員外圈仍可交流', () => {
  const gs = new GameState('balance');
  const p = createPlayer('p', '玩家', 'teacher');
  const other = createPlayer('o', '同伴', 'teacher');
  p.isInFastTrack = true; other.isInFastTrack = true;
  gs.players.set(p.id, p); gs.players.set(other.id, other);
  for (let i = 0; i < 20; i++) {
    assignBucketList(p, gs);
    const ids = p.bucketList.map(g => g.id);
    assert.equal(new Set(ids).size, 3);
    for (const group of [['world_traveler', 'healthy_elder', 'long_life'], ['mentor', 'family_man', 'philanthropist'], ['real_estate_baron', 'high_fq']]) {
      assert.ok(ids.some(id => group.includes(id)));
    }
    assert.ok(ids.every(id => !getBucketGoal(id).isAchieved(p, gs)));
  }
  assert.equal(mentorBlockReason(gs, p, other), null);
  p.familyTiePoints = 40;
  assert.equal(getBucketGoal('family_man').isAchieved(p, gs), true);
});
