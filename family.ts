/**
 * 家庭行動（2026-10-01 起）：主動求子、領養、助養兒童、付費婚配、主動離婚。
 * 每個函式先回傳「不能做的原因」，手機顯示同一份原因，伺服器也用同一份把關。
 */
import type { GameState, Player } from './gameDataModels';
import {
  ADOPTED_CHILD_AGE, ADOPTION_COST, ADOPTION_MAX_AGE, DIVORCE_CASH_SHARE, DIVORCE_HP_COST, DIVORCE_LEGAL_FEE,
  FAMILY_TIE_CAP, FAMILY_TIE_SPONSOR_POINTS, FERTILITY_COST, FERTILITY_PROBABILITY_BASE, FERTILITY_PROBABILITY_PEAK,
  HP_ACTIVITY_THRESHOLDS, LIFE_EVENT_WINDOWS, MAX_CHILDREN, MAX_CHILD_AGE, MIN_CHILD_AGE, MIN_CHILD_SPACING_YEARS,
  SPONSOR_CHILD_MAX, SPONSOR_CHILD_MONTHLY, SPONSOR_CHILD_MONTHS, LIFE_EXP,
} from './gameConfig';
import { addLifeExperience, getArrangedMarriageCost, getCurrentAge } from './gameLogic';

export function personalAge(gs: GameState, player: Player): number {
  return Math.max(player.startAge ?? 20, Math.round(getCurrentAge(gs)));
}

export function addFamilyTies(player: Player, points: number): number {
  const before = player.familyTiePoints ?? 0;
  player.familyTiePoints = Math.min(FAMILY_TIE_CAP, before + points);
  return player.familyTiePoints - before;
}

function lastChildAge(player: Player): number | null {
  return player.childBirthAges.length ? Math.max(...player.childBirthAges) : null;
}

export function fertilityChance(gs: GameState, player: Player): number {
  const age = personalAge(gs, player);
  const w = LIFE_EVENT_WINDOWS.children;
  return age >= w.peakStart && age <= w.peakEnd ? FERTILITY_PROBABILITY_PEAK : FERTILITY_PROBABILITY_BASE;
}

export function fertilityBlock(gs: GameState, player: Player): string | null {
  const age = personalAge(gs, player);
  if (!player.isAlive) return '已離世。';
  if (!player.isMarried) return '結婚後才能主動求子；單身可以考慮領養。';
  if (age < MIN_CHILD_AGE || age > MAX_CHILD_AGE) return `主動求子限 ${MIN_CHILD_AGE}–${MAX_CHILD_AGE} 歲；可以考慮領養。`;
  if (player.numberOfChildren >= MAX_CHILDREN) return `最多 ${MAX_CHILDREN} 個孩子。`;
  if (player.stats.health < HP_ACTIVITY_THRESHOLDS.baby) return `健康需要 ${HP_ACTIVITY_THRESHOLDS.baby} 以上。`;
  const last = lastChildAge(player);
  if (last !== null && age - last < MIN_CHILD_SPACING_YEARS) return `距離上一個孩子還不到 ${MIN_CHILD_SPACING_YEARS} 年。`;
  if (player.lastFertilityRound === gs.turnNumber) return '這一輪已經嘗試過了。';
  if (player.cash < FERTILITY_COST) return `需要 $${FERTILITY_COST.toLocaleString()}（檢查、療程、備孕）。`;
  return null;
}

export function tryForBaby(gs: GameState, player: Player): { success: boolean; message: string } {
  player.cash -= FERTILITY_COST;
  player.lastFertilityRound = gs.turnNumber;
  const chance = fertilityChance(gs, player);
  if (Math.random() < chance) {
    player.numberOfChildren += 1;
    player.childBirthAges.push(personalAge(gs, player));
    addLifeExperience(player, LIFE_EXP.HAVE_CHILD);
    return { success: true, message: `主動求子成功，家裡多了一個孩子！（機率 ${Math.round(chance * 100)}%）` };
  }
  return { success: false, message: `這次沒有成功（機率 ${Math.round(chance * 100)}%），下一輪可以再試。` };
}

