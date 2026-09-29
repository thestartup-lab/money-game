const test = require('node:test');
const assert = require('node:assert/strict');
const { createPlayer, triggerPayday, applyRoundGrowth, getLayoffMonths, createSpouse, naturalDeathProbability, syncPlayerAges, confirmMarriage, payWedding, previewMarriageFinances } = require('../dist/gameLogic');
const { GameState, LifeStage } = require('../dist/gameDataModels');
const { applyBabyCard, applyRelationshipCard, applyCrisisCard, previewCrisisCard, previewCrisisCost } = require('../dist/cardSystem');
const { RELATIONSHIP_EVENTS, CRISIS_EVENTS, CRISIS_POOL_BY_STAGE } = require('../dist/gameCards');
const cfg = require('../dist/gameConfig');
const { calculateAnnualTax } = require('../dist/taxSystem');

test('薪資隨年資成長：青年 8%、SK ≥ 60 再 +2%、轉型期 1%、退休後停止；配偶收入同步成長', () => {
  const p = createPlayer('p', '玩家', 'teacher');
  p.currentAge = 24;
  applyRoundGrowth(p, LifeStage.Youth);
  assert.equal(p.salaryGrowthMultiplier, 1.08);
  p.stats.careerSkill = 60;
  applyRoundGrowth(p, LifeStage.Youth);
  assert.equal(p.salaryGrowthMultiplier, Math.round(1.08 * 1.10 * 1000) / 1000);
  p.spouse = { income: 30000, unemployedMonthsLeft: 0, retired: false };
  applyRoundGrowth(p, LifeStage.Transition);
  assert.equal(p.spouse.income, Math.round(30000 * 1.03));
  p.retirementStatus = 'retired';
  const before = p.salaryGrowthMultiplier;
  applyRoundGrowth(p, LifeStage.Retirement);
  assert.equal(p.salaryGrowthMultiplier, before, '退休後不再加薪');
  const game = new GameState('G');
  triggerPayday(p, game, false, false);
  p.retirementStatus = 'working';
  triggerPayday(p, game, false, false);
  assert.equal(p.salary, Math.round(p.profession.startingSalary * p.salaryGrowthMultiplier));
});

test('生活成本每輪 +3%，65 歲停止；生活方式與健康習慣改變支出、HP、體驗', () => {
  const p = createPlayer('p', '玩家', 'teacher');
  p.currentAge = 30;
  const base = p.expenses.otherExpenses;
  applyRoundGrowth(p, LifeStage.Youth);
  assert.equal(p.livingCostMultiplier, 1.03);
  assert.equal(p.livingExpenses, Math.round(base * 1.03));
  assert.equal(p.rentExpense, Math.round(p.expenses.rent * 1.03), '房租也隨物價上漲');
  p.currentAge = 66;
  applyRoundGrowth(p, LifeStage.Retirement);
  assert.equal(p.livingCostMultiplier, 1.03, '65 歲後物價停止上漲');
  p.lifestyle = 'lavish';
  assert.equal(p.livingExpenses, Math.round(base * 1.3 * 1.03));
  const exp = p.lifeExperience;
  applyRoundGrowth(p, LifeStage.Retirement);
  assert.equal(p.lifeExperience, exp + 5, '享受：每輪體驗 +5');
  p.lifestyle = 'frugal'; p.stats.health = 50;
  applyRoundGrowth(p, LifeStage.Retirement);
  assert.equal(p.stats.health, 48, '節儉：每輪 HP −2');
  p.lifestyle = 'normal'; p.healthHabit = 'active';
  assert.equal(p.livingExpenses, Math.round(base * 1.03) + 1500, '規律運動每月 +$1,500');
  const game = new GameState('G');
  p.stats.health = 80; p.currentAge = 30;
  triggerPayday(p, game, false, true);
  assert.equal(p.stats.health, 78, '青年衰退 4 → 規律運動減半為 2');
  p.healthHabit = 'overwork';
  triggerPayday(p, game, false, false);
  assert.equal(p.salary, Math.round(p.profession.startingSalary * p.salaryGrowthMultiplier * 1.05), '熬夜加班薪資 +5%');
});

