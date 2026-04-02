import { useState, useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import ReactECharts from 'echarts-for-react';
import type { GameState, RoomPlayerSummary, LifeScoreBreakdown } from '../types/game';

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
  const [roomCode, setRoomCode] = useState('');
  const [joined, setJoined] = useState(false);
  const [view, setView] = useState<'game' | 'analysis'>('game');
  const [ticker, setTicker] = useState<string[]>([]);

  const addTicker = (msg: string) => setTicker((prev) => [msg, ...prev].slice(0, 6));

  useEffect(() => {
    const s = io(SERVER_URL, { transports: ['websocket'] });
    socketRef.current = s;
    s.on('connect', () => setConnected(true));
    s.on('disconnect', () => setConnected(false));
    s.on('gameStateUpdate', (gs: GameState) => setGameState(gs));
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
            onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
            maxLength={6}
          />
          <button
            className="btn-primary w-full text-lg"
            disabled={!connected || roomCode.length < 6}
            onClick={() => { emit('adminLogin', { password: '', roomId: roomCode }); setJoined(true); }}
          >
            進入展示模式
          </button>
          {!connected && <p className="text-yellow-400 text-sm">🔌 連線中…</p>}
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

  return (
    <div className="min-h-screen p-4 flex flex-col gap-4">
      {/* 頂部狀態列 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <h1 className="text-2xl font-bold text-emerald-400">百歲人生</h1>
          <span className="text-gray-500 text-sm">房間 {gameState.roomId}</span>
          <span className={`px-2 py-1 rounded-full text-xs ${
            gameState.gamePhase === 'GameOver' ? 'bg-purple-900 text-purple-200' :
            gameState.gamePhase === 'FastTrack' ? 'bg-emerald-900 text-emerald-200' :
            'bg-gray-800 text-gray-300'
          }`}>
            {PHASE_LABELS[gameState.gamePhase] ?? gameState.gamePhase}
          </span>
        </div>
        <div className="text-right">
          <div className="text-4xl font-bold text-yellow-300">{gameState.currentAge.toFixed(1)}</div>
          <div className="text-gray-400 text-sm">{STAGE_LABELS[gameState.currentStage] ?? gameState.currentStage} {gameState.isPaused && '⏸ 暫停'}</div>
        </div>
      </div>

      {/* 主要內容 */}
      <div className="flex gap-4 flex-1">
        {/* 左：玩家排行榜 */}
        <div className="w-80 space-y-2">
          <div className="flex justify-between items-center">
            <h2 className="text-sm font-semibold text-gray-400">玩家狀態</h2>
            {gameState.gamePhase === 'GameOver' && (
              <button className="btn-secondary text-xs px-2 py-1" onClick={() => { emit('requestRoomAnalysis'); }}>
                顯示分析
              </button>
            )}
          </div>
          {gameState.players
            .slice()
            .sort((a, b) => b.monthlyCashflow - a.monthlyCashflow)
            .map((p, i) => (
              <div
                key={p.id}
                className={`card py-2 px-3 ${p.id === gameState.currentPlayerTurnId ? 'border-emerald-600' : ''}`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-gray-500 text-xs w-5">{i + 1}</span>
                    <div>
                      <p className="text-white text-sm font-semibold truncate max-w-[100px]">{p.name}</p>
                      <p className="text-gray-500 text-xs">{p.profession.name}</p>
                    </div>
                  </div>
                  <div className="text-right text-xs">
                    <p className={p.monthlyCashflow >= 0 ? 'text-emerald-400 font-bold' : 'text-red-400 font-bold'}>
                      ${fmt(p.monthlyCashflow)}/月
                    </p>
                    <p className="text-gray-500">${fmt(p.cash)} 現金</p>
                  </div>
                </div>
                {/* 能力值小條 */}
                <div className="flex gap-1 mt-1">
                  <StatBar label="FQ" value={p.stats.financialIQ} max={10} color="bg-blue-500" />
                  <StatBar label="HP" value={p.stats.health} max={100} color={p.stats.health > 30 ? 'bg-green-500' : 'bg-red-500'} />
                  <StatBar label="NT" value={p.stats.network} max={10} color="bg-yellow-500" />
                </div>
                {/* 狀態標籤 */}
                <div className="flex gap-1 mt-1 flex-wrap">
                  {p.isInFastTrack && <span className="text-xs text-emerald-400">🚀 外圈</span>}
                  {p.isMarried && <span className="text-xs text-pink-400">💑</span>}
                  {p.numberOfChildren > 0 && <span className="text-xs text-blue-400">👶×{p.numberOfChildren}</span>}
                  {p.isBedridden && <span className="text-xs text-red-400">🛏 臥床</span>}
                  {!p.isAlive && <span className="text-xs text-gray-500">⚰️ 結束</span>}
                  {p.id === gameState.currentPlayerTurnId && <span className="text-xs text-emerald-300">← 行動中</span>}
                </div>
              </div>
            ))}
        </div>

        {/* 右：主視圖（分析雷達或跑馬燈） */}
        <div className="flex-1 space-y-3">
          {view === 'analysis' && roomAnalysis ? (
            <RoomAnalysisView analysis={roomAnalysis} />
          ) : (
            <LiveView gameState={gameState} ticker={ticker} />
          )}
          {view === 'analysis' && (
            <button className="btn-secondary text-sm" onClick={() => setView('game')}>
              返回即時畫面
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── 能力值橫條元件 ──
function StatBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = Math.round((value / max) * 100);
  return (
    <div className="flex-1">
      <div className="flex justify-between text-xs text-gray-500 mb-0.5">
        <span>{label}</span><span>{value}</span>
      </div>
      <div className="h-1 bg-gray-700 rounded-full">
        <div className={`h-1 rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

// ── 即時遊戲視圖 ──
function LiveView({ gameState, ticker }: { gameState: GameState; ticker: string[] }) {
  // 現金流長條圖
  const players = [...gameState.players].sort((a, b) => b.monthlyCashflow - a.monthlyCashflow);
  const barOption = {
    backgroundColor: 'transparent',
    grid: { left: '25%', right: '8%', top: '5%', bottom: '5%' },
    xAxis: { type: 'value', axisLabel: { color: '#6b7280', formatter: (v: number) => `$${(v / 1000).toFixed(0)}k` }, axisLine: { lineStyle: { color: '#374151' } }, splitLine: { lineStyle: { color: '#1f2937' } } },
    yAxis: { type: 'category', data: players.map((p) => p.name), axisLabel: { color: '#e5e7eb', fontSize: 13 }, axisLine: { lineStyle: { color: '#374151' } } },
    series: [{
      type: 'bar',
      data: players.map((p, i) => ({
        value: p.monthlyCashflow,
        itemStyle: { color: p.monthlyCashflow >= 0 ? COLORS[i % COLORS.length] : '#ef4444' },
      })),
      label: { show: true, position: 'right', color: '#e5e7eb', formatter: (p: { value: number }) => `$${fmt(p.value)}` },
    }],
  };

  return (
    <div className="space-y-3">
      {/* 月現金流排行 */}
      <div className="card">
        <h3 className="text-sm font-semibold text-gray-400 mb-2">月現金流排行</h3>
        <ReactECharts option={barOption} style={{ height: Math.max(200, players.length * 48) }} />
      </div>

      {/* 跑馬燈 */}
      <div className="card bg-gray-800">
        <h3 className="text-xs text-gray-500 mb-1">最新動態</h3>
        <div className="space-y-1 max-h-32 overflow-y-auto">
          {ticker.length > 0
            ? ticker.map((t, i) => <p key={i} className="text-sm text-gray-200">{t}</p>)
            : <p className="text-gray-600 text-sm">等待遊戲事件…</p>}
        </div>
      </div>
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
