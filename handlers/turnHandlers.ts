/** 擲骰回合、決策收束與提醒倒數、跳過回合、全體行動時間（由 socketServer 註冊到每條連線） */
import type { Socket } from 'socket.io';
import { Server } from 'socket.io';
import { GamePhase } from '../gameDataModels';
import { checkNaturalDeath } from '../gameLogic';
import { movePlayer, triggerPayday, applyFastTrackAppreciation, checkBedriddenDeath } from '../gameLogic';
import { SECOND_LIFE_CELL } from '../gameConfig';
import { FAST_TRACK_BOARD } from '../gameCards';
import {
  OnSafe, advanceTurn, checkBucketGoals, checkLifeMilestones, continueAfterTurnAdvance, deathAgeLabel,
  decisionReleaseWaiters, eliminatePlayer, emitClient, emitToRoom, enqueueBoardNotice, getRoomState,
  handleLandingSquare, isRoomAdmin, maybeCompleteActionPhase, playerIdentity, queueSecondLifeCandidates, readBoardNotices,
  runGlobalPayday, serializeGameState, tryOpenWorldEvent,
} from '../socketServer';

export function registerTurnHandlers(socket: Socket, onSafe: OnSafe): void {

  // ----------------------------------------------------------
  // 玩家擲骰 (playerRoll)
  // ----------------------------------------------------------
  /**
   * Client → Server: { diceCount?: 1 | 2 }   預設 2 顆骰子
   */
  onSafe(
    'playerRoll',
    async (payload: { diceCount?: 1 | 2 }) => {
      const gs = getRoomState(socket);
      if (!gs) { emitClient(socket, 'error', { message: '尚未加入任何房間。' }); return; }
      const roomId = gs.gameId;

      if (gs.gamePhase === GamePhase.GameOver) {
        emitClient(socket, 'error', { message: '遊戲已結束，請進入復盤。' });
        return;
      }

      if (gs.turnInProgress || gs.pausedAt !== null || gs.decisionPhase || gs.facilitatorScene || gs.globalPaydayPending || gs.globalPaydayInProgress) {
        emitClient(socket, 'error', { message: '目前由主持人控制流程，請等待主持人繼續遊戲。' });
        return;
      }

      // --- 1. 回合驗證 ---
      if (playerIdentity(socket) !== gs.currentPlayerTurnId) {
        emitClient(socket, 'error', { message: '尚未輪到你的回合。' });
        return;
      }

      const player = gs.players.get(playerIdentity(socket));
      if (!player || !player.isAlive) {
        emitClient(socket, 'error', { message: '玩家不存在或已出局。' });
        return;
      }

      gs.turnInProgress = true;
      try {
      // --- 1b. 臥床狀態：自動跳過並判斷死亡 ---
      if (player.isBedridden) {
        const died = checkBedriddenDeath(player);
        if (died) {
          const { deathAge, finalScore } = eliminatePlayer(
            player,
            gs,
            'bedridden',
            '長期臥床後自然死亡',
          );

          console.log(`[bedridden] ${player.name} 臥床自然死亡（${deathAge} 歲），人生評分：${finalScore.total} 分`);

          emitToRoom(roomId, 'gameStateUpdate', serializeGameState(gs));
        } else {
          emitClient(socket, 'turnSkipped', {
            playerId: player.id,
            reason: 'bedridden',
            turnsRemaining: 0,
          });
        }
        advanceTurn(gs);
        emitToRoom(roomId, 'gameStateUpdate', serializeGameState(gs));
        return;
      }

      // --- 1b2. 80 歲起的自然壽命判定（依 HP） ---
      if (player.currentAge >= 80 && checkNaturalDeath(player)) {
        const { deathAge, finalScore } = eliminatePlayer(player, gs, 'natural', `${deathAgeLabel(player)}安詳離世`);
        console.log(`[natural] ${player.name} 自然離世（${deathAge} 歲，HP ${player.stats.health}），人生評分：${finalScore.total} 分`);
        emitToRoom(roomId, 'notification', { message: `🕯️ ${player.name} 在 ${deathAge} 歲安詳離世（HP ${player.stats.health}）。人生評分 ${finalScore.total} 分。` });
        emitToRoom(roomId, 'gameStateUpdate', serializeGameState(gs));
        advanceTurn(gs);
        emitToRoom(roomId, 'gameStateUpdate', serializeGameState(gs));
        return;
      }

      // --- 1c. turnsToSkip 跳回合檢查 ---
      if (player.turnsToSkip > 0) {
        player.turnsToSkip -= 1;
        emitClient(socket, 'turnSkipped', {
          playerId: player.id,
          reason: 'crisis',
          turnsRemaining: player.turnsToSkip,
        });
        advanceTurn(gs);
        emitToRoom(roomId, 'gameStateUpdate', serializeGameState(gs));
        return;
      }

      // --- 2. 擲骰 & 移動（含 bonusDice 加成）---
      // 未指定時預設使用兩顆骰子，加快棋盤推進；玩家仍可主動選一顆精準移動。
      const baseDice = payload?.diceCount ?? 2;
      const diceCount = Math.min(3, baseDice + player.bonusDice) as 1 | 2 | 3;
      player.bonusDice = 0;

      // ⚠ 修正：以前 actualDiceCount = diceCount > 2 ? 2 : diceCount，
      //   慈善獎勵骰會把 base 2 + bonus 1 = 3 capped 回 2，導致第三顆骰直接消失。
      //   現在最多支援到 3 顆骰子（前端 DiceRollOverlay 也已支援）。
      const actualDiceCount = diceCount;
      const diceFaces: number[] = [];
      for (let i = 0; i < actualDiceCount; i++) {
        diceFaces.push(Math.floor(Math.random() * 6) + 1);
      }
      const rolled = diceFaces.reduce((a, b) => a + b, 0);
      // 內外圈使用不同位置欄位；先把移動前的位置記下，再呼叫 movePlayer
      const wasInFastTrack = player.isInFastTrack;
      const oldPos = wasInFastTrack ? player.fastTrackPosition : player.currentPosition;
      const { passedPaydays } = movePlayer(player, rolled);
      const newPos = wasInFastTrack ? player.fastTrackPosition : player.currentPosition;

      console.log(
        `[playerRoll] ${player.name}（${roomId}）擲出 ${rolled}（${diceFaces.join('+')}），` +
          `移動至${wasInFastTrack ? '外圈' : '內圈'}位置 ${newPos}，` +
          `路過發薪日：${passedPaydays.length > 0 ? passedPaydays.join(', ') : '無'}`
      );

      emitClient(socket, 'rollResult', {
        diceCount,
        rolled,
        newPosition: newPos,
        passedPaydays,
        isInFastTrack: wasInFastTrack,
      });

      // 廣播給整個房間（含 DisplayScreen），讓大螢幕播放骰子動畫
      const playerColorIndex = gs.playerOrder.indexOf(player.id);
      emitToRoom(roomId, 'playerRolled', {
        playerId: player.id,
        playerName: player.name,
        colorIndex: (playerColorIndex >= 0 ? playerColorIndex : 0) % 6,
        dice: diceFaces,
        total: rolled,
        oldPosition: oldPos,
        newPosition: newPos,
        isInFastTrack: wasInFastTrack,
      });

      // 發薪不再綁定棋盤格：一律由每三輪一次的季度全體發薪（runGlobalPayday）結算。

      // --- 5. 處理落點格子 ---
      const landingBoard = player.isInFastTrack ? FAST_TRACK_BOARD : require('../gameCards').BOARD;
      const landingPosition = player.isInFastTrack ? player.fastTrackPosition : player.currentPosition;
      const landingLabel = landingBoard[landingPosition % landingBoard.length]?.label ?? '人生事件';
      enqueueBoardNotice(gs, { playerId: player.id, playerName: player.name,
        title: `${player.name} 走到了「${landingLabel}」`,
        description: '請一起看清落格位置。主持人按「看完了，繼續」後，才進入本格事件與決策。' });
      await readBoardNotices(gs);
      await handleLandingSquare(socket, player, gs);
      await readBoardNotices(gs);

      // ⚠ 玩家可能在 handleLandingSquare 中因危機/疾病死亡，
      //   後續 FastTrack 解鎖、增值、advanceToNextTurn 邏輯需要 isAlive 守衛
      if (!player.isAlive) {
        advanceTurn(gs);
        emitToRoom(roomId, 'gameStateUpdate', serializeGameState(gs));
        return;
      }

      // --- 5b. 老鼠賽跑脫出檢查 ---
      // 偵測本次移動是否路過「第二人生」格（cell 24）
      if (!player.isInFastTrack && !player.hasPassedSecondLife) {
        const newPos = player.currentPosition;
        const c = SECOND_LIFE_CELL;
        const crossedCell24 = newPos < oldPos
          ? c > oldPos || c <= newPos   // 繞圈
          : c > oldPos && c <= newPos;  // 直線
        if (crossedCell24) {
          player.hasPassedSecondLife = true;
          emitToRoom(roomId, 'secondLifeReached', { playerId: player.id, playerName: player.name });
          console.log(`[secondLife] ${player.name}（${roomId}）首次路過第二人生格，解鎖 FastTrack 進入資格`);
        }
      }

      queueSecondLifeCandidates(gs);

      // --- 5c. FastTrack 資產增值 ---
      // 注意：FT 資產增值由「踩到外圈發薪格」時於 handleLandingSquare 觸發
      // （applyFastTrackAppreciation 註解：每個 triggerPayday 後呼叫）。
      // 過去這裡也呼叫一次，造成同一回合重複增值；已移除。

      // --- 5d. B2 人生里程碑 + B1 夢想清單檢查 ---
      // 每次擲骰結束後（含 payday、落格、FastTrack 進入），檢查當前玩家：
      //   1. 跨越 40/60/80 歲是否觸發里程碑事件
      //   2. 任何夢想目標是否達成（外圈玩家才有 bucketList）
      if (player.isAlive) {
        checkLifeMilestones(player, gs, roomId, socket);
        checkBucketGoals(player, gs, roomId, socket);
      }

      // --- 6. 廣播最終遊戲狀態 & 推進回合 ---
      advanceTurn(gs);
      emitToRoom(roomId, 'gameStateUpdate', serializeGameState(gs));
    } catch (err) {
      console.error(`[playerRoll] 未預期錯誤：`, err);
      emitClient(socket, 'error', { message: '擲骰處理時發生錯誤，請重新整理頁面。' });
      // 發送一個空的 rollResult 讓前端解除 rollingLocked
      emitClient(socket, 'rollResult', { diceCount: 1, rolled: 0, newPosition: -1, passedPaydays: [] });
      // 不強制 advanceToNextTurn —— 此時玩家可能已移動但發薪流程未完成，
      // 強制換回合會讓狀態與下家流程錯亂；交給管理員手動干預（或玩家重新整理）。
      try {
        const gs2 = getRoomState(socket);
        if (gs2) emitToRoom(gs2.gameId, 'gameStateUpdate', serializeGameState(gs2));
      } catch (_) { /* ignore */ }
    } finally {
      gs.turnInProgress = false;
      continueAfterTurnAdvance(gs);
      tryOpenWorldEvent(gs);
      emitToRoom(gs.gameId, 'gameStateUpdate', serializeGameState(gs));
    }
    }
  );

  // ----------------------------------------------------------
  // 主持人收束目前決策階段
  // ----------------------------------------------------------
  onSafe('continueDecisionPhase', (payload?: { phaseId?: string }) => {
    const gs = getRoomState(socket);
    if (!gs) { emitClient(socket, 'error', { message: '尚未加入任何房間。' }); return; }
    if (!isRoomAdmin(socket, gs)) {
      emitClient(socket, 'error', { message: '只有主持人可以結束決策階段。' });
      return;
    }

    const waiter = decisionReleaseWaiters.get(gs.gameId);
    if (!gs.decisionPhase || !waiter) {
      emitClient(socket, 'error', { message: '目前沒有等待中的決策。' });
      return;
    }
    if ((gs.decisionPhase.kind === 'reading' && payload?.phaseId !== waiter.phaseId) || (payload?.phaseId && payload.phaseId !== waiter.phaseId)) {
      emitClient(socket, 'error', { message: '決策階段已更新，請重新操作。' });
      return;
    }

    waiter.release();
  });

  // 倒數只作為全場節奏提醒；歸零不會自動替玩家選擇或結束階段。
  onSafe('setDecisionReminder', (payload?: { phaseId?: string; seconds?: number; addSeconds?: number }) => {
    const gs = getRoomState(socket);
    if (!gs) { emitClient(socket, 'error', { message: '尚未加入任何房間。' }); return; }
    if (!isRoomAdmin(socket, gs)) {
      emitClient(socket, 'error', { message: '只有主持人可以調整決策倒數。' });
      return;
    }
    const phase = gs.decisionPhase;
    if (!phase || (payload?.phaseId && payload.phaseId !== phase.id)) {
      emitClient(socket, 'error', { message: '目前的決策階段已更新。' });
      return;
    }

    if (typeof payload?.addSeconds === 'number') {
      const base = Math.max(Date.now(), phase.reminderEndsAt);
      phase.reminderEndsAt = base + Math.max(0, Math.min(300, payload.addSeconds)) * 1000;
    } else {
      const seconds = Math.max(10, Math.min(300, payload?.seconds ?? 60));
      phase.reminderEndsAt = Date.now() + seconds * 1000;
    }
    emitToRoom(gs.gameId, 'decisionPhaseUpdated', phase);
    emitToRoom(gs.gameId, 'gameStateUpdate', serializeGameState(gs));
  });

  // 舞台決策倒數同樣只作提醒，主持人仍保有完整決定權。
  onSafe('setFacilitatorReminder', (payload?: { sceneId?: string; seconds?: number; addSeconds?: number }) => {
    const gs = getRoomState(socket);
    if (!gs || !isRoomAdmin(socket, gs)) {
      emitClient(socket, 'error', { message: '只有主持人可以調整舞台倒數。' });
      return;
    }
    const scene = gs.facilitatorScene;
    if (!scene || scene.stage !== 'prompt' || (payload?.sceneId && payload.sceneId !== scene.id)) {
      emitClient(socket, 'error', { message: '目前的舞台事件已更新。' });
      return;
    }

    if (typeof payload?.addSeconds === 'number') {
      const base = Math.max(Date.now(), scene.reminderEndsAt ?? Date.now());
      scene.reminderEndsAt = base + Math.max(0, Math.min(300, payload.addSeconds)) * 1000;
    } else {
      const seconds = Math.max(10, Math.min(300, payload?.seconds ?? 60));
      scene.reminderEndsAt = Date.now() + seconds * 1000;
    }
    emitToRoom(gs.gameId, 'gameStateUpdate', serializeGameState(gs));
  });

  // ----------------------------------------------------------
  // 主持人跳過目前玩家的回合 (skipTurn) — 玩家離線、發呆或臥床時使用
  // ----------------------------------------------------------
  onSafe('skipTurn', (payload?: { playerId?: string }) => {
    const gs = getRoomState(socket);
    if (!gs) { emitClient(socket, 'error', { message: '尚未加入任何房間。' }); return; }
    const roomId = gs.gameId;

    if (!isRoomAdmin(socket, gs)) {
      emitClient(socket, 'error', { message: '只有管理員可以跳過回合。' });
      return;
    }
    if (gs.gamePhase !== GamePhase.RatRace && gs.gamePhase !== GamePhase.FastTrack) {
      emitClient(socket, 'error', { message: '遊戲尚未進行中，沒有可跳過的回合。' });
      return;
    }
    if (gs.decisionPhase || gs.facilitatorScene || gs.turnInProgress || gs.globalPaydayInProgress || gs.globalPaydayPending) {
      emitClient(socket, 'error', { message: '目前有決策或結算進行中，請先收束再跳過回合。' });
      return;
    }
    const target = gs.players.get(gs.currentPlayerTurnId);
    if (!target) { emitClient(socket, 'error', { message: '找不到目前輪到的玩家。' }); return; }
    if (payload?.playerId && payload.playerId !== target.id) {
      emitClient(socket, 'error', { message: `目前輪到的是 ${target.name}，不是你選的玩家。` });
      return;
    }

    let reason: 'bedridden' | 'crisis' | 'host' = 'host';
    if (target.isBedridden) {
      reason = 'bedridden';
      if (checkBedriddenDeath(target)) {
        const { deathAge, finalScore } = eliminatePlayer(target, gs, 'bedridden', '長期臥床後自然死亡');
        console.log(`[skipTurn] ${target.name} 臥床自然死亡（${deathAge} 歲），人生評分：${finalScore.total} 分`);
      }
    } else if (target.turnsToSkip > 0) {
      reason = 'crisis';
      target.turnsToSkip -= 1;
    }

    emitToRoom(roomId, 'turnSkipped', {
      playerId: target.id,
      playerName: target.name,
      reason,
      byHost: true,
      turnsRemaining: target.turnsToSkip,
    });
        console.log(`[skipTurn] 主持人跳過 ${target.name} 的回合（${reason}，${roomId}）`);
    advanceTurn(gs);
    emitToRoom(roomId, 'gameStateUpdate', serializeGameState(gs));
  });

  // ----------------------------------------------------------
  // 全體行動時間：玩家按「我這輪完成了」
  // ----------------------------------------------------------
  onSafe('finishActionPhase', () => {
    const gs = getRoomState(socket);
    if (!gs) { emitClient(socket, 'error', { message: '尚未加入任何房間。' }); return; }
    const player = gs.players.get(playerIdentity(socket));
    if (!player?.isAlive) { emitClient(socket, 'error', { message: '玩家不存在或已出局。' }); return; }
    if (gs.decisionPhase?.kind !== 'actions') { emitClient(socket, 'error', { message: '現在不是全體行動時間。' }); return; }
    gs.actionPhaseDone.add(player.id);
    emitToRoom(gs.gameId, 'gameStateUpdate', serializeGameState(gs));
    maybeCompleteActionPhase(gs);
  });
}