test('子女支出依孩子年齡分段，成年後歸零；扶養扣除只算未成年', () => {
  const p = createPlayer('p', '玩家', 'teacher');
  p.currentAge = 30;
  applyBabyCard(p);
  assert.deepEqual(p.childBirthAges, [30]);
  assert.equal(p.childExpenses, 6000, '幼兒');
  p.currentAge = 40; assert.equal(p.childExpenses, 7500, '學齡');
  p.currentAge = 50; assert.equal(p.childExpenses, 12000, '大學');
  assert.equal(p.dependentChildren, 1);
  p.currentAge = 56; assert.equal(p.childExpenses, 0, '成年獨立');
  assert.equal(p.dependentChildren, 0);
  assert.equal(calculateAnnualTax(p).deductions.dependentDeduction, 0);
  assert.equal(p.numberOfChildren, 1, '家庭分仍算子女');
});

test('勞健保、保費隨年齡、高齡支出都進月支出；開局租屋不背房貸', () => {
  const p = createPlayer('p', '玩家', 'teacher');
  const game = new GameState('G');
  triggerPayday(p, game, false, false);
  assert.equal(p.socialInsurance, Math.round(p.salary * 0.05));
  assert.equal(p.expenses.homeMortgagePayment, 0);
  assert.equal(p.housing, 'rent');
  p.insurance.hasMedicalInsurance = true;
  p.currentAge = 30; const young = p.insurancePremiums;
  p.currentAge = 70; assert.equal(p.insurancePremiums, Math.round(young * 2.2), '退休期保費 ×2.2');
  p.retirementStatus = 'retired';
  assert.equal(p.socialInsurance, 0, '退休金不扣勞健保');
});

test('裁員月數依年齡：青年 2、成家 4、轉型 8；SK ≥ 60 減半', () => {
  const p = createPlayer('p', '玩家', 'teacher');
  p.currentAge = 28; assert.equal(getLayoffMonths(p), 2);
  p.currentAge = 40; assert.equal(getLayoffMonths(p), 4);
  p.currentAge = 55; assert.equal(getLayoffMonths(p), 8);
  p.stats.careerSkill = 60; assert.equal(getLayoffMonths(p), 4);
  p.currentAge = 70; assert.equal(getLayoffMonths(p), 0);
});

test('結婚建立配偶收入；配偶失業 6 個月；離婚分割現金並失去配偶', () => {
  const p = createPlayer('p', '玩家', 'teacher');
  p.cash = 400000; p.relationshipActive = true; p.relationshipPoints = 100;
  const r = confirmMarriage(p, 'love');
  assert.equal(r.success, true);
  assert.ok(p.spouse && p.spouse.income >= 17000 && p.spouse.income <= 102000, '配偶收入以實拿計（85%）');
  assert.equal(p.totalIncome, p.salary + p.marriageBonus + p.spouse.income);
  const unemployed = RELATIONSHIP_EVENTS.find((c) => c.effect.spouseEvent === 'unemployed');
  applyRelationshipCard(p, unemployed);
  assert.equal(p.spouse.unemployedMonthsLeft, 6);
  assert.equal(p.spouseIncome, 0);
  const game = new GameState('G');
  for (let i = 0; i < 6; i++) triggerPayday(p, game, false, false);
  assert.equal(p.spouseIncome, p.spouse.income, '6 個月後復職');
  const cashBefore = p.cash; const hpBefore = p.stats.health;
  const divorce = RELATIONSHIP_EVENTS.find((c) => c.effect.spouseEvent === 'divorce');
  const d = applyRelationshipCard(p, divorce);
  assert.equal(d.spouseEvent, 'divorce');
  assert.equal(p.isMarried, false);
  assert.equal(p.spouse, null);
  assert.equal(p.marriageBonus, 0);
  assert.equal(p.cash, cashBefore - Math.round(cashBefore * 0.25));
  assert.equal(p.stats.health, hpBefore - 10);
  // 未婚玩家抽到配偶卡：改套替代效果
  const single = createPlayer('s', '單身', 'teacher'); single.cash = 100000;
  const f = applyRelationshipCard(single, unemployed);
  assert.equal(single.cash, 80000);
  assert.equal(f.spouseEvent, undefined);
  assert.match(f.message, /好友失業/);
});

