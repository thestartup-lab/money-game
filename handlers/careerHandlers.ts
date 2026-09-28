/** 轉職申請與舞台、65 歲人生轉折（由 socketServer 註冊到每條連線） */
import type { Socket } from 'socket.io';
import { randomBytes } from 'crypto';
import { GamePhase } from '../gameDataModels';
import { previewCareerChange } from '../careerStage';
import { RETIREMENT_STARTUP_AMOUNTS, RETIREMENT_MAX_DEFERRALS } from '../gameConfig';
import {
  OnSafe, beginFacilitatorScene, emitClient, emitToRoom, getRoomState, isRoomAdmin,
  playerIdentity, revealFacilitatorResult, serializeGameState,
} from '../socketServer';

export function registerCareerHandlers(socket: Socket, onSafe: OnSafe): void {

  // ----------------------------------------------------------
  // 請求轉職 (requestCareerChange)
  // ----------------------------------------------------------
  onSafe('requestCareerChange', (payload: { newProfessionId: string }) => {
    const gs = getRoomState(socket);
    if (!gs) { emitClient(socket, 'error', { message: '尚未加入任何房間。' }); return; }
    const roomId = gs.gameId;

    const player = gs.players.get(playerIdentity(socket));
    if (!player || !player.isAlive) {
      emitClient(socket, 'error', { message: '玩家不存在或已出局。' });
      return;
    }

    if (![GamePhase.RatRace, GamePhase.FastTrack].includes(gs.gamePhase)) {
      emitClient(socket, 'error', { message: '遊戲進行中才能申請轉職。' }); return;
    }
    if (gs.careerRequests.some(r => r.playerId === player.id) || gs.facilitatorScene?.careerPlayerId === player.id) {
      emitClient(socket, 'error', { message: '你已有轉職申請，請等待主持人或先撤回。' }); return;
    }
    const preview = previewCareerChange(player, payload.newProfessionId);
    if (preview.error) { emitClient(socket, 'error', { message: preview.error }); return; }
    gs.careerRequests.push({ id: `career-${randomBytes(8).toString('hex')}`, playerId: player.id, professionId: payload.newProfessionId });
    emitToRoom(roomId, 'gameStateUpdate', serializeGameState(gs));
  });

  onSafe('cancelCareerRequest', (payload: { requestId: string }) => {
    const gs = getRoomState(socket);
    const request = gs?.careerRequests.find(r => r.id === payload.requestId);
    if (!gs || !request || (request.playerId !== playerIdentity(socket) && !isRoomAdmin(socket, gs))) {
      emitClient(socket, 'error', { message: '無法撤回此轉職申請。' }); return;
    }
    gs.careerRequests = gs.careerRequests.filter(r => r.id !== request.id);
    emitToRoom(gs.gameId, 'gameStateUpdate', serializeGameState(gs));
  });

  onSafe('startCareerScene', (payload: { requestId: string }) => {
    const gs = getRoomState(socket);
    if (!gs || !isRoomAdmin(socket, gs)) { emitClient(socket, 'error', { message: '只有主持人可以開啟轉職舞台。' }); return; }
    if (![GamePhase.RatRace, GamePhase.FastTrack].includes(gs.gamePhase) || gs.turnInProgress || gs.decisionPhase || gs.facilitatorScene || gs.globalPaydayPending || gs.globalPaydayInProgress) {
      emitClient(socket, 'error', { message: '請先完成目前回合、舞台或全體發薪，再開啟轉職。' }); return;
    }
    gs.careerRequests = gs.careerRequests.filter(r => gs.players.get(r.playerId)?.isAlive);
    const request = gs.careerRequests[0];
    if (!request || request.id !== payload.requestId) { emitClient(socket, 'error', { message: '請依申請順序開啟舞台。' }); return; }
    const player = gs.players.get(request.playerId);
    const preview = player && previewCareerChange(player, request.professionId);
    if (!player || !preview || preview.error) {
      gs.careerRequests.shift();
      emitClient(socket, 'error', { message: preview?.error ?? '申請者已離開。' });
      emitToRoom(gs.gameId, 'gameStateUpdate', serializeGameState(gs)); return;
    }
    gs.careerRequests.shift();
    beginFacilitatorScene(gs, {
      kind: 'career', kicker: '人生職涯轉折', title: `${player.name} 的轉職選擇`,
      description: preview.description!, participantNames: [player.name],
      careerPlayerId: player.id, careerConfirmed: false,
      reminderEndsAt: Date.now() + 60_000, options: [],
    }, { playerId: player.id, professionId: request.professionId, previewDescription: preview.description });
  });

  onSafe('confirmCareerScene', (payload: { sceneId: string; accepted: boolean }) => {
    const gs = getRoomState(socket);
    const scene = gs?.facilitatorScene;
    if (!gs || scene?.kind !== 'career' || scene.id !== payload.sceneId || scene.stage !== 'prompt' || scene.careerPlayerId !== playerIdentity(socket)) {
      emitClient(socket, 'error', { message: '只有本次轉職的玩家可以確認。' }); return;
    }
    if (!payload.accepted) { revealFacilitatorResult(gs, '保留原本的職涯', `${scene.participantNames[0]} 取消了本次轉職，沒有扣款或重置技能。`); return; }
    scene.careerConfirmed = true;
    scene.options = [{ id: 'reveal', label: '本人已確認・揭曉轉職', description: '正式執行轉職，再由主持人繼續遊戲。' }];
    emitToRoom(gs.gameId, 'gameStateUpdate', serializeGameState(gs));
  });

  // ----------------------------------------------------------
  // 65 歲人生轉折：本人在手機選擇 (chooseRetirement)
  // ----------------------------------------------------------
  onSafe('chooseRetirement', (payload: { sceneId: string; choice: 'retire' | 'consultant' | 'startup' | 'defer'; startupAmount?: number }) => {
    const gs = getRoomState(socket);
    const scene = gs?.facilitatorScene;
    const context = gs?.facilitatorSceneContext;
    if (!gs || !context || scene?.kind !== 'retirement' || scene.id !== payload.sceneId || scene.stage !== 'prompt' || scene.careerPlayerId !== playerIdentity(socket)) {
      emitClient(socket, 'error', { message: '只有本次轉折的玩家可以選擇。' }); return;
    }
    const player = gs.players.get(playerIdentity(socket));
    if (!player) return;
    const choice = payload.choice;
    if (!['retire', 'consultant', 'startup', 'defer'].includes(choice)) { emitClient(socket, 'error', { message: '選項不正確。' }); return; }
    if (choice === 'defer' && player.retirementDeferrals >= RETIREMENT_MAX_DEFERRALS) { emitClient(socket, 'error', { message: '已經延後過一次，這次必須選擇。' }); return; }
    let startupAmount = 0;
    if (choice === 'startup') {
      startupAmount = Number(payload.startupAmount ?? 0);
      if (!(RETIREMENT_STARTUP_AMOUNTS as readonly number[]).includes(startupAmount)) { emitClient(socket, 'error', { message: '請選擇創業投入金額。' }); return; }
      if (player.cash < startupAmount) { emitClient(socket, 'error', { message: `現金不足（需 $${startupAmount.toLocaleString()}）。` }); return; }
    }
    context.choice = choice;
    context.startupAmount = startupAmount;
    scene.careerConfirmed = true;
    const labels: Record<string, string> = { retire: '退休領退休金', consultant: '當顧問', startup: `創業（投入 $${startupAmount.toLocaleString()}）`, defer: '延後一輪退休' };
    scene.options = [{ id: 'reveal', label: `本人已選：${labels[choice]}・揭曉`, description: '正式套用選擇，再由主持人繼續遊戲。' }];
    emitToRoom(gs.gameId, 'gameStateUpdate', serializeGameState(gs));
  });
}