export function adoptionBlock(gs: GameState, player: Player): string | null {
  const age = personalAge(gs, player);
  if (!player.isAlive) return '已離世。';
  if (age > ADOPTION_MAX_AGE) return `領養限 ${ADOPTION_MAX_AGE} 歲以前。`;
  if (player.numberOfChildren >= MAX_CHILDREN) return `最多 ${MAX_CHILDREN} 個孩子。`;
  if (player.lastAdoptionRound === gs.turnNumber) return '這一輪已經領養過了。';
  if (player.cash < ADOPTION_COST) return `需要 $${ADOPTION_COST.toLocaleString()}（評估、法律程序、安置）。`;
  return null;
}

export function adoptChild(gs: GameState, player: Player): string {
  player.cash -= ADOPTION_COST;
  player.lastAdoptionRound = gs.turnNumber;
  player.numberOfChildren += 1;
  // 孩子 3 歲來到家裡：子女支出依孩子年齡分段計算
  player.childBirthAges.push(personalAge(gs, player) - ADOPTED_CHILD_AGE);
  addLifeExperience(player, LIFE_EXP.HAVE_CHILD);
  return `領養一個 ${ADOPTED_CHILD_AGE} 歲的孩子，家裡多了一位成員。子女支出與家庭分數和親生一樣。`;
}

export function sponsorBlock(player: Player): string | null {
  if (!player.isAlive) return '已離世。';
  if ((player.sponsoredChildren ?? 0) >= SPONSOR_CHILD_MAX) return `最多助養 ${SPONSOR_CHILD_MAX} 位孩子。`;
  return null;
}

export function sponsorChild(player: Player): string {
  player.sponsoredChildren = (player.sponsoredChildren ?? 0) + 1;
  player.recurringExpenses.push({ id: `sponsor-${player.sponsoredChildren}`, label: '助養兒童', monthly: SPONSOR_CHILD_MONTHLY, monthsLeft: SPONSOR_CHILD_MONTHS });
  const gained = addFamilyTies(player, FAMILY_TIE_SPONSOR_POINTS);
  addLifeExperience(player, 5);
  return `開始助養一位孩子：每月 $${SPONSOR_CHILD_MONTHLY.toLocaleString()}，持續 ${SPONSOR_CHILD_MONTHS / 12} 年。家庭連結 +${gained}、體驗 +5。`;
}

export function arrangedBlock(gs: GameState, player: Player): string | null {
  if (!player.isAlive) return '已離世。';
  if (player.isMarried) return '已婚。';
  if (player.isBedridden || player.stats.health < HP_ACTIVITY_THRESHOLDS.arrangedMarriage) return `健康需要 ${HP_ACTIVITY_THRESHOLDS.arrangedMarriage} 以上。`;
  const cost = getArrangedMarriageCost(personalAge(gs, player));
  if (player.cash < cost) return `需要 $${cost.toLocaleString()}。`;
  return null;
}

export function divorceBlock(player: Player): string | null {
  if (!player.isAlive) return '已離世。';
  if (!player.isMarried) return '未婚。';
  if (player.cash < DIVORCE_LEGAL_FEE) return `律師費需要 $${DIVORCE_LEGAL_FEE.toLocaleString()}。`;
  return null;
}

/** 主動離婚：律師費、財產分割（現金 25%）、失去配偶收入與配偶生活費、健康 −10；孩子留在身邊 */
export function fileDivorce(player: Player): string {
  player.cash -= DIVORCE_LEGAL_FEE;
  const split = Math.round(Math.max(0, player.cash) * DIVORCE_CASH_SHARE);
  player.cash -= split;
  const lostIncome = player.spouse?.income ?? 0;
  player.spouse = null;
  player.isMarried = false;
  player.marriageBonus = 0;
  player.marriageType = undefined;
  player.relationshipPoints = 0;
  player.relationshipActive = false;
  player.stats.health = Math.max(0, player.stats.health - DIVORCE_HP_COST);
  return `結束婚姻：律師費 $${DIVORCE_LEGAL_FEE.toLocaleString()}、財產分割 $${split.toLocaleString()}，每月少了配偶收入 $${lostIncome.toLocaleString()}，也不用再付配偶生活費；健康 −${DIVORCE_HP_COST}。孩子留在身邊。`;
}
