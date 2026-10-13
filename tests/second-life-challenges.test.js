const test=require('node:test');
const assert=require('node:assert/strict');
const {createPlayer}=require('../dist/gameLogic');
const {drawSecondLifeChallenge,SECOND_LIFE_CHALLENGES}=require('../dist/secondLifeChallenges');

function player(){const p=createPlayer('challenge','測試','teacher');p.cash=1000000;p.stats.health=100;return p;}
test('第二人生挑戰：八種情境、不在抽卡時扣款、輪替不立即重複',()=>{
  assert.equal(SECOND_LIFE_CHALLENGES.length,8);
  const p=player(),before=p.cash,seen=new Set();
  for(let i=0;i<6;i++){const c=drawSecondLifeChallenge(p);assert.ok(!seen.has(c.title));seen.add(c.title);assert.equal(c.options.length,3);assert.match(c.description,/拒絕不扣分/);}
  assert.equal(p.cash,before);assert.equal(p.stats.health,100);
  const last=p.secondLifeChallengeHistory.at(-1);drawSecondLifeChallenge(p);assert.notEqual(p.secondLifeChallengeHistory.at(-1),last);
  const crisis=drawSecondLifeChallenge(p,true);assert.ok(SECOND_LIFE_CHALLENGES.find(c=>c.title===crisis.title).crisis);
});

test('新外圈：共同目標不繼承舊成績，沒有收入加倍、資產增值或入場現金紅利',()=>{
  const {GameState}=require('../dist/gameDataModels');
  const {assignBucketList,evaluateBucketList}=require('../dist/bucketList');
  const {applyFastTrackAppreciation,applyFastTrackPaydayBonus}=require('../dist/gameLogic');
  const gs=new GameState('purpose'),p=player();p.familyTiePoints=100;p.mentorCount=10;
  p.assets.push({id:'a',name:'資產',type:'Other',cost:1000000,currentValue:1000000,monthlyCashflow:10000});
  const income=p.totalIncome,cash=p.cash,asset=JSON.stringify(p.assets);
  p.isInFastTrack=true;assignBucketList(p,gs);
  assert.equal(p.totalIncome,income);assert.equal(evaluateBucketList(p,gs).newlyClaimed.length,0);
  applyFastTrackAppreciation(p);assert.equal(applyFastTrackPaydayBonus(p),0);
  assert.equal(p.cash,cash);assert.equal(JSON.stringify(p.assets),asset);
  assert.deepEqual(p.bucketList.map(g=>g.id),['purpose_explore','purpose_connect','purpose_contribute']);
});

test('零現金、未婚、單人也能實踐三方向；失敗算嘗試，重複不能刷分，存檔保留',()=>{
  const {GameState}=require('../dist/gameDataModels');
  const {assignBucketList,evaluateBucketList}=require('../dist/bucketList');
  const {buildSecondLifeChallenge,chooseSecondLifeChallengeId}=require('../dist/secondLifeChallenges');
  const {encode,decode}=require('../dist/roomPersistence');
  const gs=new GameState('purpose'),p=player();p.cash=0;p.isInFastTrack=true;assignBucketList(p,gs);
  for(const id of ['apprentice','cross-generation','remote-service']) {
    const option=buildSecondLifeChallenge(p,id).options[2];assert.equal(option.disabled,false);option.run();
    assert.equal(evaluateBucketList(p,gs).newlyClaimed.length,1);
    const before=JSON.stringify(encode(p));
    assert.match(buildSecondLifeChallenge(p,id).options[0].run(),/不重複/);
    assert.equal(JSON.stringify(encode(p)),before);
  }
  assert.equal(p.cash,0);assert.equal(p.bucketList.every(g=>g.claimed),true);assert.ok(p.stats.health>=20);
  assert.deepEqual(decode(JSON.parse(JSON.stringify(encode(p)))).secondLifeJourney,p.secondLifeJourney);
  assert.equal(evaluateBucketList(p,gs).perfectBonus,undefined);
  const q=player();q.isInFastTrack=true;assignBucketList(q,gs);
  const original=Math.random;try{Math.random=()=>0.99;buildSecondLifeChallenge(q,'community-project').options[0].run();}finally{Math.random=original;}
  assert.equal(q.secondLifeJourney.practices[0].success,false);
  assert.equal(evaluateBucketList(q,gs).newlyClaimed[0].id,'purpose_contribute');
  const next=chooseSecondLifeChallengeId(q);assert.ok(['apprentice','cross-generation','new-city'].includes(next));
});
test('第二人生挑戰：風險公開、失敗仍付代價，只取得有限體驗',()=>{
  const p=player();p.secondLifeChallengeHistory=SECOND_LIFE_CHALLENGES.filter(c=>!c.crisis&&c.id!=='community-project').map(c=>c.id);
  const c=drawSecondLifeChallenge(p),option=c.options[0];assert.match(option.description,/55%/);
  const initial={cash:p.cash,hp:p.stats.health,exp:p.lifeExperience,relation:p.relationshipPoints,legacy:p.legacyBonusPoints};
  const random=Math.random;try{Math.random=()=>0.99;assert.match(option.run(),/未達預期/);}finally{Math.random=random;}
  assert.equal(p.cash,initial.cash-100000);assert.equal(p.stats.health,initial.hp-8);assert.equal(p.lifeExperience,initial.exp+6);
  assert.equal(p.relationshipPoints,initial.relation);assert.equal(p.legacyBonusPoints,initial.legacy);
});
test('第二人生挑戰：小規模確定成長、技能封頂、執行前重新驗證金錢健康',()=>{
  const p=player();p.stats.careerSkill=99;p.secondLifeChallengeHistory=SECOND_LIFE_CHALLENGES.filter(c=>!c.crisis&&c.id!=='apprentice').map(c=>c.id);
  const option=drawSecondLifeChallenge(p).options[1];assert.match(option.run(),/完成/);assert.equal(p.stats.careerSkill,100);assert.equal(p.cash,985000);
  p.cash=1;const hp=p.stats.health;assert.match(option.run(),/未扣款/);assert.equal(p.cash,1);assert.equal(p.stats.health,hp);
  p.cash=1000000;p.stats.health=20;assert.match(drawSecondLifeChallenge(p).options[0].run(),/未扣款/);assert.equal(p.cash,1000000);
});
