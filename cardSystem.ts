import { Player, GameState, Asset, Liability, AssetType } from './gameDataModels';
import {
  DealCard,
  DoodadCard,
  CrisisCard,
  MarketCard,
  CharityCard,
  DownsizingCard,
  RelationshipCard,
} from './gameCards';
import { HP_DANGER_THRESHOLD, HP_STRONG_THRESHOLD } from './gameConfig';
import { addLifeExperience } from './gameLogic';

// ============================================================
// 結果介面
// ============================================================

export interface DoodadResult {
  card: DoodadCard;
  cashDeducted: number;
  monthlyExpenseIncrease: number;
}

export interface CrisisResult {
  card: CrisisCard;
  wasInsured: boolean;
  /** HP 修正後的實際費用 */
  effectiveCost: number;
  /** 造成的 turnsToSkip */
  turnsLost: number;
  deathTriggered: boolean;
}

export interface MarketResult {
  card: MarketCard;
  /** 每位玩家受影響的摘要：{ playerId, assetName, oldCost, newCost }[] */
  affectedAssets: {
    playerId: string;
    assetId: string;
    assetName: string;
    oldCost: number;
    newCost: number;
  }[];
}

// ============================================================
// 2-1 無需玩家決策的格子
// ============================================================

/**
 * 套用意外支出卡效果。
 * - OneTime: 直接從 cash 扣款。
 * - MonthlyIncrease: 增加 expenses.otherExpenses（totalExpenses getter 會自動反映）。
 */
export function applyDoodadCard(player: Player, card: DoodadCard): DoodadResult {
  const result: DoodadResult = { card, cashDeducted: 0, monthlyExpenseIncrease: 0 };

  if (card.expenseType === 'OneTime') {
    const deducted = Math.min(card.cost, player.cash);
    player.cash -= deducted;
    result.cashDeducted = deducted;
  } else {
    player.expenses.otherExpenses += card.cost;
    result.monthlyExpenseIncrease = card.cost;
  }

  return result;
}

/**
 * 套用添丁卡效果。
 * numberOfChildren += 1，totalExpenses getter 中的子女支出會自動反映。
 */
export function applyBabyCard(player: Player): void {
  player.numberOfChildren += 1;
}

/**
 * 套用裁員卡效果。
 * 設定 downsizingTurnsLeft，triggerPayday 中薪資將計為 0 並遞減。
 */
export function applyDownsizingCard(player: Player, card: DownsizingCard): void {
  player.downsizingTurnsLeft = card.turnsWithoutSalary;
}

/**
 * 套用市場行情卡。
 * 影響所有玩家符合 targetAssetType 的資產**市值（currentValue）**。
 * cost（購入成本）保持不變，出售時以 currentValue 計算獲利。
 * SellOpportunity 類型不改變市值，由前端通知玩家自行決定是否出售。
 */
export function applyMarketCard(gameState: GameState, card: MarketCard): MarketResult {
  const result: MarketResult = { card, affectedAssets: [] };

  if (card.effect === 'SellOpportunity') {
    return result;
  }

  const multiplier = card.priceMultiplier ?? 1;

  gameState.players.forEach((player) => {
    player.assets.forEach((asset) => {
      if (asset.type === card.targetAssetType) {
        const oldValue = asset.currentValue;
        asset.currentValue = Math.round(asset.currentValue * multiplier);
        result.affectedAssets.push({
          playerId: player.id,
          assetId: asset.id,
          assetName: asset.name,
          oldCost: oldValue,
          newCost: asset.currentValue,
        });
      }
    });
  });

  return result;
}

// ============================================================
// 2-2 需要玩家決策的格子
// ============================================================

/**
 * 玩家接受交易卡（選擇購買）。
 * 建立 Asset（含 linkedLiabilityId）與對應 Liability，從 cash 扣除 downPayment。
 * 若 downPayment 為 0（全額付清），則不建立 Liability。
 */
