/** 自動導演與世界事件：評估難度、挑選事件、排入舞台 */
import { randomBytes } from 'crypto';
import { GameState, AssetType } from './gameDataModels';
import { ADMIN_GLOBAL_EVENTS, type AdminGlobalEvent } from './adminEvents';
import { worldEventRestriction, hasFragilePlayers, describeWorldEvent } from './worldEvents';
import { beginFacilitatorScene } from './facilitatorScenes';
import {
  ADAPTIVE_EVENT_COOLDOWN_PAYDAYS, io, roomAdminSocketIds, secondLifeQueue,
} from './socketServer';

export function emitAdaptiveDirectorStatus(gs: GameState): void {
  const adminIds = [...(roomAdminSocketIds.get(gs.gameId) ?? [])];
  if (adminIds.length === 0 && gs.adminSocketId) adminIds.push(gs.adminSocketId);
  if (adminIds.length === 0) return;
  io.to(adminIds).emit('adaptiveDirectorStatus', {
    ...gs.adaptiveDirector,
    globalPaydayNumber: gs.globalPaydayNumber,
    pendingEvent: gs.pendingWorldEvent ? { id: gs.pendingWorldEvent.id, title: gs.pendingWorldEvent.event.title,
      description: describeWorldEvent(gs.pendingWorldEvent.event), source: gs.pendingWorldEvent.source,
      deferred: gs.pendingWorldEvent.deferred } : null,
    eventCatalog: ADMIN_GLOBAL_EVENTS.map((event) => ({ id: event.id, title: event.title,
      description: describeWorldEvent(event), major: Boolean(event.major), restriction: worldEventRestriction(gs, event) })),
    activeEffects: [...new Set([...gs.players.values()].flatMap((player) => player.worldEffects.map((entry) =>
      `${entry.title}：剩 ${Math.max(0, entry.expiresAfterPayday - gs.globalPaydayNumber)} 次全體發薪`)))],
    history: gs.worldEventHistory,
  });
}

export function assessAdaptiveDifficulty(gs: GameState): {
  score: number;
  mode: 'support' | 'balanced' | 'challenge';
  reason: string;
  dominantAssetType?: AssetType;
} {
  const players = [...gs.players.values()];
  const alive = players.filter((player) => player.isAlive);
  if (alive.length === 0) {
    return { score: 0, mode: 'support', reason: '目前沒有存活玩家' };
  }

  const positiveCashflowRatio = alive.filter((player) => player.monthlyCashflow > 0).length / alive.length;
  const negativeCashflowRatio = alive.filter((player) => player.monthlyCashflow < 0).length / alive.length;
  const lowReserveRatio = alive.filter((player) => player.cash < Math.max(1, player.totalExpenses * 2)).length / alive.length;
  const strongReserveRatio = alive.filter((player) => player.cash >= Math.max(1, player.totalExpenses * 6)).length / alive.length;
  const fastTrackRatio = alive.filter((player) => player.isInFastTrack).length / alive.length;
  const bedriddenRatio = alive.filter((player) => player.isBedridden).length / alive.length;
  const survivalRatio = alive.length / Math.max(1, players.length);
  const averageHealth = alive.reduce((sum, player) => sum + player.stats.health, 0) / alive.length;

  const rawScore =
    48
    + positiveCashflowRatio * 22
    + strongReserveRatio * 10
    + fastTrackRatio * 22
    + Math.max(-12, Math.min(12, (averageHealth - 60) * 0.4))
    - negativeCashflowRatio * 28
    - lowReserveRatio * 16
    - bedriddenRatio * 20
    - (1 - survivalRatio) * 24;
  const score = Math.round(Math.max(0, Math.min(100, rawScore)));
  const mode = score <= 38 ? 'support' : score >= 68 && !hasFragilePlayers(gs) ? 'challenge' : 'balanced';

  const assetTotals = new Map<AssetType, number>();
  for (const player of alive) {
    for (const asset of player.assets) {
      assetTotals.set(asset.type, (assetTotals.get(asset.type) ?? 0) + Math.max(0, asset.currentValue ?? asset.cost));
    }
  }
  const dominantAssetType = [...assetTotals.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];

  const reason = [
    ...(hasFragilePlayers(gs) ? ['有玩家現金／健康吃緊，暫停自動加壓'] : []),
    `正現金流 ${Math.round(positiveCashflowRatio * 100)}%`,
    `低現金緩衝 ${Math.round(lowReserveRatio * 100)}%`,
    `平均健康 ${Math.round(averageHealth)}`,
    `外圈 ${Math.round(fastTrackRatio * 100)}%`,
  ].join('・');

  return { score, mode, reason, dominantAssetType };
}

