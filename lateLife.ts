/**
 * 後半場目標（2026-09-29 起）：脫離內圈之後、離世之後，也還有事可做。
 * - 指導後輩：外圈玩家每輪可以在行動時間指導一位還在內圈的玩家（對方專長 +10），自己得到傳承與體驗。
 * - 家族顧問：離世的玩家可以在全場共同抉擇投票，也可以每輪給一位還在世的玩家一句建議。
 */
import type { GameState, Player } from './gameDataModels';
import { addLifeExperience } from './gameLogic';

export const MENTOR_SKILL_GAIN = 10;
export const MENTOR_RECIPIENT_LIFE_EXP = 3;
export const MENTOR_LIFE_EXP = 5;
export const MENTOR_LEGACY_POINTS = 5;
export const ADVICE_RECIPIENT_LIFE_EXP = 2;

export interface AdviceCard { id: string; emoji: string; text: string }

/** 家族顧問能給的建議（都對應遊戲裡做得到的事） */
export const ADVICE_CARDS: AdviceCard[] = [
  { id: 'emergency_fund', emoji: '🛟', text: '先留半年生活費當緊急預備金，再談投資。' },
  { id: 'insurance', emoji: '🛡️', text: '保險要在出事前買，醫療險和壽險先補上。' },
  { id: 'invest_self', emoji: '🎓', text: '趁年輕投資自己，進修和財商的回報最久。' },
  { id: 'take_the_deal', emoji: '🏘️', text: '看到報酬好的交易別只放債券，算清楚就出手。' },
  { id: 'health', emoji: '💪', text: '健康一旦掉下去很難拉回來，規律運動、定期維護。' },
  { id: 'family', emoji: '👨‍👩‍👧', text: '多陪陪家人，有些時間錯過就回不來。' },
  { id: 'travel', emoji: '✈️', text: '趁走得動去看看世界，體驗會跟著你一輩子。' },
  { id: 'debt', emoji: '🧾', text: '高利率的借款先還，別讓利息吃掉你的現金流。' },
];

export function adviceCard(id: string): AdviceCard | undefined {
  return ADVICE_CARDS.find((card) => card.id === id);
}

/** 可以指導別人的條件：在世、已進入外圈、這一輪還沒指導過 */
export function mentorBlockReason(gs: GameState, mentor: Player | undefined, target: Player | undefined): string | null {
  if (!mentor?.isAlive) return '只有仍在世的玩家可以指導後輩。';
  if (!mentor.isInFastTrack) return '進入外圈（第二人生）之後才能指導後輩。';
  if (mentor.lastMentorRound === gs.turnNumber) return '這一輪已經指導過了，下一輪再來。';
  if (!target || target.id === mentor.id) return '請選擇另一位玩家。';
  if (!target.isAlive) return '對方已離世。';
  if (target.isInFastTrack) return '對方已經在外圈，請指導還在內圈的玩家。';
  return null;
}

export function mentorPlayer(gs: GameState, mentor: Player, target: Player): string {
  mentor.lastMentorRound = gs.turnNumber;
  mentor.mentorCount = (mentor.mentorCount ?? 0) + 1;
  mentor.legacyBonusPoints += MENTOR_LEGACY_POINTS;
  // 指導後輩也算家庭連結（像長輩照顧晚輩）
  const { FAMILY_TIE_MENTOR_POINTS, FAMILY_TIE_CAP } = require('./gameConfig') as typeof import('./gameConfig');
  mentor.familyTiePoints = Math.min(FAMILY_TIE_CAP, (mentor.familyTiePoints ?? 0) + FAMILY_TIE_MENTOR_POINTS);
  addLifeExperience(mentor, MENTOR_LIFE_EXP);
  target.stats.careerSkill = Math.min(100, target.stats.careerSkill + MENTOR_SKILL_GAIN);
  addLifeExperience(target, MENTOR_RECIPIENT_LIFE_EXP);
  return `${mentor.name} 指導 ${target.name}：${target.name} 專長 +${MENTOR_SKILL_GAIN}、體驗 +${MENTOR_RECIPIENT_LIFE_EXP}；${mentor.name} 傳承 +${MENTOR_LEGACY_POINTS}、體驗 +${MENTOR_LIFE_EXP}。`;
}

/** 家族顧問給建議的條件：已離世、遊戲進行中、這一輪還沒給過 */
export function adviceBlockReason(gs: GameState, advisor: Player | undefined, target: Player | undefined, card: AdviceCard | undefined): string | null {
  if (!advisor) return '玩家不存在。';
  if (advisor.isAlive) return '家族顧問是離世玩家的角色；在世時請用祝賀或合夥互動。';
  if (advisor.lastAdviceRound === gs.turnNumber) return '這一輪已經給過建議了，下一輪再來。';
  if (!target?.isAlive) return '請選擇一位仍在世的玩家。';
  if (!card) return '沒有這則建議。';
  return null;
}

export function giveAdvice(gs: GameState, advisor: Player, target: Player, card: AdviceCard): void {
  advisor.lastAdviceRound = gs.turnNumber;
  advisor.adviceGiven = (advisor.adviceGiven ?? 0) + 1;
  addLifeExperience(target, ADVICE_RECIPIENT_LIFE_EXP);
}

/** 全場共同抉擇的投票人：在世玩家，加上仍連線的家族顧問（離世玩家） */
export function communityVoters(gs: GameState): Player[] {
  return [...gs.players.values()].filter((player) => player.isAlive || !player.isDisconnected);
}
