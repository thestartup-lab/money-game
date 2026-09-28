/** 主持人控制的決策階段：開始、等待送出、收束、危機自救 */
import { Socket } from 'socket.io';
import { GameState, Player, DecisionPhaseState } from './gameDataModels';
import { getCurrentAge, pauseGameClock, resumeGameClock } from './gameLogic';
import { FAST_TRACK_LETHAL_CRISIS_NET_WORTH_SHARE, FAST_TRACK_LETHAL_CRISIS_MIN_COST } from './gameConfig';
import { CrisisCard } from './gameCards';
import { applyCrisisCard, previewCrisisCost } from './cardSystem';
import { serializeGameState } from './playerView';
import {
  AUTO_REVEAL_DELAY_MS, HostDecisionContext, calcNetWorth, decisionReleaseWaiters, emitCellEvent, emitClient,
  emitToRoom, pendingSubmissions, playerIdentity, privateReplay, readBoardNotices,
} from './socketServer';

export function beginHostDecisionPhase(
  gs: GameState,
  player: Pick<Player, 'id' | 'name'>,
  kind: DecisionPhaseState['kind'],
  title: string,
  description?: string,
  options?: { rescue?: boolean; publicLines?: string[] },
): HostDecisionContext {
  const wasAlreadyPaused = gs.pausedAt !== null;
  if (!wasAlreadyPaused) pauseGameClock(gs);

  const phaseId = `decision-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const reminderSeconds: Record<DecisionPhaseState['kind'], number> = {
    reading: 0,
    payday: 90,
    deal: 60,
    charity: 45,
    crisis: 45,
    relationship: 45,
    marriage: 60,
    startup: 45,
    auction: 30,
    actions: 90,
  };
  gs.decisionPhase = {
    id: phaseId,
    kind,
    title,
    description,
    playerId: player.id,
    playerName: player.name,
    submitted: false,
    startedAt: Date.now(),
    reminderEndsAt: Date.now() + (options?.rescue ? 120 : reminderSeconds[kind]) * 1000,
    rescue: options?.rescue ? true : undefined,
    publicLines: options?.publicLines,
  };

  emitToRoom(gs.gameId, 'decisionPhaseStarted', gs.decisionPhase);
  emitToRoom(gs.gameId, 'gamePaused', {
    reason: title,
    currentAge: Math.round(getCurrentAge(gs) * 10) / 10,
    controlledByHost: true,
  });
  emitToRoom(gs.gameId, 'gameStateUpdate', serializeGameState(gs));
  return { phaseId, wasAlreadyPaused };
}

export function waitForHostControlledDecision<T>(
  socket: Socket,
  gs: GameState,
  context: HostDecisionContext,
  eventName: 'submitPaydayPlan' | 'submitCardDecision',
  fallback: T,
): Promise<T> {
  return new Promise((resolve) => {
    let submittedValue = fallback;
    let hasSubmitted = false;

    const cleanup = () => {
      pendingSubmissions.delete(playerIdentity(socket));
      privateReplay.delete(playerIdentity(socket));
      const current = decisionReleaseWaiters.get(gs.gameId);
      if (current?.phaseId === context.phaseId) decisionReleaseWaiters.delete(gs.gameId);
    };

    const onDecision = (value: T) => {
      if (hasSubmitted) return;
      hasSubmitted = true;
      submittedValue = value ?? fallback;
      if (gs.decisionPhase?.id === context.phaseId) {
        gs.decisionPhase.submitted = true;
        emitToRoom(gs.gameId, 'decisionPhaseUpdated', gs.decisionPhase);
        emitToRoom(gs.gameId, 'gameStateUpdate', serializeGameState(gs));
      }
      emitClient(socket, 'decisionSubmitted', { phaseId: context.phaseId });
      // 送出後自動揭曉：短暫停留讓大螢幕看到「已送出」，主持人若先按繼續則不重複放行
      if (gs.autoRevealOnSubmit) {
        setTimeout(() => {
          const waiter = decisionReleaseWaiters.get(gs.gameId);
          if (waiter?.phaseId === context.phaseId) waiter.release();
        }, AUTO_REVEAL_DELAY_MS);
      }
    };

    const release = () => {
      cleanup();
      if (gs.decisionPhase?.id === context.phaseId) gs.decisionPhase = null;
      emitToRoom(gs.gameId, 'decisionPhaseEnded', {
        phaseId: context.phaseId,
        submitted: hasSubmitted,
      });
      if (!context.wasAlreadyPaused) {
        resumeGameClock(gs);
        emitToRoom(gs.gameId, 'gameResumed', {
          resumedAt: new Date(),
          currentAge: Math.round(getCurrentAge(gs) * 10) / 10,
        });
      }
      emitToRoom(gs.gameId, 'gameStateUpdate', serializeGameState(gs));
      resolve(submittedValue);
    };

    pendingSubmissions.set(playerIdentity(socket), { phaseId: context.phaseId, event: eventName, submit: value => onDecision(value as T) });
    decisionReleaseWaiters.set(gs.gameId, { phaseId: context.phaseId, release });
  });
}

/** 群體競標沒有單一 submit 事件，只等待主持人決定何時收束。 */
export function waitForHostRelease(gs: GameState, context: HostDecisionContext): Promise<void> {
  return new Promise((resolve) => {
    const release = () => {
      const current = decisionReleaseWaiters.get(gs.gameId);
      if (current?.phaseId === context.phaseId) decisionReleaseWaiters.delete(gs.gameId);
      if (gs.decisionPhase?.id === context.phaseId) gs.decisionPhase = null;
      emitToRoom(gs.gameId, 'decisionPhaseEnded', {
        phaseId: context.phaseId,
        submitted: false,
      });
      if (!context.wasAlreadyPaused) {
        resumeGameClock(gs);
        emitToRoom(gs.gameId, 'gameResumed', {
          resumedAt: new Date(),
          currentAge: Math.round(getCurrentAge(gs) * 10) / 10,
        });
      }
      emitToRoom(gs.gameId, 'gameStateUpdate', serializeGameState(gs));
      resolve();
    };

    decisionReleaseWaiters.set(gs.gameId, { phaseId: context.phaseId, release });
  });
}

/** 把手機上的決策卡片內容轉成大螢幕可公開的文字（全場一起看、一起討論）。 */
export function describePrompt(prompt: { event: string; payload: unknown } | undefined): string[] | undefined {
  if (!prompt) return undefined;
  const p = prompt.payload as Record<string, any>;
  const money = (n: unknown) => `$${Number(n ?? 0).toLocaleString()}`;
  switch (prompt.event) {
    case 'dealCardsDrawn':
      return [
        ...(p.cards ?? []).map((c: any) => `📋 ${c.name}：頭期款 ${money(c.downPayment)}，月現金流 ${Number(c.monthlyCashflow) >= 0 ? '+' : ''}${money(c.monthlyCashflow)}`),
        `手頭現金 ${money(p.playerCash)}，可借 ${money(p.loanAvailable)}；可現金或槓桿買下，放棄則全場競標`,
      ];
    case 'fastTrackDealCard': {
      const d = p.deal ?? {};
      return [`💼 ${d.title}：頭期款 ${money(d.asset?.downPayment ?? d.asset?.cost)}，月現金流 +${money(d.asset?.monthlyCashflow)}`, `手頭現金 ${money(p.playerCash)}，可借 ${money(p.loanAvailable)}`];
    }
    case 'charityCardPending':
      return [`❤️ 捐出 ${money(p.amount)} 可獲得生命體驗與傳承加成，並得到一次加骰`];
    case 'crisisNTSkipAvailable':
      return [`⚠️ ${p.card?.title}：${p.card?.description}`, `未保險費用 ${money(p.card?.baseCost)}；人脈 ≥ 3 可用一次「人脈護盾」跳過`];
    case 'crisisRescueRequired':
      return [`🆘 ${p.card?.title} 需要 ${money(p.effectiveCost)}，現金 ${money(p.cash)}，還差 ${money(p.shortfall)}`, '本人可賣資產或申請應急借款自救；補不足才出局'];
    case 'relationshipCardDrawn':
      return [`🤝 ${p.card?.title}：${p.card?.description}`, '本人決定接受或婉拒'];
    case 'techStartupOffer':
      return [`🚀 科技新創投資：投入 ${money(p.investmentAmount)}，擲骰決定成敗；手頭現金 ${money(p.playerCash)}`];
    case 'fastTrackTravelOptions':
      return [...(p.destinations ?? []).slice(0, 6).map((d: any) => `✈️ ${d.name}（${d.region}）${money(d.cost)}，體驗 +${d.lifeExpGained}`), `手頭現金 ${money(p.playerCash)}`];
    case 'fastTrackPartnershipOptions':
      return [`🤝 可邀請的夥伴：${(p.availablePartners ?? []).map((x: any) => x.name).join('、')}`];
    case 'fastTrackPartnershipInvitation':
      return [`🤝 ${p.offerorName} 發出合夥邀請，預估各得分紅 ${money(p.estimatedDividend)}`];
    default:
      return undefined;
  }
}

export async function waitForCardDecision(
  socket: Socket,
  gs: GameState,
  player: Player,
  kind: DecisionPhaseState['kind'],
  title: string,
  prompt?: { event: string; payload: unknown },
): Promise<Record<string, unknown> | null> {
  await readBoardNotices(gs);
  const context = beginHostDecisionPhase(gs, player, kind, title, undefined, { publicLines: describePrompt(prompt) });
  // 卡片一定要等落格說明結束、決策階段開始後才送到手機；
  // 否則落格說明結束時手機會把卡片當成「決策已結束」清掉，玩家就看不到選項。
  if (prompt) emitClient(socket, prompt.event, prompt.payload);
  return waitForHostControlledDecision(socket, gs, context, 'submitCardDecision', null);
}

/**
 * 套用危機卡，但死亡條件成立時先給玩家一次自救機會：
 * 開一個主持人控制的決策階段，本人可賣資產或申請應急借款把現金補到費用以上，
 * 主持人按「繼續」後才真正判定；補不足才死亡。
 */
export async function applyCrisisWithRescue(
  socket: Socket,
  gs: GameState,
  player: Player,
  card: CrisisCard,
  label: string,
): Promise<ReturnType<typeof applyCrisisCard>> {
  const preview = previewCrisisCost(player, card);
  if (preview.deathRisk) {
    emitCellEvent(socket, gs.gameId, player.name, label,
      `🆘 ${player.name} 的現金 $${player.cash.toLocaleString()} 付不起「${card.title}」$${preview.effectiveCost.toLocaleString()}（差 $${preview.shortfall.toLocaleString()}）。可先在手機賣資產或申請應急借款自救，主持人確認後才判定。`);
    await readBoardNotices(gs);
    const context = beginHostDecisionPhase(gs, player, 'crisis', `危機自救：${card.title}`, undefined, { rescue: true, publicLines: [`🆘 ${card.title} 需要 $${preview.effectiveCost.toLocaleString()}，現金 $${player.cash.toLocaleString()}，還差 $${preview.shortfall.toLocaleString()}`, '本人可賣資產或申請應急借款自救；補不足才出局'] });
    emitClient(socket, 'crisisRescueRequired', {
      card,
      effectiveCost: preview.effectiveCost,
      shortfall: preview.shortfall,
      cash: player.cash,
      timeoutMs: 0,
      controlledByHost: true,
    });
    await waitForHostControlledDecision(socket, gs, context, 'submitCardDecision', null);
    const after = previewCrisisCost(player, card);
    emitCellEvent(socket, gs.gameId, player.name, label,
      after.deathRisk
        ? `💀 ${player.name} 自救後現金 $${player.cash.toLocaleString()} 仍不足 $${after.effectiveCost.toLocaleString()}。`
        : `✅ ${player.name} 自救成功，現金 $${player.cash.toLocaleString()} 足以支付 $${after.effectiveCost.toLocaleString()}。`);
  }
  return applyCrisisCard(player, card);
}

/** 外圈致死疾病卡：無保險時費用改為淨值的 30%，下限 $900,000。 */
export function scaleFastTrackCrisis(player: Player, card: CrisisCard): CrisisCard {
  if (!card.canCauseDeath || card.requiredInsurance === 'none' || player.insurance[card.requiredInsurance]) return card;
  const scaled = Math.max(FAST_TRACK_LETHAL_CRISIS_MIN_COST, Math.round(calcNetWorth(player) * FAST_TRACK_LETHAL_CRISIS_NET_WORTH_SHARE));
  return { ...card, baseCost: scaled };
}
