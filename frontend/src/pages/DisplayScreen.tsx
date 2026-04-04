import { useState, useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import ReactECharts from 'echarts-for-react';
import { QRCodeSVG } from 'qrcode.react';
import type { GameState, RoomPlayerSummary, LifeScoreBreakdown } from '../types/game';
import { GameBoard } from '../components/game/GameBoard';
import type { BoardPlayer } from '../components/game/GameBoard';

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
  const [view, setView] = useState<'game' | 'analysis'>('game');
  const [ticker, setTicker] = useState<string[]>([]);

  const addTicker = (msg: string) => setTicker((prev) => [msg, ...prev].slice(0, 6));

  useEffect(() => {
    const s = io(SERVER_URL, { transports: ['websocket', 'polling'], reconnectionAttempts: 5, reconnectionDelay: 2000 });
    socketRef.current = s;
    s.on('connect', () => {
      setConnected(true);
      // 若 URL 已帶入房間代碼（從後台直接跳轉），自動加入展示
      const params = new URLSearchParams(window.location.search);
      const urlRoom = params.get('room')?.toUpperCase();
      if (urlRoom && urlRoom.length >= 4) {
        setJoining(true);
        s.emit('joinDisplay', { roomId: urlRoom });
      }
    });
    s.on('disconnect', () => setConnected(false));
    s.on('joinDisplaySuccess', () => { setJoined(true); setJoining(false); });
    s.on('joinDisplayFail', (p: { message: string }) => { setJoinError(p.message); setJoining(false); });
    // 若後端尚未支援 joinDisplay，收到 gameStateUpdate 也視為成功
    s.on('gameStateUpdate', (gs: GameState) => { setGameState(gs); setJoined(true); setJoining(false); });
    s.on('gameClock', (p: { currentAge: number }) => {
      setGameState((gs) => gs ? { ...gs, currentAge: p.currentAge } : gs);
    });
    s.on('roomAnalysis', (data: typeof roomAnalysis) => { setRoomAnalysis(data); setView('analysis'); });
    s.on('ratRaceEscaped', (p: { playerName: string; monthlyPassiveIncome: number }) => {
      addTicker(`🚀 ${p.playerName} 脫出老鼠賽跑！被動收入 $${fmt(p.monthlyPassiveIncome)}/月`);
    });
    s.on('marriageAnnouncement', (p: { playerName: string }) => addTicker(`💑 ${p.playerName} 結婚了！`));
    s.on('playerFinalScore', (p: { playerName: string; deathAge: number; score: { total: number } }) => {
      addTicker(`⚰️ ${p.playerName} 在 ${p.deathAge} 歲結束人生，得 ${Math.round(p.score.total)} 分`);
    });
    s.on('globalEventAnnouncement', (p: { event: { title: string; description: string } }) => {
      addTicker(`📢 全局事件：${p.event.title} — ${p.event.description}`);
    });
    s.on('annualTaxResult', (p: { playerName: string; taxAmount: number }) => {
      addTicker(`🧾 ${p.playerName} 繳稅 $${fmt(p.taxAmount)}`);
    });
    return () => { s.disconnect(); };
  }, []);

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

  // 把玩家轉為 GameBoard 格式
  const boardPlayers: BoardPlayer[] = gameState.players.map((p, i) => ({
    id: p.id,
    name: p.name,
    position: p.currentPosition,
    fastTrackPosition: p.fastTrackPosition ?? 0,
    isInFastTrack: p.isInFastTrack ?? false,
    isMe: false,
    colorIndex: i % 6,
    isBedridden: p.isBedridden,
  }));

  const dotColors = ['bg-amber-400', 'bg-blue-400', 'bg-pink-400', 'bg-emerald-400', 'bg-purple-400', 'bg-orange-400'];

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

        {/* 中：大型年齡計時器 */}
        <div className="text-center flex-shrink-0">
          <div className="text-7xl font-bold text-yellow-300 tabular-nums leading-none tracking-tight">
            {gameState.currentAge.toFixed(1)}
          </div>
          <div className="text-base text-gray-300 mt-0.5 tracking-wide">
            歲 &nbsp;·&nbsp; {STAGE_LABELS[gameState.currentStage] ?? gameState.currentStage}
            {gameState.isPaused && <span className="ml-2 text-orange-400">⏸ 暫停中</span>}
          </div>
        </div>

        {/* 右：控制按鈕 + 連線狀態 */}
        <div className="flex items-center gap-2 min-w-0 justify-end">
          {gameState.gamePhase === 'GameOver' && (
            <button
              className="text-sm px-4 py-1.5 rounded-lg bg-purple-800 hover:bg-purple-700 transition-colors whitespace-nowrap"
              onClick={() => emit('requestRoomAnalysis')}
            >
              顯示分析
            </button>
          )}
          {view === 'analysis' && (
            <button
              className="text-sm px-4 py-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 transition-colors whitespace-nowrap"
              onClick={() => setView('game')}
            >
              返回棋盤
            </button>
          )}
          <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${connected ? 'bg-green-400' : 'bg-red-400'}`} />
        </div>
      </div>

      {/* 主體 */}
      {view === 'analysis' && roomAnalysis ? (
        <div className="flex-1 overflow-y-auto p-4">
          <RoomAnalysisView analysis={roomAnalysis} />
        </div>
      ) : (
        <div className="flex flex-1 overflow-hidden">

          {/* ══ 左欄：QR + 玩家名單 ══ */}
          <div className="w-52 xl:w-60 flex-shrink-0 flex flex-col gap-3 p-3 overflow-y-auto border-r border-gray-800">

            {/* QR Code */}
            <div className="flex flex-col items-center gap-2 bg-gray-900 rounded-xl p-3">
              <div className="bg-white rounded-lg p-2">
                <QRCodeSVG value={playerUrl} size={150} />
              </div>
              <p className="text-xs text-gray-400">掃碼加入遊戲</p>
              <p className="font-mono text-2xl font-bold text-yellow-300 tracking-[0.3em]">{gameState.roomId}</p>
            </div>

            {/* 玩家名單 */}
            <div className="space-y-2">
              <p className="text-xs text-gray-500 font-semibold uppercase tracking-wider px-1">
                參與者 {gameState.players.length} 人
              </p>
              {[...gameState.players]
                .sort((a, b) => b.monthlyCashflow - a.monthlyCashflow)
                .map((p, i) => {
                  const cfColor = p.monthlyCashflow >= 0 ? 'text-emerald-400' : 'text-red-400';
                  const hpColor = p.stats.health >= 60 ? 'text-green-400' : p.stats.health >= 30 ? 'text-yellow-400' : 'text-red-400';
                  const isTurn = p.id === gameState.currentPlayerTurnId;
                  return (
                    <div key={p.id} className={`rounded-xl px-3 py-2 ${isTurn ? 'bg-emerald-900/40 border border-emerald-700' : 'bg-gray-900'} ${p.isAlive ? '' : 'opacity-40'}`}>
                      <div className="flex items-center gap-2">
                        <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${dotColors[i % 6]}`} />
                        <span className={`text-sm font-semibold ${p.isAlive ? 'text-white' : 'line-through text-gray-500'} truncate flex-1`}>
                          {p.name}
                        </span>
                        {isTurn && <span className="text-xs text-emerald-300 flex-shrink-0">行動中</span>}
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-xs pl-4">
                        <span className={`font-mono font-bold ${cfColor}`}>${fmt(p.monthlyCashflow)}/月</span>
                        <span className={hpColor}>HP {p.stats.health}</span>
                        {p.isInFastTrack && <span className="text-emerald-400">外圈</span>}
                        {p.isBedridden && <span className="text-orange-400">臥床</span>}
                        {p.isMarried && <span className="text-pink-400">已婚</span>}
                        {!p.isAlive && <span className="text-gray-500">結束</span>}
                      </div>
                    </div>
                  );
                })}
            </div>

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

          {/* ══ 右欄：棋盤（底圖背景填滿）══ */}
          <div
            className="flex-1 flex items-center justify-center overflow-hidden"
            style={{
              backgroundImage: "url('/1.png')",
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              maxHeight: 'calc(100vh - 90px)',
            }}
          >
            <GameBoard players={boardPlayers} currentTurnPlayerId={gameState.currentPlayerTurnId} />
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