test('結婚：沒有額外紅利；配偶實拿收入、配偶生活費、房租變大、婚禮花費，現金不夠就簡單辦', () => {
  const p = createPlayer('p', '玩家', 'teacher');
  p.salary = p.profession.startingSalary;
  p.cash = 400000; p.relationshipActive = true; p.relationshipPoints = 100;
  const single = { income: p.totalIncome, expenses: p.totalExpenses, rent: p.rentExpense, living: p.livingExpenses };
  const preview = previewMarriageFinances(p);
  confirmMarriage(p, 'love');
  assert.equal(p.marriageBonus, 0, '不再有婚姻紅利');
  assert.equal(p.totalIncome, single.income + p.spouse.income);
  assert.equal(p.spouseLivingExpenses, single.living - 0, '配偶生活費與自己的生活支出基準相同');
  assert.equal(p.rentExpense, Math.round(single.rent * 1.5), '租屋換大一點');
  assert.equal(p.totalExpenses, single.expenses + p.spouseLivingExpenses + (p.rentExpense - single.rent));
  assert.ok(p.spouse.income >= preview.spouseMin && p.spouse.income <= preview.spouseMax, '實際配偶收入落在事前說明的範圍');
  assert.equal(preview.extraExpenses, p.spouseLivingExpenses + (p.rentExpense - single.rent));
  const net = p.monthlyCashflow - (single.income - single.expenses);
  assert.ok(net < p.spouse.income * 0.8, `淨增加要明顯小於配偶收入（淨增 ${net}，配偶 ${p.spouse.income}）`);
  const wedding = payWedding(p);
  assert.equal(wedding.cost, Math.max(60000, Math.round((p.salary + p.spouse.income) * 2 / 1000) * 1000));
  assert.equal(p.cash, 400000 - wedding.cost);
  assert.equal(wedding.simplified, false);
  // 現金不夠：簡單辦，只花掉手頭現金，不借錢
  const poor = createPlayer('q', '小資', 'teacher'); poor.salary = poor.profession.startingSalary;
  createSpouse(poor); poor.isMarried = true; poor.cash = 20000;
  const small = payWedding(poor);
  assert.equal(small.paid, 20000); assert.equal(small.simplified, true); assert.equal(poor.cash, 0);
});

test('父母事件：沒有保險可抵、人脈 ≥ 5 減半、長照變成 24 個月固定支出並逐月遞減', () => {
  const p = createPlayer('p', '玩家', 'teacher');
  p.cash = 500000; p.stats.network = 1;
  const care = CRISIS_EVENTS.find((c) => c.id === 'cr-010');
  assert.ok(CRISIS_POOL_BY_STAGE[LifeStage.Transition].includes('cr-010'));
  assert.ok(CRISIS_POOL_BY_STAGE[LifeStage.Family].includes('cr-009'));
  assert.equal(previewCrisisCost(p, care).effectiveCost, 60000);
  p.stats.network = 5;
  assert.equal(previewCrisisCost(p, care).effectiveCost, 30000, '人脈分攤減半');
  const before = p.totalExpenses;
  applyCrisisCard(p, care);
  assert.equal(p.recurringExpenses.length, 1);
  assert.equal(p.recurringExpenses[0].monthly, 6000, '長照月費也減半');
  assert.equal(p.totalExpenses, before + 6000);
  const game = new GameState('G');
  for (let i = 0; i < 24; i++) triggerPayday(p, game, false, false);
  assert.equal(p.recurringExpenses.length, 0, '24 個月後結束');
  assert.equal(p.totalExpenses, before);
});

test('自然壽命：80 歲前 0；之後依 HP 提高；年齡由回合同步', () => {
  const p = createPlayer('p', '玩家', 'teacher');
  p.currentAge = 79; assert.equal(naturalDeathProbability(p), 0);
  p.currentAge = 80; p.stats.health = 100; assert.equal(naturalDeathProbability(p), 0.04);
  p.stats.health = 60; assert.equal(Math.round(naturalDeathProbability(p) * 1000) / 1000, 0.14);
  p.stats.health = 20; assert.equal(Math.round(naturalDeathProbability(p) * 1000) / 1000, 0.24);
  const game = new GameState('G'); game.addPlayer(p); game.turnNumber = 15; p.startAge = 25;
  syncPlayerAges(game);
  assert.equal(p.currentAge, 80);
});