export function acceptDealCard(player: Player, card: DealCard): void {
  const { asset: cardAsset } = card;

  const assetId = `asset-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  let linkedLiabilityId: string | undefined;

  if (cardAsset.liabilityAmount && cardAsset.liabilityAmount > 0) {
    const liabilityId = `liab-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const liability: Liability = {
      id: liabilityId,
      name: cardAsset.liabilityName ?? `${cardAsset.name}貸款`,
      totalDebt: cardAsset.liabilityAmount,
      monthlyPayment: Math.round(cardAsset.liabilityAmount * 0.005),
    };
    player.liabilities.push(liability);
    linkedLiabilityId = liabilityId;
  }

  const asset: Asset = {
    id: assetId,
    name: cardAsset.name,
    type: cardAsset.assetType,
    cost: cardAsset.cost,
    downPayment: cardAsset.downPayment,
    monthlyCashflow: cardAsset.monthlyCashflow,
    currentValue: cardAsset.cost,
    linkedLiabilityId,
  };

  player.assets.push(asset);

  const payment = cardAsset.downPayment ?? cardAsset.cost;
  player.cash -= payment;
}

/**
 * 套用慈善捐款。
 * - donate: 從 cash 扣除月薪的 donationPercentage，並設定 bonusDice。
 * - 不捐：不做任何事。
 */
export function applyCharityDonation(
  player: Player,
  card: CharityCard,
  donate: boolean
): void {
  if (!donate) return;
  const donationAmount = Math.round(player.salary * card.donationPercentage);
  player.cash -= Math.min(donationAmount, player.cash);
  player.bonusDice = card.bonusDiceCount;
}

// ============================================================
// 2-3 危機卡（含 HP 修正 + 保險 + 死亡）
// ============================================================

/**
 * HP 修正倍率表：
 * HP > HP_STRONG_THRESHOLD (70)  → ×0.5，extra skip 0
 * HP 31–70                       → ×1.0，extra skip 0
 * HP ≤ HP_DANGER_THRESHOLD (30)  → ×1.5，extra skip +1
 * HP = 0                         → ×2.0 + $75,000，extra skip +2
 */
function calcHPModifier(hp: number): { costMultiplier: number; flatBonus: number; extraTurns: number } {
  if (hp <= 0)                          return { costMultiplier: 2.0, flatBonus: 75_000, extraTurns: 2 };
  if (hp <= HP_DANGER_THRESHOLD)        return { costMultiplier: 1.5, flatBonus: 0,    extraTurns: 1 };
  if (hp <= HP_STRONG_THRESHOLD)        return { costMultiplier: 1.0, flatBonus: 0,    extraTurns: 0 };
  return                                       { costMultiplier: 0.5, flatBonus: 0,    extraTurns: 0 };
}

/**
 * 套用危機卡效果（含 HP 修正與死亡判定）。
 *
 * 死亡觸發條件：card.canCauseDeath && !wasInsured && player.cash < effectiveCost
 * 若死亡觸發，呼叫方須繼續呼叫 handlePlayerDeath。
 */
export function applyCrisisCard(player: Player, card: CrisisCard): CrisisResult {
  const hp = player.stats.health;
  const wasInsured = player.insurance[card.requiredInsurance];

  const hpMod = calcHPModifier(hp);

  let effectiveCost: number;
  let baseTurns: number;

  if (wasInsured) {
    effectiveCost = card.insuredCost;
    baseTurns = card.turnsLostWithInsurance;
  } else {
    effectiveCost = Math.round(card.baseCost * hpMod.costMultiplier) + hpMod.flatBonus;
    baseTurns = card.turnsLostWithoutInsurance + hpMod.extraTurns;
  }

  const deathTriggered = card.canCauseDeath && !wasInsured && player.cash < effectiveCost;

  if (!deathTriggered) {
    player.cash -= Math.min(effectiveCost, player.cash);
    player.turnsToSkip += baseTurns;
  }

  return {
    card,
    wasInsured,
    effectiveCost,
    turnsLost: baseTurns,
    deathTriggered,
  };
}

// ============================================================
// 2-4 死亡終局處理
// ============================================================

/**
 * 執行玩家死亡：標記為死亡並從遊戲中移除。
 * 死亡一律為終局結算，不再有重生機制。
 * 呼叫方應在此之後立即呼叫 calculateLifeScore 計算最終評分（含傳承分）。
 */
export function handlePlayerDeath(player: Player, gameState: GameState): void {
  player.isAlive = false;
  gameState.removePlayer(player.id);
}

// ============================================================
// 2-5 老鼠賽跑脫出判定
// ============================================================

/**
 * 判斷玩家是否達到脫出老鼠賽跑的條件。
 * 條件：totalPassiveIncome >= totalExpenses（被動收入 ≥ 總支出）
 */
export function checkRatRaceEscape(player: Player): boolean {
  return player.totalPassiveIncome >= player.totalExpenses;
}

// ============================================================
// 人際關係事件卡套用
// ============================================================

