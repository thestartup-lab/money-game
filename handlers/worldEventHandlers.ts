/** 自動導演、世界事件、特別競標（由 socketServer 註冊到每條連線） */
import type { Socket } from 'socket.io';
import { randomBytes } from 'crypto';
import { GamePhase } from '../gameDataModels';
import { ADMIN_GLOBAL_EVENT_MAP } from '../adminEvents';
import { worldEventRestriction } from '../worldEvents';
import { DealCard } from '../gameCards';
import { acceptDealCard } from '../cardSystem';
import {
  OnSafe, beginHostDecisionPhase, calcNetWorth, emitAdaptiveDirectorStatus, emitClient, emitToRoom,
  getRoomState, isRoomAdmin, logPlayerEvent, rooms, serializeGameState, tryOpenWorldEvent,
  waitForHostRelease,
} from '../socketServer';

export function registerWorldEventHandlers(socket: Socket, onSafe: OnSafe): void {

  // ----------------------------------------------------------
  // 觸發全局市場事件 (triggerGlobalEvent) — 主持人專用
  // ----------------------------------------------------------
  onSafe('getAdaptiveDirectorStatus', (payload?: { roomId?: string }) => {
    const gs = (payload?.roomId ? rooms.get(payload.roomId) : null) ?? getRoomState(socket);
    if (!gs || !isRoomAdmin(socket, gs)) return;
    emitAdaptiveDirectorStatus(gs);
  });

  onSafe('setAdaptiveDirectorEnabled', (payload: { enabled: boolean; roomId?: string }) => {
    const gs = (payload?.roomId ? rooms.get(payload.roomId) : null) ?? getRoomState(socket);
    if (!gs) { emitClient(socket, 'error', { message: '尚未加入任何房間。' }); return; }
    if (!isRoomAdmin(socket, gs)) {
      emitClient(socket, 'error', { message: '只有主持人可以調整自動難度。' });
      return;
    }
    gs.adaptiveDirector.enabled = Boolean(payload.enabled);
    emitAdaptiveDirectorStatus(gs);
  });

  onSafe('triggerGlobalEvent', (payload: { eventId: string; roomId?: string }) => {
    const gs = (payload.roomId ? rooms.get(payload.roomId) : null) ?? getRoomState(socket);
    if (!gs) { emitClient(socket, 'error', { message: '尚未加入任何房間。' }); return; }
    const roomId = gs.gameId;

    if (!isRoomAdmin(socket, gs)) {
      emitClient(socket, 'error', { message: '權限不足：僅管理員可觸發全局事件。' });
      return;
    }
    const event = ADMIN_GLOBAL_EVENT_MAP.get(payload.eventId);
    if (!event) {
      emitClient(socket, 'error', { message: `找不到事件 ID：${payload.eventId}` });
      return;
    }

    const restriction = worldEventRestriction(gs, event);
    if (restriction || gs.pendingWorldEvent) {
      emitClient(socket, 'error', { message: restriction ?? '已有待登場的世界事件，請先處理或取消。' });
      return;
    }
    gs.pendingWorldEvent = { id: randomBytes(8).toString('hex'), event, source: 'manual', deferred: false };
    tryOpenWorldEvent(gs);
    emitAdaptiveDirectorStatus(gs);
    emitToRoom(roomId, 'gameStateUpdate', serializeGameState(gs));
  });

  onSafe('manageWorldEvent', (payload?: { id?: string; action?: string }) => {
    const gs = getRoomState(socket);
    if (!gs || !isRoomAdmin(socket, gs)) { emitClient(socket, 'error', { message: '只有主持人可以安排世界事件。' }); return; }
    if (!gs.pendingWorldEvent || gs.pendingWorldEvent.id !== payload?.id) { emitClient(socket, 'error', { message: '待登場事件已更新。' }); return; }
    if (gs.facilitatorScene?.kind === 'global_event') { emitClient(socket, 'error', { message: '請使用目前舞台上的按鈕。' }); return; }
    if (payload.action === 'cancel') gs.pendingWorldEvent = null;
    else if (payload.action === 'open') { gs.pendingWorldEvent.deferred = false; tryOpenWorldEvent(gs); }
    else return;
    emitAdaptiveDirectorStatus(gs);
  });

  // ----------------------------------------------------------
  // 觸發特殊拍賣 (triggerSpecialAuction) — 主持人專用
  // 從 SPECIAL_AUCTION_DEALS 牌組隨機抽 1 張，廣播給所有玩家競標；結束時機由主持人控制。
  // 起標金額 = downPayment ?? cost；得標者扣現金後該資產直接寫入持有，
  // 起標金額會以「無主來源」（沒有原持有者）銷毀，等同新發行的特殊資產。
  // ----------------------------------------------------------
  onSafe('triggerSpecialAuction', async (payload: { roomId?: string; cardId?: string }) => {
    const gs = (payload?.roomId ? rooms.get(payload.roomId) : null) ?? getRoomState(socket);
    if (!gs) { emitClient(socket, 'error', { message: '尚未加入任何房間。' }); return; }
    const roomId = gs.gameId;

    if (!isRoomAdmin(socket, gs)) {
      emitClient(socket, 'error', { message: '權限不足：僅管理員可觸發特殊拍賣。' });
      return;
    }
    if (![GamePhase.RatRace, GamePhase.FastTrack].includes(gs.gamePhase) || gs.finalRoundStarted
      || gs.turnInProgress || gs.decisionPhase || gs.facilitatorScene || gs.globalPaydayPending || gs.globalPaydayInProgress
      || Object.keys(gs.activeAuctions ?? {}).length > 0) {
      emitClient(socket, 'error', { message: '請在遊戲進行中，完成目前決策、舞台事件與季度發薪後再開啟拍賣。' });
      return;
    }

    const { SPECIAL_AUCTION_DEALS } = require('../gameCards') as typeof import('../gameCards');
    const pool: DealCard[] = SPECIAL_AUCTION_DEALS;
    const auctionCard = payload?.cardId
      ? (pool.find((c) => c.id === payload.cardId) ?? pool[Math.floor(Math.random() * pool.length)])
      : pool[Math.floor(Math.random() * pool.length)];

    if (!auctionCard) {
      emitClient(socket, 'error', { message: '特殊拍賣牌組已空。' });
      return;
    }

    if (!gs.activeAuctions) gs.activeAuctions = {};
    const minBid = auctionCard.asset.downPayment ?? auctionCard.asset.cost ?? 0;
    const auctionId = `special-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const auctionEndTime = 0;

    gs.activeAuctions[auctionId] = {
      dealCardId: auctionCard.id,
      startTime: Date.now(),
      endTime: auctionEndTime,
      highestBid: 0,
      minBid,
      // 特殊拍賣沒有「原持有者」（資產由銀行/市場新發行），triggeredBy 設為主持人
      triggeredBy: '__admin__',
      triggeredByName: '主持人',
      cardInfo: {
        name: auctionCard.title,
        monthlyCashflow: auctionCard.asset.monthlyCashflow ?? 0,
        downPayment: minBid,
      },
    };

    emitToRoom(roomId, 'dealAuctionStarted', {
      auctionId,
      triggeredBy: '__admin__',
      triggeredByName: '主持人',
      isSpecialAuction: true,
      card: {
        id: auctionCard.id,
        name: auctionCard.title,
        description: auctionCard.description,
        minBid,
        monthlyCashflow: auctionCard.asset.monthlyCashflow,
      },
      endsAt: auctionEndTime,
      controlledByHost: true,
    });

    const decisionContext = beginHostDecisionPhase(
      gs,
      { id: '__all_players__', name: '全體玩家' },
      'auction',
      `特殊拍賣：${auctionCard.title}`,
    );
    await waitForHostRelease(gs, decisionContext);

    const auction = gs.activeAuctions?.[auctionId];
    if (!auction) return;
    delete gs.activeAuctions![auctionId];

    if (auction.highestBidderId && auction.highestBid >= minBid) {
      const winner = gs.players.get(auction.highestBidderId);
      if (winner && winner.cash >= auction.highestBid) {
        const _wCB = winner.cash; const _wFB = winner.monthlyCashflow; const _wNWB = calcNetWorth(winner);
        // 特殊拍賣：得標金額蒸發（市場新發行），不轉給任何玩家
        acceptDealCard(winner, auctionCard, auction.highestBid);
        logPlayerEvent(
          winner, gs, 'asset_buy',
          `特殊拍賣得標：${auctionCard.title}（月現金流 ${(auctionCard.asset.monthlyCashflow ?? 0) >= 0 ? '+' : ''}$${auctionCard.asset.monthlyCashflow ?? 0}）`,
          _wCB, _wFB, _wNWB,
          { cardId: auctionCard.id, cardTitle: auctionCard.title, monthlyCashflow: auctionCard.asset.monthlyCashflow, isSpecialAuction: true }
        );
        emitToRoom(roomId, 'dealAuctionEnded', {
          auctionId,
          winnerId: auction.highestBidderId,
          winnerName: auction.highestBidderName,
          winningBid: auction.highestBid,
          cardName: auctionCard.title,
          hadBids: true,
          isSpecialAuction: true,
        });
        tryOpenWorldEvent(gs);
        emitToRoom(roomId, 'gameStateUpdate', serializeGameState(gs));
        return;
      }
    }

    emitToRoom(roomId, 'dealAuctionEnded', {
      auctionId, winnerId: null, winnerName: null,
      winningBid: 0, cardName: auctionCard.title, hadBids: false,
      isSpecialAuction: true,
    });
    tryOpenWorldEvent(gs);
    emitToRoom(roomId, 'gameStateUpdate', serializeGameState(gs));
  });
}
