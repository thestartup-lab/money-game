// Compatibility fixtures explicitly exercise pre-v6 persisted rooms.
// New-board suites do NOT load this helper.
const models = require('../../dist/gameDataModels');
const Original = models.GameState;
models.GameState = class LegacyGameState extends Original {
  constructor(...args) {
    super(...args);
    this.boardJourneyEnabled = false;
    this.actionPhaseEnabled = true;
  }
};
