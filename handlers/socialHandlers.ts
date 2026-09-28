/** 玩家互動：合夥、玩家借貸、競標、祝賀、邂逅、婚姻（由 socketServer 註冊到每條連線） */
import type { Socket } from 'socket.io';
import { randomBytes } from 'crypto';
import { validatePlayerLoan } from '../playerLoans';
import { AssetType } from '../gameDataModels';
import { activateRelationship, buyArrangedMarriage } from '../gameLogic';
import { RELATIONSHIP_MARRIAGE_THRESHOLD, HOST_ACTIVATION_DRS_BONUS, getLoanLimit } from '../gameConfig';
import {
  OnSafe, calcNetWorth, emitClient, emitToRoom, getPlayerSocket, getRoomState,
  io, isRoomAdmin, logPlayerEvent, playerIdentity, serializeGameState, socketRoomMap,
} from '../socketServer';

export function registerSocialHandlers(socket: Socket, onSafe: OnSafe): void {

  // ----------------------------------------------------------
  // 合夥投資（partnershipOffer / partnershipResponse）
  // ----------------------------------------------------------
  onSafe('partnershipOffer', (payload: { targetPlayerId: string; dealCardId?: string }) => {
    const gs = getRoomState(socket);
    if (!gs) { emitClient(socket, 'error', { message: '尚未加入任何房間。' }); return; }
    const roomId = gs.gameId;

    const offeror = gs.players.get(playerIdentity(socket));
    const target = gs.players.get(payload.targetPlayerId);
    if (!offeror || !target) { emitClient(socket, 'error', { message: '玩家不存在。' }); return; }
    if (!target.isAlive) { emitClient(socket, 'error', { message: '目標玩家已出局。' }); return; }

    // 儲存待定合夥 offer（用 Map 存放）
    const offerId = `po-${Date.now()}`;
    if (!gs.pendingPartnershipOffers) gs.pendingPartnershipOffers = {};
    gs.pendingPartnershipOffers[offerId] = {
      offerorId: playerIdentity(socket),
      targetId: payload.targetPlayerId,
      dealCardId: payload.dealCardId,
      createdAt: Date.now(),
    };

    // 通知目標玩家
    const targetSocket = [...socketRoomMap.entries()].find(([, r]) => r === roomId && gs.players.has(playerIdentity(socket)));
    // 廣播給目標玩家的 socket
    emitToRoom(roomId, 'partnershipOfferReceived', {
      offerId,
      offerorId: playerIdentity(socket),
      offerorName: offeror.name,
      targetId: payload.targetPlayerId,
      targetName: target.name,
      dealCardId: payload.dealCardId,
    });

    console.log(`[partnership] ${offeror.name} 邀請 ${target.name} 合夥`);
  });

  onSafe('partnershipResponse', (payload: { offerId: string; accepted: boolean }) => {
    const gs = getRoomState(socket);
    if (!gs) return;
    const roomId = gs.gameId;

    const offer = gs.pendingPartnershipOffers?.[payload.offerId];
    if (!offer) { emitClient(socket, 'error', { message: '合夥邀請已過期。' }); return; }

    const offeror = gs.players.get(offer.offerorId);
    const target = gs.players.get(playerIdentity(socket));
    if (!offeror || !target) return;

    delete gs.pendingPartnershipOffers![payload.offerId];

    if (!payload.accepted) {
      emitToRoom(roomId, 'partnershipDeclined', { offerorId: offer.offerorId, targetId: playerIdentity(socket) });
      return;
    }

    // 雙方各加生命體驗值
    offeror.lifeExperience += 15;
    target.lifeExperience += 15;

    // A1：合作分紅 — 雙方被動收入總和 × 3% 一次性現金（最低 $3,000、最高 $50,000）
    const passiveSum = offeror.totalPassiveIncome + target.totalPassiveIncome;
    const dividend = Math.max(3_000, Math.min(50_000, Math.round(passiveSum * 0.03)));
    offeror.cash += dividend;
    target.cash += dividend;
    logPlayerEvent(
      offeror, gs, 'asset_buy',
      `🤝 與 ${target.name} 合夥分紅 +$${dividend.toLocaleString()}（雙方被動收入總和 $${passiveSum.toLocaleString()}）`,
      offeror.cash - dividend, offeror.monthlyCashflow, calcNetWorth(offeror) - dividend,
      { partnerId: target.id, partnerName: target.name, dividend }
    );
    logPlayerEvent(
      target, gs, 'asset_buy',
      `🤝 與 ${offeror.name} 合夥分紅 +$${dividend.toLocaleString()}（雙方被動收入總和 $${passiveSum.toLocaleString()}）`,
      target.cash - dividend, target.monthlyCashflow, calcNetWorth(target) - dividend,
      { partnerId: offeror.id, partnerName: offeror.name, dividend }
    );

    emitToRoom(roomId, 'partnershipAccepted', {
      offerorId: offer.offerorId, offerorName: offeror.name,
      targetId: playerIdentity(socket),        targetName: target.name,
      dividend,
      passiveSum,
    });
    emitToRoom(roomId, 'gameStateUpdate', serializeGameState(gs));
    console.log(`[partnership] ${offeror.name} 與 ${target.name} 合夥成功，分紅 $${dividend}`);
  });

  // ----------------------------------------------------------
  // P2P 借貸（loanOffer / loanResponse / repayP2PLoan）
  // ----------------------------------------------------------
  onSafe('loanOffer', (payload: { targetPlayerId: string; amount: number; monthlyRate: number }) => {
    const gs = getRoomState(socket);
    if (!gs) return;
    const roomId = gs.gameId;

    const lender = gs.players.get(playerIdentity(socket));
    const borrower = gs.players.get(payload.targetPlayerId);
    if (!lender || !borrower) { emitClient(socket, 'error', { message: '玩家不存在。' }); return; }
    const invalid = validatePlayerLoan(lender, borrower, payload.amount, payload.monthlyRate);
    if (invalid) { emitClient(socket, 'error', { message: invalid }); return; }
    if (lender.cash < payload.amount) { emitClient(socket, 'error', { message: `現金不足（$${payload.amount}）。` }); return; }
    if (payload.monthlyRate < 0 || payload.monthlyRate > 0.1) { emitClient(socket, 'error', { message: '月利率需在 0–10% 之間。' }); return; }

    const offerId = `lo-${randomBytes(12).toString("hex")}`;
    if (!gs.pendingLoanOffers) gs.pendingLoanOffers = {};
    gs.pendingLoanOffers[offerId] = { lenderId: playerIdentity(socket), borrowerId: payload.targetPlayerId, amount: payload.amount, monthlyRate: payload.monthlyRate, createdAt: Date.now() };

    emitToRoom(roomId, 'loanOfferReceived', {
      offerId, lenderId: playerIdentity(socket), lenderName: lender.name,
      borrowerId: payload.targetPlayerId, borrowerName: borrower.name,
      amount: payload.amount, monthlyRate: payload.monthlyRate,
    });
  });

  onSafe('loanResponse', (payload: { offerId: string; accepted: boolean }) => {
    const gs = getRoomState(socket);
    if (!gs) return;
    const roomId = gs.gameId;

    const offer = gs.pendingLoanOffers?.[payload.offerId];
    if (!offer) { emitClient(socket, 'error', { message: '借貸邀請已過期。' }); return; }

    // ⚠ 安全性：只有「指定的借款人」可以接受／拒絕這筆 offer
    if (playerIdentity(socket) !== offer.borrowerId) {
      emitClient(socket, 'error', { message: '此借貸邀請不是給你的，無權回應。' });
      return;
    }

    const lender = gs.players.get(offer.lenderId);
    const borrower = gs.players.get(playerIdentity(socket));
    if (!lender || !borrower) return;

    delete gs.pendingLoanOffers![payload.offerId];

    if (!payload.accepted) {
      emitToRoom(roomId, 'loanDeclined', { lenderId: offer.lenderId, borrowerId: playerIdentity(socket) });
      return;
    }
    const invalid = Date.now() - offer.createdAt > 120_000 ? '借貸邀請已過期，請重新提出。' : validatePlayerLoan(lender, borrower, offer.amount, offer.monthlyRate);
    if (invalid) { emitClient(socket, 'error', { message: invalid }); return; }

    if (lender.cash < offer.amount) { emitClient(socket, 'error', { message: '貸款方現金已不足。' }); return; }

    // 資金轉移
    lender.cash -= offer.amount;
    borrower.cash += offer.amount;

    const loanId = `p2p-${randomBytes(12).toString("hex")}`;
    const monthlyInterest = Math.round(offer.amount * offer.monthlyRate);

    // 貸款方：新增「借出款項」資產
    lender.assets.push({
      id: loanId,
      name: `借出給 ${borrower.name}`,
      type: AssetType.Other,
      cost: offer.amount,
      currentValue: offer.amount,
      monthlyCashflow: monthlyInterest,
    });

    // 借款方：新增負債
    borrower.liabilities.push({
      id: loanId,
      name: `向 ${lender.name} 借款`,
      totalDebt: offer.amount,
      monthlyPayment: monthlyInterest,
      monthlyRate: offer.monthlyRate,
    });
    // ⚠ 不再寫入 otherExpenses（會被無擔保負債月付自動加進 totalExpenses）。
    // 過去這樣寫會導致還清後 otherExpenses 殘留幽靈月息。

    emitToRoom(roomId, 'loanAccepted', {
      loanId, lenderId: offer.lenderId, lenderName: lender.name,
      borrowerId: playerIdentity(socket), borrowerName: borrower.name,
      amount: offer.amount, monthlyRate: offer.monthlyRate, monthlyInterest,
    });
    emitToRoom(roomId, 'gameStateUpdate', serializeGameState(gs));
    console.log(`[p2ploan] ${lender.name} 借款 $${offer.amount} 給 ${borrower.name}（月息 $${monthlyInterest}）`);
  });

  // ----------------------------------------------------------
  // P2P 借貸：「主動請求借款」（loanRequest / loanRequestResponse）
  // 借款人發起 → 指定的貸款方可以接受/拒絕
  // ----------------------------------------------------------
  onSafe('loanRequest', (payload: { targetPlayerId: string; amount: number; monthlyRate: number }) => {
    const gs = getRoomState(socket);
    if (!gs) return;
    const roomId = gs.gameId;

    const borrower = gs.players.get(playerIdentity(socket));
    const lender = gs.players.get(payload.targetPlayerId);
    if (!borrower || !lender) { emitClient(socket, 'error', { message: '玩家不存在。' }); return; }
    if (!lender.isAlive) { emitClient(socket, 'error', { message: '對方已出局。' }); return; }
    if (borrower.id === lender.id) { emitClient(socket, 'error', { message: '不能向自己借款。' }); return; }
    if (!Number.isFinite(payload.amount) || payload.amount <= 0) {
      emitClient(socket, 'error', { message: '借款金額必須為正數。' }); return;
    }
    if (payload.monthlyRate < 0 || payload.monthlyRate > 0.1) {
      emitClient(socket, 'error', { message: '月利率需在 0–10% 之間。' }); return;
    }
    // 借款人現有無擔保負債 + 此次借款不可超過信用上限
    const _existingUnsecured = (() => {
      const securedIds = new Set(
        borrower.assets.map((a) => a.linkedLiabilityId).filter((id): id is string => Boolean(id))
      );
      return borrower.liabilities.filter((l) => !securedIds.has(l.id))
        .reduce((s, l) => s + l.totalDebt, 0);
    })();
    const { getLoanLimit } = require('../gameConfig');
    const maxLoan = getLoanLimit(borrower.creditScore);
    if (_existingUnsecured + payload.amount > maxLoan) {
      emitClient(socket, 'error', {
        message: `超過你的借款上限 $${maxLoan.toLocaleString()}（已用 $${_existingUnsecured.toLocaleString()}）。`,
      });
      return;
    }

    const requestId = `lr-${randomBytes(12).toString("hex")}`;
    if (!gs.pendingLoanRequests) gs.pendingLoanRequests = {};
    gs.pendingLoanRequests[requestId] = {
      borrowerId: playerIdentity(socket), lenderId: payload.targetPlayerId,
      amount: payload.amount, monthlyRate: payload.monthlyRate, createdAt: Date.now(),
    };

    emitToRoom(roomId, 'loanRequestReceived', {
      requestId,
      borrowerId: playerIdentity(socket), borrowerName: borrower.name,
      lenderId: payload.targetPlayerId, lenderName: lender.name,
      amount: payload.amount, monthlyRate: payload.monthlyRate,
    });
    console.log(`[loanRequest] ${borrower.name} 請求 ${lender.name} 借款 $${payload.amount}（月利率 ${(payload.monthlyRate * 100).toFixed(2)}%）`);
  });

  onSafe('loanRequestResponse', (payload: { requestId: string; accepted: boolean }) => {
    const gs = getRoomState(socket);
    if (!gs) return;
    const roomId = gs.gameId;

    const req = gs.pendingLoanRequests?.[payload.requestId];
    if (!req) { emitClient(socket, 'error', { message: '借款請求已過期。' }); return; }

    // 安全性：只有「指定的貸款方」可以接受／拒絕
    if (playerIdentity(socket) !== req.lenderId) {
      emitClient(socket, 'error', { message: '此借款請求不是給你的，無權回應。' });
      return;
    }

    const lender = gs.players.get(playerIdentity(socket));
    const borrower = gs.players.get(req.borrowerId);
    if (!lender || !borrower) return;

    delete gs.pendingLoanRequests![payload.requestId];

    if (!payload.accepted) {
      emitToRoom(roomId, 'loanRequestDeclined', {
        requestId: payload.requestId,
        borrowerId: req.borrowerId,
        lenderId: playerIdentity(socket),
      });
      return;
    }

    if (lender.cash < req.amount) {
      emitClient(socket, 'error', { message: '你的現金已不足以提供此筆借款。' });
      return;
    }
    const invalid = Date.now() - req.createdAt > 120_000 ? '借貸邀請已過期，請重新提出。' : validatePlayerLoan(lender, borrower, req.amount, req.monthlyRate);
    if (invalid) { emitClient(socket, 'error', { message: invalid }); return; }

    // 資金轉移
    lender.cash -= req.amount;
    borrower.cash += req.amount;

    const loanId = `p2p-${randomBytes(12).toString("hex")}`;
    const monthlyInterest = Math.round(req.amount * req.monthlyRate);

    lender.assets.push({
      id: loanId,
      name: `借出給 ${borrower.name}`,
      type: AssetType.Other,
      cost: req.amount,
      currentValue: req.amount,
      monthlyCashflow: monthlyInterest,
    });

    borrower.liabilities.push({
      id: loanId,
      name: `向 ${lender.name} 借款`,
      totalDebt: req.amount,
      monthlyPayment: monthlyInterest,
      monthlyRate: req.monthlyRate,
    });

    emitToRoom(roomId, 'loanAccepted', {
      loanId,
      lenderId: playerIdentity(socket), lenderName: lender.name,
      borrowerId: req.borrowerId, borrowerName: borrower.name,
      amount: req.amount, monthlyRate: req.monthlyRate, monthlyInterest,
      initiatedBy: 'borrower',
    });
    emitToRoom(roomId, 'gameStateUpdate', serializeGameState(gs));
    console.log(`[loanRequestAccepted] ${lender.name} 同意借款 $${req.amount} 給 ${borrower.name}（月息 $${monthlyInterest}）`);
  });

  // ----------------------------------------------------------
  // BigDeal 競標（bidDeal）
  // ----------------------------------------------------------
  onSafe('bidDeal', (payload: { auctionId: string; bidAmount: number }) => {
    const gs = getRoomState(socket);
    if (!gs) return;
    const roomId = gs.gameId;

    const bidder = gs.players.get(playerIdentity(socket));
    if (!bidder || !bidder.isAlive) return;
    if (!payload || typeof payload.auctionId !== 'string' || !Number.isSafeInteger(payload.bidAmount) || payload.bidAmount <= 0) {
      emitClient(socket, 'error', { message: '請輸入有效的正整數出價。' }); return;
    }

    if (!gs.activeAuctions) gs.activeAuctions = {};
    const auction = gs.activeAuctions[payload.auctionId];
    if (!auction) { emitClient(socket, 'error', { message: '競標已結束或不存在。' }); return; }
    if (auction.triggeredBy === bidder.id) { emitClient(socket, 'error', { message: '這是你放棄的交易，不能自己出價。' }); return; }
    if (bidder.cash < payload.bidAmount) { emitClient(socket, 'error', { message: `現金不足（目前 $${bidder.cash.toLocaleString()}）。` }); return; }
    if (payload.bidAmount < (auction.minBid ?? 0)) { emitClient(socket, 'error', { message: `出價不得低於起標金額 $${(auction.minBid ?? 0).toLocaleString()}。` }); return; }
    if (payload.bidAmount <= (auction.highestBid ?? 0)) { emitClient(socket, 'error', { message: '出價需高於目前最高標。' }); return; }

    auction.highestBid = payload.bidAmount;
    auction.highestBidderId = playerIdentity(socket);
    auction.highestBidderName = bidder.name;
    (auction.bids ??= []).push({ bidderId: bidder.id, bidderName: bidder.name, amount: payload.bidAmount, at: Date.now() });

    emitToRoom(roomId, 'dealBidUpdated', {
      auctionId: payload.auctionId, bidderId: playerIdentity(socket), bidderName: bidder.name,
      bidAmount: payload.bidAmount, newHighest: payload.bidAmount,
    });
    emitToRoom(roomId, 'gameStateUpdate', serializeGameState(gs));
  });

  // ----------------------------------------------------------
  // 人生事件祝賀（congratulate）
  // ----------------------------------------------------------
  onSafe('congratulate', (payload: { targetPlayerId: string; event: string; amount?: number }) => {
    const gs = getRoomState(socket);
    if (!gs) return;
    const roomId = gs.gameId;

    const sender = gs.players.get(playerIdentity(socket));
    const target = gs.players.get(payload.targetPlayerId);
    if (!sender || !target) return;
    if (!sender.isAlive) { emitClient(socket, 'error', { message: '已出局玩家無法送祝賀。' }); return; }
    if (!target.isAlive) { emitClient(socket, 'error', { message: '對方已離世，無法送上祝賀。' }); return; }
    const CONGRATS_PER_NT = 5;
    const CONGRATS_AMOUNT = Number.isSafeInteger(payload.amount) ? Number(payload.amount) : 7_500;
    if (CONGRATS_AMOUNT < 1_000 || CONGRATS_AMOUNT > 300_000) { emitClient(socket, 'error', { message: '祝賀金額需介於 $1,000 到 $300,000。' }); return; }
    if (sender.cash < CONGRATS_AMOUNT) { emitClient(socket, 'error', { message: `現金不足（需 $${CONGRATS_AMOUNT.toLocaleString()}）。` }); return; }

    sender.cash -= CONGRATS_AMOUNT;
    target.cash += CONGRATS_AMOUNT;
    // 每收到 5 次祝賀 NT +1，人脈值維持整數
    target.congratulationsReceived += 1;
    let networkGain = 0;
    if (target.congratulationsReceived % CONGRATS_PER_NT === 0) {
      const ntCap = target.profession.salaryType === 'nt_driven' ? Infinity : 10;
      const before = target.stats.network;
      target.stats.network = Math.min(ntCap, target.stats.network + 1);
      networkGain = target.stats.network - before;
    }

    emitToRoom(roomId, 'congratulationSent', {
      senderId: playerIdentity(socket), senderName: sender.name,
      targetId: payload.targetPlayerId, targetName: target.name,
      event: payload.event, amount: CONGRATS_AMOUNT,
      networkGain,
      congratulationsReceived: target.congratulationsReceived,
      congratulationsPerNT: CONGRATS_PER_NT,
    });
    emitToRoom(roomId, 'gameStateUpdate', serializeGameState(gs));
  });

  // ----------------------------------------------------------
  // 主持人觸發邂逅 (triggerRelationship)
  // ----------------------------------------------------------
  onSafe('triggerRelationship', (payload: { targetPlayerId: string }) => {
    const gs = getRoomState(socket);
    if (!gs) { emitClient(socket, 'error', { message: '尚未加入任何房間。' }); return; }
    const roomId = gs.gameId;

    if (!isRoomAdmin(socket, gs)) {
      emitClient(socket, 'error', { message: '只有管理員可以觸發邂逅事件。' });
      return;
    }
    if ((gs.decisionPhase && gs.decisionPhase.kind !== 'actions') || gs.facilitatorScene || gs.globalPaydayPending || gs.globalPaydayInProgress) {
      emitClient(socket, 'error', { message: '請先完成目前的全場決策或舞台事件（全體行動時間內可以觸發）。' });
      return;
    }

    const target = gs.players.get(payload?.targetPlayerId);
    if (!target || !target.isAlive) {
      emitClient(socket, 'error', { message: '目標玩家不存在或已出局。' });
      return;
    }

    const result = activateRelationship(target);
    emitClient(socket, 'triggerRelationshipResult', { ...result, targetPlayerId: target.id, targetName: target.name });

    if (result.activated) {
      console.log(`[relationship] ${target.name}（${roomId}）邂逅觸發`);

      // 找到目標玩家的 socket 並直接通知
      const targetSocketEntry = [...io.sockets.sockets.entries()]
        .find(([, s]) => socketRoomMap.get(s.id) === roomId && s.id === target.id);
      if (targetSocketEntry) {
        targetSocketEntry[1].emit('relationshipActivated', {
          drsBonus: HOST_ACTIVATION_DRS_BONUS,
          currentDrs: target.relationshipPoints,
          threshold: require('../gameConfig').RELATIONSHIP_MARRIAGE_THRESHOLD,
        });
      } else {
        // fallback：直接用 target.id 找 socket
        const targetSocket = getPlayerSocket(target.id);
        if (targetSocket) {
          emitClient(targetSocket, 'relationshipActivated', {
            drsBonus: HOST_ACTIVATION_DRS_BONUS,
            currentDrs: target.relationshipPoints,
            threshold: require('../gameConfig').RELATIONSHIP_MARRIAGE_THRESHOLD,
          });
        }
      }

      emitToRoom(roomId, 'cellEventBroadcast', {
        playerId: target.id,
        playerName: target.name,
        cellName: '邂逅機緣',
        message: `💞 ${target.name} 的關係路徑啟動，DRS +${HOST_ACTIVATION_DRS_BONUS}，目前 ${target.relationshipPoints}/${RELATIONSHIP_MARRIAGE_THRESHOLD}。`,
        ts: Date.now(),
      });
      emitToRoom(roomId, 'gameStateUpdate', serializeGameState(gs));
    }
  });

  // ----------------------------------------------------------
  // 求婚 (proposeMarriage)
  // ----------------------------------------------------------
  onSafe('proposeMarriage', (payload: { type?: 'love' | 'matchmaker' }) => {
    const gs = getRoomState(socket);
    if (!gs) { emitClient(socket, 'error', { message: '尚未加入任何房間。' }); return; }

    const player = gs.players.get(playerIdentity(socket));
    if (!player || !player.isAlive) {
      emitClient(socket, 'error', { message: '玩家不存在或已出局。' });
      return;
    }

    void payload;
    emitClient(socket, 'error', { message: '婚姻必須在大螢幕共同觀看，請由主持人開啟婚姻舞台。' });
  });

  // ----------------------------------------------------------
  // 買賣婚姻 (buyArrangedMarriage)
  // ----------------------------------------------------------
  onSafe('buyArrangedMarriage', () => {
    const gs = getRoomState(socket);
    if (!gs) { emitClient(socket, 'error', { message: '尚未加入任何房間。' }); return; }

    const player = gs.players.get(playerIdentity(socket));
    if (!player || !player.isAlive) {
      emitClient(socket, 'error', { message: '玩家不存在或已出局。' });
      return;
    }

    emitClient(socket, 'error', { message: '付費婚配必須由主持人在大螢幕開啟並確認。' });
  });
}
