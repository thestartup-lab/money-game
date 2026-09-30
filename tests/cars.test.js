// 交通與車子：不強制買車、交通費隨家庭人數、買車貸款或現金、養車費、折舊、賣二手車
const test = require('node:test');
const assert = require('node:assert/strict');
const { createPlayer, createSpouse, sellAsset } = require('../dist/gameLogic');
const cars = require('../dist/cars');
const cfg = require('../dist/gameConfig');

test('開局不強制買車：一般職業沒有車貸、付交通費；靠車工作的職業有工作用車', () => {
  const t = createPlayer('t', '老師', 'teacher');
  assert.equal(t.car, null); assert.equal(t.expenses.carLoanPayment, 0);
  assert.equal(t.transportExpense, cfg.TRANSPORT_BASE_MONTHLY);
  const taxi = createPlayer('x', '司機', 'taxi_driver');
  assert.equal(taxi.car.workVehicle, true); assert.ok(taxi.expenses.carLoanPayment > 0);
  const rider = createPlayer('r', '外送', 'delivery_rider');
  assert.equal(rider.car.optionId, 'scooter');
});

test('交通費：配偶與每個未成年孩子各多一半', () => {
  const p = createPlayer('p', '玩家', 'teacher'); p.currentAge = 35;
  p.isMarried = true; createSpouse(p); p.numberOfChildren = 2; p.childBirthAges = [30, 33];
  assert.equal(p.transportExpense, Math.round(cfg.TRANSPORT_BASE_MONTHLY * (1 + 0.5 + 1)));
});

test('買車：貸款付頭期款、每月車貸加養車費、不用付交通費；現金買沒有車貸；賣二手車先還車貸', () => {
  const p = createPlayer('p', '玩家', 'teacher'); p.cash = 3_000_000;
  const offer = cars.getCarOffers(p).find((o) => o.id === 'economy');
  assert.equal(offer.downPayment, 120_000);
  const r = cars.buyCar(p, 'economy', false);
  assert.equal(r.success, true);
  assert.equal(p.cash, 3_000_000 - 120_000);
  assert.equal(p.expenses.carLoanPayment, offer.loanMonthly);
  assert.equal(p.transportExpense, 5_000, '改付養車費');
  assert.match(cars.buyCar(p, 'sports', true).message, /先賣掉/);
  cars.ageCar(p, 4);
  const value = Math.round(600_000 * Math.pow(0.85, 4));
  assert.equal(p.assets.find((a) => a.id.startsWith('car-')).currentValue, value, '四年折舊');
  const cashBefore = p.cash;
  const sold = sellAsset(p, p.assets.find((a) => a.id.startsWith('car-')).id);
  assert.equal(sold.success, true);
  assert.equal(p.cash, cashBefore + value - offer.loan, '二手價扣掉車貸');
  assert.equal(p.car, null); assert.equal(p.expenses.carLoanPayment, 0);
  const lifeExp = p.lifeExperience;
  p.cash = 10_000_000;
  cars.buyCar(p, 'sports', true);
  assert.equal(p.expenses.carLoanPayment, 0, '現金買沒有車貸');
  cars.ageCar(p, 4);
  assert.equal(p.lifeExperience, lifeExp + 10 + 8, '跑車買時 +10、每輪 +8');
});
