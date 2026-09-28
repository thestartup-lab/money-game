/** 終局復盤與分析（由 socketServer 註冊到每條連線） */
import type { Socket } from 'socket.io';
import { Server } from 'socket.io';
import { GamePhase } from '../gameDataModels';
import { getCurrentAge, calculateLifeScore } from '../gameLogic';
import {
  OnSafe, buildSecondLifeReview, calcNetWorth, emitClient, emitToRoom, getRoomState,
  isRoomAdmin, playerIdentity,
} from '../socketServer';

export function registerReviewHandlers(socket: Socket, onSafe: OnSafe): void {

  // ----------------------------------------------------------
  // 玩家請求個人決策分析 (requestPlayerAnalysis)
  // ----------------------------------------------------------
  /**
   * 遊戲結束後（反思階段），玩家或主持人請求某位玩家的完整事件日誌與分析統計。
   * Client → Server: { targetPlayerId?: string }  省略則回傳自己的資料
   * Server → Caller: playerAnalysis { playerId, playerName, eventLog, stats }
   */
  onSafe('requestPlayerAnalysis', (payload?: { targetPlayerId?: string }) => {
    const gs = getRoomState(socket);
    if (!gs) { emitClient(socket, 'error', { message: '尚未加入任何房間。' }); return; }
    if (gs.gamePhase !== GamePhase.GameOver) {
      emitClient(socket, 'error', { message: '完整決策分析會在遊戲結束後的復盤階段開放。' });
      return;
    }

    const targetId = payload?.targetPlayerId ?? playerIdentity(socket);
    const target = gs.players.get(targetId);

    // 主持人可查詢任意玩家；玩家只能查自己
    if (targetId !== playerIdentity(socket) && !isRoomAdmin(socket, gs)) {
      emitClient(socket, 'error', { message: '只能查看自己的分析資料，或由管理員查詢。' });
      return;
    }

    if (!target) {
      emitClient(socket, 'error', { message: '玩家不存在。' });
      return;
    }

    // 彙整統計
    const eventLog = target.eventLog;
    const assetBuyCount = eventLog.filter((e) => e.type === 'asset_buy').length;
    const assetSellCount = eventLog.filter((e) => e.type === 'asset_sell').length;
    const crisisCount = eventLog.filter((e) => e.type === 'crisis').length;
    const travelCount = eventLog.filter((e) => e.type === 'travel').length;
    const paydayCount = eventLog.filter((e) => e.type === 'payday').length;
    const firstAssetAge = eventLog.find((e) =>
      (e.type === 'asset_buy' || e.type === 'payday_plan') &&
      (e.cashflowAfter > e.cashflowBefore || Number(e.meta?.monthlyCashflow ?? 0) > 0)
    )?.age ?? null;
    const escapeAge = eventLog.find((e) => e.type === 'rat_race_escaped')?.age ?? null;

    // 現金流歷史：每次發薪日的現金流快照（用於折線圖）
    const cashflowHistory = eventLog
      .filter((e) => e.type === 'payday')
      .map((e) => ({ age: e.age, cashflow: e.cashflowAfter, netWorth: e.netWorthAfter }));

    // 關鍵決策：對現金流影響最大的前 5 個非發薪日事件
    const keyDecisions = eventLog
      .filter((e) => e.type !== 'payday' && e.type !== 'death')
      .map((e) => ({
        age: e.age,
        type: e.type,
        description: e.description,
        cashflowDelta: e.cashflowAfter - e.cashflowBefore,
        cashDelta: e.cashAfter - e.cashBefore,
        netWorthDelta: e.netWorthAfter - e.netWorthBefore,
      }))
      .sort((a, b) => Math.abs(b.cashflowDelta) - Math.abs(a.cashflowDelta))
      .slice(0, 5);

    // 最終評分
    const deathAge = target.isAlive
      ? Math.round(getCurrentAge(gs))
      : (eventLog.find((e) => e.type === 'death')?.age ?? Math.round(getCurrentAge(gs)));
    const finalScore = calculateLifeScore(target, deathAge, gs.monthsPerRound);

    emitClient(socket, 'playerAnalysis', {
      playerId: target.id,
      playerName: target.name,
      profession: target.profession.name,
      quadrant: target.profession.quadrant,
      isMarried: target.isMarried,
      numberOfChildren: target.numberOfChildren,
      lifeExperience: target.lifeExperience,
      deathAge,
      finalScore,
      eventLog,
      summary: {
        assetBuyCount,
        assetSellCount,
        crisisCount,
        travelCount,
        paydayCount,
        isMarried: target.isMarried,
        numberOfChildren: target.numberOfChildren,
        escapedRatRace: target.isInFastTrack,
        finalNetWorth: calcNetWorth(target),
        finalCashflow: target.monthlyCashflow,
        finalPassiveIncome: target.totalPassiveIncome,
        finalCash: target.cash,
        finalExpenses: target.totalExpenses,
        finalHP: target.stats.health,
        finalNetwork: target.stats.network,
        totalDebt: target.liabilities.reduce((sum, liability) => sum + liability.totalDebt, 0),
        insuranceCount: Object.values(target.insurance).filter(Boolean).length,
        firstAssetAge,
        escapeAge,
        socialClass: target.socialClass,
        continuedEducation: target.hasContinuedEducation,
        secondLifeReview: buildSecondLifeReview(target),
      },
      cashflowHistory,
      keyDecisions,
    });
  });

  // ----------------------------------------------------------
  // 主持人控制大螢幕復盤頁面 (setReviewView)
  // ----------------------------------------------------------
  onSafe('setReviewView', (payload?: { view?: string }) => {
    const gs = getRoomState(socket);
    if (!gs || !isRoomAdmin(socket, gs)) {
      emitClient(socket, 'error', { message: '權限不足：只有主持人可以控制大螢幕復盤。' });
      return;
    }
    if (gs.gamePhase !== GamePhase.GameOver) {
      emitClient(socket, 'error', { message: '大螢幕復盤會在遊戲結束後開放。' });
      return;
    }

    const allowedViews = new Set(['game', 'intro', 'analysis', 'history']);
    const view = payload?.view;
    if (!view || !allowedViews.has(view)) {
      emitClient(socket, 'error', { message: '無效的復盤畫面。' });
      return;
    }

    emitToRoom(gs.gameId, 'reviewViewChanged', { view });
  });

  // ----------------------------------------------------------
  // 房間所有玩家的彙整分析（大螢幕用）(requestRoomAnalysis)
  // ----------------------------------------------------------
  /**
   * 主持人或大螢幕請求整個房間所有玩家的分析摘要（用於比較雷達圖與排行榜）。
   * Client → Server: {}
   * Server → Caller: roomAnalysis { players: [...] }
   */
  onSafe('requestRoomAnalysis', () => {
    const gs = getRoomState(socket);
    if (!gs) { emitClient(socket, 'error', { message: '尚未加入任何房間。' }); return; }
    if (gs.gamePhase !== GamePhase.GameOver) {
      emitClient(socket, 'error', { message: '全場分析會在遊戲結束後的復盤階段開放。' });
      return;
    }

    const currentAge = Math.round(getCurrentAge(gs));

    const players = Array.from(gs.players.values()).map((p) => {
      const deathAge = p.isAlive ? currentAge : (p.eventLog.find((e) => e.type === 'death')?.age ?? currentAge);
      const score = calculateLifeScore(p, deathAge, gs.monthsPerRound);
      return {
        playerId: p.id,
        playerName: p.name,
        profession: p.profession.name,
        quadrant: p.profession.quadrant,
        isAlive: p.isAlive,
        isMarried: p.isMarried,
        numberOfChildren: p.numberOfChildren,
        lifeExperience: p.lifeExperience,
        deathAge,
        escapedRatRace: p.isInFastTrack,
        finalNetWorth: calcNetWorth(p),
        finalCashflow: p.monthlyCashflow,
        finalPassiveIncome: p.totalPassiveIncome,
        finalExpenses: p.totalExpenses,
        finalHP: p.stats.health,
        finalNetwork: p.stats.network,
        insuranceCount: Object.values(p.insurance).filter(Boolean).length,
        firstAssetAge: p.eventLog.find((e) =>
          (e.type === 'asset_buy' || e.type === 'payday_plan') &&
          (e.cashflowAfter > e.cashflowBefore || Number(e.meta?.monthlyCashflow ?? 0) > 0)
        )?.age ?? null,
        escapeAge: p.eventLog.find((e) => e.type === 'rat_race_escaped')?.age ?? null,
        secondLifeReview: buildSecondLifeReview(p),
        score,
        cashflowHistory: p.eventLog
          .filter((e) => e.type === 'payday')
          .map((e) => ({ age: e.age, cashflow: e.cashflowAfter, netWorth: e.netWorthAfter })),
        eventLog: p.eventLog
          .filter((e) => ['asset_buy','asset_sell','travel','marriage','child','crisis','career_change','education','rat_race_escaped','loan_taken','franchise','relationship','community_choice','decision_echo','cooperation','legacy','global_event','payday_plan','insurance','property_event','bucket_goal_achieved','life_milestone'].includes(e.type))
          .map((e) => ({
            age: e.age,
            type: e.type,
            description: e.description,
            cashBefore: e.cashBefore,
            cashAfter: e.cashAfter,
            cashflowBefore: e.cashflowBefore,
            cashflowAfter: e.cashflowAfter,
            netWorthBefore: e.netWorthBefore,
            netWorthAfter: e.netWorthAfter,
            meta: e.meta,
          })),
      };
    });

    // 依總分排名
    players.sort((a, b) => b.score.total - a.score.total);

    // 隱藏獎項只在終局分析時計算，遊戲中不公開評分方向。
    const usedAwardPlayers = new Set<string>();
    const chooseAwardPlayer = (ranked: typeof players) =>
      ranked.find((player) => !usedAwardPlayers.has(player.playerId)) ?? ranked[0];
    const awards: Array<{
      id: string; emoji: string; title: string; playerId: string; playerName: string;
      reason: string; reflectionQuestion: string;
    }> = [];
    const addAward = (
      id: string,
      emoji: string,
      title: string,
      ranked: typeof players,
      reason: (player: typeof players[number]) => string,
      reflectionQuestion: string,
    ) => {
      const winner = chooseAwardPlayer(ranked);
      if (!winner) return;
      usedAwardPlayers.add(winner.playerId);
      awards.push({
        id,
        emoji,
        title,
        playerId: winner.playerId,
        playerName: winner.playerName,
        reason: reason(winner),
        reflectionQuestion,
      });
    };

    addAward(
      'resilience',
      '🛡️',
      '最有韌性人生',
      [...players].sort((a, b) => {
        const aCrises = gs.players.get(a.playerId)?.eventLog.filter((event) => event.type === 'crisis').length ?? 0;
        const bCrises = gs.players.get(b.playerId)?.eventLog.filter((event) => event.type === 'crisis').length ?? 0;
        return bCrises - aCrises || (b.finalHP ?? 0) - (a.finalHP ?? 0);
      }),
      (player) => `經歷 ${gs.players.get(player.playerId)?.eventLog.filter((event) => event.type === 'crisis').length ?? 0} 次危機，仍走到了自己的終點。`,
      '你如何判斷一個人是在堅持，還是在消耗自己？',
    );
    addAward(
      'growth',
      '🌱',
      '最強成長曲線',
      [...players].sort((a, b) => {
        const aPlayer = gs.players.get(a.playerId);
        const bPlayer = gs.players.get(b.playerId);
        return ((bPlayer?.stats.financialIQ ?? 0) * 10 + (bPlayer?.stats.careerSkill ?? 0))
          - ((aPlayer?.stats.financialIQ ?? 0) * 10 + (aPlayer?.stats.careerSkill ?? 0));
      }),
      (player) => {
        const source = gs.players.get(player.playerId);
        return `終局財商 ${source?.stats.financialIQ ?? 0}、第二專長 ${source?.stats.careerSkill ?? 0}。`;
      },
      '哪些成長投資在當下看起來最不像「划算」的選擇？',
    );
    addAward(
      'relationship',
      '🤝',
      '最有連結的人生',
      [...players].sort((a, b) => b.score.relationshipIndex - a.score.relationshipIndex),
      (player) => `人際關係指數 ${Math.round(player.score.relationshipIndex)} 分。`,
      '你的人際選擇帶來的是支持、責任，還是兩者都有？',
    );
    addAward(
      'experience',
      '🧭',
      '最敢體驗人生',
      [...players].sort((a, b) => b.lifeExperience - a.lifeExperience),
      (player) => `累積 ${player.lifeExperience} 點生命體驗。`,
      '如果不能用金錢衡量，哪一次體驗最值得？',
    );
    addAward(
      'turning_point',
      '🔀',
      '最值得討論的轉折',
      [...players].sort((a, b) => {
        const largestLoss = (playerId: string) => Math.min(
          0,
          ...(gs.players.get(playerId)?.eventLog.map((event) => event.netWorthAfter - event.netWorthBefore) ?? [0]),
        );
        return largestLoss(a.playerId) - largestLoss(b.playerId);
      }),
      (player) => {
        const events = gs.players.get(player.playerId)?.eventLog ?? [];
        const turningPoint = [...events].sort((a, b) =>
          (a.netWorthAfter - a.netWorthBefore) - (b.netWorthAfter - b.netWorthBefore)
        )[0];
        return turningPoint ? `${Math.round(turningPoint.age)} 歲：${turningPoint.description}` : '這場人生沒有單一答案，值得從整體路線回看。';
      },
      '如果回到當時，你會改變選擇，還是改變準備方式？',
    );

    emitClient(socket, 'roomAnalysis', { roomId: gs.gameId, players, currentAge, awards });
  });
}
