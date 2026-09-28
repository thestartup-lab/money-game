/** 大螢幕舞台事件（由 socketServer 註冊到每條連線） */
import type { Socket } from 'socket.io';
import { GameState, GamePhase, PlayerEvent, AssetType } from '../gameDataModels';
import { previewCareerChange } from '../careerStage';
import { applyGlobalEvent, rollDice, computePension, computeConsultantIncome, getArrangedMarriageCost } from '../gameLogic';
import { RELATIONSHIP_MARRIAGE_THRESHOLD, HP_ACTIVITY_THRESHOLDS, RETIREMENT_STARTUP_SUCCESS_ROLL, RETIREMENT_STARTUP_RETURN_RATE, RETIREMENT_STARTUP_FAILURE_LOSS, RETIREMENT_DEFER_HP_COST, CONSULTANT_HP_COST_PER_CYCLE, CONSULTANT_MIN_HP } from '../gameConfig';
import { worldEventRestriction, hasFragilePlayers, describeWorldEvent } from '../worldEvents';
import { executeCareerChange, applyHPChange } from '../statsSystem';
import {
  COMMUNITY_CHOICE_CARDS, COOPERATION_CONTRACTS, LEGACY_CHOICES, MarriageSceneRoute, OnSafe, applyCommunityChoice,
  applyCooperationContract, applyDecisionEcho, applyLegacyAction, applyMarriageScene, beginFacilitatorScene, calcNetWorth,
  closeFacilitatorScene, emitAdaptiveDirectorStatus, emitClient, emitToRoom, findDecisionEcho, getPlayerAge,
  getPlayerSocket, getRoomState, isRoomAdmin, logPlayerEvent, resolveFamilyScene, revealFacilitatorResult,
  revealSecondLife, serializeGameState, startFamilyScene, startMarriageScene,
} from '../socketServer';