test('債券基金：不限額、配息依利率環境、利率變動重算配息、本金不受股市卡影響、賣出全額拿回不課稅', () => {
  const { investBondFund, BOND_FUND_ID, shiftBondRate, currentBondRate } = require('../dist/bondFund');
  const { sellAsset, applyGlobalEvent } = require('../dist/gameLogic');
  const { applyMarketCard } = require('../dist/cardSystem');
  const { MARKET_CARDS } = require('../dist/gameCards');
  const { ADMIN_GLOBAL_EVENTS } = require('../dist/adminEvents');
  const p = createPlayer('b', '存錢族', 'teacher');
  p.cash = 5_000_000;
  const game = new GameState('B'); game.addPlayer(p);
  assert.equal(currentBondRate(game), 0.03, '開局年殖利率 3%');
  assert.equal(investBondFund(p, 0).success, false);
  assert.equal(investBondFund(p, 9_000_000).success, false, '現金不足');
  const r1 = investBondFund(p, 3_000_000, currentBondRate(game));
  assert.equal(r1.success, true);
  assert.equal(r1.monthlyIncome, Math.round(3_000_000 * 0.03 / 12));
  const r2 = investBondFund(p, 1_000_000, currentBondRate(game));
  assert.equal(r2.principal, 4_000_000, '同一檔累加');
  assert.equal(p.assets.filter((a) => a.id === BOND_FUND_ID).length, 1);
  assert.equal(p.totalPassiveIncome, Math.round(4_000_000 * 0.03 / 12));
  // 降息：已持有的配息跟著重算；上下限 1%–5%
  assert.deepEqual(shiftBondRate(game, -0.01), { from: 0.03, to: 0.02 });
  assert.equal(p.totalPassiveIncome, Math.round(4_000_000 * 0.02 / 12));
  assert.equal(shiftBondRate(game, -0.05).to, 0.01, '不低於 1%');
  assert.equal(shiftBondRate(game, 0.2).to, 0.05, '不高於 5%');
  shiftBondRate(game, -0.02);
  // 通膨事件升息 1 個百分點
  applyGlobalEvent(game, ADMIN_GLOBAL_EVENTS.find((e) => e.id === 'inflation'));
  assert.equal(currentBondRate(game), 0.04);
  assert.equal(p.totalPassiveIncome, Math.round(4_000_000 * 0.04 / 12));
  applyMarketCard(game, MARKET_CARDS.find((c) => c.effect === 'PriceDecrease' && c.targetAssetType === 'Stock'));
  assert.equal(p.assets.find((a) => a.id === BOND_FUND_ID).currentValue, 4_000_000, '股災不影響本金');
  const cashBefore = p.cash;
  const sold = sellAsset(p, BOND_FUND_ID);
  assert.equal(sold.capitalGainsTax, 0);
  assert.equal(p.cash, cashBefore + 4_000_000);
  assert.ok(cfg.BOND_RATE_MAX_ANNUAL < 0.07, '最高利率仍低於定期定額');
});

test('交易規模跟著生活規模：依月支出放大、報酬率不變、牌庫原卡不被改動', () => {
  const { dealScaleFor, scaleDealCard } = require('../dist/cardSystem');
  const { SMALL_DEALS } = require('../dist/gameCards');
  const p = createPlayer('d', '老師', 'teacher'); p.salary = p.profession.startingSalary;
  const scale = dealScaleFor(p);
  assert.equal(scale, Math.min(8, Math.max(1, Math.round(p.totalExpenses / 16000 * 2) / 2)));
  assert.ok(scale >= 2, `老師的生活規模要放大交易（${scale}）`);
  const card = SMALL_DEALS[0];
  const before = JSON.stringify(card);
  const scaled = scaleDealCard(card, scale);
  assert.equal(JSON.stringify(card), before, '原卡不變');
  assert.equal(scaled.asset.monthlyCashflow, Math.round(card.asset.monthlyCashflow * scale / 10) * 10);
  assert.equal(scaled.asset.downPayment, Math.round(card.asset.downPayment * scale / 1000) * 1000);
  assert.equal(scaled.asset.liabilityAmount, scaled.asset.cost - scaled.asset.downPayment);
  const roi = (c) => c.asset.monthlyCashflow * 12 / c.asset.downPayment;
  assert.ok(Math.abs(roi(scaled) - roi(card)) < 0.01, '報酬率不變');
  const poor = createPlayer('q', '低支出', 'teacher'); poor.expenses.otherExpenses = 0; poor.expenses.rent = 0; poor.salary = 0;
  assert.equal(dealScaleFor(poor), 1, '最少 1 倍');
});