export interface RelationshipResult {
  /** 事件套用後的描述訊息（給玩家看）*/
  message: string;
  /** NT 人脈值實際變化量 */
  networkDelta: number;
  /** 體驗值增加量 */
  lifeExpGain: number;
  /** 現金變化量（負數=扣錢）*/
  cashChange: number;
  /** 月現金流變化量（永久）*/
  monthlyCashflowDelta: number;
  /** 薪資倍率（僅暫時效果時才有值）*/
  salaryMultiplier?: number;
  /** 薪資倍率持續回合數 */
  turnsAffected?: number;
  /** 是否應觸發婚姻視窗（由 socketServer 判斷是否繼續）*/
  triggerMarriageWindow: boolean;
  /** 是否應觸發額外 SmallDeal 抽牌 */
  triggerSmallDeal: boolean;
  /** 擲骰賭注的結果（undefined 表示非賭注型）*/
  gambleOutcome?: 'success' | 'failure';
}

/**
 * 套用人際關係事件卡效果。
 * @param player     目標玩家
 * @param card       抽到的 RelationshipCard
 * @param diceResult 骰子點數（賭注型事件必須傳入；非賭注型可略）
 * @returns          結果摘要，供 socketServer 廣播給客戶端
 */
export function applyRelationshipCard(
  player: Player,
  card: RelationshipCard,
  diceResult?: number,
): RelationshipResult {
  const e = card.effect;
  let cashChange         = 0;
  let networkDelta       = e.networkDelta       ?? 0;
  let lifeExpGain        = e.lifeExpGain        ?? 0;
  let monthlyCashflowDelta = e.monthlyCashflowDelta ?? 0;
  let gambleOutcome: 'success' | 'failure' | undefined;
  let message            = card.description;

  // 立即現金扣除
  if (e.cashCost) {
    const actual = Math.min(e.cashCost, player.cash);
    player.cash -= actual;
    cashChange  -= actual;
  }

  // NT 人脈值變化（nt_driven 職業無上限；其他職業上限 10）
  if (networkDelta !== 0) {
    const ntCap = player.profession.salaryType === 'nt_driven' ? Infinity : 10;
    player.stats.network = Math.max(0, Math.min(ntCap, player.stats.network + networkDelta));
  }

  // 生命體驗值
  if (lifeExpGain > 0) {
    addLifeExperience(player, lifeExpGain);
  }

  // 永久月現金流變化（rel-012 子女支出改善）
  if (monthlyCashflowDelta !== 0) {
    player.expenses.otherExpenses = Math.max(
      0,
      player.expenses.otherExpenses - monthlyCashflowDelta,
    );
  }

  // 擲骰賭注型（rel-004 朋友創業邀請）
  if (e.gambleSuccess) {
    const roll = diceResult ?? Math.ceil(Math.random() * 6);
    if (roll >= e.gambleSuccess.threshold) {
      gambleOutcome = 'success';
      // 成功：新增月被動收入（以新資產形式加入）
      // 啟動資金 = 失敗時會損失的現金；成功時亦扣除作為入股
      const investAmount = e.gambleSuccess.failureCashLoss;
      const actualInvest = Math.min(investAmount, player.cash);
      player.cash -= actualInvest;
      cashChange  -= actualInvest;
      const newAsset: Asset = {
        id:               `rel-gamble-${Date.now()}`,
        name:             '創業股份',
        type:             AssetType.Business,
        cost:             investAmount,
        currentValue:     investAmount,
        downPayment:      investAmount,
        monthlyCashflow:  e.gambleSuccess.successCashflow,
      };
      player.assets.push(newAsset);
      message = `${card.title}：擲出 ${roll}，創業成功！每月被動收入 +$${e.gambleSuccess.successCashflow}。`;
    } else {
      gambleOutcome = 'failure';
      const loss = Math.min(e.gambleSuccess.failureCashLoss, player.cash);
      player.cash -= loss;
      cashChange  -= loss;
      message = `${card.title}：擲出 ${roll}，創業失敗！損失 $${loss}。`;
    }
  }

  return {
    message,
    networkDelta,
    lifeExpGain,
    cashChange,
    monthlyCashflowDelta,
    salaryMultiplier:  e.salaryMultiplier,
    turnsAffected:     e.turnsAffected,
    triggerMarriageWindow: !!(e.triggerMarriageWindow && !player.isMarried && player.stats.health >= 30),
    triggerSmallDeal:  !!(e.triggerSmallDeal),
    gambleOutcome,
  };
}
