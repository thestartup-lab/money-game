const test = require('node:test');
const assert = require('node:assert/strict');
const { GameState, GamePhase, AssetType } = require('../dist/gameDataModels');
const { createPlayer, applyGlobalEvent } = require('../dist/gameLogic');
const { ADMIN_GLOBAL_EVENT_MAP } = require('../dist/adminEvents');
const { expireWorldEffects, worldEventRestriction, hasFragilePlayers } = require('../dist/worldEvents');
const { acceptDealCard } = require('../dist/cardSystem');

test('拍賣得標僅扣得標價，直接購買仍扣原始頭期款', () => {
  const player = createPlayer('buyer', '得標者');
  player.cash = 200000;
  const card = { asset: { name: '店面', assetType: AssetType.RealEstate, cost: 300000,
    downPayment: 60000, liabilityAmount: 240000, monthlyCashflow: 2000 } };
  acceptDealCard(player, card, 75000);
  assert.equal(player.cash, 125000);
  assert.equal(player.assets.length, 1);
  assert.equal(player.liabilities.length, 1);
  assert.equal(player.assets[0].currentValue, 300000);
  acceptDealCard(player, card);
  assert.equal(player.cash, 65000);
});

test('疫情期限跨兩次全體發薪，期間新增／出售資產與原始收入變動不會被回復覆蓋', () => {
  const game = new GameState('WORLD');
  const player = createPlayer('p', '玩家');
  game.addPlayer(player);
  player.assets = [{ id: 'a', name: '商店', type: AssetType.Business, currentValue: 100000, cost: 100000, monthlyCashflow: 10000 }];
  const expenses = player.totalExpenses;
  applyGlobalEvent(game, ADMIN_GLOBAL_EVENT_MAP.get('pandemic'));
  assert.equal(player.totalPassiveIncome, 4000);
  assert.equal(player.totalExpenses, expenses + 6000);
  assert.equal(player.assets[0].monthlyCashflow, 10000);
  player.assets[0].monthlyCashflow = 12000;
  player.assets.push({ id: 'b', name: '新商店', type: AssetType.Business, currentValue: 50000, cost: 50000, monthlyCashflow: 5000 });
  assert.equal(player.totalPassiveIncome, 6800);
  game.globalPaydayNumber = 1;
  assert.deepEqual(expireWorldEffects(game), []);
  player.assets.shift();
  assert.equal(player.totalPassiveIncome, 2000);
  game.globalPaydayNumber = 2;
  assert.deepEqual(expireWorldEffects(game), ['全球疫情爆發']);
  assert.equal(player.totalPassiveIncome, 5000);
  assert.equal(player.totalExpenses, expenses);
  assert.equal(player.eventLog.filter((event) => event.type === 'global_event').length, 2);
  assert.deepEqual(expireWorldEffects(game), []);
});

test('股災市值重定價保留，股息在期限結束後恢復；已故玩家不受新事件影響', () => {
  const game = new GameState('STOCK');
  const player = createPlayer('p', '玩家');
  const deceased = createPlayer('d', '已故玩家');
  deceased.isAlive = false;
  const cash = deceased.cash;
  game.addPlayer(player); game.addPlayer(deceased);
  player.assets = [{ id: 's', name: '股票', type: AssetType.Stock, currentValue: 100000, cost: 100000, monthlyCashflow: 1000 }];
  applyGlobalEvent(game, ADMIN_GLOBAL_EVENT_MAP.get('stock_crash'));
  assert.equal(player.assets[0].currentValue, 50000);
  assert.equal(player.totalPassiveIncome, 700);
  game.globalPaydayNumber = 2; expireWorldEffects(game);
  assert.equal(player.assets[0].currentValue, 50000);
  assert.equal(player.totalPassiveIncome, 1000);
  assert.equal(deceased.cash, cash); assert.equal(deceased.eventLog.length, 0);
});

test('世界事件限制涵蓋階段、每季額度、重複間隔、重大事件上限及脆弱玩家辨識', () => {
  const game = new GameState('LIMIT');
  const event = ADMIN_GLOBAL_EVENT_MAP.get('inflation');
  assert.match(worldEventRestriction(game, event), /遊戲開始後/);
  game.gamePhase = GamePhase.RatRace;
  assert.equal(worldEventRestriction(game, event), null);
  game.worldEventHistory.push({ eventId: 'inflation', payday: 0 });
  assert.match(worldEventRestriction(game, event), /本季/);
  game.globalPaydayNumber = 1;
  assert.match(worldEventRestriction(game, event), /間隔/);
  game.globalPaydayNumber = 2;
  assert.equal(worldEventRestriction(game, event), null);
  game.worldEventHistory.push({ eventId: 'stock_crash', payday: 0, major: true }, { eventId: 'pandemic', payday: 1, major: true });
  assert.match(worldEventRestriction(game, ADMIN_GLOBAL_EVENT_MAP.get('stock_crash')), /本場已使用/);
  assert.match(worldEventRestriction(game, ADMIN_GLOBAL_EVENT_MAP.get('natural_disaster')), /兩次重大/);
  const player = createPlayer('p', '玩家'); game.addPlayer(player);
  player.expenses.otherExpenses = 1000;
  player.cash = 0; assert.equal(hasFragilePlayers(game), true);
  player.cash = 1000000; player.stats.health = 80; assert.equal(hasFragilePlayers(game), false);
  game.finalRoundStarted = true; assert.match(worldEventRestriction(game, event), /最後一輪/);
});
