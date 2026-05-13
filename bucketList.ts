// ============================================================
// 人生夢想清單 (Bucket List)
// 玩家進入外圈（FastTrack）時隨機抽 3 個目標。
// 達成後 claimed=true，給予 lifeExperience + legacyBonusPoints 加成。
// 全部達成額外給一次性大獎。
// ============================================================

import type { Player, GameState } from './gameDataModels';
import { AssetType } from './gameConstants';

export interface BucketListGoal {
  id: string;
  emoji: string;
  title: string;
  description: string;
  /** 達成獎勵：legacy 點數 */
  legacyReward: number;
  /** 達成獎勵：生命體驗值 */
  lifeExpReward: number;
  /** 達成獎勵：現金（可選，當作達成的紀念禮金） */
  cashReward?: number;
  /** 達成條件檢查；回傳 true 表示已達成 */
  isAchieved: (player: Player, gs: GameState) => boolean;
}

// ----------------------------------------------------------
// 工具函數（避免 import socketServer 形成循環依賴）
// ----------------------------------------------------------
function netWorth(p: Player): number {
  const assetValue = p.assets.reduce((s, a) => s + (a.currentValue ?? a.cost), 0);
  const liabilityTotal = p.liabilities.reduce((s, l) => s + l.totalDebt, 0);
  return p.cash + assetValue - liabilityTotal;
}

// ----------------------------------------------------------
// 8 個夢想目標
// ----------------------------------------------------------
export const BUCKET_LIST_GOALS: BucketListGoal[] = [
  {
    id: 'world_traveler',
    emoji: '🌍',
    title: '環遊世界',
    description: '造訪 5 個不同的旅遊目的地。',
    legacyReward: 15,
    lifeExpReward: 30,
    cashReward: 20_000,
    isAchieved: (p) => (p.visitedDestinations?.length ?? 0) >= 5,
  },
  {
    id: 'philanthropist',
    emoji: '❤️',
    title: '慈善家',
    description: '累積慈善捐款達 $200,000。',
    legacyReward: 25,
    lifeExpReward: 20,
    isAchieved: (p) => (p.charityTotal ?? 0) >= 200_000,
  },
  {
    id: 'tycoon',
    emoji: '💰',
    title: '財富自由',
    description: '淨資產達到 $5,000,000。',
    legacyReward: 20,
    lifeExpReward: 25,
    cashReward: 50_000,
    isAchieved: (p) => netWorth(p) >= 5_000_000,
  },
  {
    id: 'family_man',
    emoji: '👨‍👩‍👧',
    title: '溫暖家庭',
    description: '結婚並擁有至少 2 個孩子。',
    legacyReward: 15,
    lifeExpReward: 30,
    cashReward: 15_000,
    isAchieved: (p) => p.isMarried && p.numberOfChildren >= 2,
  },
  {
    id: 'cashflow_king',
    emoji: '👑',
    title: '被動收入之王',
    description: '月被動收入達 $30,000 以上。',
    legacyReward: 18,
    lifeExpReward: 20,
    isAchieved: (p) => p.totalPassiveIncome >= 30_000,
  },
  {
    id: 'real_estate_baron',
    emoji: '🏘️',
    title: '不動產大亨',
    description: '同時擁有 3 個以上不動產資產。',
    legacyReward: 18,
    lifeExpReward: 15,
    cashReward: 30_000,
    isAchieved: (p) => p.assets.filter((a) => a.type === AssetType.RealEstate).length >= 3,
  },
  {
    id: 'high_fq',
    emoji: '🧠',
    title: '財商達人',
    description: '財商等級提升到 8 以上。',
    legacyReward: 15,
    lifeExpReward: 25,
    isAchieved: (p) => (p.stats?.financialIQ ?? 0) >= 8,
  },
  {
    id: 'long_life',
    emoji: '🎂',
    title: '長壽人生',
    description: '健康存活到 80 歲（依然在世且 HP > 0）。',
    legacyReward: 20,
    lifeExpReward: 25,
    isAchieved: (p) => {
      const age = (p.startAge ?? 20) + Math.floor((p.lifeExperience ?? 0) / 100);
      return age >= 80 && p.isAlive && (p.stats?.health ?? 0) > 0;
    },
  },
];

const BUCKET_GOAL_MAP: Record<string, BucketListGoal> = Object.fromEntries(
  BUCKET_LIST_GOALS.map((g) => [g.id, g])
);

export function getBucketGoal(id: string): BucketListGoal | undefined {
  return BUCKET_GOAL_MAP[id];
}

/**
 * 進入外圈時隨機抽 3 個夢想目標，覆寫 player.bucketList。
 * 重複進入（理論上不會）時會重新分配。
 */
export function assignBucketList(player: Player, count = 3): void {
  const pool = [...BUCKET_LIST_GOALS];
  const picked: BucketListGoal[] = [];
  const n = Math.min(count, pool.length);
  for (let i = 0; i < n; i++) {
    const idx = Math.floor(Math.random() * pool.length);
    picked.push(pool.splice(idx, 1)[0]);
  }
  player.bucketList = picked.map((g) => ({ id: g.id, claimed: false }));
}

export interface BucketCheckResult {
  newlyClaimed: BucketListGoal[];
  allDone: boolean;
  /** 全部完成時的一次性 bonus（首次完成所有 3 項才會給） */
  perfectBonus?: { legacy: number; lifeExp: number; cash: number };
}

/**
 * 檢查所有未達成的目標，達成則寫入 claimed=true 並回傳結果。
 * 達成條件實際應用獎勵（cash/lifeExp/legacy）由呼叫方一併處理（以便發送事件）。
 */
export function evaluateBucketList(player: Player, gs: GameState): BucketCheckResult {
  if (!player.bucketList || player.bucketList.length === 0) {
    return { newlyClaimed: [], allDone: false };
  }

  const newlyClaimed: BucketListGoal[] = [];
  let totalCash = 0;
  let totalLegacy = 0;
  let totalLifeExp = 0;

  for (const entry of player.bucketList) {
    if (entry.claimed) continue;
    const goal = BUCKET_GOAL_MAP[entry.id];
    if (!goal) continue;
    if (goal.isAchieved(player, gs)) {
      entry.claimed = true;
      entry.claimedAt = Date.now();
      newlyClaimed.push(goal);
      totalLegacy += goal.legacyReward;
      totalLifeExp += goal.lifeExpReward;
      totalCash += goal.cashReward ?? 0;
    }
  }

  if (newlyClaimed.length > 0) {
    player.legacyBonusPoints = (player.legacyBonusPoints ?? 0) + totalLegacy;
    player.lifeExperience = (player.lifeExperience ?? 0) + totalLifeExp;
    if (totalCash > 0) player.cash += totalCash;
  }

  const allDone = player.bucketList.every((e) => e.claimed);
  let perfectBonus: BucketCheckResult['perfectBonus'] | undefined;
  if (allDone && newlyClaimed.length > 0) {
    // 全部達成（且本次有新達成 → 屬於「最後一筆」），給予一次性大獎
    perfectBonus = { legacy: 30, lifeExp: 50, cash: 100_000 };
    player.legacyBonusPoints += perfectBonus.legacy;
    player.lifeExperience += perfectBonus.lifeExp;
    player.cash += perfectBonus.cash;
  }

  return { newlyClaimed, allDone, perfectBonus };
}
