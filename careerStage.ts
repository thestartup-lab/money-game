import { Player } from './gameDataModels';
import { HP_ACTIVITY_THRESHOLDS, SKILL_CAREER_CHANGE_THRESHOLD } from './gameConfig';
import { executeCareerChange } from './statsSystem';

/** Preview with the same calculation as execution; never mutate the real player. */
export function previewCareerChange(player: Player, professionId: string) {
  if (!player.isAlive || player.isBedridden) return { error: '角色已出局或臥床，無法轉職。' };
  if (player.stats.health < HP_ACTIVITY_THRESHOLDS.careerChange) return { error: '健康需至少 30 才能轉職。' };
  if (player.stats.careerSkill < SKILL_CAREER_CHANGE_THRESHOLD) return { error: '職涯技能需達 100 才能轉職。' };
  const projected: Player = Object.assign(Object.create(Object.getPrototypeOf(player)), structuredClone(player));
  const result = executeCareerChange(projected, professionId);
  if (!result.success) return { error: result.message };
  const debt = (p: Player) => p.liabilities.reduce((sum, item) => sum + item.totalDebt, 0);
  const money = (value: number) => '$' + Math.round(value).toLocaleString('zh-TW');
  return { projected, description: [
    `${player.profession.name} → ${projected.profession.name}`,
    `月薪：${money(player.salary)} → ${money(projected.salary)}`,
    `月支出：${money(player.totalExpenses)} → ${money(projected.totalExpenses)}`,
    `月現金流：${money(player.monthlyCashflow)} → ${money(projected.monthlyCashflow)}`,
    `本次支付：${money(player.cash - projected.cash)}；新增貸款：${money(debt(projected) - debt(player))}`,
    '轉職後 SK 歸零；原有資產、負債保留。請本人確認，主持人揭曉後才生效。',
  ].join('\n') };
}
