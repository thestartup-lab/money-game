const test = require('node:test');
const assert = require('node:assert/strict');

const {
  AssetType,
  GameState,
} = require('../dist/gameDataModels.js');
const {
  applyGlobalEvent,
  createPlayer,
  getCurrentAge,
} = require('../dist/gameLogic.js');

test('20 個完整回合會把全體年齡從 20 推進到 100', () => {
  const game = new GameState('ROUND20');
  const players = ['p1', 'p2', 'p3'].map((id) => createPlayer(id, id));
  players.forEach((player) => game.addPlayer(player));
  game.currentPlayerTurnId = players[0].id;

  for (let round = 1; round <= 20; round += 1) {
    players.forEach(() => game.advanceToNextTurn());
    assert.equal(game.turnNumber, round);
    assert.equal(getCurrentAge(game), 20 + round * 4);

    if (game.globalPaydayPending) {
      assert.equal(round % 3, 0);
      game.globalPaydayPending = false;
      game.roundsSinceGlobalPayday = 0;
      game.globalPaydayNumber += 1;
    }
  }

  assert.equal(getCurrentAge(game), 100);
  assert.equal(game.globalPaydayNumber, 6);
});

test('不同職涯起始年齡不會被全體回合年齡倒退', () => {
  const game = new GameState('AGESTART');
  const directCareer = createPlayer('direct', '直接就業');
  const educated = createPlayer('educated', '進修玩家');
  directCareer.startAge = 22;
  educated.startAge = 25;

  assert.equal(Math.max(directCareer.startAge, getCurrentAge(game)), 22);
  assert.equal(Math.max(educated.startAge, getCurrentAge(game)), 25);

  game.turnNumber = 2;
  assert.equal(getCurrentAge(game), 28);
  assert.equal(Math.max(directCareer.startAge, getCurrentAge(game)), 28);
  assert.equal(Math.max(educated.startAge, getCurrentAge(game)), 28);
});

test('自動難度事件會安全套用現金、健康、支出與資產變動', () => {
  const game = new GameState('ADAPTIVE');
  const player = createPlayer('p1', '測試玩家');
  player.cash = 10_000;
  player.stats.health = 4;
  player.expenses.otherExpenses = 1_000;
  player.assets.push({
    id: 'stock-1',
    name: '測試股票',
    type: AssetType.Stock,
    cost: 100_000,
    currentValue: 100_000,
    monthlyCashflow: 1_000,
  });
  game.addPlayer(player);

  applyGlobalEvent(game, {
    id: 'test-adaptive-event',
    title: '測試事件',
    description: '驗證所有新效果',
    effects: [
      { type: 'CashChange', flatAmount: 20_000 },
      { type: 'HealthChange', flatAmount: -10 },
      { type: 'ExpenseChange', flatAmount: -5_000 },
      { type: 'AssetValueChange', targetAssetType: AssetType.Stock, multiplier: 0.85 },
    ],
  });

  assert.equal(player.cash, 30_000);
  assert.equal(player.stats.health, 0);
  assert.equal(player.expenses.otherExpenses, 0);
  assert.equal(player.assets[0].currentValue, 85_000);
  assert.equal(game.marketEvents.at(-1).title, '測試事件');
});
