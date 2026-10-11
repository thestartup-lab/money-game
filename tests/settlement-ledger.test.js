const test = require('node:test');
const assert = require('node:assert/strict');
const { createPlayer, triggerPayday } = require('../dist/gameLogic');
const { GameState } = require('../dist/gameDataModels');
const { monthlyLedger } = require('../dist/settlementLedger');

test('每月實際入帳與分類相符，不重複計算投資內含貸款', () => {
  const p = createPlayer('p', '玩家', 'teacher');
  const g = new GameState('ledger');
  p.assets.push({ id: 'rental', name: '房產', type: 'RealEstate', cost: 100000, monthlyCashflow: -300, linkedLiabilityId: 'secured' });
  p.liabilities.push({ id: 'secured', name: '投資房貸', balance: 50000, monthlyPayment: 700 });
  for (let month = 0; month < 24; month++) {
    const before = p.cash;
    let ledger;
    triggerPayday(p, g, false, false, value => { ledger = monthlyLedger(value); });
    assert.equal(Object.values(ledger).reduce((a, b) => a + b, 0), p.cash - before);
  }
});
