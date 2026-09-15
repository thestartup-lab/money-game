const test = require('node:test');
const assert = require('node:assert/strict');
const { createPlayer, triggerPayday, repayLoan, getAvailableLoan, applyEducationLoan, calculateLifeScore } = require('../dist/gameLogic');
const { GameState } = require('../dist/gameDataModels');
const { CRISIS_POOL_BY_STAGE, CRISIS_EVENTS, DOODADS, RELATIONSHIP_EVENTS, CHARITY_CARD, MARKET_CARDS } = require('../dist/gameCards');
const { applyDoodadCard, applyCrisisCard, applyCharityDonation, applyRelationshipCard, applyMarketCard, getCharityDonationAmount, evaluateSecondLifeEligibility, previewCrisisCost } = require('../dist/cardSystem');
const { takeLeverageLoan } = require('../dist/gameLogic');
const { BIG_DEALS } = require('../dist/gameCards');
const { LEVERAGE_RATE_MULTIPLIER, getLoanRate } = require('../dist/gameConfig');
const { validateSocketPayload } = require('../dist/socketValidation');
const { LifeStage } = require('../dist/gameConstants');
const { LOAN_LIMIT_BY_TIER } = require('../dist/gameConfig');

const crisisById = new Map(CRISIS_EVENTS.map((c) => [c.id, c]));

test('青年期與成家期的危機池不含致死卡，且所有 ID 都存在', () => {
  for (const stage of Object.values(LifeStage)) {
    for (const id of CRISIS_POOL_BY_STAGE[stage]) assert.ok(crisisById.has(id), `${stage} 池含未知卡 ${id}`);
  }
  for (const stage of [LifeStage.Youth, LifeStage.Family]) {
    const lethal = CRISIS_POOL_BY_STAGE[stage].filter((id) => crisisById.get(id).canCauseDeath);
    assert.deepEqual(lethal, [], `${stage} 不應有致死卡`);
  }
  assert.ok(CRISIS_POOL_BY_STAGE[LifeStage.Transition].some((id) => crisisById.get(id).canCauseDeath));
});

test('現金為負時扣款不會變成退款，慈善也不會倒扣', () => {
  const p = createPlayer('p', '玩家', 'teacher');
  p.cash = -50000;
  const oneTime = DOODADS.find((d) => d.expenseType === 'OneTime');
  const r = applyDoodadCard(p, oneTime);
  assert.equal(r.cashDeducted, 0);
  assert.equal(p.cash, -50000);

  const nonLethal = CRISIS_EVENTS.find((c) => !c.canCauseDeath);
  applyCrisisCard(p, nonLethal);
  assert.equal(p.cash, -50000);

  applyCharityDonation(p, CHARITY_CARD, true);
  assert.equal(p.cash, -50000);
  assert.equal(p.charityTotal ?? 0, 0);
  assert.equal(p.bonusDice, 0);

  const fraud = RELATIONSHIP_EVENTS.find((c) => c.effect.cashCost);
  applyRelationshipCard(p, fraud);
  assert.equal(p.cash, -50000);
});

test('薪資倍率卡透過 triggerPayday 持續生效，升遷是加薪不是減薪', () => {
  const game = new GameState('SALARY');
  const p = createPlayer('p', '玩家', 'teacher');
  p.cash = 100000;
  triggerPayday(p, game);
  const base = p.salary;
  const promo = RELATIONSHIP_EVENTS.find((c) => c.effect.salaryMultiplier && c.effect.salaryMultiplier > 1);
  const r = applyRelationshipCard(p, promo);
  p.salaryMultiplierPending = r.salaryMultiplier;
  p.salaryMultiplierMonths = r.turnsAffected;
  triggerPayday(p, game);
  assert.equal(p.salary, Math.round(base * promo.effect.salaryMultiplier));
  for (let i = 1; i < promo.effect.turnsAffected; i++) triggerPayday(p, game);
  triggerPayday(p, game);
  assert.equal(p.salary, base, '倍率到期後恢復原薪');
  assert.equal(p.salaryMultiplierMonths, 0);
});

test('還款信用加分依比例計算，還 $1 不能刷信用；學貸不占信用額度', () => {
  const p = createPlayer('p', '玩家', 'teacher');
  p.cash = 500000;
  p.liabilities = [{ id: 'emergency-1', name: '應急借款', totalDebt: 100000, monthlyPayment: 1000 }];
  const before = p.creditScore;
  repayLoan(p, 'emergency-1', 1);
  assert.equal(p.creditScore, before);
  repayLoan(p, 'emergency-1', 50000);
  assert.ok(p.creditScore > before && p.creditScore - before <= 15);

  const student = createPlayer('s', '學生', 'teacher');
  const limitBefore = getAvailableLoan(student);
  applyEducationLoan(student);
  assert.equal(getAvailableLoan(student), limitBefore, '學貸不應吃掉信用額度');
  assert.ok(limitBefore >= LOAN_LIMIT_BY_TIER.at(-1).limit);
});

