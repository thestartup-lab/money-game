import { useState, useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import type { GameState, Player, PlayerAnalysis } from '../types/game';
import FinancialStatement from '../components/game/FinancialStatement';
import DiceRoller from '../components/game/DiceRoller';
import ActionPanel from '../components/game/ActionPanel';
import AnalysisPage from './AnalysisPage';
import { GameBoard, type BoardPlayer } from '../components/game/GameBoard';

const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:3001';
const fmt = (n: number) => n.toLocaleString('zh-TW', { maximumFractionDigits: 0 });

type View = 'join' | 'pre20' | 'game' | 'analysis' | 'gameover';

interface AvailableProfession {
  id: string;
  name: string;
  quadrant: string;
  startingSalary: number;
  salaryType?: string;
  hasFlexibleSchedule?: boolean;
}

const SOCIAL_CLASS_LABELS: Record<string, string> = {
  Wealthy: '富裕階層',
  UpperMiddle: '中上階層',
  Middle: '中等階層',
  LowerClass: '小康/貧窮',
};

const GROWTH_FIELDS: { key: 'academic' | 'health' | 'social' | 'resource'; label: string; desc: string }[] = [
  { key: 'academic', label: '學業', desc: '影響可選職業資格與職涯技能初始值' },
  { key: 'health',   label: '體能', desc: '影響初始 HP 健康值' },
  { key: 'social',   label: '社交', desc: '影響初始 NT 人脈值' },
  { key: 'resource', label: '資源', desc: '影響起始現金與財商初始值' },
];

// ── 棋盤 Tab：將 GameState.players 轉為 BoardPlayer 格式 ──
function BoardTab({
  players,
  myId,
  currentTurnPlayerId,
}: {
  players: Player[];
  myId: string;
  currentTurnPlayerId: string;
}) {
  const boardPlayers: BoardPlayer[] = players.map((p, i) => ({
    id: p.id,
    name: p.name,
    position: p.currentPosition,
    fastTrackPosition: p.fastTrackPosition ?? 0,
    isInFastTrack: p.isInFastTrack ?? false,
    isMe: p.id === myId,
    colorIndex: i,
    isBedridden: p.isBedridden,
  }));

  return (
    <GameBoard players={boardPlayers} currentTurnPlayerId={currentTurnPlayerId} />
  );
}

// ── 簡易 Tab 元件 ──
function Tabs({ tabs, panels }: { tabs: string[]; panels: React.ReactNode[] }) {
  const [active, setActive] = useState(0);
  return (
    <div>
      <div className="flex gap-1 bg-gray-800 p-1 rounded-xl mb-3">
        {tabs.map((t, i) => (
          <button
            key={i}
            className={`flex-1 py-1.5 rounded-lg text-sm font-medium transition-colors ${active === i ? 'bg-gray-700 text-white' : 'text-gray-500 hover:text-gray-300'}`}
            onClick={() => setActive(i)}
          >
            {t}
          </button>
        ))}
      </div>
      {panels[active]}
    </div>
  );
}

export default function PlayerPage() {
  const socketRef = useRef<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [myId, setMyId] = useState<string>('');
  const [view, setView] = useState<View>('join');
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [analysis, setAnalysis] = useState<PlayerAnalysis | null>(null);
  const [notifications, setNotifications] = useState<string[]>([]);
  const [lastRoll, setLastRoll] = useState<{ rolled: number; newPosition: number } | undefined>();

  // 互動機制 state
  type CongratulatableEvent = { targetId: string; targetName: string; event: string };
  type ActiveAuction = { auctionId: string; triggeredByName: string; endsAt: number };
  type PartnershipOffer = { offerId: string; offerorName: string; targetId: string };
  type LoanOffer = { offerId: string; lenderName: string; borrowerId: string; amount: number; monthlyRate: number };
  const [congratulatableEvent, setCongratulatableEvent] = useState<CongratulatableEvent | null>(null);
  const [activeAuction, setActiveAuction] = useState<ActiveAuction | null>(null);
  const [auctionBid, setAuctionBid] = useState('');
  const [partnershipOffer, setPartnershipOffer] = useState<PartnershipOffer | null>(null);
  const [loanOffer, setLoanOffer] = useState<LoanOffer | null>(null);

  // Join form state — pre-fill room code from URL ?room=XXX
  const [playerName, setPlayerName] = useState('');
  const [roomCode, setRoomCode] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return (params.get('room') ?? '').toUpperCase();
  });
  const [error, setError] = useState('');

  // Pre-20 state
  type Pre20Step = 'roll' | 'allocate' | 'career' | 'done';
  const [pre20Step, setPre20Step] = useState<Pre20Step>('roll');
  const [growthAlloc, setGrowthAlloc] = useState({ academic: 0, health: 0, social: 0, resource: 0 });
  const [, setAvailableProfessions] = useState<AvailableProfession[]>([]);
  const [canEducation, setCanEducation] = useState(false);

  const addNotification = (msg: string) => {
    setNotifications((prev) => [msg, ...prev].slice(0, 5));
  };

  useEffect(() => {
    const s = io(SERVER_URL, {
      transports: ['websocket', 'polling'], // polling 作為 WebSocket 失敗時的備援
      reconnectionAttempts: 5,
      reconnectionDelay: 2000,
    });
    socketRef.current = s;

    s.on('connect', () => {
      setConnected(true);
      setMyId(s.id ?? '');

      // 嘗試從 localStorage 自動重連恢復資料
      const saved = localStorage.getItem('baisuiGame');
      if (saved) {
        try {
          const { playerName: savedName, roomCode: savedRoom } = JSON.parse(saved) as { playerName: string; roomCode: string };
          if (savedName && savedRoom) {
            s.emit('playerRejoin', { playerName: savedName, roomCode: savedRoom });
          }
        } catch { /* 忽略格式錯誤 */ }
      }
    });
    s.on('disconnect', () => setConnected(false));
    s.on('error', (p: { message: string }) => setError(p.message));

    // 重連成功
    s.on('rejoinSuccess', () => {
      addNotification('✅ 重連成功，已恢復遊戲資料！');
    });

    // 重連失敗（資料已過期或房間不存在）
    s.on('rejoinFailed', () => {
      localStorage.removeItem('baisuiGame');
    });

    s.on('gameStateUpdate', (gs: GameState) => {
      setGameState(gs);
      const amIInGame = gs.players.some((p) => p.id === s.id);
      if (gs.gamePhase === 'GameOver') { setView('gameover'); localStorage.removeItem('baisuiGame'); }
      else if (amIInGame && gs.gamePhase === 'Pre20') setView((v) => v === 'join' ? 'pre20' : v);
      else if (amIInGame && ['RatRace', 'FastTrack'].includes(gs.gamePhase)) setView((v) => (v === 'pre20' || v === 'join') ? 'game' : v);
    });

    s.on('socialClassRolled', (p: { socialClass: string; label: string; growthPoints: number; startingCashBonus: number }) => {
      addNotification(`投胎完成：${p.label}，成長點數 ${p.growthPoints}，現金加成 $${fmt(p.startingCashBonus)}`);
      setView('pre20');
      setPre20Step('allocate');
      setGrowthAlloc({ academic: 0, health: 0, social: 0, resource: 0 });
    });

    s.on('growthStatsApplied', (p: { stats: unknown; availableProfessions: AvailableProfession[]; canContinueEducation: boolean }) => {
      setAvailableProfessions(p.availableProfessions);
      setCanEducation(p.canContinueEducation);
      setPre20Step('career');
    });

    s.on('educationLoanApplied', (p: { newFQ: number; lifeExpGained: number; availableProfessions: AvailableProfession[] }) => {
      setAvailableProfessions(p.availableProfessions);
      addNotification(`繼續進修！FQ 提升至 ${p.newFQ}，解鎖高階職業。下一個回合將跳過（進修代價）。`);
    });

    s.on('professionAssigned', (p: { profession: { name: string; quadrant: string }; quadrant: string; initialCashflow: number }) => {
      addNotification(`職業分配：${p.profession.name}（${p.quadrant} 象限），月現金流 $${fmt(p.initialCashflow)}`);
      setPre20Step('done');
    });

    s.on('rollResult', (p: { rolled: number; newPosition: number }) => setLastRoll(p));
    s.on('paydayPlanningRequired', () => addNotification('發薪日到了！請規劃你的投資'));
    s.on('ratRaceEscaped', (p: { playerName: string; canCongratulate?: boolean; playerId?: string }) => {
      addNotification(`🎉 ${p.playerName} 脫出老鼠賽跑！`);
      if (p.canCongratulate && p.playerId !== s.id) {
        setCongratulatableEvent({ targetId: p.playerId ?? '', targetName: p.playerName, event: '脫出老鼠賽跑' });
      }
    });
    s.on('marriageAnnouncement', (p: { playerName: string; marriageType: string; playerId?: string; canCongratulate?: boolean }) => {
      addNotification(`💍 ${p.playerName} 結婚了！`);
      if (p.canCongratulate && p.playerId !== s.id) {
        setCongratulatableEvent({ targetId: p.playerId ?? '', targetName: p.playerName, event: '結婚' });
      }
    });
    s.on('dealAuctionStarted', (p: { auctionId: string; triggeredByName: string; endsAt: number }) => {
      addNotification(`🔔 ${p.triggeredByName} 觸發競標！20 秒內可出價`);
      setActiveAuction(p);
    });
    s.on('dealAuctionEnded', (p: { auctionId: string; winnerName?: string; winningBid: number }) => {
      setActiveAuction(null);
      if (p.winnerName) addNotification(`🏆 競標結果：${p.winnerName} 以 $${fmt(p.winningBid)} 得標`);
    });
    s.on('dealBidUpdated', (p: { bidderName: string; bidAmount: number }) => {
      addNotification(`💰 ${p.bidderName} 出價 $${fmt(p.bidAmount)}`);
    });
    s.on('partnershipOfferReceived', (p: { offerId: string; offerorName: string; targetId: string }) => {
      if (p.targetId === s.id) {
        addNotification(`🤝 ${p.offerorName} 邀請你合夥投資！`);
        setPartnershipOffer(p);
      }
    });
    s.on('partnershipAccepted', (p: { offerorName: string; targetName: string }) => {
      addNotification(`✅ 合夥成功：${p.offerorName} & ${p.targetName}（+15 體驗值）`);
      setPartnershipOffer(null);
    });
    s.on('loanOfferReceived', (p: { offerId: string; lenderName: string; borrowerId: string; amount: number; monthlyRate: number }) => {
      if (p.borrowerId === s.id) {
        addNotification(`💳 ${p.lenderName} 願意借你 $${fmt(p.amount)}（月息 ${(p.monthlyRate * 100).toFixed(1)}%）`);
        setLoanOffer(p);
      }
    });
    s.on('loanAccepted', (p: { lenderName: string; borrowerName: string; amount: number }) => {
      addNotification(`✅ P2P 借貸成交：${p.lenderName} → ${p.borrowerName} $${fmt(p.amount)}`);
      setLoanOffer(null);
    });
    s.on('congratulationSent', (p: { senderName: string; targetName: string; amount: number }) => {
      addNotification(`🎊 ${p.senderName} 恭喜了 ${p.targetName}（$${p.amount}）`);
    });
    s.on('playerFinalScore', (p: { playerName: string; deathAge: number; score: { total: number } }) => {
      addNotification(`${p.playerName} 在 ${p.deathAge} 歲結束人生（${p.score.total} 分）`);
    });
    s.on('playerAnalysis', (data: PlayerAnalysis) => {
      setAnalysis(data);
      setView('analysis');
    });
    s.on('cardApplied', (p: { playerName?: string; effect?: { type?: string } }) => {
      if (p.effect?.type === 'crisis') addNotification('危機事件觸發！');
      if (p.effect?.type === 'baby') addNotification('添丁！');
    });
    s.on('gameClock', (p: { currentAge: number }) => {
      setGameState((gs) => gs ? { ...gs, currentAge: p.currentAge } : gs);
    });

    return () => { s.disconnect(); };
  }, []);

  const emit = (event: string, ...args: unknown[]) => socketRef.current?.emit(event, ...args);

  const myPlayer: Player | undefined = gameState?.players.find((p) => p.id === myId);
  const isMyTurn = gameState?.currentPlayerTurnId === myId;
  const isGameOver = gameState?.gamePhase === 'GameOver';

  // ── JOIN VIEW ──
  if (view === 'join') {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="card w-full max-w-sm space-y-4">
          <h1 className="text-2xl font-bold text-center text-emerald-400">百歲人生</h1>
          <p className="text-center text-gray-400 text-sm">輸入你的名字加入遊戲</p>

          {!connected && <p className="text-center text-yellow-400 text-sm">連線中…</p>}

          <input
            className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500 text-lg"
            placeholder="你的名字"
            value={playerName}
            onChange={(e) => setPlayerName(e.target.value)}
            maxLength={12}
            autoFocus
          />

          {roomCode ? (
            <div className="flex items-center gap-2 bg-gray-800 border border-emerald-700 rounded-xl px-3 py-2">
              <span className="text-gray-400 text-sm">房間：</span>
              <span className="font-mono text-emerald-300 text-lg font-bold tracking-widest flex-1">{roomCode}</span>
              <button
                className="text-xs text-gray-500 hover:text-gray-300 underline"
                onClick={() => setRoomCode('')}
              >
                更改
              </button>
            </div>
          ) : (
            <input
              className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-white placeholder-gray-500 uppercase tracking-widest focus:outline-none focus:border-emerald-500"
              placeholder="房間代碼 (e.g. ABC123)"
              value={roomCode}
              onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
              maxLength={6}
            />
          )}

          {error && <p className="text-red-400 text-sm text-center">{error}</p>}
          <button
            className="btn-primary w-full text-lg py-3"
            disabled={!connected || !playerName.trim() || roomCode.length < 6}
            onClick={() => {
              setError('');
              emit('playerJoin', { playerName: playerName.trim(), roomCode });
              // 儲存到 localStorage，供斷線後重連使用
              localStorage.setItem('baisuiGame', JSON.stringify({ playerName: playerName.trim(), roomCode }));
            }}
          >
            加入遊戲
          </button>
        </div>
      </div>
    );
  }

  // ── PRE-20 VIEW ──
  if (view === 'pre20') {
    const totalAllocated = growthAlloc.academic + growthAlloc.health + growthAlloc.social + growthAlloc.resource;
    const remaining = (myPlayer?.growthPointsRemaining ?? 0) - totalAllocated;
    const hasContinuedEdu = myPlayer?.hasContinuedEducation ?? false;

    return (
      <div className="min-h-screen p-4 space-y-4 max-w-lg mx-auto">
        {/* 標題 */}
        <div className="card text-center">
          <h2 className="text-xl font-bold text-emerald-400">20 歲前的人生</h2>
          <p className="text-gray-400 text-sm mt-1">你的起點決定你的可能性</p>
        </div>

        {/* 步驟指示器（3 步驟） */}
        <div className="flex items-center justify-between px-1">
          {(['roll', 'allocate', 'career'] as const).map((step, i) => {
            const labels = ['投胎', '成長', '職業'];
            const stepOrder: Pre20Step[] = ['roll', 'allocate', 'career', 'done'];
            const currentIdx = stepOrder.indexOf(pre20Step);
            const isDone = currentIdx > i;
            const isCurrent = currentIdx === i;
            return (
              <div key={step} className="flex items-center flex-1">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-colors ${isDone ? 'bg-emerald-600 text-white' : isCurrent ? 'bg-emerald-400 text-black' : 'bg-gray-700 text-gray-500'}`}>
                  {isDone ? '✓' : i + 1}
                </div>
                <span className={`ml-1 text-xs ${isCurrent ? 'text-white' : 'text-gray-500'}`}>{labels[i]}</span>
                {i < 2 && <div className={`flex-1 h-0.5 mx-2 ${isDone ? 'bg-emerald-600' : 'bg-gray-700'}`} />}
              </div>
            );
          })}
        </div>

        {/* ── 步驟 1：投胎 ── */}
        {pre20Step === 'roll' && (
          <div className="card space-y-3">
            <p className="text-gray-300 text-sm">你即將隨機「投胎」成為四種社會階層之一，階層決定你的成長點數上限與起始資源。</p>
            <div className="grid grid-cols-2 gap-2 text-xs">
              {[['富裕階層', '多點數', 'text-yellow-300'], ['中上階層', '均衡', 'text-blue-300'], ['中等階層', '一般', 'text-gray-300'], ['小康/貧窮', '少點數', 'text-gray-500']].map(([name, desc, color]) => (
                <div key={name} className="bg-gray-800 rounded-lg p-2">
                  <p className={`font-bold ${color}`}>{name}</p>
                  <p className="text-gray-400">{desc}</p>
                </div>
              ))}
            </div>
            <button
              className="btn-primary w-full"
              onClick={() => { setError(''); emit('rollSocialClass'); }}
            >
              擲骰投胎
            </button>
          </div>
        )}

        {/* 階層已確定：顯示 */}
        {myPlayer?.socialClass && pre20Step !== 'roll' && (
          <div className="card flex items-center justify-between">
            <div>
              <p className="text-xs text-gray-400">社會階層</p>
              <p className="text-yellow-300 font-bold">{SOCIAL_CLASS_LABELS[myPlayer.socialClass] ?? myPlayer.socialClass}</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-gray-400">已分配 / 總點數</p>
              <p className="text-blue-300 font-bold">{totalAllocated} / {myPlayer.growthPointsRemaining}</p>
            </div>
          </div>
        )}

        {/* ── 步驟 2：分配成長屬性 ── */}
        {pre20Step === 'allocate' && myPlayer && (
          <div className="card space-y-4">
            <div className="flex justify-between items-center">
              <p className="text-sm font-semibold text-white">分配成長點數</p>
              <span className={`text-sm font-bold ${remaining > 0 ? 'text-blue-300' : 'text-emerald-400'}`}>
                剩餘 {remaining} 點
              </span>
            </div>
            {GROWTH_FIELDS.map(({ key, label, desc }) => (
              <div key={key} className="space-y-1">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-300">{label}</span>
                  <span className="text-white font-bold">{growthAlloc[key]}</span>
                </div>
                <p className="text-xs text-gray-500">{desc}</p>
                <div className="flex items-center gap-2">
                  <button
                    className="w-8 h-8 bg-gray-700 hover:bg-gray-600 rounded-lg font-bold disabled:opacity-30 transition-colors"
                    disabled={growthAlloc[key] <= 0}
                    onClick={() => setGrowthAlloc((prev) => ({ ...prev, [key]: prev[key] - 1 }))}
                  >-</button>
                  <div className="flex-1 bg-gray-800 rounded-full h-2">
                    <div
                      className="bg-emerald-500 h-2 rounded-full transition-all"
                      style={{ width: `${myPlayer.growthPointsRemaining > 0 ? (growthAlloc[key] / myPlayer.growthPointsRemaining) * 100 : 0}%` }}
                    />
                  </div>
                  <button
                    className="w-8 h-8 bg-gray-700 hover:bg-gray-600 rounded-lg font-bold disabled:opacity-30 transition-colors"
                    disabled={remaining <= 0}
                    onClick={() => setGrowthAlloc((prev) => ({ ...prev, [key]: prev[key] + 1 }))}
                  >+</button>
                </div>
              </div>
            ))}
            <button
              className="btn-primary w-full"
              disabled={totalAllocated === 0}
              onClick={() => {
                setError('');
                emit('allocateGrowthStats', growthAlloc);
              }}
            >
              確認分配（已分配 {totalAllocated} 點）
            </button>
            {error && <p className="text-red-400 text-sm text-center">{error}</p>}
          </div>
        )}

        {/* ── 步驟 3：職業選擇（E / S 象限） ── */}
        {pre20Step === 'career' && (
          <div className="space-y-3">
            {/* 警告橫幅 */}
            <div className="bg-orange-900 border border-orange-600 rounded-xl px-4 py-3 flex items-start gap-2">
              <span className="text-orange-400 text-xl leading-tight">⚠</span>
              <p className="text-orange-200 text-sm font-semibold">
                職業一旦確認無法更改，請仔細考慮是否先進修再選擇象限。
              </p>
            </div>

            {/* 進修卡片 */}
            <div className="card space-y-3">
              <p className="text-sm font-semibold text-white">繼續進修？</p>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="bg-emerald-950 border border-emerald-800 rounded-lg p-2 space-y-1">
                  <p className="text-emerald-400 font-semibold">進修優點</p>
                  <p className="text-gray-300">解鎖高薪 E 職業（醫生、IT、店長、公職）</p>
                  <p className="text-gray-300">解鎖高階 S 職業（顧問、財務顧問等）</p>
                  <p className="text-gray-300">FQ 財商值提升</p>
                </div>
                <div className="bg-red-950 border border-red-800 rounded-lg p-2 space-y-1">
                  <p className="text-red-400 font-semibold">進修代價</p>
                  <p className="text-gray-300">$30,000 學貸（每月 -$600）</p>
                  <p className="text-gray-300">跳過第一個發薪日</p>
                </div>
              </div>
              {hasContinuedEdu ? (
                <div className="bg-emerald-950 border border-emerald-700 rounded-xl p-3 space-y-2">
                  <p className="text-emerald-300 font-bold text-sm">✓ 進修完成！你從 25 歲開始職涯</p>
                  <p className="text-xs text-gray-400">進修期間 22–25 歲，跳過第一個發薪日作為代價</p>
                  <div className="space-y-1 pt-2 border-t border-emerald-800/60">
                    <p className="text-xs text-white font-semibold">已解鎖高階職業（保證分配，不會抽到初階）：</p>
                    <div className="flex items-start gap-1.5">
                      <span className="text-xs font-bold bg-blue-700 text-white px-1.5 py-0.5 rounded-full flex-shrink-0">E</span>
                      <p className="text-xs text-blue-200">IT工程師、醫生、店長、公職人員</p>
                    </div>
                    <div className="flex items-start gap-1.5">
                      <span className="text-xs font-bold bg-purple-700 text-white px-1.5 py-0.5 rounded-full flex-shrink-0">S</span>
                      <p className="text-xs text-purple-200">顧問、財務顧問、心理諮商師、律師（獨立）</p>
                    </div>
                  </div>
                </div>
              ) : canEducation ? (
                <>
                  <button
                    className="w-full bg-blue-700 hover:bg-blue-600 text-white font-bold py-2 rounded-xl transition-colors"
                    onClick={() => { setError(''); emit('continueEducation'); }}
                  >
                    選擇進修（解鎖高階職業，25歲起）
                  </button>
                  <p className="text-xs text-gray-500 text-center">不進修則從 22 歲開始職涯（基礎職業）</p>
                </>
              ) : (
                <p className="text-gray-500 text-xs text-center">此角色資格不符，無法繼續進修，從 22 歲開始職涯</p>
              )}
            </div>

            {/* E 象限卡片 */}
            <div className="card space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold bg-blue-700 text-white px-2 py-0.5 rounded-full">E</span>
                <p className="text-sm font-semibold text-white">受薪族（Employee）</p>
              </div>
              <p className="text-xs text-gray-400">穩定固定薪資，時間受限（固定行程），每發薪日只能進行一次選擇性活動。</p>
              <p className="text-xs text-gray-500">職業由系統依象限隨機分配{hasContinuedEdu ? '（含高階職業：IT工程師、醫生、店長、公職）' : '（基礎職業）'}。</p>
              <button
                className="w-full bg-blue-800 hover:bg-blue-700 border border-blue-600 text-white font-bold py-2.5 rounded-xl transition-colors"
                onClick={() => { setError(''); emit('selectQuadrant', { quadrant: 'E' }); }}
              >
                選擇 E 象限，隨機分配職業
              </button>
            </div>

            {/* S 象限卡片 */}
            <div className="card space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold bg-purple-700 text-white px-2 py-0.5 rounded-full">S</span>
                <p className="text-sm font-semibold text-white">自僱者（Self-Employed）</p>
              </div>
              <p className="text-xs text-gray-400">自由行程，可無限進行旅遊與社交活動，但收入波動較大（依人脈、技能或隨機）。</p>
              <p className="text-xs text-gray-500">職業由系統依象限隨機分配{hasContinuedEdu ? '（含進階職業：顧問、財務顧問、心理諮商師）' : '（基礎＋中階職業）'}。</p>
              <button
                className="w-full bg-purple-800 hover:bg-purple-700 border border-purple-600 text-white font-bold py-2.5 rounded-xl transition-colors"
                onClick={() => { setError(''); emit('selectQuadrant', { quadrant: 'S' }); }}
              >
                選擇 S 象限，隨機分配職業
              </button>
            </div>

            {/* B / I 提示說明 */}
            <div className="bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 space-y-1">
              <p className="text-xs text-gray-400 font-semibold">B / I 象限說明（非初始選項）</p>
              <p className="text-xs text-gray-500">B（企業主）：遊戲中現金達門檻後可申請加盟，或透過特殊事件創業取得。</p>
              <p className="text-xs text-gray-500">I（投資者）：被動收入 &gt; 總支出時，自動達到 FastTrack 狀態。</p>
            </div>

            {error && <p className="text-red-400 text-sm text-center">{error}</p>}
          </div>
        )}

        {/* ── 步驟完成：等待遊戲開始 ── */}
        {pre20Step === 'done' && myPlayer && (
          <div className="card text-center space-y-2">
            <p className="text-2xl">🎉</p>
            <p className="text-emerald-400 font-bold text-lg">設定完成！</p>
            <p className="text-gray-300 text-sm">{myPlayer.profession.name}（{myPlayer.profession.quadrant} 象限）</p>
            <p className="text-gray-400 text-xs">等待主持人啟動遊戲…</p>
          </div>
        )}

        {/* ── 互動彈出卡片 ── */}
        {congratulatableEvent && (
          <div className="card border border-yellow-600 bg-yellow-900 space-y-2">
            <p className="text-yellow-200 font-semibold text-sm">🎉 {congratulatableEvent.targetName} {congratulatableEvent.event}！</p>
            <p className="text-yellow-400 text-xs">花費 $500 送上祝賀（對方 +$500，NT+0.2）</p>
            <div className="flex gap-2">
              <button className="btn-primary text-sm flex-1" onClick={() => {
                emit('congratulate', { targetPlayerId: congratulatableEvent.targetId, event: congratulatableEvent.event });
                setCongratulatableEvent(null);
              }}>🎊 恭喜（$500）</button>
              <button className="btn-secondary text-sm" onClick={() => setCongratulatableEvent(null)}>略過</button>
            </div>
          </div>
        )}

        {activeAuction && (
          <div className="card border border-blue-600 bg-blue-900 space-y-2">
            <p className="text-blue-200 font-semibold text-sm">🔔 {activeAuction.triggeredByName} 觸發競標</p>
            <p className="text-blue-400 text-xs">20 秒內可出價搶標此筆交易</p>
            <div className="flex gap-2">
              <input
                type="number"
                value={auctionBid}
                onChange={(e) => setAuctionBid(e.target.value)}
                placeholder="出價金額"
                className="input-field flex-1 text-sm"
              />
              <button className="btn-primary text-sm" onClick={() => {
                emit('bidDeal', { auctionId: activeAuction.auctionId, bidAmount: Number(auctionBid) });
                setAuctionBid('');
              }}>出價</button>
              <button className="btn-secondary text-sm" onClick={() => setActiveAuction(null)}>放棄</button>
            </div>
          </div>
        )}

        {partnershipOffer && (
          <div className="card border border-green-600 bg-green-900 space-y-2">
            <p className="text-green-200 font-semibold text-sm">🤝 {partnershipOffer.offerorName} 邀請你合夥！</p>
            <p className="text-green-400 text-xs">雙方各獲得 +15 生命體驗值</p>
            <div className="flex gap-2">
              <button className="btn-primary text-sm flex-1" onClick={() => {
                emit('partnershipResponse', { offerId: partnershipOffer.offerId, accepted: true });
                setPartnershipOffer(null);
              }}>✅ 接受合夥</button>
              <button className="btn-secondary text-sm" onClick={() => {
                emit('partnershipResponse', { offerId: partnershipOffer.offerId, accepted: false });
                setPartnershipOffer(null);
              }}>❌ 拒絕</button>
            </div>
          </div>
        )}

        {loanOffer && (
          <div className="card border border-purple-600 bg-purple-900 space-y-2">
            <p className="text-purple-200 font-semibold text-sm">💳 {loanOffer.lenderName} 願意借你 ${loanOffer.amount.toLocaleString()}</p>
            <p className="text-purple-400 text-xs">月息 {(loanOffer.monthlyRate * 100).toFixed(1)}%（每月支出增加 ${Math.round(loanOffer.amount * loanOffer.monthlyRate).toLocaleString()}）</p>
            <div className="flex gap-2">
              <button className="btn-primary text-sm flex-1" onClick={() => {
                emit('loanResponse', { offerId: loanOffer.offerId, accepted: true });
                setLoanOffer(null);
              }}>✅ 借款</button>
              <button className="btn-secondary text-sm" onClick={() => {
                emit('loanResponse', { offerId: loanOffer.offerId, accepted: false });
                setLoanOffer(null);
              }}>❌ 拒絕</button>
            </div>
          </div>
        )}

        {/* 通知 */}
        {notifications.length > 0 && (
          <div className="card space-y-1">
            {notifications.map((n, i) => (
              <p key={i} className="text-sm text-gray-300">{n}</p>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ── GAME VIEW ──
  if ((view === 'game' || view === 'gameover') && myPlayer && gameState) {
    return (
      <div className="min-h-screen p-3 space-y-3 max-w-lg mx-auto">
        {/* 頂部狀態列 */}
        <div className="flex items-center justify-between">
          <div>
            <span className="text-white font-bold">{myPlayer.name}</span>
            <span className="ml-2 text-gray-400 text-sm">{myPlayer.profession.name}</span>
          </div>
          <div className="text-right">
            <span className="text-yellow-300 font-bold">{gameState.currentAge.toFixed(1)} 歲</span>
            {gameState.isPaused && <span className="ml-2 text-orange-400 text-xs">⏸ 暫停</span>}
          </div>
        </div>

        {/* 通知 */}
        {notifications.length > 0 && (
          <div className="card bg-gray-800 space-y-1 max-h-24 overflow-y-auto">
            {notifications.map((n, i) => (
              <p key={i} className="text-xs text-gray-300">{n}</p>
            ))}
          </div>
        )}

        {/* 幸福指數即時目標提示 */}
        {!isGameOver && (() => {
          const cf = myPlayer.monthlyCashflow;
          const exp = myPlayer.totalExpenses;
          const hp = myPlayer.stats.health;
          const nt = myPlayer.stats.network;
          const travels = myPlayer.visitedDestinations?.length ?? 0;
          let hint = '';
          let hintColor = 'text-emerald-300';
          if (hp < 40) {
            hint = '❤️ 健康警告！少旅遊多休養，維護生命體驗指數';
            hintColor = 'text-red-400';
          } else if (cf < 0) {
            hint = '📉 現金流為負，賣掉負現金流資產讓錢幫你工作';
            hintColor = 'text-red-400';
          } else if (!myPlayer.isMarried && nt < 3) {
            hint = '🤝 NT 人脈偏低，多社交事件可提升人際關係指數';
            hintColor = 'text-pink-400';
          } else if (cf < 500) {
            hint = '💡 持續投資小交易，增加被動收入提升人生成就指數';
            hintColor = 'text-yellow-400';
          } else if (travels < 3) {
            hint = '✈️ 多出去走走！旅遊可提升生命體驗指數';
            hintColor = 'text-teal-400';
          } else if (cf >= exp && !myPlayer.isInFastTrack) {
            hint = '🚀 被動收入已超越支出，快準備脫出老鼠賽跑！';
            hintColor = 'text-emerald-400';
          }
          return hint ? (
            <div className={`text-xs px-3 py-1.5 rounded-lg bg-gray-800 border border-gray-700 ${hintColor}`}>
              {hint}
            </div>
          ) : null;
        })()}

        {/* 遊戲結束橫幅 */}
        {isGameOver && (
          <div className="card bg-purple-900 border-purple-700 text-center">
            <p className="text-purple-200 font-bold">遊戲結束！</p>
            <button className="btn-primary mt-2 text-sm" onClick={() => { setView('analysis'); emit('requestPlayerAnalysis'); }}>
              查看我的人生分析
            </button>
          </div>
        )}

        {/* 擲骰 */}
        {!isGameOver && (
          <DiceRoller
            isMyTurn={isMyTurn}
            isBedridden={myPlayer.isBedridden}
            onRoll={(count) => emit('playerRoll', { diceCount: count })}
            lastRoll={lastRoll}
          />
        )}

        {/* 標籤切換：棋盤 / 財報 / 行動 */}
        <Tabs
          tabs={['棋盤', '財務報表', '行動']}
          panels={[
            <BoardTab key="board" players={gameState.players} myId={myId} currentTurnPlayerId={gameState.currentPlayerTurnId} />,
            <FinancialStatement key="fs" player={myPlayer} />,
            <ActionPanel
              key="ap"
              player={myPlayer}
              currentAge={gameState.currentAge}
              onTravel={(destId) => emit('goTravel', { destinationId: destId })}
              onSocialEvent={() => emit('attendSocialEvent')}
              onBuyInsurance={(t) => emit('buyInsurance', { insuranceType: t })}
              onTakeEmergencyLoan={(amt) => emit('takeEmergencyLoan', { amount: amt })}
              onRequestAnalysis={() => { emit('requestPlayerAnalysis'); }}
              isGameOver={isGameOver}
            />,
          ]}
        />
      </div>
    );
  }

  // ── ANALYSIS VIEW ──
  if (view === 'analysis' && analysis) {
    return (
      <div className="min-h-screen p-3 max-w-lg mx-auto">
        <button className="btn-secondary text-sm mb-3" onClick={() => setView(isGameOver ? 'gameover' : 'game')}>
          ← 返回
        </button>
        <AnalysisPage analysis={analysis} />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center text-gray-400">
      載入中…
    </div>
  );
}

