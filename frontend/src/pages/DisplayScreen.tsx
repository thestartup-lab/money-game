import { useCallback, useState, useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import ReactECharts from 'echarts-for-react';
import { QRCodeSVG } from 'qrcode.react';
import type { GameState, RoomPlayerSummary, LifeScoreBreakdown } from '../types/game';
import { GameBoard } from '../components/game/GameBoard';
import type { BoardPlayer } from '../components/game/GameBoard';
import IntroSheet from '../components/game/IntroSheet';
import DecisionHistoryView from '../components/analysis/DecisionHistoryView';
import DiceRollOverlay, { type DiceRollData } from '../components/game/DiceRollOverlay';
import DecisionCountdown from '../components/game/DecisionCountdown';
import TurnIntroOverlay, { type TurnIntroData } from '../components/game/TurnIntroOverlay';

const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:3001';
const fmt = (n: number) => n.toLocaleString('zh-TW', { maximumFractionDigits: 0 });
const fmtCompact = (n: number) => {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(abs >= 100_000 ? 0 : 1)}k`;
  return fmt(n);
};
const PHASE_LABELS: Record<string, string> = {
  WaitingForPlayers: '等待玩家', Pre20: '開局設定', RatRace: '老鼠賽跑',
  FastTrack: '外圈快車道', GameOver: '遊戲結束',
};

const RADAR_DIMENSIONS = [
  { key: 'netWorth', label: '淨資產' },
  { key: 'passiveIncome', label: '被動收入' },
  { key: 'financialHealth', label: '財務健康' },
  { key: 'family', label: '家庭' },
  { key: 'lifeExperience', label: '生命體驗' },
  { key: 'hp', label: '健康長壽' },
  { key: 'legacyScore', label: '傳承' },
] as const;

const COLORS = ['#10b981', '#f59e0b', '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'];

export default function DisplayScreen() {
  const socketRef = useRef<Socket | null>(null);
  const joinedRoomRef = useRef<string>(''); // 記錄已成功加入的房間代碼，供重連使用
  const [connected, setConnected] = useState(false);
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [roomAnalysis, setRoomAnalysis] = useState<{ roomId: string; players: RoomPlayerSummary[]; currentAge: number } | null>(null);
  const [roomCode, setRoomCode] = useState(() => {
    // 支援從 URL ?display&room=ROOMID 直接帶入
    const params = new URLSearchParams(window.location.search);
    return (params.get('room') ?? '').toUpperCase();
  });
  const [joined, setJoined] = useState(false);
  const [joinError, setJoinError] = useState('');
  const [joining, setJoining] = useState(false);
  const [view, setView] = useState<'game' | 'analysis' | 'intro' | 'history'>('game');
  const [ticker, setTicker] = useState<string[]>([]);
  // 置中大字幕：落地事件與里程碑
  type CellEvent = { playerName: string; cellName: string; message: string; isMilestone?: boolean };
  const [centerEvent, setCenterEvent] = useState<CellEvent | null>(null);
  const centerEventTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 發薪日決策小卡
  type PaydayCard = {
    playerName: string; colorIndex: number;
    fqUpgrade: boolean; healthBoost: boolean; healthMaint: boolean;
    skillTraining: boolean; networkInvest: boolean;
    dcaAmount: number; insurances: string[]; totalCost: number;
  };
  const [paydayCards, setPaydayCards] = useState<Map<string, PaydayCard>>(new Map());
  const [showPaydayOverlay, setShowPaydayOverlay] = useState(false);
  const showPaydayOverlayRef = useRef(false);
  const paydayDismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 本回合玩家行動標記
  const [playerRoundActions, setPlayerRoundActions] = useState<Map<string, string>>(new Map());
  const prevTurnIdRef = useRef<string | null>(null);
  const prevGamePhaseRef = useRef<GameState['gamePhase'] | null>(null);
  const [pendingTurnIntro, setPendingTurnIntro] = useState<TurnIntroData | null>(null);
  const [activeTurnIntro, setActiveTurnIntro] = useState<TurnIntroData | null>(null);
  const turnIntroBusyRef = useRef(false);
  // 競標面板
  type AuctionPanel = {
    auctionId: string; triggeredByName: string; cardName: string;
    minBid: number; highestBid: number; highestBidderName?: string;
    endsAt: number; secondsLeft: number;
    controlledByHost?: boolean;
  };
  const [auctionPanel, setAuctionPanel] = useState<AuctionPanel | null>(null);
  const auctionCountdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [diceAnim, setDiceAnim] = useState<DiceRollData | null>(null);
  const queuedDiceRef = useRef<DiceRollData | null>(null);
  // 骰子動畫期間：鎖定該玩家位置在 oldPosition、暫存 centerEvent，等動畫結束才釋放
  const diceAnimRef = useRef<DiceRollData | null>(null);
  const pendingCenterEventsRef = useRef<{ evt: CellEvent; autoDismissMs?: number }[]>([]);
  const centerRevealTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [positionOverride, setPositionOverride] = useState<Map<string, number>>(new Map());
  // 外圈位置 override（FastTrack 階段擲骰動畫期間鎖定 fastTrackPosition）
  const [positionOverrideOuter, setPositionOverrideOuter] = useState<Map<string, number>>(new Map());
  const [boardFocusPlayerId, setBoardFocusPlayerId] = useState<string | undefined>();
  const boardFocusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const addTicker = (msg: string) => setTicker((prev) => [msg, ...prev].slice(0, 6));

  const revealPendingCenterEvent = useCallback((delayMs = 350) => {
    if (
      pendingCenterEventsRef.current.length === 0 ||
      diceAnimRef.current ||
      showPaydayOverlayRef.current ||
      centerRevealTimer.current
    ) return;

    centerRevealTimer.current = setTimeout(() => {
      centerRevealTimer.current = null;
      const pending = pendingCenterEventsRef.current;
      pendingCenterEventsRef.current = [];
      const last = pending[pending.length - 1];
      if (!last) return;

      setCenterEvent(last.evt);
      if (centerEventTimer.current) clearTimeout(centerEventTimer.current);
      const dismissAfter = last.autoDismissMs ?? (last.evt.isMilestone ? 7_000 : 4_500);
      centerEventTimer.current = setTimeout(() => setCenterEvent(null), dismissAfter);
    }, delayMs);
  }, []);

  const dismissPaydayOverlay = useCallback(() => {
    showPaydayOverlayRef.current = false;
    setShowPaydayOverlay(false);
    setPaydayCards(new Map());
    revealPendingCenterEvent(300);
  }, [revealPendingCenterEvent]);

  useEffect(() => {
    const s = io(SERVER_URL, { transports: ['websocket', 'polling'], reconnection: true, reconnectionAttempts: Infinity, reconnectionDelay: 1000, reconnectionDelayMax: 5000, randomizationFactor: 0.5, timeout: 20000 });
    socketRef.current = s;
    s.on('connect', () => {
      setConnected(true);
      // 優先用已記錄的房間代碼（斷線重連情境），其次用 URL 參數（首次連線）
      const reconnectRoom = joinedRoomRef.current;
      const params = new URLSearchParams(window.location.search);
      const urlRoom = params.get('room')?.toUpperCase();
      const targetRoom = reconnectRoom || urlRoom;
      if (targetRoom && targetRoom.length >= 4) {
        setJoining(true);
        s.emit('joinDisplay', { roomId: targetRoom });
      }
    });
    s.on('disconnect', () => setConnected(false));
    s.on('joinDisplaySuccess', (p: { roomId?: string }) => {
      setJoined(true);
      setJoining(false);
      // 記錄成功加入的房間代碼，供斷線重連使用
      if (p?.roomId) joinedRoomRef.current = p.roomId;
    });
    s.on('joinDisplayFail', (p: { message: string }) => {
      setJoinError(p.message);
      setJoining(false);
      // 若重連失敗（例如伺服器重啟後房間消失），回到加入畫面讓用戶重新輸入
      if (joinedRoomRef.current) {
        setJoined(false);
        joinedRoomRef.current = '';
      }
    });
    // 若後端尚未支援 joinDisplay，收到 gameStateUpdate 也視為成功
    s.on('gameStateUpdate', (gs: GameState) => {
      setGameState(gs);
      const previousTurnId = prevTurnIdRef.current;
      const previousPhase = prevGamePhaseRef.current;
      const isPlaying = gs.gamePhase === 'RatRace' || gs.gamePhase === 'FastTrack';
      const enteredPlayingPhase = isPlaying && previousPhase !== 'RatRace' && previousPhase !== 'FastTrack';
      const turnChanged = Boolean(previousTurnId && previousTurnId !== gs.currentPlayerTurnId);

      if (turnChanged) {
        setPlayerRoundActions(new Map());
        if (!gs.globalPaydayInProgress) setBoardFocusPlayerId(undefined);
      }

      if (isPlaying && !gs.globalPaydayInProgress && gs.currentPlayerTurnId && (enteredPlayingPhase || turnChanged || !previousTurnId)) {
        const turnPlayer = gs.players.find((player) => player.id === gs.currentPlayerTurnId);
        if (turnPlayer) {
          const playerIndex = gs.players.findIndex((player) => player.id === turnPlayer.id);
          setPendingTurnIntro({
            key: Date.now(),
            playerId: turnPlayer.id,
            playerName: turnPlayer.name,
            professionName: turnPlayer.profession?.name,
            colorIndex: Math.max(0, playerIndex),
          });
          turnIntroBusyRef.current = true;
        }
      } else if (gs.gamePhase === 'GameOver') {
        setPendingTurnIntro(null);
        setActiveTurnIntro(null);
        turnIntroBusyRef.current = false;
        queuedDiceRef.current = null;
      }

      prevTurnIdRef.current = gs.currentPlayerTurnId ?? null;
      prevGamePhaseRef.current = gs.gamePhase;
      setJoined(true);
      setJoining(false);
      // 若尚未記錄房間代碼（例如 gameStateUpdate 先於 joinDisplaySuccess 到達），從 gs 補記
      if (!joinedRoomRef.current && gs.roomId) {
        joinedRoomRef.current = gs.roomId;
      }
    });
    s.on('gameClock', (p: { currentAge: number; remainingTimeMs?: number }) => {
      setGameState((gs) => gs ? { ...gs, currentAge: p.currentAge, remainingTimeMs: p.remainingTimeMs ?? gs.remainingTimeMs } : gs);
    });
    s.on('roomAnalysis', (data: typeof roomAnalysis) => { setRoomAnalysis(data); setView('analysis'); });
    s.on('ratRaceEscaped', (p: { playerId: string; playerName: string; routeLabel?: string }) => {
      addTicker(`🚀 ${p.playerName} 完成「${p.routeLabel ?? '第二人生'}」，正式進入外圈！`);
      setBoardFocusPlayerId(p.playerId);
      if (boardFocusTimerRef.current) clearTimeout(boardFocusTimerRef.current);
      boardFocusTimerRef.current = setTimeout(() => setBoardFocusPlayerId(undefined), 6_000);
    });
    s.on('marriageAnnouncement', (p: { playerName: string }) => addTicker(`💑 ${p.playerName} 結婚了！`));
    s.on('globalPaydayStarted', (p: { globalPaydayNumber: number; settlementMonths: number }) => {
      setPaydayCards(new Map());
      addTicker(`💰 第 ${p.globalPaydayNumber} 季全體發薪：一次規劃、結算 ${p.settlementMonths} 個月`);
    });
    s.on('globalPaydayPlayerTurn', (p: {
      playerId: string; playerName: string; playerIndex: number; playerCount: number; globalPaydayNumber: number;
    }) => {
      setBoardFocusPlayerId(p.playerId);
      setPendingTurnIntro({
        key: Date.now(),
        playerId: p.playerId,
        playerName: p.playerName,
        colorIndex: Math.max(0, p.playerIndex - 1),
        eyebrow: `第 ${p.globalPaydayNumber} 季・${p.playerIndex}/${p.playerCount}`,
        launchText: '的季度結算開始了',
      });
      turnIntroBusyRef.current = true;
    });
    s.on('globalPaydayCompleted', (p: {
      globalPaydayNumber: number; nextPlayer?: { id: string; name: string; colorIndex: number; professionName?: string };
    }) => {
      setBoardFocusPlayerId(undefined);
      addTicker(`✅ 第 ${p.globalPaydayNumber} 季結算完成，回到人生行動`);
      if (p.nextPlayer) {
        setPendingTurnIntro({
          key: Date.now(),
          playerId: p.nextPlayer.id,
          playerName: p.nextPlayer.name,
          professionName: p.nextPlayer.professionName,
          colorIndex: p.nextPlayer.colorIndex,
        });
        turnIntroBusyRef.current = true;
      }
    });
    s.on('finalRoundStarted', (p: { firstPlayerId: string; firstPlayerName: string }) => {
      setBoardFocusPlayerId(p.firstPlayerId);
      addTicker(`⏳ 最後一輪開始：${p.firstPlayerName} 先行動，每位玩家都還有一次機會`);
      setCenterEvent({
        playerName: p.firstPlayerName,
        cellName: '最後一輪',
        message: '現在是 96 歲。每位仍在場的玩家完成最後一次人生行動後，人生來到 100 歲並結算。',
        isMilestone: true,
      });
      if (centerEventTimer.current) clearTimeout(centerEventTimer.current);
      centerEventTimer.current = setTimeout(() => setCenterEvent(null), 7_000);
    });

    // 發薪日決策小卡
    type PlanResult = { fqUpgrade?: { executed: boolean }; healthBoost?: { executed: boolean }; healthMaintenance?: { executed: boolean }; skillTraining?: { executed: boolean }; networkInvest?: { executed: boolean } };
    s.on('paydayPlanResult', (p: {
      playerId: string; playerName: string;
      planResult: { investments: PlanResult; stockDCA: { executed: boolean; amount: number }; insurancePurchases: Array<{ type: string; success: boolean }>; totalCostDeducted: number };
    }) => {
      setPaydayCards((prev) => {
        const colorIdx = Array.from(prev.keys()).indexOf(p.playerId) % 6;
        const inv = p.planResult.investments;
        const card: PaydayCard = {
          playerName: p.playerName,
          colorIndex: colorIdx >= 0 ? colorIdx : prev.size % 6,
          fqUpgrade: inv.fqUpgrade?.executed ?? false,
          healthBoost: inv.healthBoost?.executed ?? false,
          healthMaint: inv.healthMaintenance?.executed ?? false,
          skillTraining: inv.skillTraining?.executed ?? false,
          networkInvest: inv.networkInvest?.executed ?? false,
          dcaAmount: p.planResult.stockDCA?.executed ? p.planResult.stockDCA.amount : 0,
          insurances: (p.planResult.insurancePurchases ?? []).filter((i) => i.success).map((i) => i.type),
          totalCost: p.planResult.totalCostDeducted,
        };
        const next = new Map(prev);
        next.set(p.playerId, card);
        return next;
      });
      showPaydayOverlayRef.current = true;
      setShowPaydayOverlay(true);
      if (paydayDismissTimer.current) clearTimeout(paydayDismissTimer.current);
    });
    s.on('gameResumed', () => {
      // 不強制關閉 payday overlay — 由使用者手動點擊關閉
    });

    s.on('playerTraveled', (p: { playerId: string; playerName: string; destinationName?: string; lifeExperienceGained: number }) => {
      setPlayerRoundActions((prev) => {
        const next = new Map(prev);
        next.set(p.playerId, `前往「${p.destinationName ?? '旅遊地'}」體驗 +${p.lifeExperienceGained}`);
        return next;
      });
    });

    s.on('playerRolled', (p: { playerId: string; playerName: string; colorIndex: number; dice: number[]; total: number; oldPosition: number; newPosition: number; isInFastTrack?: boolean }) => {
      const data = { ...p, key: Date.now() };
      diceAnimRef.current = data;
      if (turnIntroBusyRef.current) {
        queuedDiceRef.current = data;
      } else {
        setDiceAnim(data);
      }
      // 動畫期間先把該玩家位置鎖回 oldPosition，等骰子停才實際移動
      // 內外圈使用獨立的 override map，避免錯位
      const isOuter = p.isInFastTrack ?? false;
      const overrideMap = isOuter ? setPositionOverrideOuter : setPositionOverride;
      overrideMap((prev) => {
        const next = new Map(prev);
        next.set(p.playerId, p.oldPosition);
        return next;
      });
      setPlayerRoundActions((prev) => {
        const next = new Map(prev);
        next.set(p.playerId, `擲出 ${p.total} 點，移動至 ${p.newPosition}`);
        return next;
      });
    });

    const showCenterEvent = (evt: CellEvent, autoDismissMs?: number) => {
      // 若骰子動畫還在播，先暫存，等 onDone 時再依序顯示
      if (diceAnimRef.current || showPaydayOverlayRef.current) {
        pendingCenterEventsRef.current.push({ evt, autoDismissMs });
        return;
      }
      setCenterEvent(evt);
      if (centerEventTimer.current) clearTimeout(centerEventTimer.current);
      const dismissAfter = autoDismissMs ?? (evt.isMilestone ? 7_000 : 4_500);
      centerEventTimer.current = setTimeout(() => setCenterEvent(null), dismissAfter);
    };

    s.on('cellEventBroadcast', (p: { playerId: string; playerName: string; cellName: string; message: string }) => {
      showCenterEvent({ playerName: p.playerName, cellName: p.cellName, message: p.message });
      // 記錄本回合行動
      setPlayerRoundActions((prev) => {
        const next = new Map(prev);
        next.set(p.playerId, p.message.replace(/^[^\s]*\s/, '').substring(0, 30));
        return next;
      });
    });
    s.on('milestoneAnnounced', (p: { playerName: string; milestone: string; description: string }) => {
      addTicker(`🏆 ${p.description}`);
      showCenterEvent({ playerName: p.playerName, cellName: `🏆 ${p.milestone}`, message: p.description, isMilestone: true });
    });
    s.on('careerChangeAnnouncement', (p: { playerName: string; previousProfession: string; newProfession: string; salaryChange?: number }) => {
      const salaryText = p.salaryChange != null
        ? `  薪資${p.salaryChange >= 0 ? '增加' : '變動'} $${Math.abs(p.salaryChange).toLocaleString()}/月`
        : '';
      showCenterEvent({
        playerName: p.playerName,
        cellName: '🎯 恭喜轉職！',
        message: `${p.playerName} 從「${p.previousProfession}」\n轉職為「${p.newProfession}」！${salaryText}`,
        isMilestone: true,
      });
      addTicker(`🎯 ${p.playerName} 轉職：${p.previousProfession} → ${p.newProfession}`);
    });
    s.on('playerFinalScore', (p: { playerName: string; deathAge: number; score: { total: number } }) => {
      addTicker(`⚰️ ${p.playerName} 在 ${p.deathAge} 歲結束人生，得 ${Math.round(p.score.total)} 分`);
    });
    s.on('globalEventAnnouncement', (p: { event: { title: string; description: string } }) => {
      addTicker(`📢 全局事件：${p.event.title} — ${p.event.description}`);
    });
    s.on('annualTaxResult', (p: { playerName: string; taxAmount: number; taxCreditAmount?: number }) => {
      const saving = (p.taxCreditAmount ?? 0) > 0 ? `（規劃省下 $${fmt(p.taxCreditAmount ?? 0)}）` : '';
      addTicker(`🧾 ${p.playerName} 繳稅 $${fmt(p.taxAmount)}${saving}`);
    });
    s.on('dealAuctionStarted', (p: { auctionId: string; triggeredByName: string; endsAt: number; controlledByHost?: boolean; card?: { name: string; minBid: number; monthlyCashflow?: number } }) => {
      const cardName = p.card?.name ?? '交易';
      const minBid = p.card?.minBid ?? 0;
      showCenterEvent({ playerName: p.triggeredByName, cellName: '🔔 開放競標！', message: `${p.triggeredByName} 放棄交易，${cardName} 開放競標！起標 $${minBid.toLocaleString()}` });
      addTicker(`🔔 ${p.triggeredByName} 放棄「${cardName}」，開放競標（起標 $${minBid.toLocaleString()}）`);
      const secondsLeft = Math.max(0, Math.round((p.endsAt - Date.now()) / 1000));
      setAuctionPanel({ auctionId: p.auctionId, triggeredByName: p.triggeredByName, cardName, minBid, highestBid: 0, endsAt: p.endsAt, secondsLeft, controlledByHost: p.controlledByHost });
      if (auctionCountdownRef.current) clearInterval(auctionCountdownRef.current);
      if (p.controlledByHost) return;
      auctionCountdownRef.current = setInterval(() => {
        setAuctionPanel((prev) => {
          if (!prev) return null;
          const s = Math.max(0, Math.round((prev.endsAt - Date.now()) / 1000));
          if (s <= 0) { clearInterval(auctionCountdownRef.current!); return { ...prev, secondsLeft: 0 }; }
          return { ...prev, secondsLeft: s };
        });
      }, 1000);
    });
    s.on('dealBidUpdated', (p: { bidderName: string; bidAmount: number; newHighest: number }) => {
      showCenterEvent({ playerName: p.bidderName, cellName: `💰 出價 $${fmt(p.newHighest)}`, message: `${p.bidderName} 出價 $${fmt(p.bidAmount)}（目前最高）` });      setAuctionPanel((prev) => prev ? { ...prev, highestBid: p.newHighest, highestBidderName: p.bidderName } : prev);
    });
    s.on('dealAuctionEnded', (p: { auctionId: string; winnerId?: string | null; winnerName?: string | null; winningBid: number; cardName?: string; hadBids?: boolean }) => {
      if (auctionCountdownRef.current) clearInterval(auctionCountdownRef.current);
      setAuctionPanel(null);
      if (p.hadBids && p.winnerName) {
        showCenterEvent({ playerName: p.winnerName, cellName: `🏆 得標！`, message: `${p.winnerName} 以 $${fmt(p.winningBid)} 競標到「${p.cardName ?? '資產'}」！` });
        addTicker(`🏆 ${p.winnerName} 以 $${fmt(p.winningBid)} 得標「${p.cardName ?? '資產'}」`);
      } else {
        showCenterEvent({ playerName: '', cellName: '🔔 競標結束', message: `無人出價，${p.cardName ?? '交易'} 流標` });
        addTicker(`🔔 ${p.cardName ?? '交易'} 競標流標，無人出價`);
      }
    });
    const clearRuntimeTimers = () => {
      if (auctionCountdownRef.current) clearInterval(auctionCountdownRef.current);
      if (centerEventTimer.current) clearTimeout(centerEventTimer.current);
      if (centerRevealTimer.current) clearTimeout(centerRevealTimer.current);
      if (paydayDismissTimer.current) clearTimeout(paydayDismissTimer.current);
      if (boardFocusTimerRef.current) clearTimeout(boardFocusTimerRef.current);
    };
    return () => {
      s.disconnect();
      clearRuntimeTimers();
    };
  }, []);

  // Enter 鍵手動關閉置中事件 overlay
  useEffect(() => {
    if (!centerEvent) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Enter') setCenterEvent(null);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [centerEvent]);

  // Enter 鍵手動關閉發薪日 overlay
  useEffect(() => {
    if (!showPaydayOverlay) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Enter') dismissPaydayOverlay();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [dismissPaydayOverlay, showPaydayOverlay]);

  // 回合交棒不與上一位的結果畫面搶焦點；所有演出完成後才正式叫出下一位。
  useEffect(() => {
    if (!pendingTurnIntro || activeTurnIntro) return;
    const visualIsBusy = Boolean(
      diceAnim ||
      centerEvent ||
      showPaydayOverlay ||
      pendingCenterEventsRef.current.length > 0 ||
      Boolean(centerRevealTimer.current),
    );
    if (visualIsBusy) return;

    const launchTimer = window.setTimeout(() => {
      setActiveTurnIntro(pendingTurnIntro);
      setPendingTurnIntro(null);
    }, 280);

    return () => window.clearTimeout(launchTimer);
  }, [activeTurnIntro, centerEvent, diceAnim, pendingTurnIntro, showPaydayOverlay]);

  const emit = (ev: string, ...args: unknown[]) => socketRef.current?.emit(ev, ...args);

  if (!joined) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="card w-96 space-y-4 text-center">
          <h1 className="text-3xl font-bold text-emerald-400">百歲人生</h1>
          <p className="text-gray-400">大螢幕展示模式</p>
          <input
            className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-white uppercase tracking-widest text-center text-xl focus:outline-none focus:border-emerald-500"
            placeholder="輸入房間代碼"
            value={roomCode}
            onChange={(e) => { setRoomCode(e.target.value.toUpperCase()); setJoinError(''); }}
            maxLength={6}
            onKeyDown={(e) => { if (e.key === 'Enter' && roomCode.length >= 4) emit('joinDisplay', { roomId: roomCode }); }}
          />
          {joinError && <p className="text-red-400 text-sm">{joinError}</p>}
          <button
            className="btn-primary w-full text-lg"
            disabled={!connected || roomCode.length < 4 || joining}
            onClick={() => {
              setJoinError('');
              setJoining(true);
              emit('joinDisplay', { roomId: roomCode });
              // 3 秒後若還沒進入，提示可能是後端問題
              setTimeout(() => {
                setJoining((prev) => {
                  if (prev) setJoinError('沒有回應，請確認房間代碼是否正確，或稍後再試。');
                  return false;
                });
              }, 3000);
            }}
          >
            {joining ? '連線中…' : '進入展示模式'}
          </button>
          {!connected && <p className="text-yellow-400 text-sm">連線中…</p>}
        </div>
      </div>
    );
  }

  if (!gameState) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-gray-400 text-xl">等待遊戲狀態…</p>
      </div>
    );
  }

  const playerUrl = `${window.location.protocol}//${window.location.host}/?room=${gameState.roomId}`;

  // 把玩家轉為 GameBoard 格式（含 HP / 現金流 / 年齡等富資訊，給棋盤中央面板顯示）
  const boardPlayers: BoardPlayer[] = gameState.players.map((p, i) => ({
    id: p.id,
    name: p.name,
    // 骰子動畫期間，鎖定在 oldPosition；動畫結束後才更新為實際位置
    position: positionOverride.get(p.id) ?? p.currentPosition,
    fastTrackPosition: positionOverrideOuter.get(p.id) ?? p.fastTrackPosition ?? 0,
    isInFastTrack: p.isInFastTrack ?? false,
    isMe: false,
    colorIndex: i % 6,
    isBedridden: p.isBedridden,
    health: p.stats.health,
    monthlyCashflow: p.monthlyCashflow,
    age: Math.floor(p.personalAge ?? Math.max(p.startAge ?? 20, gameState.currentAge)),
    isAlive: p.isAlive,
    isMarried: p.isMarried,
    roundAction: playerRoundActions.get(p.id) || undefined,
  }));
  const currentTurnIndex = gameState.playerOrder.indexOf(gameState.currentPlayerTurnId);
  const currentTurnPlayer = gameState.players.find((p) => p.id === gameState.currentPlayerTurnId);
  const currentTurnColorIndex = Math.max(0, gameState.players.findIndex((p) => p.id === gameState.currentPlayerTurnId));
  const nextTurnId = currentTurnIndex >= 0 && gameState.playerOrder.length > 1
    ? Array.from({ length: gameState.playerOrder.length - 1 }, (_, offset) =>
        gameState.playerOrder[(currentTurnIndex + offset + 1) % gameState.playerOrder.length]
      ).find((id) => gameState.players.find((player) => player.id === id)?.isAlive !== false)
    : undefined;
  const nextTurnPlayer = gameState.players.find((p) => p.id === nextTurnId);
  const isSetupPhase = gameState.gamePhase === 'WaitingForPlayers' || gameState.gamePhase === 'Pre20';
  const alivePlayers = gameState.players.filter((player) => player.isAlive);
  const isMixedTrack = alivePlayers.some((player) => player.isInFastTrack) && alivePlayers.some((player) => !player.isInFastTrack);
  const phaseLabel = gameState.finalRoundStarted
    ? '最後一輪'
    : isMixedTrack
      ? '雙圈進行中'
      : PHASE_LABELS[gameState.gamePhase] ?? gameState.gamePhase;

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col">

      {/* ══ 頂部全場狀態橫幅 ══ */}
      <div className="flex items-center justify-between px-6 py-3 bg-gray-900 border-b border-gray-700 flex-shrink-0">

        {/* 左：標題 + 房間 + 階段 */}
        <div className="flex items-center gap-3 min-w-0">
          <h1 className="text-2xl font-bold text-emerald-400 whitespace-nowrap">百歲人生</h1>
          <span className="text-gray-500 text-sm font-mono whitespace-nowrap">#{gameState.roomId}</span>
          <span className={`px-2 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap ${
            gameState.gamePhase === 'GameOver'   ? 'bg-purple-900 text-purple-200' :
            gameState.gamePhase === 'FastTrack'  ? 'bg-emerald-900 text-emerald-200' :
            gameState.gamePhase === 'RatRace'    ? 'bg-blue-900 text-blue-200' :
            'bg-yellow-900 text-yellow-300'
          }`}>
            {phaseLabel}
          </span>
          <span className="whitespace-nowrap rounded-full bg-gray-800 px-2 py-0.5 text-xs font-bold text-yellow-200">
            {currentTurnPlayer ? `${Math.floor(currentTurnPlayer.personalAge ?? gameState.currentAge)} 歲 · ` : ''}人生輪 {Math.min(gameState.totalLifeRounds ?? 20, (gameState.completedLifeRounds ?? gameState.turnNumber) + 1)}/{gameState.totalLifeRounds ?? 20}
          </span>
        </div>

        {/* 中：持續顯示目前玩家；真正的決策倒數只在決策階段出現 */}
        <div className="text-center flex-shrink-0">
          <div className={`max-w-[34vw] truncate text-4xl font-black leading-none tracking-tight ${
            gameState.isPaused ? 'text-orange-300' : gameState.finalRoundStarted ? 'text-purple-300' : 'text-yellow-200'
          }`}>
            {gameState.isPaused
              ? '遊戲暫停'
              : gameState.finalRoundStarted
                ? '最後一輪'
                : currentTurnPlayer?.name ?? '準備開始'}
          </div>
          <div className="text-base text-gray-300 mt-0.5 tracking-wide">
            {gameState.isPaused
              ? '由主持人決定何時繼續'
              : gameState.finalRoundStarted
                ? `現在輪到 ${currentTurnPlayer?.name ?? '—'} 完成最後行動`
                : `現在輪到 · 下一位 ${nextTurnPlayer?.name ?? '—'}`}
          </div>
        </div>

        {/* 右：控制按鈕 + 連線狀態 */}
        <div className="flex items-center gap-2 min-w-0 justify-end">
          {gameState.gamePhase === 'GameOver' && (
            <button
              className={`text-sm px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap ${view === 'intro' ? 'bg-emerald-700 text-white' : 'bg-gray-700 hover:bg-gray-600 text-gray-300'}`}
              onClick={() => setView(view === 'intro' ? 'game' : 'intro')}
            >
              復盤原則
            </button>
          )}
          {gameState.gamePhase === 'GameOver' && (
            <>
              <button
                className="text-sm px-3 py-1.5 rounded-lg bg-purple-800 hover:bg-purple-700 transition-colors whitespace-nowrap"
                onClick={() => { emit('requestRoomAnalysis'); }}
              >
                顯示分析
              </button>
              <button
                className={`text-sm px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap ${view === 'history' ? 'bg-blue-700 text-white' : 'bg-blue-900 hover:bg-blue-800 text-blue-200'}`}
                onClick={() => setView(view === 'history' ? 'game' : 'history')}
              >
                決策歷程
              </button>
            </>
          )}
          {(view === 'analysis' || view === 'history') && (
            <button
              className="text-sm px-3 py-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 transition-colors whitespace-nowrap"
              onClick={() => setView('game')}
            >
              返回棋盤
            </button>
          )}
          <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${connected ? 'bg-green-400' : 'bg-red-400'}`} />
        </div>
      </div>

      {/* 主體 */}
      {view === 'intro' && gameState.gamePhase === 'GameOver' ? (
        <div className="flex-1 overflow-hidden">
          <IntroSheet mode="fullscreen" />
        </div>
      ) : view === 'history' && roomAnalysis ? (
        <div className="flex-1 overflow-y-auto p-4">
          <DecisionHistoryView analysis={roomAnalysis} />
        </div>
      ) : view === 'analysis' && roomAnalysis ? (
        <div className="flex-1 overflow-y-auto p-4">
          <RoomAnalysisView analysis={roomAnalysis} />
        </div>
      ) : (
        <div className="flex flex-1 overflow-hidden relative">

          {/* 摺疊／展開按鈕：垂直置中懸浮於側欄與棋盤之間，超大易見 */}
          <button
            onClick={() => setSidebarCollapsed((v) => !v)}
            className="absolute top-1/2 -translate-y-1/2 z-50 bg-indigo-600 hover:bg-indigo-500 border-2 border-indigo-300 text-white rounded-r-2xl w-8 h-20 flex items-center justify-center text-xl font-bold shadow-2xl transition-all"
            style={{ left: sidebarCollapsed ? 0 : 'calc(13rem - 0px)' }}
            title={sidebarCollapsed ? '展開側欄' : '收起側欄（讓棋盤更大）'}
          >
            {sidebarCollapsed ? '›' : '‹'}
          </button>

          {/* ══ 左欄：QR + 玩家名單（可摺疊） ══ */}
          {!sidebarCollapsed && (
          <div className="w-52 xl:w-60 flex-shrink-0 flex flex-col gap-3 p-3 overflow-y-auto border-r border-gray-800">

            {/* 開局顯示 QR；進行中改成全場回合焦點 */}
            {isSetupPhase ? (
              <div className="flex flex-col items-center gap-2 bg-gray-900 rounded-xl p-3">
                <div className="bg-white rounded-lg p-2">
                  <QRCodeSVG value={playerUrl} size={150} />
                </div>
                <p className="text-xs text-gray-400">掃碼加入遊戲</p>
                <p className="font-mono text-2xl font-bold text-yellow-300 tracking-[0.3em]">{gameState.roomId}</p>
              </div>
            ) : (
              <div
                className="rounded-2xl border-2 bg-gradient-to-br from-indigo-950 to-gray-900 p-4 shadow-xl"
                style={{ borderColor: COLORS[currentTurnColorIndex % COLORS.length] }}
              >
                <p className="text-xs font-bold uppercase tracking-widest text-indigo-300">現在輪到</p>
                <div className="mt-2 flex min-w-0 items-center gap-2">
                  <span
                    className="h-4 w-4 shrink-0 rounded-full border-2 border-white/80"
                    style={{ backgroundColor: COLORS[currentTurnColorIndex % COLORS.length] }}
                  />
                  <p className="truncate text-3xl font-black text-white">{currentTurnPlayer?.name ?? '—'}</p>
                </div>
                <p className="mt-1 truncate text-sm font-semibold text-gray-300">{currentTurnPlayer?.profession?.name ?? ''}</p>
                {currentTurnPlayer ? (
                  <div className="mt-4 grid grid-cols-3 gap-1.5 border-t border-indigo-800 pt-3 text-center">
                    <div className="rounded-lg bg-black/25 px-1 py-2">
                      <p className="text-[9px] uppercase text-gray-500">年齡</p>
                      <p className="mt-0.5 text-sm font-black text-white">{Math.floor(currentTurnPlayer.personalAge ?? gameState.currentAge)}</p>
                    </div>
                    <div className="rounded-lg bg-black/25 px-1 py-2">
                      <p className="text-[9px] uppercase text-gray-500">健康</p>
                      <p className={`mt-0.5 text-sm font-black ${currentTurnPlayer.stats.health >= 60 ? 'text-emerald-300' : currentTurnPlayer.stats.health >= 30 ? 'text-yellow-300' : 'text-red-300'}`}>
                        {currentTurnPlayer.stats.health}
                      </p>
                    </div>
                    <div className="rounded-lg bg-black/25 px-1 py-2">
                      <p className="text-[9px] uppercase text-gray-500">月現金流</p>
                      <p className={`mt-0.5 truncate text-xs font-black ${currentTurnPlayer.monthlyCashflow >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>
                        {currentTurnPlayer.monthlyCashflow >= 0 ? '+' : '-'}${fmtCompact(Math.abs(currentTurnPlayer.monthlyCashflow))}
                      </p>
                    </div>
                  </div>
                ) : null}
                {nextTurnPlayer ? (
                  <div className="mt-3 border-t border-indigo-800 pt-3">
                    <p className="text-[10px] uppercase tracking-wider text-gray-500">下一位準備</p>
                    <p className="mt-1 truncate text-lg font-black text-yellow-300">{nextTurnPlayer.name}</p>
                  </div>
                ) : null}
              </div>
            )}

            {/* 競標面板 */}
            {auctionPanel && (
              <div className="bg-blue-950 border border-blue-500 rounded-xl p-3 space-y-1.5 animate-pulse-once">
                <div className="flex items-center justify-between">
                  <p className="text-blue-200 font-bold text-xs">🔔 競標進行中</p>
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${auctionPanel.controlledByHost ? 'bg-indigo-700 text-indigo-100' : auctionPanel.secondsLeft <= 5 ? 'bg-red-700 text-white' : 'bg-blue-700 text-blue-100'}`}>
                    {auctionPanel.controlledByHost ? '主持人控制' : `${auctionPanel.secondsLeft}s`}
                  </span>
                </div>
                <p className="text-white text-sm font-semibold truncate">{auctionPanel.cardName}</p>
                <p className="text-blue-300 text-xs">起標：<span className="text-yellow-300 font-bold">${auctionPanel.minBid.toLocaleString()}</span></p>
                {auctionPanel.highestBid > 0 ? (
                  <p className="text-xs text-blue-300">最高標：<span className="text-yellow-300 font-bold">${auctionPanel.highestBid.toLocaleString()}</span>
                    {auctionPanel.highestBidderName && <span className="text-gray-400">（{auctionPanel.highestBidderName}）</span>}
                  </p>
                ) : (
                  <p className="text-xs text-gray-500">尚無出價</p>
                )}
              </div>
            )}

            {/* 最新動態 */}
            {ticker.length > 0 && (
              <div className="bg-gray-900 rounded-xl p-3 space-y-1">
                <p className="text-xs text-gray-500 font-semibold uppercase tracking-wider">最新動態</p>
                {ticker.slice(0, 4).map((t, i) => (
                  <p key={i} className="text-xs text-gray-300 leading-snug">{t}</p>
                ))}
              </div>
            )}
          </div>
          )}

          {/* ══ 右欄：棋盤 + 置中大字幕 ══ */}
          <div
            className="flex-1 flex items-center justify-center overflow-hidden relative"
            style={{ maxHeight: 'calc(100vh - 90px)' }}
          >
            <GameBoard
              players={boardPlayers}
              currentTurnPlayerId={gameState.currentPlayerTurnId}
              focusPlayerId={boardFocusPlayerId}
              completedRoundsInCycle={gameState.roundsSinceGlobalPayday ?? (gameState.turnNumber % 3)}
              isGlobalPayday={gameState.globalPaydayInProgress ?? false}
              showPlayerPanel={false}
              showMiniMap={false}
            />

            {/* 擲骰動畫 overlay */}
            <DiceRollOverlay
              data={diceAnim}
              size="large"
              onDone={() => {
                const finished = diceAnimRef.current;
                diceAnimRef.current = null;
                setDiceAnim(null);
                // 釋放位置鎖：玩家現在才「實際移動」到新格子
                if (finished) {
                  setPositionOverride((prev) => {
                    if (!prev.has(finished.playerId)) return prev;
                    const next = new Map(prev);
                    next.delete(finished.playerId);
                    return next;
                  });
                  setPositionOverrideOuter((prev) => {
                    if (!prev.has(finished.playerId)) return prev;
                    const next = new Map(prev);
                    next.delete(finished.playerId);
                    return next;
                  });
                }
                // 依序播放暫存的事件（同一個 cell 通常只會有 1 個，取最後一個避免堆疊）
                // 若發薪結果仍在畫面上，事件繼續排隊；關閉後才播放。
                revealPendingCenterEvent(400);
              }}
            />

            {/* 回合交棒：上一位所有結果顯示完，才放大提醒下一位 */}
            <TurnIntroOverlay
              key={activeTurnIntro?.key ?? 'turn-intro-idle'}
              data={activeTurnIntro}
              onDone={() => {
                setActiveTurnIntro(null);
                turnIntroBusyRef.current = false;
                const queuedDice = queuedDiceRef.current;
                queuedDiceRef.current = null;
                if (queuedDice) {
                  diceAnimRef.current = queuedDice;
                  setDiceAnim(queuedDice);
                }
              }}
            />

            {/* 主持人控制的決策階段：只公開進度，不公開玩家選項 */}
            {gameState.decisionPhase && !centerEvent && !diceAnim && (
              <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/65 px-6 backdrop-blur-sm">
                <div className="w-full max-w-2xl rounded-3xl border-2 border-indigo-400 bg-gradient-to-br from-indigo-950/95 to-gray-950/95 px-10 py-9 text-center shadow-2xl">
                  <p className="text-sm font-bold uppercase tracking-[0.3em] text-indigo-300">全場決策時間</p>
                  <p className="mt-3 text-5xl font-black text-white">{gameState.decisionPhase.title}</p>
                  <p className="mt-4 text-2xl font-bold text-yellow-300">{gameState.decisionPhase.playerName}</p>
                  <DecisionCountdown
                    reminderEndsAt={gameState.decisionPhase.reminderEndsAt}
                    className="mt-5 block font-mono text-7xl font-black tracking-tight text-yellow-300"
                  />
                  <div className={`mx-auto mt-6 inline-flex items-center gap-2 rounded-full px-5 py-2 text-lg font-bold ${gameState.decisionPhase.submitted ? 'bg-emerald-700 text-emerald-100' : 'bg-amber-700 text-amber-100'}`}>
                    <span className={`h-3 w-3 rounded-full ${gameState.decisionPhase.submitted ? 'bg-emerald-200' : 'animate-pulse bg-amber-200'}`} />
                    {gameState.decisionPhase.kind === 'auction'
                      ? '公開競標進行中，主持人決定結束時間'
                      : gameState.decisionPhase.submitted
                        ? '選擇已送出，等待主持人揭曉'
                        : '思考與討論中'}
                  </div>
                  <p className="mt-5 text-sm text-gray-400">決策內容保密；由主持人掌握討論與揭曉時機</p>
                </div>
              </div>
            )}

            {/* 發薪日決策小卡 overlay */}
            {showPaydayOverlay && paydayCards.size > 0 && (
              <div
                className="absolute inset-0 flex flex-col items-center justify-center z-40 bg-black/60 backdrop-blur-sm pointer-events-auto cursor-pointer"
                onClick={dismissPaydayOverlay}
              >
                <p className="text-yellow-300 font-bold text-lg mb-4 tracking-wide">💵 本次發薪日決策</p>
                <div className="flex flex-wrap justify-center gap-3 max-w-5xl px-4">
                  {Array.from(paydayCards.values()).map((card, i) => {
                    const dotC = ['bg-amber-400','bg-blue-400','bg-pink-400','bg-emerald-400','bg-purple-400','bg-orange-400'];
                    const insLabel: Record<string, string> = { medical: '醫', life: '壽', property: '財' };
                    const anyAction = card.fqUpgrade || card.healthBoost || card.healthMaint || card.skillTraining || card.networkInvest || card.dcaAmount > 0 || card.insurances.length > 0;
                    return (
                      <div key={i} className="bg-gray-900 border border-gray-700 rounded-xl p-3 min-w-[130px] text-center">
                        <div className="flex items-center justify-center gap-1.5 mb-2">
                          <span className={`w-2 h-2 rounded-full ${dotC[card.colorIndex % 6]}`} />
                          <span className="text-sm font-bold text-white">{card.playerName}</span>
                        </div>
                        {anyAction ? (
                          <>
                            <div className="flex flex-wrap justify-center gap-1 mb-2">
                              <span className={`text-lg ${card.fqUpgrade ? '' : 'opacity-20'}`} title="FQ">🧠</span>
                              <span className={`text-lg ${card.healthBoost ? '' : 'opacity-20'}`} title="HP強化">💪</span>
                              <span className={`text-lg ${card.healthMaint ? '' : 'opacity-20'}`} title="HP維護">🩺</span>
                              <span className={`text-lg ${card.skillTraining ? '' : 'opacity-20'}`} title="SK">🛠️</span>
                              <span className={`text-lg ${card.networkInvest ? '' : 'opacity-20'}`} title="NT">🌐</span>
                            </div>
                            {card.dcaAmount > 0 && (
                              <p className="text-xs text-emerald-400 mb-1">📈 DCA ${fmt(card.dcaAmount)}</p>
                            )}
                            {card.insurances.length > 0 && (
                              <p className="text-xs text-blue-300 mb-1">
                                🛡️ {card.insurances.map((t) => insLabel[t] ?? t).join('、')}險
                              </p>
                            )}
                            <p className="text-xs text-gray-500">支出 ${fmt(card.totalCost)}</p>
                          </>
                        ) : (
                          <p className="text-xs text-gray-500 mt-1">本次略過</p>
                        )}
                      </div>
                    );
                  })}
                </div>
                <p className="text-xs text-gray-500 mt-5">點擊或按 Enter 繼續</p>
              </div>
            )}

            {/* 置中大字幕 overlay */}
            {centerEvent && (
              <div
                className="absolute inset-0 flex items-center justify-center z-50 pointer-events-auto cursor-pointer"
                style={{ animation: 'fadeInOut 0.3s ease' }}
                onClick={() => setCenterEvent(null)}
              >
                <div className={`rounded-2xl px-10 py-8 text-center shadow-2xl max-w-xl w-full mx-4 ${
                  centerEvent.isMilestone
                    ? 'bg-yellow-950/90 border-2 border-yellow-500 backdrop-blur'
                    : 'bg-black/80 border border-gray-600 backdrop-blur'
                }`}>
                  <p className={`text-base font-semibold mb-1 ${centerEvent.isMilestone ? 'text-yellow-400' : 'text-yellow-300'}`}>
                    👤 {centerEvent.playerName}
                  </p>
                  <p className={`font-black leading-none mb-3 ${
                    centerEvent.isMilestone ? 'text-4xl text-yellow-300' : 'text-5xl text-white'
                  }`}>
                    {centerEvent.cellName}
                  </p>
                  <p className={`text-lg leading-snug ${centerEvent.isMilestone ? 'text-yellow-200' : 'text-gray-200'}`}>
                    {centerEvent.message}
                  </p>
                  <p className="text-xs text-gray-500 mt-4">點擊或按 Enter 繼續</p>
                </div>
              </div>
            )}
          </div>

        </div>
      )}

    </div>
  );
}

// ── 遊戲結束：全組分析視圖 ──
function RoomAnalysisView({ analysis }: { analysis: { roomId: string; players: RoomPlayerSummary[]; currentAge: number } }) {
  const [selected, setSelected] = useState<string | null>(null);
  const players = analysis.players;
  const winner = players[0];
  const winnerTurningPoints = (winner?.eventLog ?? [])
    .filter((event) => ['asset_buy', 'career_change', 'rat_race_escaped', 'crisis', 'travel', 'marriage'].includes(event.type))
    .slice(0, 5);

  const indicator = RADAR_DIMENSIONS.map((d) => ({ name: d.label, max: 100 }));

  const radarSeries = players.map((p, i) => ({
    name: p.playerName,
    type: 'radar',
    data: [{ value: RADAR_DIMENSIONS.map((d) => Math.round(p.score[d.key as keyof LifeScoreBreakdown] as number ?? 0)), name: p.playerName }],
    lineStyle: { color: COLORS[i % COLORS.length], width: selected === p.playerId ? 3 : 1.5 },
    areaStyle: { color: selected === p.playerId ? `${COLORS[i % COLORS.length]}40` : 'transparent' },
  }));

  const radarOption = {
    backgroundColor: 'transparent',
    legend: {
      data: players.map((p) => p.playerName),
      textStyle: { color: '#9ca3af', fontSize: 12 },
      bottom: 0,
    },
    radar: {
      indicator,
      shape: 'polygon',
      splitNumber: 4,
      axisName: { color: '#9ca3af', fontSize: 12 },
      splitLine: { lineStyle: { color: '#374151' } },
      splitArea: { areaStyle: { color: ['rgba(31,41,55,0.3)', 'transparent'] } },
    },
    series: radarSeries,
  };

  return (
    <div className="space-y-3">
      {/* 最終排名 */}
      <div className="card">
        <h3 className="text-lg font-bold text-gray-200 mb-3">🏆 最終排名</h3>
        <div className="space-y-2">
          {players.map((p, i) => (
            <div
              key={p.playerId}
              className={`flex items-center gap-3 p-2 rounded-xl cursor-pointer transition-colors ${selected === p.playerId ? 'bg-gray-700' : 'hover:bg-gray-800'}`}
              onClick={() => setSelected(selected === p.playerId ? null : p.playerId)}
            >
              <span className={`text-xl font-bold w-8 text-center ${i === 0 ? 'text-yellow-400' : i === 1 ? 'text-gray-300' : i === 2 ? 'text-amber-600' : 'text-gray-500'}`}>
                {i + 1}
              </span>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-white">{p.playerName}</span>
                  <span className="text-xs text-gray-500">{p.profession}</span>
                  {p.escapedRatRace && <span className="text-xs text-emerald-400">🚀</span>}
                </div>
                <div className="text-xs text-gray-400">
                  {p.isAlive ? '活到百歲 🎉' : `${p.deathAge} 歲離世`} •
                  {p.isMarried ? ' 💑' : ''} 👶×{p.numberOfChildren} •
                  體驗 {p.lifeExperience}
                </div>
              </div>
              <div className="text-right">
                <div className="text-2xl font-bold text-emerald-400">{Math.round(p.score.total)}</div>
                <div className="text-xs text-gray-500">分</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {winner && (
        <div className="card border-indigo-700 bg-indigo-950/45">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-indigo-300">賽後共同復盤</p>
              <h3 className="mt-1 text-lg font-black text-white">🧭 {winner.playerName} 的勝利路線</h3>
              <p className="mt-1 text-xs text-gray-400">觀察關鍵轉折，不把冠軍路線當成唯一標準答案。</p>
            </div>
            <div className="rounded-xl bg-gray-900 px-4 py-2 text-right text-xs text-gray-400">
              <div>首筆資產：{winner.firstAssetAge == null ? '未發生' : `${Math.round(winner.firstAssetAge)} 歲`}</div>
              <div>脫出內圈：{winner.escapeAge == null ? '未脫出' : `${Math.round(winner.escapeAge)} 歲`}</div>
            </div>
          </div>
          <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {winnerTurningPoints.length > 0 ? winnerTurningPoints.map((event, index) => (
              <div key={`${event.age}-${event.type}-${index}`} className="rounded-xl border border-gray-700 bg-gray-900/70 p-3">
                <p className="text-xs font-bold text-yellow-300">{Math.round(event.age)} 歲 · 關鍵轉折</p>
                <p className="mt-1 text-xs leading-relaxed text-gray-300">{event.description}</p>
              </div>
            )) : (
              <p className="text-sm text-gray-500">本局沒有足夠的關鍵事件紀錄。</p>
            )}
          </div>
          <p className="mt-4 text-sm font-semibold text-indigo-200">討論：如果交換起始階層與職業，這條路線還成立嗎？</p>
        </div>
      )}

      {/* 雷達圖比較 */}
      <div className="card">
        <h3 className="text-sm font-semibold text-gray-300 mb-2">🕸 人生維度比較（點擊玩家名字聚焦）</h3>
        <ReactECharts option={radarOption} style={{ height: 380 }} />
      </div>
    </div>
  );
}