export function registerSceneHandlers(socket: Socket, onSafe: OnSafe): void {

  // ----------------------------------------------------------
  // 主持人導演模式：所有內容只在大螢幕公開，並由主持人揭曉
  // ----------------------------------------------------------
  onSafe('startFacilitatorScene', (payload?: {
    kind?: string;
    cardId?: string;
    contractId?: string;
    playerAId?: string;
    playerBId?: string;
    deceasedPlayerId?: string;
    beneficiaryId?: string;
    legacyId?: string;
    playerId?: string;
    marriageRoute?: string;
  }) => {
    const gs = getRoomState(socket);
    if (!gs || !isRoomAdmin(socket, gs)) {
      emitClient(socket, 'error', { message: '權限不足：只有主持人可以啟動大螢幕舞台事件。' });
      return;
    }
    if (gs.gamePhase !== GamePhase.RatRace && gs.gamePhase !== GamePhase.FastTrack) {
      emitClient(socket, 'error', { message: '主持人導演事件只會在遊戲進行中開放。' });
      return;
    }
    if (gs.facilitatorScene) {
      emitClient(socket, 'error', { message: '目前已有舞台事件，請先完成或關閉。' });
      return;
    }
    if (gs.turnInProgress || gs.decisionPhase || gs.globalPaydayPending || gs.globalPaydayInProgress) {
      emitClient(socket, 'error', { message: '請先完成目前玩家決策或季度發薪，再啟動舞台事件。' });
      return;
    }

    if (payload?.kind === 'community') {
      const card = COMMUNITY_CHOICE_CARDS.find((candidate) => candidate.id === payload.cardId);
      if (!card) {
        emitClient(socket, 'error', { message: '找不到這張共同抉擇事件。' });
        return;
      }
      beginFacilitatorScene(gs, {
        kind: 'community',
        kicker: '全場共同抉擇',
        title: card.title,
        description: card.description,
        participantNames: [...gs.players.values()].filter((player) => player.isAlive).map((player) => player.name),
        options: card.options,
      }, { cardId: card.id });
      return;
    }

    if (payload?.kind === 'echo') {
      const echo = findDecisionEcho(gs);
      if (!echo) {
        emitClient(socket, 'error', { message: '目前還沒有發生至少 8 年、且適合回看的關鍵選擇。' });
        return;
      }
      beginFacilitatorScene(gs, {
        kind: 'echo',
        kicker: '選擇正在回來',
        title: `${echo.player.name} 的決策回聲`,
        description: `${Math.round(echo.event.age)} 歲時：${echo.event.description}`,
        participantNames: [echo.player.name],
        options: [{ id: 'reveal', label: '揭曉後續影響', description: '看看這個選擇如何在多年後產生回報或代價。' }],
      }, { playerId: echo.player.id, eventKey: echo.key, event: echo.event });
      return;
    }

    if (payload?.kind === 'cooperation') {
      const contractId = payload.contractId as keyof typeof COOPERATION_CONTRACTS;
      const contract = COOPERATION_CONTRACTS[contractId];
      const playerA = gs.players.get(payload.playerAId ?? '');
      const playerB = gs.players.get(payload.playerBId ?? '');
      if (!contract || !playerA?.isAlive || !playerB?.isAlive || playerA.id === playerB.id) {
        emitClient(socket, 'error', { message: '請選擇兩位不同且仍在遊戲中的玩家與有效契約。' });
        return;
      }
      const requiredA = contractId === 'mutual_aid' ? 15_000 : contractId === 'joint_venture' ? 10_000 : 8_000;
      const requiredB = contractId === 'mutual_aid' ? 0 : contractId === 'joint_venture' ? 10_000 : 8_000;
      if (playerA.cash < requiredA || playerB.cash < requiredB) {
        emitClient(socket, 'error', { message: '其中一位玩家的現金不足以成立這份契約。' });
        return;
      }
      beginFacilitatorScene(gs, {
        kind: 'cooperation',
        kicker: '玩家合作契約',
        title: contract.title,
        description: `${playerA.name} × ${playerB.name}｜${contract.description}`,
        participantNames: [playerA.name, playerB.name],
        options: [
          { id: 'accept', label: '雙方成立契約', description: '主持人確認雙方已公開同意後執行。' },
          { id: 'decline', label: '本次不合作', description: '保留各自資源，不套用任何效果。' },
        ],
      }, { contractId, playerAId: playerA.id, playerBId: playerB.id });
      return;
    }

    if (payload?.kind === 'legacy') {
      const legacyId = payload.legacyId as keyof typeof LEGACY_CHOICES;
      const legacy = LEGACY_CHOICES[legacyId];
      const deceased = gs.players.get(payload.deceasedPlayerId ?? '');
      const beneficiary = gs.players.get(payload.beneficiaryId ?? '');
      if (!legacy || !deceased || deceased.isAlive || deceased.legacyActionUsed || !beneficiary?.isAlive) {
        emitClient(socket, 'error', { message: '請選擇尚未傳承的已故玩家，以及一位仍在遊戲中的承接者。' });
        return;
      }
      beginFacilitatorScene(gs, {
        kind: 'legacy',
        kicker: '出局不是離席',
        title: `${deceased.name} 的${legacy.title}`,
        description: `${legacy.description} 承接者：${beneficiary.name}。`,
        participantNames: [deceased.name, beneficiary.name],
        options: [
          { id: 'accept', label: '完成傳承', description: '讓這段人生繼續影響桌上的故事。' },
          { id: 'decline', label: '稍後再決定', description: '本次不套用，之後仍可重新安排。' },
        ],
      }, { legacyId, deceasedPlayerId: deceased.id, beneficiaryId: beneficiary.id });
      return;
    }

    if (payload?.kind === 'marriage') {
      const player = gs.players.get(payload.playerId ?? '');
      const route: MarriageSceneRoute = payload.marriageRoute === 'arranged'
        ? 'arranged'
        : payload.marriageRoute === 'matchmaker'
          ? 'matchmaker'
          : 'love';
      if (!player?.isAlive || player.isMarried) {
        emitClient(socket, 'error', { message: '請選擇一位仍在遊戲中的未婚玩家。' });
        return;
      }
      if ((route === 'love' || route === 'matchmaker') && (!player.relationshipActive || player.relationshipPoints < RELATIONSHIP_MARRIAGE_THRESHOLD)) {
        emitClient(socket, 'error', { message: `關係經營值需達 ${RELATIONSHIP_MARRIAGE_THRESHOLD} 才能提出婚姻。` });
        return;
      }
      if (route === 'arranged') {
        const cost = getArrangedMarriageCost(getPlayerAge(gs, player));
        if (player.isBedridden || player.stats.health < HP_ACTIVITY_THRESHOLDS.arrangedMarriage || player.cash < cost) {
          emitClient(socket, 'error', { message: `付費婚配需要健康 ${HP_ACTIVITY_THRESHOLDS.arrangedMarriage} 以上與現金 $${cost.toLocaleString()}。` });
          return;
        }
      }
      startMarriageScene(gs, player, route);
      return;
    }

    if (payload?.kind === 'family') {
      const player = gs.players.get(payload.playerId ?? '');
      if (!player?.isAlive) {
        emitClient(socket, 'error', { message: '請選擇一位仍在遊戲中的玩家。' });
        return;
      }
      startFamilyScene(gs, player, player.isInFastTrack ? 'outer' : 'inner');
      return;
    }

    emitClient(socket, 'error', { message: '未知的主持人導演事件。' });
  });

  onSafe('resolveFacilitatorScene', (payload?: { sceneId?: string; choiceId?: string }) => {
    const gs = getRoomState(socket);
    if (!gs || !isRoomAdmin(socket, gs)) {
      emitClient(socket, 'error', { message: '權限不足：只有主持人可以揭曉舞台事件。' });
      return;
    }
    resolveFacilitatorSceneChoice(gs, payload?.sceneId, payload?.choiceId ?? '', (message) => emitClient(socket, 'error', { message }));
  });

  onSafe('closeFacilitatorScene', (payload?: { sceneId?: string }) => {
    const gs = getRoomState(socket);
    if (!gs || !isRoomAdmin(socket, gs)) {
      emitClient(socket, 'error', { message: '權限不足：只有主持人可以關閉舞台事件。' });
      return;
    }
    if (!gs.facilitatorScene || (payload?.sceneId && payload.sceneId !== gs.facilitatorScene.id)) {
      emitClient(socket, 'error', { message: '目前沒有可關閉的舞台事件。' });
      return;
    }
    closeFacilitatorScene(gs);
  });
}

