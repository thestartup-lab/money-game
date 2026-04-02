import { useState, useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import type { GameState, Player } from '../types/game';
import { QRCodeSVG } from 'qrcode.react';

const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:3001';
const fmt = (n: number) => n.toLocaleString('zh-TW', { maximumFractionDigits: 0 });

const GLOBAL_EVENTS = [
  { id: 'stock_crash',       label: '股市崩盤',   color: 'bg-red-700 hover:bg-red-600' },
  { id: 'stock_boom',        label: '股市繁榮',   color: 'bg-green-700 hover:bg-green-600' },
  { id: 'realestate_crash',  label: '房市崩盤',   color: 'bg-orange-700 hover:bg-orange-600' },
  { id: 'realestate_boom',   label: '房市繁榮',   color: 'bg-teal-700 hover:bg-teal-600' },
  { id: 'inflation',         label: '通貨膨脹',   color: 'bg-yellow-700 hover:bg-yellow-600' },
  { id: 'business_collapse', label: '企業倒閉',   color: 'bg-red-800 hover:bg-red-700' },
  { id: 'natural_disaster',  label: '天然災害',   color: 'bg-gray-600 hover:bg-gray-500' },
  { id: 'pandemic',          label: '全球疫情',   color: 'bg-purple-700 hover:bg-purple-600' },
];

interface AdminRoom {
  roomId: string;
  phase: string;
  playerCount: number;
}

interface StatsEdit {
  fq: number;
  hp: number;
  sk: number;
  nt: number;
}

export default function AdminPage() {
  const socketRef = useRef<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [loggedIn, setLoggedIn] = useState(false);
  const [roomId, setRoomId] = useState('');
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [roomList, setRoomList] = useState<AdminRoom[]>([]);
  const [log, setLog] = useState<string[]>([]);

  // Login form
  const [password, setPassword] = useState('');
  const [loginRoomId, setLoginRoomId] = useState('');
  const [loginError, setLoginError] = useState('');

  // Game start settings
  const [durationMinutes, setDurationMinutes] = useState(90);

  // Stats editor
  const [expandedPlayer, setExpandedPlayer] = useState<string | null>(null);
  const [statsEdit, setStatsEdit] = useState<Record<string, StatsEdit>>({});

  const addLog = (msg: string) => {
    const time = new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    setLog((prev) => [`[${time}] ${msg}`, ...prev].slice(0, 30));
  };

  useEffect(() => {
    const s = io(SERVER_URL, { transports: ['websocket', 'polling'], reconnectionAttempts: 5, reconnectionDelay: 2000 });
    socketRef.current = s;

    s.on('connect', () => {
      setConnected(true);
      s.emit('listRooms');
    });
    s.on('disconnect', () => { setConnected(false); setLoggedIn(false); });

    s.on('adminLoginSuccess', (p: { roomId: string; message: string }) => {
      setLoggedIn(true);
      setRoomId(p.roomId);
      addLog(`登入成功：房間 ${p.roomId}`);
      setLoginError('');
    });
    s.on('adminLoginFail', (p: { message: string }) => {
      setLoginError(p.message ?? '登入失敗');
    });

    s.on('roomCreated', (p: { roomId: string; message: string }) => {
      addLog(`房間已建立：${p.roomId}`);
      s.emit('listRooms');
    });
    s.on('roomsList', (p: { rooms: AdminRoom[] }) => setRoomList(p.rooms));

    s.on('gameStateUpdate', (gs: GameState) => setGameState(gs));
    s.on('gameClock', (p: { currentAge: number }) => {
      setGameState((gs) => gs ? { ...gs, currentAge: p.currentAge } : gs);
    });

    s.on('gamePaused', (p: { reason?: string }) => addLog(`遊戲暫停${p.reason ? `：${p.reason}` : ''}`));
    s.on('gameResumed', () => addLog('遊戲繼續'));
    s.on('gameStarted', (p: { durationMinutes: number }) => addLog(`遊戲開始，時長 ${p.durationMinutes} 分鐘`));
    s.on('globalEventAnnouncement', (p: { title: string }) => addLog(`全局事件：${p.title}`));
    s.on('playerStatUpdated', (p: { playerName: string }) => addLog(`玩家數值已更新：${p.playerName}`));
    s.on('error', (p: { message: string }) => addLog(`錯誤：${p.message}`));

    return () => { s.disconnect(); };
  }, []);

  const emit = (event: string, ...args: unknown[]) => socketRef.current?.emit(event, ...args);

  // ── LOGIN VIEW ──
  if (!loggedIn) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-gray-950">
        <div className="card w-full max-w-sm space-y-4">
          <h1 className="text-2xl font-bold text-center text-indigo-400">主持人後台</h1>
          <p className="text-center text-gray-400 text-sm">百歲人生 — 遊戲控制台</p>

          {!connected && <p className="text-yellow-400 text-sm text-center">連線中…</p>}

          <input
            className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"
            type="password"
            placeholder="主持人密碼"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <input
            className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-white placeholder-gray-500 uppercase tracking-widest focus:outline-none focus:border-indigo-500"
            placeholder="房間代碼（可留空，自動建立）"
            value={loginRoomId}
            onChange={(e) => setLoginRoomId(e.target.value.toUpperCase())}
            maxLength={6}
          />
          {loginError && <p className="text-red-400 text-sm text-center">{loginError}</p>}

          <button
            className="btn-primary w-full bg-indigo-600 hover:bg-indigo-500"
            disabled={!connected || !password}
            onClick={() => {
              setLoginError('');
              if (loginRoomId) {
                emit('adminLogin', { password, roomId: loginRoomId });
              } else {
                // Create new room, then login
                emit('createRoom', { password });
                // Will receive roomCreated → listRooms; then login after delay
                const tryLogin = setTimeout(() => {
                  emit('adminLogin', { password });
                }, 600);
                return () => clearTimeout(tryLogin);
              }
            }}
          >
            {loginRoomId ? '登入已有房間' : '建立新房間並登入'}
          </button>

          {roomList.length > 0 && (
            <div className="mt-2 space-y-2">
              <p className="text-xs text-gray-400">現有房間（點擊登入）：</p>
              {roomList.map((r) => (
                <button
                  key={r.roomId}
                  className="w-full text-left bg-gray-800 hover:bg-gray-700 rounded-xl px-3 py-2 text-sm transition-colors"
                  onClick={() => {
                    setLoginRoomId(r.roomId);
                  }}
                >
                  <span className="font-mono text-indigo-300">{r.roomId}</span>
                  <span className="ml-3 text-gray-400">{r.phase}</span>
                  <span className="ml-3 text-gray-500">{r.playerCount} 人</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  const players = gameState?.players ?? [];
  const phase = gameState?.gamePhase ?? '—';
  const currentAge = gameState?.currentAge ?? 0;
  const isPaused = gameState?.isPaused ?? false;
  const isRunning = phase === 'RatRace' || phase === 'FastTrack';
  const isStartable = phase === 'Pre20' || phase === 'WaitingForPlayers';

  // ── DASHBOARD VIEW ──
  return (
    <div className="min-h-screen bg-gray-950 text-white p-3 space-y-3 max-w-3xl mx-auto">

      {/* 頂部狀態列 */}
      <div className="card flex flex-wrap items-center justify-between gap-2">
        <div>
          <span className="text-indigo-400 font-bold text-lg">主持人後台</span>
          <span className="ml-3 font-mono text-yellow-300 text-sm">{roomId}</span>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
            phase === 'RatRace' ? 'bg-blue-800 text-blue-200' :
            phase === 'FastTrack' ? 'bg-emerald-800 text-emerald-200' :
            phase === 'GameOver' ? 'bg-gray-700 text-gray-300' :
            'bg-yellow-900 text-yellow-300'
          }`}>{phase}</span>
          <span className="text-gray-300">{players.length} 位玩家</span>
          {isRunning && <span className="text-yellow-300 font-bold">{currentAge.toFixed(1)} 歲</span>}
          {isPaused && <span className="text-orange-400">⏸ 暫停中</span>}
          <div className={`w-2 h-2 rounded-full ${connected ? 'bg-green-400' : 'bg-red-400'}`} />
        </div>
      </div>

      {/* QR Code 加入卡片 */}
      {(() => {
        const playerUrl = `${window.location.protocol}//${window.location.host}/?room=${roomId}`;
        return (
          <div className="card flex flex-col sm:flex-row items-center gap-4">
            <div className="bg-white rounded-xl p-2 flex-shrink-0">
              <QRCodeSVG value={playerUrl} size={120} />
            </div>
            <div className="flex-1 text-center sm:text-left space-y-1">
              <p className="text-sm font-semibold text-indigo-300">玩家掃碼加入</p>
              <p className="font-mono text-2xl font-bold text-yellow-300 tracking-widest">{roomId}</p>
              <p className="text-xs text-gray-500 break-all">{playerUrl}</p>
              <p className="text-xs text-gray-400">掃描 QR Code 或手動輸入房間代碼即可加入</p>
            </div>
          </div>
        );
      })()}

      {/* 遊戲控制 */}
      <div className="card space-y-3">
        <p className="text-xs text-gray-400 font-semibold uppercase tracking-wider">遊戲控制</p>
        {isStartable && (
          <div className="flex items-center gap-2">
            <label className="text-sm text-gray-300 whitespace-nowrap">時長（分鐘）</label>
            <input
              type="number"
              className="w-24 bg-gray-800 border border-gray-700 rounded-lg px-2 py-1 text-white text-sm focus:outline-none focus:border-indigo-500"
              value={durationMinutes}
              min={20}
              max={180}
              onChange={(e) => setDurationMinutes(Number(e.target.value))}
            />
            <button
              className="btn-primary flex-1 text-sm"
              onClick={() => emit('startGame', { durationMinutes })}
            >
              開始遊戲
            </button>
            <button
              className="bg-gray-600 hover:bg-gray-500 text-white text-sm py-2 px-3 rounded-xl transition-colors"
              title="強制開始（跳過未完成 Pre-20 的玩家）"
              onClick={() => emit('startGame', { durationMinutes, force: true })}
            >
              強制開始
            </button>
          </div>
        )}
        {isRunning && (
          <div className="flex gap-2">
            {isPaused ? (
              <button className="btn-primary flex-1" onClick={() => emit('resumeGame')}>
                ▶ 繼續遊戲
              </button>
            ) : (
              <button
                className="bg-orange-700 hover:bg-orange-600 text-white font-bold py-2 px-4 rounded-xl flex-1 transition-colors"
                onClick={() => emit('pauseGame', { reason: '主持人手動暫停' })}
              >
                ⏸ 暫停遊戲
              </button>
            )}
          </div>
        )}
      </div>

      {/* 全局事件 */}
      <div className="card space-y-2">
        <p className="text-xs text-gray-400 font-semibold uppercase tracking-wider">觸發全局事件</p>
        <div className="grid grid-cols-4 gap-2">
          {GLOBAL_EVENTS.map((ev) => (
            <button
              key={ev.id}
              className={`${ev.color} text-white text-xs font-semibold py-2 px-2 rounded-xl transition-colors`}
              onClick={() => {
                if (window.confirm(`確定要觸發「${ev.label}」嗎？`)) {
                  emit('triggerGlobalEvent', { eventId: ev.id });
                  addLog(`觸發全局事件：${ev.label}`);
                }
              }}
            >
              {ev.label}
            </button>
          ))}
        </div>
      </div>

      {/* 玩家列表 */}
      <div className="card space-y-2">
        <p className="text-xs text-gray-400 font-semibold uppercase tracking-wider">玩家列表</p>
        {players.length === 0 && <p className="text-gray-500 text-sm">尚無玩家加入</p>}
        {players.map((p: Player) => (
          <PlayerRow
            key={p.id}
            player={p}
            currentAge={currentAge}
            expanded={expandedPlayer === p.id}
            statsEdit={statsEdit[p.id] ?? { fq: p.stats.financialIQ, hp: p.stats.health, sk: p.stats.careerSkill, nt: p.stats.network }}
            onToggleExpand={() => setExpandedPlayer((prev) => prev === p.id ? null : p.id)}
            onStatsChange={(field, val) =>
              setStatsEdit((prev) => ({
                ...prev,
                [p.id]: { ...(prev[p.id] ?? { fq: p.stats.financialIQ, hp: p.stats.health, sk: p.stats.careerSkill, nt: p.stats.network }), [field]: val },
              }))
            }
            onApplyStats={() => {
              const se = statsEdit[p.id];
              if (!se) return;
              emit('setPlayerStats', { targetPlayerId: p.id, stats: { fq: se.fq, hp: se.hp, sk: se.sk, nt: se.nt } });
              addLog(`調整 ${p.name} 數值`);
            }}
            onTriggerRelationship={() => {
              emit('triggerRelationship', { targetPlayerId: p.id });
              addLog(`觸發 ${p.name} 的邂逅機緣`);
            }}
          />
        ))}
      </div>

      {/* 活動日誌 */}
      <div className="card space-y-1">
        <p className="text-xs text-gray-400 font-semibold uppercase tracking-wider">活動日誌</p>
        {log.length === 0 && <p className="text-gray-600 text-xs">尚無紀錄</p>}
        {log.map((l, i) => (
          <p key={i} className="text-xs text-gray-300 font-mono">{l}</p>
        ))}
      </div>

      {/* 房間管理 */}
      <div className="card flex items-center justify-between">
        <p className="text-sm text-gray-400">房間管理</p>
        <button
          className="bg-red-800 hover:bg-red-700 text-white text-sm py-1.5 px-4 rounded-xl transition-colors"
          onClick={() => {
            if (window.confirm('確定要刪除目前房間？所有玩家將被踢出。')) {
              emit('deleteRoom');
              setLoggedIn(false);
              setGameState(null);
              setRoomId('');
            }
          }}
        >
          刪除房間
        </button>
      </div>
    </div>
  );
}

// ── Player Row Sub-component ──

interface PlayerRowProps {
  player: Player;
  currentAge: number;
  expanded: boolean;
  statsEdit: StatsEdit;
  onToggleExpand: () => void;
  onStatsChange: (field: keyof StatsEdit, val: number) => void;
  onApplyStats: () => void;
  onTriggerRelationship: () => void;
}

function PlayerRow({ player: p, expanded, statsEdit, onToggleExpand, onStatsChange, onApplyStats, onTriggerRelationship }: PlayerRowProps) {
  const hpColor = p.stats.health >= 60 ? 'text-green-400' : p.stats.health >= 30 ? 'text-yellow-400' : 'text-red-400';
  const cfColor = p.monthlyCashflow >= 0 ? 'text-emerald-400' : 'text-red-400';

  return (
    <div className={`rounded-xl border transition-colors ${p.isAlive ? 'border-gray-700 bg-gray-800' : 'border-gray-800 bg-gray-900 opacity-50'}`}>
      {/* Summary row */}
      <button className="w-full text-left px-3 py-2 flex items-center gap-3" onClick={onToggleExpand}>
        <span className={`text-sm font-semibold ${p.isAlive ? 'text-white' : 'text-gray-500 line-through'}`}>
          {p.name}
        </span>
        <span className="text-xs text-gray-400">{p.profession.name}</span>
        <span className="text-xs px-1.5 py-0.5 rounded bg-gray-700 text-gray-300">{p.quadrant}</span>
        {p.isBedridden && <span className="text-xs text-orange-400">臥床</span>}
        {p.isInFastTrack && <span className="text-xs text-emerald-400">外圈</span>}
        <span className="ml-auto flex items-center gap-3 text-xs">
          <span className={hpColor}>HP {p.stats.health}</span>
          <span className={cfColor}>CF ${fmt(p.monthlyCashflow)}</span>
          <span className="text-gray-400">現金 ${fmt(p.cash)}</span>
          <span className="text-gray-500 ml-1">{expanded ? '▲' : '▼'}</span>
        </span>
      </button>

      {/* Expanded stats editor */}
      {expanded && (
        <div className="px-3 pb-3 space-y-3 border-t border-gray-700 pt-3">
          <div className="grid grid-cols-2 gap-3">
            {([ ['fq', '財商 FQ', 0, 10], ['hp', '健康 HP', 0, 100], ['sk', '技能 SK', 0, 100], ['nt', '人脈 NT', 0, 10] ] as [keyof StatsEdit, string, number, number][]).map(
              ([field, label, min, max]) => (
                <div key={field} className="space-y-1">
                  <div className="flex justify-between text-xs text-gray-400">
                    <span>{label}</span>
                    <span className="text-white font-bold">{statsEdit[field]}</span>
                  </div>
                  <input
                    type="range"
                    min={min}
                    max={max}
                    value={statsEdit[field]}
                    className="w-full accent-indigo-500"
                    onChange={(e) => onStatsChange(field, Number(e.target.value))}
                  />
                </div>
              )
            )}
          </div>
          <div className="flex gap-2">
            <button className="btn-primary flex-1 text-sm py-1.5" onClick={onApplyStats}>
              套用數值
            </button>
            {!p.isMarried && (
              <button
                className="bg-pink-800 hover:bg-pink-700 text-white text-sm py-1.5 px-3 rounded-xl transition-colors"
                onClick={onTriggerRelationship}
              >
                觸發邂逅
              </button>
            )}
          </div>
          <div className="text-xs text-gray-500 space-y-0.5">
            <p>體驗值 {p.lifeExperience}  ｜  小孩 {p.numberOfChildren}  ｜  信用 {p.creditScore}</p>
            <p>資產 {p.assets.length} 筆  ｜  負債 {p.liabilities.length} 筆  ｜  被動收入 ${fmt(p.totalPassiveIncome)}/月</p>
          </div>
        </div>
      )}
    </div>
  );
}
