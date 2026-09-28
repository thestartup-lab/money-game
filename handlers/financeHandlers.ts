/** 手機財務行動：資產、保險、借還款、買房、投資、加盟、旅遊、聯誼（由 socketServer 註冊到每條連線） */
import type { Socket } from 'socket.io';
import { repayRoomLoan } from '../playerLoans';
import { buyHome } from '../householdLoans';
import { investBondFund } from '../bondFund';
import { createPlayer, sellAsset, buyInsurance, cancelInsurance, takeEmergencyLoan, takeLeverageLoan, repayLoan, InsuranceType, goTravel, attendSocialEvent } from '../gameLogic';
import { FRANCHISE_CASH_THRESHOLD, PROFESSIONS, STOCK_DCA_MONTHLY_DIVIDEND_RATE } from '../gameConfig';
import {
  OnSafe, announceCareerUnlock, calcNetWorth, emitCellEvent, emitClient, emitToRoom,
  executeSocialAction, executeTravelAction, getRoomState, logPlayerEvent, playerIdentity, serializeGameState,
  isActionWindowOpen,
} from '../socketServer';

export function registerFinanceHandlers(socket: Socket, onSafe: OnSafe): void {

  // ----------------------------------------------------------
  // 出售資產 (sellAsset)
  // ----------------------------------------------------------
  onSafe('sellAsset', (payload: { assetId: string }) => {
    const gs = getRoomState(socket);
    if (!gs) { emitClient(socket, 'error', { message: '尚未加入任何房間。' }); return; }

    const player = gs.players.get(playerIdentity(socket));
    if (!player || !player.isAlive) {
      emitClient(socket, 'error', { message: '玩家不存在或已出局。' });
      return;
    }

    const _saCB = player.cash; const _saFB = player.monthlyCashflow; const _saNWB = calcNetWorth(player);
    const result = sellAsset(player, payload.assetId);
    if (!result.success) {
      emitClient(socket, 'error', { message: result.message });
      return;
    }
    logPlayerEvent(player, gs, 'asset_sell', result.message ?? `出售資產，淨收益 $${(result.netCashChange ?? 0).toLocaleString()}${result.capitalGainsTax ? `（資本利得稅 $${result.capitalGainsTax.toLocaleString()}）` : ''}`, _saCB, _saFB, _saNWB, { assetId: result.assetId, proceeds: result.proceeds, debtSettled: result.debtSettled, capitalGainsTax: result.capitalGainsTax });

    emitClient(socket, 'assetSold', {
      assetId: result.assetId,
      proceeds: result.proceeds,
      debtSettled: result.debtSettled,
      netCashChange: result.netCashChange,
      capitalGainsTax: result.capitalGainsTax ?? 0,
      message: result.message,
    });

    emitToRoom(gs.gameId, 'gameStateUpdate', serializeGameState(gs));
  });

  // ----------------------------------------------------------
  // 購買保險 (buyInsurance)
  // ----------------------------------------------------------
  onSafe('buyInsurance', (payload: { insuranceType: InsuranceType }) => {
    const gs = getRoomState(socket);
    if (!gs) { emitClient(socket, 'error', { message: '尚未加入任何房間。' }); return; }

    const player = gs.players.get(playerIdentity(socket));
    if (!player || !player.isAlive) {
      emitClient(socket, 'error', { message: '玩家不存在或已出局。' });
      return;
    }

    const insCash = player.cash;
    const insFlow = player.monthlyCashflow;
    const insWorth = calcNetWorth(player);
    const result = buyInsurance(player, payload.insuranceType);
    if (!result.success) {
      emitClient(socket, 'error', { message: result.message });
      return;
    }
    const insuranceLabel = ({ medical: '醫療險', life: '壽險', property: '產險' } as Record<string, string>)[payload.insuranceType] ?? payload.insuranceType;
    logPlayerEvent(player, gs, 'insurance', `投保 ${insuranceLabel}（啟動費 $${(result.activationFee ?? 0).toLocaleString()}，每月保費計入支出）`, insCash, insFlow, insWorth,
      { insuranceType: payload.insuranceType, activationFee: result.activationFee });

    emitClient(socket, 'insuranceUpdated', {
      insuranceType: payload.insuranceType,
      active: true,
      activationFee: result.activationFee,
      newMonthlyExpenses: player.totalExpenses,
    });

    const INSURANCE_LABEL: Record<string, string> = { medical: '醫療險', life: '壽險', property: '財產險' };
    emitCellEvent(socket, gs.gameId, player.name, '購買保險',
      `${player.name} 購買了 ${INSURANCE_LABEL[payload.insuranceType] ?? payload.insuranceType}`);

    emitToRoom(gs.gameId, 'gameStateUpdate', serializeGameState(gs));
  });

  // ----------------------------------------------------------
  // 取消保險 (cancelInsurance)
  // ----------------------------------------------------------
  onSafe('cancelInsurance', (payload: { insuranceType: InsuranceType }) => {
    const gs = getRoomState(socket);
    if (!gs) { emitClient(socket, 'error', { message: '尚未加入任何房間。' }); return; }

    const player = gs.players.get(playerIdentity(socket));
    if (!player || !player.isAlive) {
      emitClient(socket, 'error', { message: '玩家不存在或已出局。' });
      return;
    }

    cancelInsurance(player, payload.insuranceType);

    emitClient(socket, 'insuranceUpdated', {
      insuranceType: payload.insuranceType,
      active: false,
      activationFee: 0,
      newMonthlyExpenses: player.totalExpenses,
    });

    emitToRoom(gs.gameId, 'gameStateUpdate', serializeGameState(gs));
  });

  // ----------------------------------------------------------
  // 應急借款 (takeEmergencyLoan)
  // ----------------------------------------------------------
  onSafe('takeEmergencyLoan', (payload: { amount: number }) => {
    const gs = getRoomState(socket);
    if (!gs) { emitClient(socket, 'error', { message: '尚未加入任何房間。' }); return; }

    const player = gs.players.get(playerIdentity(socket));
    if (!player || !player.isAlive) {
      emitClient(socket, 'error', { message: '玩家不存在或已出局。' });
      return;
    }

    const result = takeEmergencyLoan(player, payload.amount);
    if (!result.success) {
      emitClient(socket, 'error', { message: result.message });
      return;
    }

    emitClient(socket, 'loanTaken', {
      liabilityId: result.liabilityId,
      loanType: 'emergency',
      amount: result.amount,
      monthlyPayment: result.monthlyPayment,
      newCreditScore: result.newCreditScore,
    });

    emitToRoom(gs.gameId, 'gameStateUpdate', serializeGameState(gs));
  });

  // ----------------------------------------------------------
  // 股票定期定額投資 (investStockDCA)
  // ----------------------------------------------------------
  // ----------------------------------------------------------
  // 買自住房 (buyHome)：租屋 → 自有；頭期款 20%、30 年房貸
  // ----------------------------------------------------------
  onSafe('buyHome', (payload: { optionId: string }) => {
    const gs = getRoomState(socket);
    if (!gs) { emitClient(socket, 'error', { message: '尚未加入任何房間。' }); return; }
    const player = gs.players.get(playerIdentity(socket));
    if (!player || !player.isAlive) { emitClient(socket, 'error', { message: '玩家不存在或已出局。' }); return; }
    if (gs.decisionPhase && gs.decisionPhase.kind !== 'actions' && !(gs.decisionPhase.rescue && gs.decisionPhase.playerId === player.id)) {
      emitClient(socket, 'error', { message: '決策進行中，請等這個決策結束再買房。' }); return;
    }
    const _bhCB = player.cash; const _bhFB = player.monthlyCashflow; const _bhNWB = calcNetWorth(player);
    const result = buyHome(player, payload.optionId);
    if (!result.success) { emitClient(socket, 'error', { message: result.message }); return; }
    logPlayerEvent(player, gs, 'asset_buy', result.message, _bhCB, _bhFB, _bhNWB, { source: 'home', optionId: payload.optionId, price: result.price, monthlyPayment: result.monthlyPayment });
    emitClient(socket, 'homeBought', result);
    emitToRoom(gs.gameId, 'notification', { message: `🏠 ${player.name} 買了房子：${result.message}` });
    emitToRoom(gs.gameId, 'gameStateUpdate', serializeGameState(gs));
  });

  // 債券基金 (investBond)：不限額，穩定配息
  onSafe('investBond', (payload: { amount: number }) => {
    const gs = getRoomState(socket);
    if (!gs) { emitClient(socket, 'error', { message: '尚未加入任何房間。' }); return; }
    const player = gs.players.get(playerIdentity(socket));
    if (!player || !player.isAlive) { emitClient(socket, 'error', { message: '玩家不存在或已出局。' }); return; }
    const _bdCB = player.cash; const _bdFB = player.monthlyCashflow; const _bdNWB = calcNetWorth(player);
    const result = investBondFund(player, payload.amount);
    if (!result.success) { emitClient(socket, 'error', { message: result.message }); return; }
    logPlayerEvent(player, gs, 'asset_buy', result.message, _bdCB, _bdFB, _bdNWB, { source: 'bond', amount: payload.amount });
    emitClient(socket, 'bondResult', result);
    emitToRoom(gs.gameId, 'gameStateUpdate', serializeGameState(gs));
  });

  onSafe('investStockDCA', (payload: { amount: number }) => {
    const gs = getRoomState(socket);
    if (!gs) { emitClient(socket, 'error', { message: '尚未加入任何房間。' }); return; }

    const player = gs.players.get(playerIdentity(socket));
    if (!player || !player.isAlive) {
      emitClient(socket, 'error', { message: '玩家不存在或已出局。' });
      return;
    }

    const amount = payload.amount ?? 0;
    if (amount <= 0) { emitClient(socket, 'error', { message: '投資金額必須大於 0。' }); return; }
    if (player.cash < amount) { emitClient(socket, 'error', { message: '現金不足，無法投資。' }); return; }

    const dcaCash = player.cash;
    const dcaFlow = player.monthlyCashflow;
    const dcaWorth = calcNetWorth(player);
    player.cash -= amount;
    const existing = player.assets.find((a) => a.id === 'stock-dca');
    if (existing) {
      existing.cost += amount;
      existing.currentValue = (existing.currentValue ?? existing.cost) + amount;
    } else {
      player.assets.push({
        id: 'stock-dca',
        name: '指數股票基金（定期定額）',
        type: 'Stock' as import('../gameConstants').AssetType,
        cost: amount,
        currentValue: amount,
        monthlyCashflow: 0,
      });
    }
    const updated = player.assets.find((a) => a.id === 'stock-dca');
    logPlayerEvent(player, gs, 'asset_buy', `股票定期定額 $${amount.toLocaleString()}（持股市值 $${Math.round(updated?.currentValue ?? amount).toLocaleString()}）`, dcaCash, dcaFlow, dcaWorth,
      { source: 'stock_dca', amount, monthlyCashflow: Math.round(amount * STOCK_DCA_MONTHLY_DIVIDEND_RATE) });
    emitClient(socket, 'stockDCAResult', {
      amount,
      newPortfolioValue: updated?.currentValue ?? amount,
      remainingCash: player.cash,
    });
    emitToRoom(gs.gameId, 'gameStateUpdate', serializeGameState(gs));
  });

  // ----------------------------------------------------------
  // 投資槓桿借款 (takeLeverageLoan)
  // ----------------------------------------------------------
  onSafe(
    'takeLeverageLoan',
    (payload: { amount: number; targetAssetName: string }) => {
      const gs = getRoomState(socket);
      if (!gs) { emitClient(socket, 'error', { message: '尚未加入任何房間。' }); return; }

      const player = gs.players.get(playerIdentity(socket));
      if (!player || !player.isAlive) {
        emitClient(socket, 'error', { message: '玩家不存在或已出局。' });
        return;
      }

      const result = takeLeverageLoan(player, payload.amount, payload.targetAssetName);
      if (!result.success) {
        emitClient(socket, 'error', { message: result.message });
        return;
      }

      emitClient(socket, 'loanTaken', {
        liabilityId: result.liabilityId,
        loanType: 'leverage',
        amount: result.amount,
        monthlyPayment: result.monthlyPayment,
        newCreditScore: result.newCreditScore,
      });

      emitToRoom(gs.gameId, 'gameStateUpdate', serializeGameState(gs));
    }
  );

  // ----------------------------------------------------------
  // 還款 (repayLoan)
  // ----------------------------------------------------------
  onSafe('repayLoan', (payload: { liabilityId: string; amount: number }) => {
    const gs = getRoomState(socket);
    if (!gs) { emitClient(socket, 'error', { message: '尚未加入任何房間。' }); return; }

    const player = gs.players.get(playerIdentity(socket));
    if (!player || !player.isAlive) {
      emitClient(socket, 'error', { message: '玩家不存在或已出局。' });
      return;
    }

    const result = repayRoomLoan(gs.players.values(), player, payload.liabilityId, payload.amount);
    if (!result.success) {
      emitClient(socket, 'error', { message: result.message });
      return;
    }

    emitClient(socket, 'loanRepaid', {
      liabilityId: payload.liabilityId,
      amountPaid: result.amountPaid,
      remainingDebt: result.remainingDebt,
      fullyRepaid: result.fullyRepaid,
      newCreditScore: result.newCreditScore,
    });

    emitToRoom(gs.gameId, 'gameStateUpdate', serializeGameState(gs));
  });

  // ----------------------------------------------------------
  // 申請加盟（buyFranchise）
  // ----------------------------------------------------------
  onSafe('buyFranchise', () => {
    const gs = getRoomState(socket);
    if (!gs) { emitClient(socket, 'error', { message: '尚未加入任何房間。' }); return; }
    const roomId = gs.gameId;

    const player = gs.players.get(playerIdentity(socket));
    if (!player) { emitClient(socket, 'error', { message: '玩家不存在。' }); return; }

    if (player.profession.id === 'franchise_owner') {
      emitClient(socket, 'error', { message: '你已經是加盟主，不能重複申請加盟。' });
      return;
    }
    if (!isActionWindowOpen(gs)) {
      emitClient(socket, 'error', { message: '請等目前的決策或結算結束後再申請加盟。' });
      return;
    }
    if (player.cash < FRANCHISE_CASH_THRESHOLD) {
      emitClient(socket, 'error', { message: `申請加盟需要現金 $${FRANCHISE_CASH_THRESHOLD.toLocaleString()}，你目前不足。` });
      return;
    }

    const franchise = PROFESSIONS.find((p) => p.id === 'franchise_owner');
    if (!franchise) { emitClient(socket, 'error', { message: '加盟職業設定錯誤。' }); return; }

    // ⚠ 實際扣除加盟金（先前的 bug：只檢查門檻不扣錢）
    const _bfCB = player.cash;
    const _bfFB = player.monthlyCashflow;
    player.cash -= FRANCHISE_CASH_THRESHOLD;

    player.profession = franchise;
    player.salary = franchise.startingSalary;
    player.expenses.otherExpenses = franchise.startingOtherExpenses;
    player.actionTokensThisPayday = Infinity;

    // 注入加盟店資產與負債（含 linkedLiabilityId 連結，與 createPlayer 一致）
    if (franchise.startingAssets) {
      franchise.startingAssets.forEach((tmpl, idx) => {
        const ts = Date.now();
        const assetId = `franchise-${player.id}-${ts}-${idx}`;
        const liabilityId = tmpl.liabilityAmount
          ? `franchise-loan-${player.id}-${ts}-${idx}`
          : undefined;

        player.assets.push({
          id: assetId,
          name: tmpl.name,
          type: tmpl.type,
          cost: tmpl.cost,
          currentValue: tmpl.currentValue ?? tmpl.cost,
          monthlyCashflow: tmpl.monthlyCashflow,
          linkedLiabilityId: liabilityId,
        });

        if (tmpl.liabilityAmount && liabilityId) {
          player.liabilities.push({
            id: liabilityId,
            name: tmpl.liabilityName ?? `${tmpl.name}貸款`,
            totalDebt: tmpl.liabilityAmount,
            monthlyPayment: tmpl.liabilityMonthlyPayment ?? Math.round(tmpl.liabilityAmount * 0.005),
          });
          // ⚠ 不要再把 liabilityMonthlyPayment 加進 homeMortgagePayment：
          //   負債月付會由 totalExpenses getter 自動加總（見 fix-5），且資產的
          //   monthlyCashflow 在資料設計上「已扣除貸款月付的淨額」，
          //   再加入支出會造成雙重扣除。
        }
      });
    }

    logPlayerEvent(player, gs, 'franchise', `轉職加盟主（支付 $${FRANCHISE_CASH_THRESHOLD.toLocaleString()} 加盟金）`,
      _bfCB, _bfFB, 0, {});

    console.log(`[buyFranchise] ${player.name}（${roomId}）成功申請加盟`);
    emitClient(socket, 'franchisePurchased', { professionName: franchise.name, initialCashflow: player.monthlyCashflow });
    emitToRoom(roomId, 'gameStateUpdate', serializeGameState(gs));
  });

  // ----------------------------------------------------------
  // 旅遊行動 (goTravel)
  // ----------------------------------------------------------
  onSafe('goTravel', (payload: { destinationId: string }) => {
    const gs = getRoomState(socket);
    if (!gs) { emitClient(socket, 'error', { message: '尚未加入任何房間。' }); return; }

    const player = gs.players.get(playerIdentity(socket));
    if (!player || !player.isAlive) {
      emitClient(socket, 'error', { message: '玩家不存在或已出局。' });
      return;
    }
    if (!isActionWindowOpen(gs)) {
      emitClient(socket, 'error', { message: '決策階段中請先完成目前選擇，主持人揭曉後再行動。' });
      return;
    }

    executeTravelAction(socket, gs, player, payload.destinationId);
    announceCareerUnlock(gs, player);
  });

  // ----------------------------------------------------------
  // 聯誼活動 (attendSocialEvent)
  // ----------------------------------------------------------
  onSafe('attendSocialEvent', () => {
    const gs = getRoomState(socket);
    if (!gs) { emitClient(socket, 'error', { message: '尚未加入任何房間。' }); return; }

    const player = gs.players.get(playerIdentity(socket));
    if (!player || !player.isAlive) {
      emitClient(socket, 'error', { message: '玩家不存在或已出局。' });
      return;
    }
    if (!isActionWindowOpen(gs)) {
      emitClient(socket, 'error', { message: '決策階段中請先完成目前選擇，主持人揭曉後再行動。' });
      return;
    }

    executeSocialAction(socket, gs, player);
  });
}
