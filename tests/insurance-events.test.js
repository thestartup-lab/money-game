const test=require('node:test');
const assert=require('node:assert/strict');
const {createPlayer,triggerPayday,calculateLifeScore,buyInsurance}=require('../dist/gameLogic');
const {applyCrisisCard,previewCrisisCost}=require('../dist/cardSystem');
const {CRISIS_EVENTS}=require('../dist/gameCards');
const {GameState,AssetType}=require('../dist/gameDataModels');
const {crisisFitsPlayer}=require('../dist/eventEligibility');
const {encode,decode}=require('../dist/roomPersistence');
const card=id=>CRISIS_EVENTS.find(c=>c.id===id);
const player=()=>{const p=createPlayer('insurance','保障測試','teacher');p.stats.health=60;p.cash=1000000;return p;};

test('medical claims reconcile, no duplicate cash credit; life policy does not cover medical costs',()=>{
 const p=player();p.insurance.hasLifeInsurance=true;
 assert.equal(previewCrisisCost(p,card('cr-007')).wasInsured,false);
 assert.equal(previewCrisisCost(p,card('cr-008')).wasInsured,false);
 p.insurance.hasMedicalInsurance=true;
 const result=applyCrisisCard(p,card('cr-011'));
 assert.equal(result.uninsuredCost,80000);assert.equal(result.insurancePayout,70000);
 assert.equal(result.cashPaid,10000);assert.equal(p.cash,990000);assert.equal(p.turnsToSkip,1);
 assert.equal(p.insuranceClaimsPaid,70000);
 assert.equal(result.effectiveCost+result.insurancePayout,result.uninsuredCost);
});

test('medical coverage leaves work interruption; property coverage leaves rental loss; identity filters apply',()=>{
 const p=player();p.insurance.hasMedicalInsurance=true;
 const result=applyCrisisCard(p,card('cr-012'));
 assert.equal(result.incomePauseMonths,2);assert.equal(p.downsizingTurnsLeft,2);
 p.retirementStatus='retired';assert.equal(crisisFitsPlayer(p,card('cr-012')),false);
 assert.equal(crisisFitsPlayer(p,card('cr-013')),false);
 assert.equal(crisisFitsPlayer(p,card('cr-014')),false);
 p.assets.push({id:'rental',name:'出租房',type:AssetType.RealEstate,cost:1000000,currentValue:1000000,monthlyCashflow:10000});
 p.insurance.hasPropertyInsurance=true;
 assert.equal(crisisFitsPlayer(p,card('cr-014')),true);
 const r=applyCrisisCard(p,card('cr-014'));
 assert.equal(r.insurancePayout,160000);assert.equal(r.rentalMonthlyLoss,10000);
 assert.equal(p.recurringExpenses.at(-1).monthsLeft,3);
});

test('unpaid crisis bills remain debt, health does not discount property damage',()=>{
 const p=player();p.stats.health=100;p.cash=5000;
 const r=applyCrisisCard(p,card('cr-013'));
 assert.equal(r.uninsuredCost,240000);assert.equal(r.cashPaid,5000);assert.equal(r.unpaidCost,235000);
 assert.equal(p.cash,0);assert.equal(p.liabilities.at(-1).totalDebt,235000);
});

test('life benefit has a fixed cap, stays outside spendable cash; insurance totals survive persistence',()=>{
 const p=player();const gs=new GameState('INSURANCE');
 buyInsurance(p,'life');const before=p.insurancePremiumsPaid;
 triggerPayday(p,gs);assert.ok(p.insurancePremiumsPaid>before);assert.ok(p.insuranceActivationPaid>0);
 p.liabilities=[{id:'debt',name:'負債',totalDebt:2000000,monthlyPayment:0}];
 const cash=p.cash;const estate=calculateLifeScore(p,80).insuranceEstate;
 assert.equal(estate.benefit,1000000);assert.equal(estate.netEstate,p.assets.reduce((s,a)=>s+a.currentValue,0)+cash+1000000-2000000);
 assert.equal(p.cash,cash);
 const restored=decode(encode(p));assert.equal(restored.insurancePremiumsPaid,p.insurancePremiumsPaid);
 assert.equal(restored.insuranceActivationPaid,p.insuranceActivationPaid);
});
