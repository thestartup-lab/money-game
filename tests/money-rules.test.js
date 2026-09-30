// 部分賣出、用流動資產補頭期款、現金為負的處理與破產、生活支出校正
const test = require('node:test');
const assert = require('node:assert/strict');
const { createPlayer, sellAsset, LIVING_COST_CALIBRATION } = require('../dist/gameLogic');
const { GameState } = require('../dist/gameDataModels');
const { investBondFund } = require('../dist/bondFund');
const { liquidValue, raiseCashFromLiquid } = require('../dist/liquidity');
const { resolveNegativeCash } = require('../dist/bankruptcy');

function withDca(p, cost, value) {
  p.assets.push({ id: 'stock-dca', name: '指數股票基金（定期定額）', type: 'Stock', cost, currentValue: value, monthlyCashflow: 300 });
}

test('股票、基金、債券可以只賣一部分：成本、市值、配息等比例減少，只對賣出部分的獲利課稅', () => {
  const p = createPlayer('a', '甲', 'teacher'); p.cash = 0;
  withDca(p, 100_000, 200_000);
  const r = sellAsset(p, 'stock-dca', 0.25);
  assert.equal(r.success, true);
  assert.equal(r.proceeds, 50_000);
  assert.equal(r.capitalGainsTax, Math.round((50_000 - 25_000) * 0.2));
  const dca = p.assets.find((a) => a.id === 'stock-dca');
  assert.equal(dca.currentValue, 150_000); assert.equal(dca.cost, 75_000); assert.equal(dca.monthlyCashflow, 225);
  assert.equal(p.cash, 50_000 - 5_000);
  // 房地產等有貸款的資產只能整筆賣
  p.assets.push({ id: 'house-x', name: '公寓', type: 'RealEstate', cost: 1_000_000, currentValue: 1_000_000, monthlyCashflow: 3000, linkedLiabilityId: 'l1' });
  assert.equal(sellAsset(p, 'house-x', 0.5).success, false);
});

test('頭期款不夠時可以依序賣債券、基金補足', () => {
  const p = createPlayer('b', '乙', 'teacher'); p.cash = 100_000;
  investBondFund(p, 100_000, 0.03);
  withDca(p, 200_000, 200_000);
  assert.equal(liquidValue(p), 300_000);
  const raised = raiseCashFromLiquid(p, 250_000);
  assert.equal(raised.enough, true);
  assert.ok(p.cash >= 250_000);
  assert.equal(p.assets.find((a) => a.id === 'bond-fund'), undefined, '先賣債券');
  assert.ok(p.assets.find((a) => a.id === 'stock-dca').currentValue > 0, '基金只賣需要的部分');
});

test('現金為負：先賣流動資產，再應急借款，再賣其他投資；都不夠就破產重整但不出局', () => {
  const gs = new GameState('N');
  const p = createPlayer('c', '丙', 'teacher'); gs.addPlayer(p);
  p.cash = -50_000; withDca(p, 30_000, 30_000);
  const light = resolveNegativeCash(gs, p);
  assert.equal(light.bankrupt, false);
  assert.ok(p.cash >= 0, '賣基金加借款後回到正數');
  assert.ok(p.liabilities.some((l) => l.id.startsWith('emergency-')), '不夠的部分用應急借款');

  const q = createPlayer('d', '丁', 'teacher'); gs.addPlayer(q);
  q.creditScore = 300; q.liabilities.push({ id: 'emergency-old', name: '應急借款', totalDebt: 150_000, monthlyPayment: 3000 });
  q.cash = -2_000_000;
  const hp = q.stats.health;
  const heavy = resolveNegativeCash(gs, q);
  assert.equal(heavy.bankrupt, true);
  assert.equal(q.cash, 0); assert.equal(q.creditScore, 300); assert.equal(q.lifestyle, 'frugal');
  assert.equal(q.stats.health, Math.max(0, hp - 10));
  assert.equal(q.liabilities.some((l) => l.id.startsWith('emergency-')), false, '銀行欠款註銷');
  assert.equal(q.isAlive, true, '破產不出局');
  assert.equal(q.bankruptcies, 1);
  assert.equal(resolveNegativeCash(gs, q), null, '現金不為負就不處理');
});

test('生活支出逐職業校正：存錢率補到約 30%，原本就花很多的職業不加碼', () => {
  const byName = Object.fromEntries(LIVING_COST_CALIBRATION.map((r) => [r.name, r]));
  assert.equal(byName['老師'].after, byName['老師'].before * 2, '老師最多補到 2 倍');
  assert.equal(byName['財務顧問'].after, byName['財務顧問'].before, '財務顧問原本就花很多，不再加碼');
  for (const row of LIVING_COST_CALIBRATION) {
    assert.ok(row.after <= row.before * 2 && row.after >= row.before, `${row.name} 介於原本與 2 倍之間`);
  }
});
