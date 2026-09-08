import { GameState, GamePhase, Player } from './gameDataModels';
import type { AdminGlobalEvent } from './adminEvents';
import { getCurrentAge } from './gameLogic';

export function worldEventRestriction(gs: GameState, event: AdminGlobalEvent): string | null {
  if (![GamePhase.RatRace, GamePhase.FastTrack].includes(gs.gamePhase)) return '遊戲開始後才能安排世界事件。';
  if (gs.finalRoundStarted) return '最後一輪保留給玩家完成人生，不再加入世界事件。';
  if (gs.worldEventHistory.some((entry) => entry.payday === gs.globalPaydayNumber)) return '本季已發生世界事件，請等下一次全體發薪後。';
  const previous = [...gs.worldEventHistory].reverse().find((entry) => entry.eventId === event.id);
  if (previous && event.major) return '這個重大事件本場已使用，每場限一次。';
  if (previous && gs.globalPaydayNumber - previous.payday < 2) return '同一世界事件至少間隔兩次全體發薪。';
  if (event.major && gs.worldEventHistory.filter((entry) => entry.major).length >= 2) return '本場已發生兩次重大事件，請保留時間讓玩家回應與調整。';
  return null;
}

export function hasFragilePlayers(gs: GameState): boolean {
  const alive = [...gs.players.values()].filter((player) => player.isAlive);
  return alive.some((player) => player.cash < player.totalExpenses || player.stats.health <= 20)
    || alive.filter((player) => player.isBedridden).length >= 2;
}

export function describeWorldEvent(event: AdminGlobalEvent): string {
  const durations = [...new Set(event.effects.map((effect) => effect.durationPaydays).filter(Boolean))];
  const hasRepricing = event.effects.some((effect) => effect.type === 'AssetValueChange');
  return `${event.description}${durations.length ? ` 收入／生活費效果持續 ${Math.max(...durations as number[])} 次全體發薪，結算後解除。` : ''}${hasRepricing ? ' 市值重新定價不會自動回復。' : ''}`;
}

function netWorth(player: Player): number {
  return player.cash + player.assets.reduce((sum, asset) => sum + (asset.currentValue ?? asset.cost), 0)
    - player.liabilities.reduce((sum, loan) => sum + loan.totalDebt, 0);
}

/** 在全員完成結算之後解除，不改回資產原始值，保留期間買賣、增值等變動。 */
export function expireWorldEffects(gs: GameState): string[] {
  const titles = new Set<string>();
  for (const player of gs.players.values()) {
    const expired = player.worldEffects.filter((entry) => entry.expiresAfterPayday <= gs.globalPaydayNumber);
    if (!expired.length) continue;
    const before = player.monthlyCashflow;
    player.worldEffects = player.worldEffects.filter((entry) => entry.expiresAfterPayday > gs.globalPaydayNumber);
    expired.forEach((entry) => titles.add(entry.title));
    if (!player.isAlive) continue;
    player.eventLog.push({ type: 'global_event', age: Math.max(player.startAge, getCurrentAge(gs)),
      description: `限期影響結束：${[...new Set(expired.map((entry) => entry.title))].join('、')}`,
      cashBefore: player.cash, cashAfter: player.cash, cashflowBefore: before, cashflowAfter: player.monthlyCashflow,
      netWorthBefore: netWorth(player), netWorthAfter: netWorth(player), meta: { expired: true, globalPayday: gs.globalPaydayNumber } });
  }
  return [...titles];
}
