const test = require('node:test');
const assert = require('node:assert/strict');
const { createPlayer, triggerPayday, checkAndApplyAnnualTax } = require('../dist/gameLogic');
const { GameState } = require('../dist/gameDataModels');
const { applyPaydayPlan } = require('../dist/statsSystem');
const { buyBasicInvestment } = require('../dist/basicInvestments');
const { evaluateSecondLifeEligibility } = require('../dist/cardSystem');
const { validateSocketPayload } = require('../dist/socketValidation');
const { MONTHS_PER_GLOBAL_PAYDAY, GROWTH_CYCLES_PER_GLOBAL_PAYDAY } = require('../dist/gameConfig');

test('六個財務月保留三個健康／人脈週期，保費照月扣，十二月照常課稅', () => {
  const game = new GameState('FINANCE');
  const old = createPlayer('old', '舊節奏', 'teacher');
  const now = createPlayer('new', '新節奏', 'teacher');
  old.cash = now.cash = 1000000;
  old.stats.health = now.stats.health = 100;
  old.insurance.hasMedicalInsurance = now.insurance.hasMedicalInsurance = true;
  let taxTriggers = 0;
  for (let period = 0; period < 2; period++) {
    for (let month = 1; month <= 3; month++) triggerPayday(old, game);
    for (let month = 1; month <= MONTHS_PER_GLOBAL_PAYDAY; month++) {
      const before = now.cash;
      triggerPayday(now, game, false, month <= GROWTH_CYCLES_PER_GLOBAL_PAYDAY);
      assert.equal(now.cash - before, now.monthlyCashflow);
      if (checkAndApplyAnnualTax(now).triggered) taxTriggers++;
    }
  }
  assert.equal(now.paydayCount, 12);
  assert.equal(old.stats.health, now.stats.health);
  assert.equal(old.stats.network, now.stats.network);
  assert.equal(now.growthPaydayCount, 6);
  assert.equal(taxTriggers, 1);
  const a = applyPaydayPlan(old, { settlementMonths: 3, investInHealthMaintenance: true });
  const b = applyPaydayPlan(now, { settlementMonths: 6, investInHealthMaintenance: true });
  assert.equal(a.investments.healthMaintenance.cost, 9000);
  assert.equal(a.investments.healthMaintenance.cost, b.investments.healthMaintenance.cost);
});

test('基本投資一人一期一份、可放棄、不能偽造價格、不能賣掉後重買', () => {
  const p = createPlayer('p', '玩家'); p.cash = 100000;
  assert.equal(buyBasicInvestment(p, undefined, 1).success, false);
  assert.equal(buyBasicInvestment(p, 'fake', 1).success, false);
  assert.equal(p.cash, 100000);
  assert.equal(buyBasicInvestment(p, 'basic-dividend', 1).success, true);
  assert.equal(p.cash, 70000);
  assert.equal(p.assets.at(-1).monthlyCashflow, 360);
  assert.equal(buyBasicInvestment(p, 'basic-deposit', 1).success, false);
  p.assets = [];
  assert.equal(buyBasicInvestment(p, 'basic-deposit', 1).success, false);
  assert.equal(buyBasicInvestment(p, 'basic-deposit', 2).success, true);
  p.cash = 1;
  assert.equal(buyBasicInvestment(p, 'basic-business', 3).success, false);
  assert.equal(p.cash, 1);
  assert.equal(validateSocketPayload('submitPaydayPlan', { phaseId: 'phase', basicInvestmentId: {} }), false);
});

test('資格保留雙路徑、財商乘數與人生指標，轉職後 SK 歸零會改變資格', () => {
  const p = createPlayer('p', '玩家');
  p.expenses = { taxes: 0, homeMortgagePayment: 0, carLoanPayment: 0, creditCardPayment: 0, otherExpenses: 10000 };
  p.liabilities = []; p.stats.financialIQ = 1;
  p.assets = [{ id: 'a', type: 'Other', name: '收入', cost: 1, monthlyCashflow: 7500 }];
  p.stats.health = 50; p.stats.careerSkill = 60; p.relationshipPoints = 0; p.lifeExperience = 0;
  assert.equal(evaluateSecondLifeEligibility(p).route, 'balancedLife');
  p.stats.careerSkill = 0;
  assert.equal(evaluateSecondLifeEligibility(p).eligible, false);
  p.assets[0].monthlyCashflow = 10000;
  assert.equal(evaluateSecondLifeEligibility(p).route, 'financialBreakthrough');
});