test('房東風險：空置期間沒有租金且逐月恢復、大修扣房價 2%、租屋族不受影響、自住房也要修', () => {
  const { rollPropertyEvent, rentalProperties } = require('../dist/propertyRisks');
  const seq = (...values) => { let i = 0; return () => values[i++ % values.length]; };
  const p = createPlayer('l', '房東', 'teacher');
  p.cash = 1_000_000;
  assert.equal(rollPropertyEvent(p, seq(0)), null, '沒有房子的人不會遇到');
  p.assets.push({ id: 'r1', name: '出租套房', type: 'RealEstate', cost: 675_000, currentValue: 675_000, monthlyCashflow: 2_500 });
  assert.equal(rentalProperties(p).length, 1);
  assert.equal(rollPropertyEvent(p, seq(0.9)), null, '沒擲中就照常抽意外支出卡');
  const passiveBefore = p.totalPassiveIncome;
  // 擲中（0）→ 事件類型 0.1（空置）→ 選第一間（0）
  const vacancy = rollPropertyEvent(p, seq(0, 0.1, 0));
  assert.equal(vacancy.kind, 'vacancy');
  assert.equal(p.totalPassiveIncome, passiveBefore - 2_500, '空置時被動收入少了這間的租金');
  const game = new GameState('L');
  for (let m = 0; m < cfg.PROPERTY_VACANCY_MONTHS; m++) triggerPayday(p, game, false, false);
  assert.equal(p.totalPassiveIncome, passiveBefore, '空置期滿恢復租金');
  // 大修：事件類型 0.5
  const cashBefore = p.cash;
  const repair = rollPropertyEvent(p, seq(0, 0.5, 0));
  assert.equal(repair.kind, 'repair');
  assert.equal(p.cash, cashBefore - Math.max(cfg.PROPERTY_REPAIR_MIN, Math.round(675_000 * cfg.PROPERTY_REPAIR_RATE)));
  // 調漲租金：事件類型 0.9
  const raise = rollPropertyEvent(p, seq(0, 0.9, 0));
  assert.equal(raise.kind, 'rentRaise');
  assert.equal(p.assets.find((a) => a.id === 'r1').monthlyCashflow, 2_500 + Math.round(2_500 * cfg.PROPERTY_RENT_RAISE_RATE));
  // 自住房也要修，但不會空置或調漲
  const owner = createPlayer('o', '屋主', 'teacher');
  owner.cash = 500_000;
  owner.assets.push({ id: 'home-o', name: '自住房', type: 'RealEstate', cost: 3_000_000, currentValue: 3_000_000, monthlyCashflow: 0, isResidence: true });
  const homeRepair = rollPropertyEvent(owner, seq(0, 0.1, 0));
  assert.equal(homeRepair.kind, 'repair');
  assert.equal(owner.cash, 500_000 - 60_000);
});

test('出國請假：固定班表的在職受僱者扣「月薪 × 請假月數」；自由行程、退休者只付旅費', () => {
  const { goTravel, travelLeaveCost, isOnPayrollSchedule } = require('../dist/gameLogic');
  const tokyo = cfg.TRAVEL_DESTINATIONS.find((d) => d.id === 'japan_tokyo');
  const taiwan = cfg.TRAVEL_DESTINATIONS.find((d) => d.id === 'taiwan_cycling');
  assert.equal(tokyo.leaveMonths, 1);
  assert.equal(taiwan.leaveMonths, 0.25);

  const teacher = createPlayer('e', '老師', 'teacher');
  teacher.salary = 49_000; teacher.cash = 200_000; teacher.stats.health = 80;
  assert.equal(isOnPayrollSchedule(teacher), true);
  const leave = travelLeaveCost(teacher, tokyo);
  assert.equal(leave, Math.round(49_000 * 1));
  const r = goTravel(teacher, 'japan_tokyo');
  assert.equal(r.success, true);
  assert.equal(r.leaveCost, leave);
  assert.equal(teacher.cash, 200_000 - tokyo.cost - leave);
  assert.equal(teacher.travelPenaltyRemaining, 0, '不再用下次薪水打折');

  const poor = createPlayer('p', '受僱者', 'teacher');
  poor.salary = 49_000; poor.cash = tokyo.cost + 1_000; poor.stats.health = 80;
  const denied = goTravel(poor, 'japan_tokyo');
  assert.equal(denied.success, false);
  assert.match(denied.message, /請假扣薪/);

  const owner = createPlayer('b', '老闆', 'restaurant_owner');
  owner.cash = 200_000; owner.stats.health = 80;
  assert.equal(isOnPayrollSchedule(owner), false);
  assert.equal(travelLeaveCost(owner, tokyo), 0);
  goTravel(owner, 'japan_tokyo');
  assert.equal(owner.cash, 200_000 - tokyo.cost, '企業主只付旅費');

  const retiree = createPlayer('r', '退休老師', 'teacher');
  retiree.retirementStatus = 'retired'; retiree.salary = 20_000;
  assert.equal(travelLeaveCost(retiree, tokyo), 0, '退休者不用請假');
});
