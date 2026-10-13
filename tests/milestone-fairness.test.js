const test=require('node:test');
const assert=require('node:assert/strict');
const {createPlayer}=require('../dist/gameLogic');
const {balancedMilestoneReview}=require('../dist/milestoneRewards');

test('里程碑：單身照顧重要關係與婚育同上限，不可用子女數無限加分',()=>{
  const p=createPlayer('a','玩家','teacher');p.familyTiePoints=50;
  assert.equal(balancedMilestoneReview(p,0).family,25);
  p.familyTiePoints=0;p.isMarried=true;p.numberOfChildren=3;
  assert.equal(balancedMilestoneReview(p,0).family,25);
  p.numberOfChildren=20;assert.equal(balancedMilestoneReview(p,0).family,25);
});
test('里程碑：相同生活保障比例，不因職業收支規模而有不同加分',()=>{
  const profiles=['teacher','angel_investor'].map(id=>createPlayer(id,id,id));
  const result=profiles.map(p=>{
    p.assets=[{id:'income',name:'測試',type:'Other',cost:0,currentValue:0,monthlyCashflow:p.totalExpenses/2}];
    p.charityTotal=p.totalExpenses*2;
    return balancedMilestoneReview(p,p.totalExpenses*180);
  });
  assert.equal(result[0].wealth,35);assert.equal(result[0].legacy,10);
  assert.equal(result[0].wealth,result[1].wealth);assert.equal(result[0].legacy,result[1].legacy);
});
