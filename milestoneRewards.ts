import type { Player } from './gameDataModels';

/** Compare security relative to personal living costs, not nominal wealth or family size. */
export function balancedMilestoneReview(p: Player, netWorth: number) {
  const expenses = Math.max(1,p.totalExpenses);
  return {
    family: Math.min(25,Math.max((p.isMarried ? 10 : 0)+p.numberOfChildren*5,Math.floor((p.familyTiePoints??0)/2))),
    wealth: (netWorth>=expenses*36 ? 10 : 0)+(netWorth>=expenses*180 ? 15 : 0)
      +(p.totalPassiveIncome>=expenses*0.5 ? 10 : 0),
    health: p.stats.health>=70 ? 10 : 0,
    legacy: p.charityTotal>=expenses*2 ? 10 : 0,
  };
}
