import type { GameState, Player } from './gameDataModels';
export function effectSnapshot(p: Player) {
  return { 現金:p.cash, 資產估值:p.assets.reduce((n,a)=>n+(a.currentValue??a.cost),0), 負債:p.liabilities.reduce((n,l)=>n+l.totalDebt,0), 月收入:p.totalIncome,
    月支出:p.totalExpenses, 月現金流:p.monthlyCashflow, HP:p.stats.health, SK:p.stats.careerSkill,
    FQ:p.stats.financialIQ, NT:p.stats.network, 體驗:p.lifeExperience, 關係:p.relationshipPoints,
    家庭連結:p.familyTiePoints??0, 傳承:p.legacyBonusPoints, 子女:p.numberOfChildren };
}
export function captureBoardEffects(gs: GameState) {
  return new Map([...gs.players.values()].map(p=>[p.id,effectSnapshot(p)]));
}
export function describeBoardEffects(gs: GameState, before: ReturnType<typeof captureBoardEffects>): string {
  const lines:string[]=[];
  for(const p of gs.players.values()) {
    const old=before.get(p.id); if(!old)continue;
    const now=effectSnapshot(p);
    const changes=(Object.keys(now) as (keyof typeof now)[]).filter(k=>Math.abs(now[k]-old[k])>0.001)
      .map(k=>`${k} ${Math.round(old[k]).toLocaleString()} → ${Math.round(now[k]).toLocaleString()}（${now[k]>=old[k]?'+':''}${Math.round(now[k]-old[k]).toLocaleString()}）`);
    if(changes.length) lines.push(p.name+'：\n'+changes.join('；'));
  }
  return lines.length ? lines.join('\n\n') : '本次沒有金錢或指數變動。';
}
