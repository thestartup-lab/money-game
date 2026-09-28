/**
 * 全自動主持：小場次或主持人要專心帶討論時，讓系統代按「繼續」。
 *
 * - 決策：本人送出後 2 秒揭曉；沒人送出時，提醒倒數歸零就收束（發薪用空白方案、交易視為放棄、競標結標）。
 * - 系統自動出現的舞台（第二人生、家庭、婚姻、世界事件、決策回聲）停留幾秒讓大家看完再揭曉；結果顯示幾秒後自動關閉。
 * - 需要本人選擇的舞台（轉職、65 歲轉折）等本人在手機選；倒數歸零還沒選時，轉職視為取消、轉折預設退休。
 * - 主持人自己開的舞台（全場抉擇、合作契約、傳承）仍由主持人操作。
 * - 排隊的轉職申請在空檔時依序開啟。
 * - 主持人手動暫停（含伺服器重啟後的還原暫停）時不動作。
 */
import { GameState, GamePhase } from './gameDataModels';
import { closeFacilitatorScene, revealFacilitatorResult } from './facilitatorScenes';
import { resolveFacilitatorSceneChoice } from './handlers/sceneHandlers';
import { openCareerScene } from './handlers/careerHandlers';
import { serializeGameState } from './playerView';
import { decisionReleaseWaiters, emitToRoom } from './socketServer';

export const AUTO_HOST_TIMING = {
  /** 本人送出後到揭曉 */
  submittedRevealMs: 2_000,
  /** 落格說明在主持人設為「每次都等」時的保底 */
  readingMs: 10_000,
  /** 系統舞台停留多久才揭曉 */
  sceneReadMs: 8_000,
  /** 沒有設定提醒倒數的舞台，等本人選擇的上限 */
  sceneChoiceMs: 60_000,
  /** 結果畫面停留多久才關閉 */
  resultShowMs: 8_000,
} as const;

/** 測試用：把所有等待時間縮短（例如 0.05 = 快 20 倍）；正式環境不設 */
const TIME_SCALE = Number(process.env.AUTO_HOST_TIME_SCALE) > 0 ? Number(process.env.AUTO_HOST_TIME_SCALE) : 1;
const wait = (ms: number) => ms * TIME_SCALE;
/** 檢查間隔；測試可縮短 */
export const AUTO_HOST_TICK_MS = Number(process.env.AUTO_HOST_TICK_MS) > 0 ? Number(process.env.AUTO_HOST_TICK_MS) : 1_000;

const AUTO_REVEAL_KINDS = new Set(['second_life', 'family', 'global_event', 'echo', 'marriage']);
const sceneSeen = new Map<string, { firstAt: number; resultAt?: number }>();

function release(gs: GameState, phaseId: string): boolean {
  const waiter = decisionReleaseWaiters.get(gs.gameId);
  if (waiter?.phaseId !== phaseId) return false;
  waiter.release();
  return true;
}

/** 每秒呼叫一次；回傳這次代做的動作（沒有動作為 null），方便記錄與測試。 */
export function runAutoHost(gs: GameState, now = Date.now()): string | null {
  if (!gs.autoHost) return null;
  if (gs.gamePhase !== GamePhase.RatRace && gs.gamePhase !== GamePhase.FastTrack) return null;
  const phase = gs.decisionPhase;
  const scene = gs.facilitatorScene;
  // 主持人手動暫停：不代按任何東西
  if (gs.pausedAt !== null && !phase && !scene) return null;

  if (phase) {
    if (phase.kind === 'reading') {
      const readingMs = gs.readingAutoContinueMs > 0 ? gs.readingAutoContinueMs : AUTO_HOST_TIMING.readingMs;
      return now - phase.startedAt >= wait(readingMs + 500) && release(gs, phase.id) ? `落格說明結束：${phase.title}` : null;
    }
    if (phase.submitted && phase.kind !== 'auction' && now - phase.startedAt >= wait(AUTO_HOST_TIMING.submittedRevealMs)) {
      return release(gs, phase.id) ? `已送出，揭曉：${phase.title}` : null;
    }
    if (now >= phase.startedAt + wait(phase.reminderEndsAt - phase.startedAt)) {
      return release(gs, phase.id) ? `倒數結束，收束：${phase.title}` : null;
    }
    return null;
  }

  if (scene) {
    const seen = sceneSeen.get(scene.id) ?? { firstAt: now };
    sceneSeen.set(scene.id, seen);
    if (scene.stage === 'result') {
      seen.resultAt ??= now;
      if (now - seen.resultAt < wait(AUTO_HOST_TIMING.resultShowMs)) return null;
      sceneSeen.delete(scene.id);
      closeFacilitatorScene(gs);
      return `關閉舞台：${scene.resultTitle ?? scene.title}`;
    }
    const context = gs.facilitatorSceneContext ?? {};
    const deadline = seen.firstAt + wait(scene.reminderEndsAt ? Math.max(0, scene.reminderEndsAt - seen.firstAt) : AUTO_HOST_TIMING.sceneChoiceMs);
    const readEnough = now - seen.firstAt >= wait(AUTO_HOST_TIMING.sceneReadMs);
    const ignore = () => undefined;

    if (scene.kind === 'career') {
      if (scene.careerConfirmed && now - seen.firstAt >= wait(AUTO_HOST_TIMING.submittedRevealMs)) {
        resolveFacilitatorSceneChoice(gs, scene.id, 'reveal', ignore);
        return `揭曉轉職：${scene.title}`;
      }
      if (!scene.careerConfirmed && now >= deadline) {
        revealFacilitatorResult(gs, '保留原本的職涯', `${scene.participantNames[0]} 在時間內沒有確認，這次不轉職，沒有扣款或重置技能。`);
        return `轉職逾時取消：${scene.title}`;
      }
      return null;
    }
    if (scene.kind === 'retirement') {
      if (!scene.careerConfirmed && now >= deadline) {
        // 時間到還沒選：預設退休（最常見、風險最低的選項），並在大螢幕說明
        context.choice = 'retire';
        scene.careerConfirmed = true;
        emitToRoom(gs.gameId, 'notification', { message: `⏰ ${scene.participantNames[0]} 沒有在時間內選擇，系統依預設「退休」。` });
      }
      if (scene.careerConfirmed && context.choice) {
        resolveFacilitatorSceneChoice(gs, scene.id, 'reveal', ignore);
        return `揭曉人生轉折：${scene.title}`;
      }
      return null;
    }
    if (AUTO_REVEAL_KINDS.has(scene.kind) && readEnough) {
      const choice = scene.kind === 'global_event' ? 'apply' : scene.kind === 'marriage' ? 'accept' : 'reveal';
      let failed = false;
      resolveFacilitatorSceneChoice(gs, scene.id, choice, () => { failed = true; });
      // 婚姻條件改變而無法成立時，改為婉拒，避免卡住
      if (failed && scene.kind === 'marriage') resolveFacilitatorSceneChoice(gs, scene.id, 'decline', ignore);
      else if (failed) closeFacilitatorScene(gs);
      emitToRoom(gs.gameId, 'gameStateUpdate', serializeGameState(gs));
      return `揭曉舞台：${scene.title}`;
    }
    return null;
  }

  const idle = !gs.turnInProgress && !gs.globalPaydayPending && !gs.globalPaydayInProgress;
  if (idle && gs.careerRequests.length > 0) {
    const opened = openCareerScene(gs, gs.careerRequests[0].id, () => undefined);
    return opened ? '開啟轉職舞台' : null;
  }
  return null;
}