/**
 * 揭曉舞台事件（主持人按鈕與自動主持共用）。
 * 條件不符時呼叫 fail 說明原因，不改變任何狀態。
 */
export function resolveFacilitatorSceneChoice(gs: GameState, sceneId: string | undefined, choiceId: string, fail: (message: string) => void): void {
  const scene = gs.facilitatorScene;
  const context = gs.facilitatorSceneContext;
  if (!scene || !context || scene.stage !== 'prompt' || (sceneId && sceneId !== scene.id)) {
    fail('舞台事件已更新，請重新操作。');
    return;
  }

  if (scene.kind === 'career') {
    if (sceneId !== scene.id || choiceId !== 'reveal' || !scene.careerConfirmed) {
      fail('請先等待玩家本人確認轉職。'); return;
    }
    const player = gs.players.get(String(context.playerId));
    const preview = player && previewCareerChange(player, String(context.professionId));
    if (!player || !preview || preview.error) {
      revealFacilitatorResult(gs, '本次轉職未執行', preview?.error ?? '玩家已離開。'); return;
    }
    // Host adjustments during discussion must never change the terms after consent.
    if (preview.description !== context.previewDescription) {
      scene.description = preview.description!;
      context.previewDescription = preview.description;
      scene.careerConfirmed = false; scene.options = [];
      fail('條件已變更，請玩家重新確認更新後的內容。');
      emitToRoom(gs.gameId, 'gameStateUpdate', serializeGameState(gs)); return;
    }
    const cash = player.cash, flow = player.monthlyCashflow, worth = calcNetWorth(player);
    const result = executeCareerChange(player, String(context.professionId));
    if (!result.success) { revealFacilitatorResult(gs, '本次轉職未執行', result.message); return; }
    logPlayerEvent(player, gs, 'career_change', `轉職：${result.previousProfession} → ${result.newProfession}`, cash, flow, worth,
      { previousProfession: result.previousProfession, newProfession: result.newProfession, salaryChange: result.salaryChange });
    revealFacilitatorResult(gs, `${player.name} 的新職涯啟動了`, `${scene.description.split('\n').slice(0, -1).join('\n')}\n轉職已生效，SK 已歸零；請主持人帶領觀察後繼續。`);
    const target = getPlayerSocket(player.id);
    if (target) emitClient(target, 'careerChangeResult', { ...result, staged: true });
    return;
  }

  if (scene.kind === 'retirement') {
    if (choiceId !== 'reveal' || !scene.careerConfirmed || !context.choice) {
      fail('請先等待玩家本人在手機選擇。'); return;
    }
    const player = gs.players.get(String(context.playerId));
    if (!player?.isAlive) { revealFacilitatorResult(gs, '本次轉折未執行', '玩家已離開。'); return; }
    const cash = player.cash, flow = player.monthlyCashflow, worth = calcNetWorth(player);
    const choice = String(context.choice);
    let title = '', detail = '';
    if (choice === 'retire') {
      player.retirementStatus = 'retired';
      player.pensionMonthly = computePension(player);
      player.salary = player.pensionMonthly;
      title = `${player.name} 退休了`;
      detail = `每月領退休金 $${player.pensionMonthly.toLocaleString()}，被動收入照領。月現金流 ${player.monthlyCashflow >= 0 ? '+' : ''}$${player.monthlyCashflow.toLocaleString()}。`;
    } else if (choice === 'consultant') {
      player.retirementStatus = 'consultant';
      player.salary = computeConsultantIncome(player);
      title = `${player.name} 轉任顧問`;
      detail = `顧問月收入 $${player.salary.toLocaleString()}（隨第二專長與人脈變動），每輪扣 HP ${CONSULTANT_HP_COST_PER_CYCLE}；HP 低於 ${CONSULTANT_MIN_HP} 就接不到案。`;
    } else if (choice === 'startup') {
      const amount = Number(context.startupAmount ?? 0);
      const roll = rollDice(1) + (player.stats.network >= 5 ? 1 : 0);
      player.retirementStatus = 'founder';
      player.salary = 0;
      if (roll >= RETIREMENT_STARTUP_SUCCESS_ROLL) {
        player.cash -= amount;
        const monthly = Math.round(amount * RETIREMENT_STARTUP_RETURN_RATE);
        player.assets.push({ id: `retire-biz-${player.id}`, name: '退休創業事業', type: AssetType.Business, cost: amount, currentValue: amount, monthlyCashflow: monthly });
        title = `${player.name} 退休創業成功`;
        detail = `擲出 ${roll}，投入 $${amount.toLocaleString()} 成立事業，每月現金流 +$${monthly.toLocaleString()}。`;
      } else {
        const loss = Math.round(amount * RETIREMENT_STARTUP_FAILURE_LOSS);
        player.cash -= loss;
        title = `${player.name} 退休創業失敗`;
        detail = `擲出 ${roll}，未達 ${RETIREMENT_STARTUP_SUCCESS_ROLL}，損失 $${loss.toLocaleString()}；之後沒有薪資，靠被動收入生活。`;
      }
    } else {
      player.retirementDeferrals += 1;
      player.retirementDeferralRound = gs.turnNumber;
      applyHPChange(player, -RETIREMENT_DEFER_HP_COST);
      title = `${player.name} 選擇再工作一輪`;
      detail = `保留薪資到下一輪，HP −${RETIREMENT_DEFER_HP_COST}（目前 ${player.stats.health}）。下一輪會再問一次。`;
    }
    logPlayerEvent(player, gs, 'career_change', `65 歲人生轉折：${title}`, cash, flow, worth, { retirementChoice: choice });
    revealFacilitatorResult(gs, title, `${detail}\n請主持人帶領觀察後繼續。`);
    emitToRoom(gs.gameId, 'gameStateUpdate', serializeGameState(gs));
    return;
  }

  if (scene.kind === 'second_life') {
    if (choiceId === 'reveal') revealSecondLife(gs);
    return;
  }

  if (scene.kind === 'global_event') {
    const pending = gs.pendingWorldEvent;
    if (!pending || context.worldEventId !== pending.id) {
      fail('世界事件已更新，請關閉舞台後重新安排。'); return;
    }
    if (choiceId === 'defer') {
      pending.deferred = true;
      closeFacilitatorScene(gs);
      return;
    }
    if (choiceId !== 'apply') { fail('請選擇揭曉或延後。'); return; }
    const restriction = worldEventRestriction(gs, pending.event);
    if (restriction) { fail(restriction); return; }
    if (pending.source === 'automatic' && hasFragilePlayers(gs) && pending.event.effects.some((effect) =>
      (effect.multiplier ?? 1) < 1 || (effect.type === 'ExpenseChange' && (effect.flatAmount ?? 0) > 0)
      || (effect.type === 'HealthChange' && (effect.flatAmount ?? 0) < 0))) {
      gs.pendingWorldEvent = null;
      revealFacilitatorResult(gs, '這次考驗暫緩', '有玩家現金或健康已吃緊，系統取消本次自動加壓。');
      emitAdaptiveDirectorStatus(gs); return;
    }
    applyGlobalEvent(gs, pending.event);
    gs.worldEventHistory.push({ eventId: pending.event.id, title: pending.event.title,
      payday: gs.globalPaydayNumber, round: gs.turnNumber, source: pending.source, major: Boolean(pending.event.major) });
    if (pending.source === 'automatic') {
      gs.adaptiveDirector.lastTriggeredPayday = gs.globalPaydayNumber;
      gs.adaptiveDirector.lastEventId = pending.event.id;
      gs.adaptiveDirector.lastEventTitle = pending.event.title;
    }
    scene.impacts = [...gs.players.values()].filter((player) => player.isAlive).map((player) => {
      const event = player.eventLog[player.eventLog.length - 1];
      event.meta = { ...event.meta, source: pending.source };
      return { playerName: player.name, cashflowDelta: event.cashflowAfter - event.cashflowBefore,
        netWorthDelta: event.netWorthAfter - event.netWorthBefore,
        healthDelta: Number(event.meta.healthAfter) - Number(event.meta.healthBefore) };
    });
    const event = pending.event;
    gs.pendingWorldEvent = null;
    revealFacilitatorResult(gs, `${event.title}・影響揭曉`, describeWorldEvent(event));
    emitToRoom(gs.gameId, 'globalEventAnnouncement', { event, stageManaged: true });
    emitAdaptiveDirectorStatus(gs);
    return;
  }

  if (scene.kind === 'community') {
    const result = applyCommunityChoice(gs, String(context.cardId ?? ''), choiceId);
    if (!result) {
      fail('請選擇有效的共同決策。');
      return;
    }
    const optionLabel = scene.options?.find((option) => option.id === choiceId)?.label ?? '共同決策';
    revealFacilitatorResult(gs, `全場選擇：${optionLabel}`, result);
    return;
  }

  if (scene.kind === 'echo') {
    if (choiceId !== 'reveal') {
      fail('請由主持人揭曉決策回聲。');
      return;
    }
    const player = gs.players.get(String(context.playerId ?? ''));
    const event = context.event as PlayerEvent | undefined;
    if (!player || !event) {
      fail('找不到這次決策回聲的原始資料。');
      return;
    }
    gs.facilitatorEchoHistory.add(String(context.eventKey ?? ''));
    revealFacilitatorResult(gs, '多年後，選擇產生了結果', applyDecisionEcho(gs, player, event));
    return;
  }

  if (scene.kind === 'cooperation') {
    if (choiceId === 'decline') {
      revealFacilitatorResult(gs, '本次沒有成立契約', '雙方保留資源，也保留未來再次合作的可能。');
      return;
    }
    if (choiceId !== 'accept') {
      fail('請確認是否成立合作契約。');
      return;
    }
    const contractId = context.contractId as keyof typeof COOPERATION_CONTRACTS;
    const playerA = gs.players.get(String(context.playerAId ?? ''));
    const playerB = gs.players.get(String(context.playerBId ?? ''));
    if (!COOPERATION_CONTRACTS[contractId] || !playerA?.isAlive || !playerB?.isAlive) {
      fail('契約參與者狀態已改變，無法成立。');
      return;
    }
    const requiredA = contractId === 'mutual_aid' ? 15_000 : contractId === 'joint_venture' ? 10_000 : 8_000;
    const requiredB = contractId === 'mutual_aid' ? 0 : contractId === 'joint_venture' ? 10_000 : 8_000;
    if (playerA.cash < requiredA || playerB.cash < requiredB) {
      fail('玩家目前現金已不足，這份契約沒有成立。');
      return;
    }
    revealFacilitatorResult(gs, '合作契約正式成立', applyCooperationContract(gs, contractId, playerA, playerB));
    return;
  }

  if (scene.kind === 'legacy') {
    if (choiceId === 'decline') {
      revealFacilitatorResult(gs, '本次暫不傳承', '主持人可以稍後重新安排傳承儀式。');
      return;
    }
    if (choiceId !== 'accept') {
      fail('請確認是否完成傳承。');
      return;
    }
    const legacyId = context.legacyId as keyof typeof LEGACY_CHOICES;
    const deceased = gs.players.get(String(context.deceasedPlayerId ?? ''));
    const beneficiary = gs.players.get(String(context.beneficiaryId ?? ''));
    if (!LEGACY_CHOICES[legacyId] || !deceased || deceased.isAlive || deceased.legacyActionUsed || !beneficiary?.isAlive) {
      fail('傳承參與者狀態已改變，請重新安排。');
      return;
    }
    revealFacilitatorResult(gs, '影響力被留下來了', applyLegacyAction(gs, legacyId, deceased, beneficiary));
    return;
  }

  if (scene.kind === 'family') {
    if (choiceId !== 'reveal') {
      fail('請由主持人揭曉家庭事件。');
      return;
    }
    const player = gs.players.get(String(context.playerId ?? ''));
    if (!player?.isAlive) {
      fail('這位玩家目前無法進行家庭事件。');
      return;
    }
    resolveFamilyScene(gs, player);
    return;
  }

  if (scene.kind === 'marriage') {
    const player = gs.players.get(String(context.playerId ?? ''));
    if (!player?.isAlive || player.isMarried) {
      fail('這次婚姻事件已失效。');
      return;
    }
    if (choiceId === 'decline') {
      revealFacilitatorResult(gs, '這次選擇不結婚', `${player.name} 保留目前的人生方向；深度關係累積不會被清除。`);
      emitToRoom(gs.gameId, 'marriageDeclined', { playerId: player.id, playerName: player.name });
      return;
    }
    if (choiceId !== 'accept') {
      fail('請確認是否接受這次婚姻選擇。');
      return;
    }
    const result = applyMarriageScene(gs, player, context);
    if (!result) {
      fail('目前條件已改變，婚姻無法成立。');
      return;
    }
    revealFacilitatorResult(gs, '兩段人生決定同行 💍', result);
  }
}
