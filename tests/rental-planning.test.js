const test=require('node:test');
const assert=require('node:assert/strict');
const {GameState}=require('../dist/gameDataModels');
const {createPlayer,repayLoan,sellAsset,connectionScore,calculateLifeScore}=require('../dist/gameLogic');
const {rentalPlanningOffers,buyPlanningRental}=require('../dist/rentalPlanning');
const {adoptChild}=require('../dist/family');
const {balancedMilestoneReview}=require('../dist/milestoneRewards');
const {encode,decode}=require('../dist/roomPersistence');
function setup(){const gs=new GameState('RENT');gs.turnNumber=3;gs.decisionPhase={kind:'actions'};const p=createPlayer('p','玩家','teacher');p.cash=3000000;gs.addPlayer(p);return {gs,p};}
test('出租置產：全員同房源，每期一間，重連不換房源，不開放時不扣款',()=>{
 const {gs,p}=setup();const q=createPlayer('q','同伴','teacher');q.cash=3000000;
 const offers=rentalPlanningOffers(gs,p);assert.equal(offers.length,2);
 assert.deepEqual(offers.map(x=>x.id),rentalPlanningOffers(gs,q).map(x=>x.id));
 assert.match(buyPlanningRental(gs,p,offers[0].id),/購入/);
 const restored=decode(JSON.parse(JSON.stringify(encode(p)))),cash=p.cash;
 assert.match(buyPlanningRental(gs,restored,offers[1].id),/未扣款/);assert.equal(restored.cash,cash);
 gs.turnNumber=6;assert.notDeepEqual(rentalPlanningOffers(gs,p).map(x=>x.id),offers.map(x=>x.id));
 gs.actionPhaseDone.add(p.id);assert.match(buyPlanningRental(gs,p,'apartment'),/未扣款/);
 gs.actionPhaseDone.clear();gs.decisionPhase=null;assert.match(buyPlanningRental(gs,p,'apartment'),/未扣款/);
});
test('出租置產：頭期、稅費、租金與負債一致；空置仍付利息，還款降息，賣房結清',()=>{
 const {gs,p}=setup(),o=rentalPlanningOffers(gs,p)[0];const cash=p.cash,base=p.totalPassiveIncome,expenses=p.totalExpenses,rent=p.rentExpense;
 buyPlanningRental(gs,p,o.id);const a=p.assets.find(a=>a.rentalOperatingCost!==undefined),l=p.liabilities.find(l=>l.id===a.linkedLiabilityId);
 assert.equal(p.cash,cash-o.cashNeeded);assert.equal(p.totalPassiveIncome-base,o.net);assert.equal(p.totalExpenses,expenses);assert.equal(p.rentExpense,rent);
 a.vacantMonthsLeft=6;assert.equal(p.assetPassiveIncome(a),-o.operating-o.monthlyPayment);
 repayLoan(p,l.id,o.loan/2);assert.equal(l.monthlyPayment,Math.round(o.monthlyPayment/2));
 assert.equal(p.assetPassiveIncome(a),-o.operating-l.monthlyPayment);
 a.vacantMonthsLeft=0;assert.equal(p.assetPassiveIncome(a),o.rent-o.operating-l.monthlyPayment);
 const before=p.cash,sold=sellAsset(p,a.id);assert.equal(sold.success,true);assert.equal(p.cash-before,o.price-o.loan/2);assert.ok(!p.liabilities.includes(l));
});
test('領養：與親生相同家庭與里程碑分數；重複提交不增加子女或扣款',()=>{
 const {gs,p}=setup();const prior=p.lifeExperience;adoptChild(gs,p);
 assert.equal(connectionScore(p),25);assert.ok(p.lifeExperience>prior);assert.equal(balancedMilestoneReview(p,0).family,5);
 const biological=createPlayer('b','親生對照','teacher');biological.numberOfChildren=1;
 assert.equal(calculateLifeScore(p,32).family,calculateLifeScore(biological,32).family);
 const cash=p.cash;assert.match(adoptChild(gs,p),/未扣款/);assert.equal(p.cash,cash);assert.equal(p.numberOfChildren,1);
});