export function getAdaptiveEventPool(
  mode: 'support' | 'balanced' | 'challenge',
  dominantAssetType?: AssetType,
): AdminGlobalEvent[] {
  const support: AdminGlobalEvent[] = [
    {
      id: 'adaptive_living_relief',
      title: '民生支持方案',
      description: '公共資源投入生活支持，每位玩家獲得 $20,000 緊急預備金。',
      effects: [{ type: 'CashChange', flatAmount: 20_000 }],
    },
    {
      id: 'adaptive_health_program',
      title: '全民健康促進計畫',
      description: '健康資源普及，每位存活玩家恢復 8 點健康值。',
      effects: [{ type: 'HealthChange', flatAmount: 8 }],
    },
    {
      id: 'adaptive_cost_relief',
      title: '生活成本減壓',
      description: '公共服務補助上路，每位玩家每月其他支出減少 $1,500。',
      effects: [{ type: 'ExpenseChange', flatAmount: -1_500, durationPaydays: 2 }],
    },
  ];

  const challenge: AdminGlobalEvent[] = [
    {
      id: 'adaptive_rate_pressure',
      title: '利率與物價升溫',
      description: '資金與生活成本同步上升，每位玩家每月其他支出增加 $2,500；利率升 1 個百分點，債券配息跟著提高。',
      effects: [{ type: 'ExpenseChange', flatAmount: 2_500, durationPaydays: 2 }, { type: 'BondRateChange', flatAmount: 0.01 }],
    },
    {
      id: 'adaptive_work_pressure',
      title: '高壓環境考驗',
      description: '全場進入高壓週期，每位存活玩家健康值下降 5 點。',
      effects: [{ type: 'HealthChange', flatAmount: -5 }],
    },
  ];
  if (dominantAssetType !== undefined) {
    challenge.push({
      id: `adaptive_asset_correction_${dominantAssetType}`,
      title: '主力資產市場修正',
      description: '資金集中度過高引發市場修正，全場主要持有資產估值下調 15%。',
      effects: [{ type: 'AssetValueChange', targetAssetType: dominantAssetType, multiplier: 0.85 }],
    });
  }

  const balanced: AdminGlobalEvent[] = [
    {
      id: 'adaptive_small_stimulus',
      title: '景氣微幅回暖',
      description: '消費信心回升，每位玩家獲得 $8,000 周轉資金。',
      effects: [{ type: 'CashChange', flatAmount: 8_000 }],
    },
    {
      id: 'adaptive_cost_wave',
      title: '生活成本波動',
      description: '短期物價變動，每位玩家每月其他支出增加 $1,000。',
      effects: [{ type: 'ExpenseChange', flatAmount: 1_000, durationPaydays: 1 }],
    },
  ];
  if (dominantAssetType !== undefined) {
    balanced.push({
      id: `adaptive_asset_tailwind_${dominantAssetType}`,
      title: '產業順風',
      description: '市場信心轉強，全場主要持有資產估值上升 10%。',
      effects: [{ type: 'AssetValueChange', targetAssetType: dominantAssetType, multiplier: 1.1 }],
    });
  }

  return mode === 'support' ? support : mode === 'challenge' ? challenge : balanced;
}

export function evaluateAndMaybeTriggerAdaptiveEvent(gs: GameState): void {
  const assessment = assessAdaptiveDifficulty(gs);
  gs.adaptiveDirector.score = assessment.score;
  gs.adaptiveDirector.mode = assessment.mode;
  gs.adaptiveDirector.reason = assessment.reason;
  gs.adaptiveDirector.lastEvaluatedPayday = gs.globalPaydayNumber;

  if (!gs.adaptiveDirector.enabled || gs.globalPaydayNumber < 2 || gs.pendingWorldEvent || gs.facilitatorScene) {
    emitAdaptiveDirectorStatus(gs);
    return;
  }
  if (gs.globalPaydayNumber - gs.adaptiveDirector.lastTriggeredPayday < ADAPTIVE_EVENT_COOLDOWN_PAYDAYS) {
    emitAdaptiveDirectorStatus(gs);
    return;
  }

  const triggerChance = assessment.mode === 'balanced' ? 0.55 : 0.75;
  if (Math.random() >= triggerChance) {
    emitAdaptiveDirectorStatus(gs);
    return;
  }

  const pool = getAdaptiveEventPool(assessment.mode, assessment.dominantAssetType)
    .filter((event) => event.id !== gs.adaptiveDirector.lastEventId && !worldEventRestriction(gs, event))
    .filter((event) => !hasFragilePlayers(gs) || !event.effects.some((effect) =>
      (effect.multiplier ?? 1) < 1 || (effect.type === 'ExpenseChange' && (effect.flatAmount ?? 0) > 0)
      || (effect.type === 'HealthChange' && (effect.flatAmount ?? 0) < 0)));
  const event = pool[Math.floor(Math.random() * pool.length)];
  if (!event) {
    emitAdaptiveDirectorStatus(gs);
    return;
  }

  gs.pendingWorldEvent = { id: randomBytes(8).toString('hex'), event, source: 'automatic', deferred: false };
  tryOpenWorldEvent(gs);
  emitAdaptiveDirectorStatus(gs);
}

/** 僅在完成目前決策、擲骰及全體發薪後開啟。效果直到主持人揭曉才套用。 */
export function tryOpenWorldEvent(gs: GameState): void {
  if ((secondLifeQueue.get(gs)?.length ?? 0) > 0) return;
  const pending = gs.pendingWorldEvent;
  if (!pending || pending.deferred || gs.turnInProgress || gs.decisionPhase || gs.facilitatorScene
    || gs.globalPaydayInProgress || gs.globalPaydayPending) return;
  const restriction = worldEventRestriction(gs, pending.event);
  if (restriction) {
    gs.pendingWorldEvent = null;
    emitAdaptiveDirectorStatus(gs);
    return;
  }
  beginFacilitatorScene(gs, {
    kind: 'global_event', kicker: '世界正在改變', title: pending.event.title,
    description: describeWorldEvent(pending.event), participantNames: [], reminderEndsAt: Date.now() + 60_000,
    options: [{ id: 'apply', label: '揭曉並正式生效', description: '主持人確認全場已看見事件後，公布各玩家受到的影響。' },
      { id: 'defer', label: '稍後再發生', description: '保留事件，由主持人選擇適合的時機重新開啟。' }],
  }, { worldEventId: pending.id });
}
