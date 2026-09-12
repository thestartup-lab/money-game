const test = require('node:test');
const assert = require('node:assert/strict');
const { validateSocketPayload } = require('../dist/socketValidation');
const { repayRoomLoan, validatePlayerLoan } = require('../dist/playerLoans');
const { createPlayer, sellAsset } = require('../dist/gameLogic');

test('異常 Socket 輸入：空值、錯誤型別、非有限數字、負數金額都被攔截', () => {
  for (const value of [null, [], 'hello', 12, undefined, {}, { playerName: {}, roomCode: 'ROOM01' }]) {
    assert.equal(validateSocketPayload('playerJoin', value), false);
  }
  for (const amount of [-1, 0, NaN, Infinity, '1000', 1.5]) {
    assert.equal(validateSocketPayload('loanOffer', { targetPlayerId: 'p', amount, monthlyRate: 0.01 }), false);
  }
  assert.equal(validateSocketPayload('setPlayerStats', { targetPlayerId: 'p', stats: { hp: 'wrong' } }), false);
  assert.equal(validateSocketPayload('allocateGrowthStats', { academic: -1, health: 1, social: 1, resource: 1 }), false);
  assert.equal(validateSocketPayload('playerJoin', { playerName: '阿明', roomCode: 'ROOM01' }), true);
  assert.equal(validateSocketPayload('playerRoll', undefined), true);
});

test('P2P 部分還款與全額清償會同步本金、現金與利息，而且債權不能重複變現', () => {
  const lender = createPlayer('lender', '貸方');
  const borrower = createPlayer('borrower', '借方');
  lender.cash = 9000; borrower.cash = 11000;
  lender.assets = [{ id: 'p2p-test', name: '借款', type: 'Other', cost: 1000, currentValue: 1000, monthlyCashflow: 10 }];
  borrower.liabilities = [{ id: 'p2p-test', name: '借款', totalDebt: 1000, monthlyPayment: 10, monthlyRate: 0.01 }];
  assert.equal(sellAsset(lender, 'p2p-test').success, false);
  const initialTotal = lender.cash + borrower.cash;
  assert.equal(repayRoomLoan([lender, borrower], borrower, 'p2p-test', 400).success, true);
  assert.equal(lender.cash, 9400);
  assert.equal(lender.assets[0].currentValue, 600);
  assert.equal(lender.assets[0].monthlyCashflow, 6);
  assert.equal(borrower.liabilities[0].monthlyPayment, 6);
  assert.equal(repayRoomLoan([lender, borrower], borrower, 'p2p-test', NaN).success, false);
  assert.equal(repayRoomLoan([lender, borrower], borrower, 'p2p-test', 1000).fullyRepaid, true);
  assert.equal(lender.cash, 10000);
  assert.equal(lender.assets.length, 0);
  assert.equal(borrower.liabilities.length, 0);
  assert.equal(lender.cash + borrower.cash, initialTotal);
  assert.equal(repayRoomLoan([lender, borrower], borrower, 'p2p-test', 1000).success, false);
});

test('借貸成立時必須重新確認信用、利率、身分與現金', () => {
  const a = createPlayer('a', '甲'), b = createPlayer('b', '乙');
  a.cash = 10000; b.liabilities = [];
  assert.equal(validatePlayerLoan(a, b, 1000, 0.01), null);
  assert.ok(validatePlayerLoan(a, a, 1000, 0.01));
  assert.ok(validatePlayerLoan(a, b, 1000, NaN));
  assert.ok(validatePlayerLoan(a, b, 10001, 0.01));
  b.isAlive = false;
  assert.ok(validatePlayerLoan(a, b, 1000, 0.01));
});
