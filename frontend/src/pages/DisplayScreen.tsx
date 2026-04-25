import { useState, useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import ReactECharts from 'echarts-for-react';
import { QRCodeSVG } from 'qrcode.react';
import type { GameState, RoomPlayerSummary, LifeScoreBreakdown } from '../types/game';
import { GameBoard } from '../components/game/GameBoard';
import type { BoardPlayer } from '../components/game/GameBoard';
import IntroSheet from '../components/game/IntroSheet';
import DecisionHistoryView from '../components/analysis/DecisionHistoryView';

const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:3001';
const fmt = (n: number) => n.toLocaleString('zh-TW', { maximumFractionDigits: 0 });

const STAGE_LABELS: Record<string, string> = {
  Youth: '青年期', Family: '家庭期', Peak: '壯年期', Senior: '暮年期', Legacy: '傳承期',
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
  // 倒數計時（毫秒），從 gameState 的 gameDurationMs 與 currentAge 算出，每秒本地遞減
  const [countdownMs, setCountdownMs] = useState(0);
  const countdownRef = useRef(0);
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
  const paydayDismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 本回合玩家行動標記
  const [playerRoundActions, setPlayerRoundActions] = useState<Map<string, string>>(new Map());
  const prevTurnIdRef = useRef<string | null>(null);
  // 競標面板
  type AuctionPanel = {
    auctionId: string; triggeredByName: string; cardName: string;
    minBid: number; highestBid: number; highestBidderName?: string;
    endsAt: number; secondsLeft: number;
  };
  const [auctionPanel, setAuctionPanel] = useState<AuctionPanel | null>(null);
  const auctionCountdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const addTicker = (msg: string) => setTicker((prev) => [msg, ...prev].slice(0, 6));

  useEffect(() => {
    const s = io(SERVER_URL, { transports: ['websocket', 'polling'], reconnectionAttempts: 5, reconnectionDelay: 2000 });
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
      setJoined(true);
      setJoining(false);
      // 若尚未記錄房間代碼（例如 gameStateUpdate 先於 joinDisplaySuccess 到達），從 gs 補記
      if (!joinedRoomRef.current && gs.roomId) {
        joinedRoomRef.current = gs.roomId;
      }
    });
    s.on('gameClock', (p: { currentAge: number }) => {
      setGameState((gs) => gs ? { ...gs, currentAge: p.currentAge } : gs);
    });
    s.on('roomAnalysis', (data: typeof roomAnalysis) => { setRoomAnalysis(data); setView('analysis'); });
    s.on('ratRaceEscaped', (p: { playerName: string; monthlyPassiveIncome: number }) => {
      addTicker(`🚀 ${p.playerName} 脫出老鼠賽跑！被動收入 $${fmt(p.monthlyPassiveIncome)}/月`);
    });
    s.on('marriageAnnouncement', (p: { playerName: string }) => addTicker(`💑 ${p.playerName} 結婚了！`));

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

    const showCenterEvent = (evt: CellEvent, autoDismissMs?: number) => {
      setCenterEvent(evt);
      if (centerEventTimer.current) clearTimeout(centerEventTimer.current);
      if (autoDismissMs) {
        centerEventTimer.current = setTimeout(() => setCenterEvent(null), autoDismissMs);
      }
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
    s.on('annualTaxResult', (p: { playerName: string; taxAmount: number }) => {
      addTicker(`🧾 ${p.playerName} 繳稅 $${fmt(p.taxAmount)}`);
    });
    s.on('dealAuctionStarted', (p: { auctionId: string; triggeredByName: string; endsAt: number; card?: { name: string; minBid: number; monthlyCashflow?: number } }) => {
      const cardName = p.card?.name ?? '交易';
      const minBid = p.card?.minBid ?? 0;
      showCenterEvent({ playerName: p.triggeredByName, cellName: '🔔 開放競標！', message: `${p.triggeredByName} 放棄交易，${cardName} 開放競標！起標 $${minBid.toLocaleString()}` });
      addTicker(`🔔 ${p.triggeredByName} 放棄「${cardName}」，開放競標（起標 $${minBid.toLocaleString()}）`);
      const secondsLeft = Math.max(0, Math.round((p.endsAt - Date.now()) / 1000));
      setAuctionPanel({ auctionId: p.auctionId, triggeredByName: p.triggeredByName, cardName, minBid, highestBid: 0, endsAt: p.endsAt, secondsLeft });
      if (auctionCountdownRef.current) clearInterval(auctionCountdownRef.current);
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
    return () => { s.disconnect(); };
  }, []);

  // 每秒本地遞減倒數計時（暫停時停止）
  useEffect(() => {
    const timer = setInterval(() => {
      if (!gameState?.isPaused && countdownRef.current > 0) {
        countdownRef.current = Math.max(0, countdownRef.current - 1000);
        setCountdownMs(countdownRef.current);
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [gameState?.isPaused]);

  // 換人行動時清除本回合行動標記
  useEffect(() => {
    if (!gameState) return;
    const newTurnId = gameState.currentPlayerTurnId;
    if (prevTurnIdRef.current && prevTurnIdRef.current !== newTurnId) {
      setPlayerRoundActions(new Map());
    }
    prevTurnIdRef.current = newTurnId ?? null;
  }, [gameState?.currentPlayerTurnId]);

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
      if (e.key === 'Enter') { setShowPaydayOverlay(false); setPaydayCards(new Map()); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [showPaydayOverlay]);

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

  // 計算剩餘毫秒（從 currentAge 反推）並同步到 countdownRef
  const calcRemaining = (gs: GameState) => {
    const ratio = Math.min(1, Math.max(0, (gs.currentAge - 20) / 80));
    return Math.max(0, Math.round(gs.gameDurationMs * (1 - ratio)));
  };

  // 每次 gameState 更新時重新校正倒數
  if (Math.abs(countdownRef.current - calcRemaining(gameState)) > 3000 || countdownRef.current === 0) {
    countdownRef.current = calcRemaining(gameState);
  }

  // 格式化為 MM:SS
  const formatCountdown = (ms: number) => {
    const totalSec = Math.max(0, Math.ceil(ms / 1000));
    const m = Math.floor(totalSec / 60).toString().padStart(2, '0');
    const s = (totalSec % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  const playerUrl = `${window.location.protocol}//${window.location.host}/?room=${gameState.roomId}`;

  // 把玩家轉為 GameBoard 格式（含 HP / 現金流 / 年齡等富資訊，給棋盤中央面板顯示）
  const boardPlayers: BoardPlayer[] = gameState.players.map((p, i) => ({
    id: p.id,
    name: p.name,
    position: p.currentPosition,
    fastTrackPosition: p.fastTrackPosition ?? 0,
    isInFastTrack: p.isInFastTrack ?? false,
    isMe: false,
    colorIndex: i % 6,
    isBedridden: p.isBedridden,
    health: p.stats.health,
    monthlyCashflow: p.monthlyCashflow,
    age: Math.floor(gameState.currentAge + ((p.startAge ?? 20) - 20)),
    isAlive: p.isAlive,
    isMarried: p.isMarried,
    roundAction: playerRoundActions.get(p.id) || undefined,
  }));

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col">

      {/* ══ 頂部大型計時器橫幅 ══ */}
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
            {PHASE_LABELS[gameState.gamePhase] ?? gameState.gamePhase}
          </span>
        </div>

        {/* 中：倒數計時器（取代年齡顯示） */}
        <div className="text-center flex-shrink-0">
          <div className={`text-7xl font-bold tabular-nums leading-none tracking-tight ${
            countdownMs < 300_000 ? 'text-red-400' : countdownMs < 600_000 ? 'text-orange-300' : 'text-yellow-300'
          }`}>
            {gameState.isPaused ? '⏸' : formatCountdown(countdownMs)}
          </div>
          <div className="text-base text-gray-300 mt-0.5 tracking-wide">
            {gameState.isPaused ? '暫停中' : `剩餘時間 · ${STAGE_LABELS[gameState.currentStage] ?? gameState.currentStage}`}
          </div>
        </div>

        {/* 右：控制按鈕 + 連線狀態 */}
        <div className="flex items-center gap-2 min-w-0 justify-end">
          <button
            className={`text-sm px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap ${view === 'intro' ? 'bg-emerald-700 text-white' : 'bg-gray-700 hover:bg-gray-600 text-gray-300'}`}
            onClick={() => setView(view === 'intro' ? 'game' : 'intro')}
          >
            策略指南
          </button>
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
      {view === 'intro' ? (
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

            {/* QR Code */}
            <div className="flex flex-col items-center gap-2 bg-gray-900 rounded-xl p-3">
              <div className="bg-white rounded-lg p-2">
                <QRCodeSVG value={playerUrl} size={150} />
              </div>
              <p className="text-xs text-gray-400">掃碼加入遊戲</p>
              <p className="font-mono text-2xl font-bold text-yellow-300 tracking-[0.3em]">{gameState.roomId}</p>
            </div>

            {/* 競標面板 */}
            {auctionPanel && (
              <div className="bg-blue-950 border border-blue-500 rounded-xl p-3 space-y-1.5 animate-pulse-once">
                <div className="flex items-center justify-between">
                  <p className="text-blue-200 font-bold text-xs">🔔 競標進行中</p>
                  <span className={`text-xs font-mono font-bold px-2 py-0.5 rounded-full ${auctionPanel.secondsLeft <= 5 ? 'bg-red-700 text-white' : 'bg-blue-700 text-blue-100'}`}>
                    {auctionPanel.secondsLeft}s
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
            <GameBoard players={boardPlayers} currentTurnPlayerId={gameState.currentPlayerTurnId} />

            {/* 發薪日決策小卡 overlay */}
            {showPaydayOverlay && paydayCards.size > 0 && (
              <div
                className="absolute inset-0 flex flex-col items-center justify-center z-40 bg-black/60 backdrop-blur-sm pointer-events-auto cursor-pointer"
                onClick={() => { setShowPaydayOverlay(false); setPaydayCards(new Map()); }}
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

      {/* 雷達圖比較 */}
      <div className="card">
        <h3 className="text-sm font-semibold text-gray-300 mb-2">🕸 人生維度比較（點擊玩家名字聚焦）</h3>
        <ReactECharts option={radarOption} style={{ height: 380 }} />
      </div>
    </div>
  );
}