test('第二人生排除玩家間借貸利息；市場卡不影響已故玩家', () => {
  const p = createPlayer('p', '玩家');
  p.paydayCount = 6;
  p.expenses = { taxes: 0, homeMortgagePayment: 0, carLoanPayment: 0, creditCardPayment: 0, otherExpenses: 10000 };
  p.liabilities = [];
  p.stats.health = 70; p.stats.careerSkill = 60;
  p.assets = [{ id: 'p2p-1', type: 'Other', name: '借出款項', cost: 1, currentValue: 1, monthlyCashflow: 10000 }];
  assert.equal(evaluateSecondLifeEligibility(p).eligible, false, 'P2P 利息不算被動收入');
  p.assets = [{ id: 'a', type: 'Other', name: '收入', cost: 1, currentValue: 1, monthlyCashflow: 10000 }];
  assert.equal(evaluateSecondLifeEligibility(p).eligible, true);

  const game = new GameState('MARKET');
  const dead = createPlayer('d', '已故');
  dead.isAlive = false;
  dead.assets = [{ id: 'x', type: 'RealEstate', name: '房', cost: 100, currentValue: 100, monthlyCashflow: 1 }];
  game.addPlayer(dead);
  const priceCard = MARKET_CARDS.find((c) => c.effect === 'PriceIncrease' && c.targetAssetType === 'RealEstate');
  applyMarketCard(game, priceCard);
  assert.equal(dead.assets[0].currentValue, 100);
  assert.ok(!MARKET_CARDS.some((c) => c.effect === 'SellOpportunity'), '沒有實作的 SellOpportunity 卡不應存在');
});

test('慈善以薪資或被動收入較高者計算；人生評分計入現金且家庭可滿分', () => {
  const investor = createPlayer('i', '投資人', 'angel_investor');
  investor.salary = 0;
  assert.ok(getCharityDonationAmount(investor, CHARITY_CARD) > 0);

  const rich = createPlayer('r', '有錢人', 'teacher');
  rich.cash = 5000000; rich.assets = []; rich.liabilities = [];
  rich.isMarried = true; rich.numberOfChildren = 3;
  const score = calculateLifeScore(rich, 100);
  assert.equal(score.netWorth, 100);
  assert.equal(score.family, 100);
});

test('卡牌決策允許 null 的 Id 代表略過，其他事件仍拒絕', () => {
  assert.equal(validateSocketPayload('submitCardDecision', { phaseId: 'p', destinationId: null }), true);
  assert.equal(validateSocketPayload('submitCardDecision', { phaseId: 'p', targetPlayerId: null }), true);
  assert.equal(validateSocketPayload('submitCardDecision', { phaseId: null }), false);
  assert.equal(validateSocketPayload('submitCardDecision', { phaseId: 'p', accept: 'yes' }), false);
  assert.equal(validateSocketPayload('goTravel', { destinationId: null }), false);
});

test('危機費用預覽不改狀態；詐騙依現金比例扣款；槓桿利率高於應急；大交易現金流已上調', () => {
  const p = createPlayer('p', '玩家', 'teacher');
  p.cash = 10000;
  const lethal = CRISIS_EVENTS.find((c) => c.canCauseDeath);
  const preview = previewCrisisCost(p, lethal);
  assert.equal(preview.deathRisk, true);
  assert.equal(p.cash, 10000);
  p.cash = preview.effectiveCost + 1;
  assert.equal(previewCrisisCost(p, lethal).deathRisk, false);

  const victim = createPlayer('v', '受害者', 'teacher');
  victim.cash = 40000;
  const fraud = RELATIONSHIP_EVENTS.find((c) => c.effect.cashCostShare);
  applyRelationshipCard(victim, fraud);
  assert.equal(victim.cash, 20000, '扣 50%，不是扣光');
  victim.cash = 1000000;
  applyRelationshipCard(victim, fraud);
  assert.equal(victim.cash, 880000, '上限 $120,000');

  const lever = createPlayer('l', '槓桿', 'teacher');
  lever.cash = 100000;
  const r = takeLeverageLoan(lever, 100000, '測試資產');
  assert.equal(r.success, true);
  const expectedRate = getLoanRate(lever.creditScore) * LEVERAGE_RATE_MULTIPLIER;
  assert.equal(r.monthlyPayment, Math.max(1, Math.round(100000 * expectedRate)));
  assert.ok(expectedRate > getLoanRate(lever.creditScore));

  const first = BIG_DEALS[0];
  assert.equal(first.asset.monthlyCashflow, 28800);
});
