import { useState, useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import type { GameState, Player } from '../types/game';
import { QRCodeSVG } from 'qrcode.react';
import DecisionCountdown from '../components/game/DecisionCountdown';
import './AdminClarity.css';

const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:3001';
const fmt = (n: number) => n.toLocaleString('zh-TW', { maximumFractionDigits: 0 });
const fmtActivityTime = (ms: number) => {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(totalSeconds / 60).toString().padStart(2, '0')}:${(totalSeconds % 60).toString().padStart(2, '0')}`;
};

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
  const pendingLoginPasswordRef = useRef<string>(''); // 建立房間後自動登入用
  const autoReloginPasswordRef = useRef<string>('');  // 斷線重連自動登入用
  const autoReloginRoomIdRef = useRef<string>('');    // 斷線重連自動登入用
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
    const s = io(SERVER_URL, { transports: ['websocket', 'polling'], reconnection: true, reconnectionAttempts: Infinity, reconnectionDelay: 1000, reconnectionDelayMax: 5000, randomizationFactor: 0.5, timeout: 20000 });
    socketRef.current = s;

    s.on('connect', () => {
      setConnected(true);
      s.emit('listRooms');
      // 若有儲存的登入資訊，自動重新登入（斷線重連情境）
      if (autoReloginPasswordRef.current && autoReloginRoomIdRef.current) {
        s.emit('adminLogin', {
          password: autoReloginPasswordRef.current,
          roomId: autoReloginRoomIdRef.current,
        });
      }
    });
    s.on('disconnect', () => { setConnected(false); });

    s.on('adminLoginSuccess', (p: { roomId: string; message: string }) => {
      setLoggedIn(true);
      setRoomId(p.roomId);
      addLog(`登入成功：房間 ${p.roomId}`);
      setLoginError('');
      // 儲存登入資訊供斷線重連使用
      if (p.roomId) {
        autoReloginRoomIdRef.current = p.roomId;
        if (pendingLoginPasswordRef.current) {
          autoReloginPasswordRef.current = pendingLoginPasswordRef.current;
        }
      }
    });
    s.on('adminLoginFail', (p: { message: string }) => {
      setLoginError(p.message ?? '登入失敗');
    });

    s.on('roomCreated', (p: { roomId: string; message: string }) => {
      setRoomId(p.roomId);
      addLog(`房間已建立：${p.roomId}`);
      s.emit('listRooms');
      // 建立房間後自動用正確的 roomId 登入
      if (pendingLoginPasswordRef.current) {
        s.emit('adminLogin', { password: pendingLoginPasswordRef.current, roomId: p.roomId });
        pendingLoginPasswordRef.current = '';
      }
    });
    s.on('roomList', (rooms: AdminRoom[]) => setRoomList(rooms ?? []));

    s.on('gameStateUpdate', (gs: GameState) => setGameState(gs));
    s.on('gameClock', (p: { currentAge: number; remainingTimeMs?: number }) => {
      setGameState((gs) => gs ? { ...gs, currentAge: p.currentAge, remainingTimeMs: p.remainingTimeMs ?? gs.remainingTimeMs } : gs);
    });

    s.on('gamePaused', (p: { reason?: string }) => addLog(`遊戲暫停${p.reason ? `：${p.reason}` : ''}`));
    s.on('gameResumed', () => addLog('遊戲繼續'));
    s.on('gameStarted', (p: { durationMinutes: number; yearsPerRound?: number }) => addLog(`遊戲開始：每輪 +${p.yearsPerRound ?? 4} 歲；活動參考時間 ${p.durationMinutes} 分鐘`));
    s.on('gameRestarted', (p: { playerCount: number }) => addLog(`遊戲重啟，${p.playerCount} 位玩家回到投胎`));
    s.on('finalRoundStarted', (p: { firstPlayerName: string }) => addLog(`96 歲：最後一輪開始，由 ${p.firstPlayerName} 先行動`));
    s.on('educationTurnSkipped', (p: { playerName: string; careerStartAge: number }) => addLog(`${p.playerName} 完成進修延後回合，將從 ${p.careerStartAge} 歲職涯起點出發`));
    s.on('globalEventAnnouncement', (p: { event: { title: string; description: string } }) => addLog(`全局事件：${p.event?.title ?? '未知事件'}`));
    s.on('playerStatUpdated', (p: { playerName: string }) => addLog(`玩家數值已更新：${p.playerName}`));
    s.on('error', (p: { message: string }) => addLog(`錯誤：${p.message}`));

    return () => { s.disconnect(); };
  }, []);

  const emit = (event: string, ...args: unknown[]) => socketRef.current?.emit(event, ...args);

  // ── LOGIN VIEW ──
  if (!loggedIn) {
    return (
      <div className="admin-shell admin-login">
        <div className="card admin-login-panel space-y-5">
          <div className="admin-login-brand">
            <span className="admin-brand-mark" aria-hidden="true">🎛️</span>
            <div>
              <p className="admin-kicker">Hundred-Year Life</p>
              <h1 className="admin-login-title">主持人控制台</h1>
              <p className="mt-1 text-sm text-gray-400">建立房間、掌握節奏、照顧全場狀態</p>
            </div>
          </div>

          <div className="flex justify-center" aria-live="polite">
            <span className="admin-connection" data-connected={connected}>
              <span className="admin-connection-dot" aria-hidden="true" />
              {connected ? '伺服器已連線' : '正在連接伺服器…'}
            </span>
          </div>

          <div>
            <label className="admin-field-label" htmlFor="admin-password">主持人密碼</label>
            <input
              id="admin-password"
              className="w-full"
              type="password"
              placeholder="請輸入主持人密碼"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <div>
            <label className="admin-field-label" htmlFor="admin-room-code">房間代碼</label>
            <input
              id="admin-room-code"
              className="w-full tracking-widest uppercase"
              placeholder="可留空，由系統自動產生"
              value={loginRoomId}
              onChange={(e) => setLoginRoomId(e.target.value)}
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              maxLength={6}
            />
            <p className="mt-2 text-xs text-gray-500">輸入 4–6 碼英數字，可建立指定房間或接管既有房間。</p>
          </div>
          {loginError && (
            <p className="rounded-xl border border-red-700 bg-red-950/70 px-3 py-2 text-sm font-bold text-red-200" role="alert">
              {loginError}
            </p>
          )}

          {/* 建立新房間（自訂或隨機代號） */}
          <button
            className="btn-primary w-full"
            disabled={!connected || !password}
            onClick={() => {
              setLoginError('');
              pendingLoginPasswordRef.current = password;
              autoReloginPasswordRef.current = password;
              emit('createRoom', { password, roomId: loginRoomId.toUpperCase() || undefined });
            }}
          >
            {loginRoomId ? `建立房間「${loginRoomId.toUpperCase()}」` : '建立新房間（自動產生代號）'}
          </button>

          {/* 加入已有房間 */}
          {loginRoomId && (
            <button
              className="btn-secondary w-full"
              disabled={!connected || !password}
              onClick={() => {
                setLoginError('');
                autoReloginPasswordRef.current = password;
                emit('adminLogin', { password, roomId: loginRoomId.toUpperCase() });
              }}
            >
              加入已有房間「{loginRoomId.toUpperCase()}」
            </button>
          )}

          {roomList.length > 0 && (
            <div className="mt-2 space-y-2 border-t border-slate-700 pt-4">
              <p className="text-sm font-bold text-gray-300">現有房間</p>
              {roomList.map((r) => (
                <button
                  key={r.roomId}
                  className="w-full rounded-xl border border-slate-600 bg-slate-900/70 px-4 py-3 text-left text-sm transition-colors hover:border-indigo-400 hover:bg-slate-800"
                  onClick={() => {
                    setLoginRoomId(r.roomId);
                  }}
                >
                  <span className="font-mono font-black tracking-widest text-yellow-300">{r.roomId}</span>
                  <span className="ml-3 text-gray-300">{r.phase}</span>
                  <span className="float-right text-gray-400">{r.playerCount} 人</span>
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
  const decisionPhase = gameState?.decisionPhase ?? null;
  const notReadyPlayers = players.filter((p: Player) => !p.pre20Done && !p.isDisconnected);
  const alivePlayers = players.filter((p: Player) => p.isAlive);
  const isMixedTrack = alivePlayers.some((p: Player) => p.isInFastTrack) && alivePlayers.some((p: Player) => !p.isInFastTrack);

  // 展示頁 URL（讓展示頁自動帶房間代碼）
  const displayUrl = `${window.location.protocol}//${window.location.host}/?display&room=${roomId}`;
  const playerUrl = `${window.location.protocol}//${window.location.host}/?room=${roomId}`;

  const phaseLabel: Record<string, string> = {
    WaitingForPlayers: '等待玩家', Pre20: '設定中',
    RatRace: '老鼠賽跑', FastTrack: 'FastTrack', GameOver: '遊戲結束',
  };
  const phaseBadge = (p: string) => {
    const classes: Record<string, string> = {
      WaitingForPlayers: 'bg-yellow-900 text-yellow-300',
      Pre20: 'bg-blue-900 text-blue-300',
      RatRace: 'bg-indigo-800 text-indigo-200',
      FastTrack: 'bg-emerald-800 text-emerald-200',
      GameOver: 'bg-gray-700 text-gray-400',
    };
    return classes[p] ?? 'bg-gray-700 text-gray-300';
  };
  const currentPhaseLabel = gameState?.finalRoundStarted
    ? '最後一輪'
    : isMixedTrack
      ? '雙圈進行中'
      : phaseLabel[phase] ?? phase;

  return (
    <div className="admin-shell">

      {/* ══ 頂部導覽列 ══ */}
      <header className="admin-topbar">
        <div className="admin-topbar-brand">
          <span className="admin-brand-mark" aria-hidden="true">🎛️</span>
          <div>
            <div className="admin-topbar-title">主持人控制台</div>
            <div className="text-xs text-gray-400">百歲人生 Money Game</div>
          </div>
        </div>

        <div className="admin-status-strip" aria-label="遊戲即時狀態">
          <span className="admin-status-chip admin-room-code">房間 {roomId}</span>
          <span className={`admin-status-chip ${phaseBadge(phase)}`}>{currentPhaseLabel}</span>
          {isRunning && <span className="admin-status-chip text-yellow-200">🎂 {Math.round(currentAge)} 歲</span>}
          {isRunning && (
            <span className="admin-status-chip">
              人生輪 {Math.min(gameState?.totalLifeRounds ?? 20, (gameState?.completedLifeRounds ?? gameState?.turnNumber ?? 0) + 1)}/{gameState?.totalLifeRounds ?? 20}
            </span>
          )}
          {isRunning && (
            <span className="admin-status-chip text-cyan-100">
              ⏱ 活動參考 {fmtActivityTime(gameState?.remainingTimeMs ?? gameState?.gameDurationMs ?? 0)}
            </span>
          )}
          {isPaused && <span className="admin-status-chip border-orange-600 text-orange-200">⏸ 已暫停</span>}
          <span className="admin-connection" data-connected={connected}>
            <span className="admin-connection-dot" aria-hidden="true" />
            {connected ? '連線正常' : '連線中斷'}
          </span>
        </div>

        <div className="admin-topbar-actions">
          {/* 直接開啟展示頁按鈕 */}
          <a
            href={displayUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 rounded-xl border border-emerald-500 bg-emerald-700 px-4 py-2 text-sm font-black text-white transition-colors hover:bg-emerald-600"
          >
            📺 展示頁
          </a>
          <button
            className="rounded-xl border border-red-700 bg-red-950 px-3 py-2 text-sm font-bold text-red-200 transition-colors hover:bg-red-900"
            onClick={() => {
              if (window.confirm('確定要刪除目前房間？')) {
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
      </header>

      {/* ══ 主內容：三欄 ══ */}
      <main className="admin-layout">

        {/* ── 左欄：QR + 玩家名單 + 遊戲控制 ── */}
        <aside className="admin-sidebar">

          {/* QR Code */}
          <div className="card admin-room-card flex flex-col items-center gap-2">
            <p className="admin-kicker">Player Entry</p>
            <div className="admin-qr-wrap">
              <QRCodeSVG value={playerUrl} size={130} />
            </div>
            <p className="text-sm font-bold text-indigo-200">請玩家掃碼加入</p>
            <p className="font-mono text-3xl font-black text-yellow-300 tracking-[0.3em]">{roomId}</p>
            <p className="text-xs text-gray-500 break-all leading-tight">{playerUrl}</p>
          </div>

          {/* 玩家名單 */}
          <div className="card space-y-2">
            <SectionHeading icon="👥" title="參與者" meta={`${players.length} 人`} />
            {players.length === 0 && <p className="text-gray-500 text-sm">尚無玩家加入</p>}
            {players.map((p: Player, idx: number) => {
              const hpColor = p.stats.health >= 60 ? 'text-green-400' : p.stats.health >= 30 ? 'text-yellow-400' : 'text-red-400';
              const cfColor = p.monthlyCashflow >= 0 ? 'text-emerald-400' : 'text-red-400';
              const dotColors = ['bg-amber-400','bg-blue-400','bg-pink-400','bg-emerald-400','bg-purple-400','bg-orange-400'];
              return (
                <div key={p.id} className={`admin-player-list-item flex flex-col gap-1 text-sm ${p.isAlive ? '' : 'opacity-40'}`}>
                  <div className="flex items-center gap-2">
                    <span className={`w-3 h-3 rounded-full flex-shrink-0 ${dotColors[idx % 6]}`} />
                    <span className={`font-semibold truncate ${p.isAlive ? 'text-white' : 'line-through text-gray-500'}`}>{p.name}</span>
                    <span className={`text-xs truncate hidden sm:block ${p.profession?.name === '待選擇' ? 'text-gray-500 italic' : 'text-gray-400'}`}>
                      {p.profession?.name === '待選擇' ? '未選擇職業' : p.profession?.name}
                    </span>
                    <span className={`ml-auto text-xs font-mono ${hpColor}`}>{p.stats.health}hp</span>
                    <span className={`text-xs font-mono ${cfColor}`}>${(p.monthlyCashflow/1000).toFixed(1)}k</span>
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap pl-5">
                    {/* 設定階段才顯示就緒狀態 */}
                    {isStartable && (
                      p.isDisconnected ? (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-700 text-gray-300">📵 離線</span>
                      ) : p.pre20Done ? (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-700 text-emerald-100">✓ 就緒</span>
                      ) : (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-700 text-yellow-100 animate-pulse">⏳ 設定中</span>
                      )
                    )}
                    {p.isDisconnected && !isStartable && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-700 text-gray-300">📵 離線</span>
                    )}
                    {p.isInFastTrack && <span className="text-xs text-emerald-400">外圈</span>}
                    {p.isBedridden && <span className="text-xs text-orange-400">臥床</span>}
                    {/* 踢出按鈕（離線或卡關設定階段才顯示） */}
                    {(p.isDisconnected || (isStartable && !p.pre20Done)) && (
                      <button
                        className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-red-900 hover:bg-red-800 text-red-200"
                        title="移除此玩家"
                        onClick={() => {
                          if (window.confirm(`確定要移除玩家「${p.name}」？\n（如他斷線重連會視為新玩家）`)) {
                            emit('kickPlayer', { playerId: p.id });
                            addLog(`已移除玩家：${p.name}`);
                          }
                        }}
                      >移除</button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* 遊戲控制 */}
          <div className="card space-y-3">
            <SectionHeading icon="🎮" title="遊戲控制" meta={isPaused ? '已暫停' : isRunning ? '進行中' : '準備中'} />
            {isStartable && notReadyPlayers.length > 0 && (
              <div className="bg-yellow-950 border border-yellow-700 rounded-xl p-2 text-xs text-yellow-200">
                ⏳ 等待 {notReadyPlayers.length} 位玩家完成職業選擇：
                <span className="font-semibold">{notReadyPlayers.map((p: Player) => p.name).join('、')}</span>
                <p className="text-[11px] text-yellow-400 mt-0.5">職業選擇為硬性條件：如玩家已離開請在上方點「移除」清掉名單後再開始。</p>
              </div>
            )}
            {isStartable && (
              <div className="flex items-center gap-2">
                <label className="text-sm text-gray-300 whitespace-nowrap">時長（分）</label>
                <input
                  type="number"
                  className="w-20 bg-gray-800 border border-gray-700 rounded-lg px-2 py-1 text-white text-sm focus:outline-none focus:border-indigo-500"
                  value={durationMinutes}
                  min={20} max={180}
                  onChange={(e) => setDurationMinutes(Number(e.target.value))}
                />
                <button
                  className="btn-primary flex-1 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                  disabled={notReadyPlayers.length > 0}
                  title={notReadyPlayers.length > 0 ? '尚有玩家未完成職業選擇，無法開始' : '開始遊戲'}
                  onClick={() => emit('startGame', { durationMinutes })}
                >
                  開始
                </button>
              </div>
            )}
            {isStartable && notReadyPlayers.length > 0 && (
              <button
                className="w-full bg-amber-700 hover:bg-amber-600 text-white text-xs font-semibold py-2 px-3 rounded-xl transition-colors"
                title="為未完成 Pre-20 的玩家自動分配（隨機投胎 + 預設配點 + E 象限職業）並開始"
                onClick={() => {
                  const names = notReadyPlayers.map((p) => p.name).join('、');
                  if (window.confirm(`系統會為以下 ${notReadyPlayers.length} 位玩家自動分配「中等社會階層 / E 象限隨機職業」：\n${names}\n\n確定強制開始？`)) {
                    emit('startGame', { durationMinutes, force: true });
                    addLog(`強制開始：自動補齊 ${notReadyPlayers.length} 位玩家的 Pre-20`);
                  }
                }}
              >
                ⚡ 強制開始（為 {notReadyPlayers.length} 位玩家自動補齊）
              </button>
            )}
            {decisionPhase && (
              <div className="admin-decision-panel rounded-2xl p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wider text-indigo-300">全場決策時間</p>
                    <p className="mt-1 text-lg font-black text-white">{decisionPhase.title}</p>
                    <p className="text-sm text-indigo-200">{decisionPhase.playerName} 正在決策</p>
                  </div>
                  <div className="text-right">
                    <DecisionCountdown
                      reminderEndsAt={decisionPhase.reminderEndsAt}
                      className="font-mono text-2xl font-black text-yellow-300"
                    />
                    <div className={`mt-1 rounded-full px-3 py-1 text-xs font-bold ${decisionPhase.submitted ? 'bg-emerald-700 text-emerald-100' : 'bg-amber-700 text-amber-100'}`}>
                      {decisionPhase.kind === 'auction' ? '競標中' : decisionPhase.submitted ? '已送出' : '思考中'}
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-4 gap-2">
                  {[30, 60, 90].map((seconds) => (
                    <button
                      key={seconds}
                      className="rounded-lg bg-gray-800 px-2 py-2 text-xs font-bold text-gray-200 hover:bg-gray-700"
                      onClick={() => emit('setDecisionReminder', { phaseId: decisionPhase.id, seconds })}
                    >
                      重設 {seconds} 秒
                    </button>
                  ))}
                  <button
                    className="rounded-lg bg-indigo-800 px-2 py-2 text-xs font-bold text-indigo-100 hover:bg-indigo-700"
                    onClick={() => emit('setDecisionReminder', { phaseId: decisionPhase.id, addSeconds: 30 })}
                  >
                    +30 秒
                  </button>
                </div>
                <p className="text-xs leading-relaxed text-indigo-300">
                  倒數只提醒節奏，不會自動送出。可以依本次發薪日內容加時，最後由你統一結束並揭曉。
                </p>
                <button
                  className="w-full rounded-xl bg-indigo-500 px-4 py-3 text-base font-black text-white transition-colors hover:bg-indigo-400"
                  onClick={() => emit('continueDecisionPhase', { phaseId: decisionPhase.id })}
                >
                  {decisionPhase.kind === 'auction'
                    ? '結束競標並揭曉 ▶'
                    : decisionPhase.submitted
                      ? '揭曉結果並繼續 ▶'
                      : '略過本次決策並繼續 ▶'}
                </button>
              </div>
            )}
            {isRunning && !decisionPhase && (
              <div className="flex gap-2">
                {isPaused
                  ? <button className="btn-primary flex-1" onClick={() => emit('resumeGame')}>▶ 繼續</button>
                  : <button className="bg-orange-700 hover:bg-orange-600 text-white font-bold py-2 px-4 rounded-xl flex-1 transition-colors" onClick={() => emit('pauseGame', { reason: '主持人手動暫停' })}>⏸ 暫停</button>
                }
              </div>
            )}
            {players.length > 0 && (
              <button
                className="w-full bg-red-900 hover:bg-red-800 text-red-200 text-sm font-bold py-2 px-4 rounded-xl transition-colors border border-red-700"
                onClick={() => {
                  if (window.confirm(`確定要重啟遊戲？\n所有玩家（${players.length} 人）將回到重新投胎，財務與職業全部清空。`)) {
                    emit('restartGame');
                    addLog('遊戲重啟');
                  }
                }}
              >
                ↺ 重啟遊戲（全員回到投胎）
              </button>
            )}
          </div>

          {/* 全局事件 */}
          <div className="card space-y-2">
            <SectionHeading icon="🌍" title="全局事件" meta="影響全場" />
            <div className="grid grid-cols-2 gap-2">
              {GLOBAL_EVENTS.map((ev) => (
                <button
                  key={ev.id}
                  className={`${ev.color} text-white text-xs font-semibold py-2 px-2 rounded-xl transition-colors`}
                  onClick={() => {
                    if (window.confirm(`確定要觸發「${ev.label}」嗎？`)) {
                      emit('triggerGlobalEvent', { eventId: ev.id, roomId });
                      addLog(`觸發全局事件：${ev.label}`);
                    }
                  }}
                >{ev.label}</button>
              ))}
            </div>
            <button
              className="w-full bg-amber-700 hover:bg-amber-600 text-white text-xs font-semibold py-2 px-2 rounded-xl transition-colors mt-2"
              onClick={() => {
                if (window.confirm('開放一場「特殊拍賣」給全房玩家競標？競標時間將由主持人控制。')) {
                  emit('triggerSpecialAuction', { roomId });
                  addLog('觸發特殊拍賣');
                }
              }}
              title="從特殊拍賣牌庫隨機抽 1 張，由主持人決定何時結束競標"
            >🔨 觸發特殊拍賣</button>
          </div>

          {/* 慈善排行榜（A1） */}
          <div className="card space-y-1">
            <SectionHeading icon="❤️" title="慈善排行榜" />
            {(() => {
              const ranked = [...players]
                .filter((p) => (p.charityTotal ?? 0) > 0)
                .sort((a, b) => (b.charityTotal ?? 0) - (a.charityTotal ?? 0))
                .slice(0, 5);
              if (ranked.length === 0) {
                return <p className="text-gray-600 text-xs">尚無玩家捐款</p>;
              }
              return (
                <div className="space-y-1">
                  {ranked.map((p, i) => {
                    const bonusPts = Math.min(30, Math.floor((p.charityTotal ?? 0) / 100_000) * 5);
                    return (
                      <div key={p.id} className="flex items-center justify-between text-xs px-2 py-1 rounded bg-gray-800/60">
                        <span className="text-gray-300">
                          <span className="text-yellow-400 font-bold">#{i + 1}</span>{' '}
                          <span className="font-semibold">{p.name}</span>
                        </span>
                        <span className="text-pink-300 font-mono">
                          ${(p.charityTotal ?? 0).toLocaleString()}{' '}
                          <span className="text-emerald-400">+{bonusPts}</span>
                        </span>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </div>

          {/* 活動日誌 */}
          <div className="card admin-log space-y-1 overflow-y-auto">
            <SectionHeading icon="📋" title="活動日誌" meta={`${log.length} 筆`} />
            {log.length === 0 && <p className="text-gray-600 text-xs">尚無紀錄</p>}
            {log.map((l, i) => (
              <p key={i} className="admin-log-line text-xs text-gray-300 font-mono">{l}</p>
            ))}
          </div>
        </aside>

        {/* ── 右欄：玩家管理 + 多房間儀表板 ── */}
        <section className="admin-main">

          {/* 玩家詳細管理 */}
          <div className="card space-y-2">
            <SectionHeading icon="🧭" title="玩家管理" meta={`${alivePlayers.length} 位進行中`} />
            {players.length === 0 && <p className="text-gray-500 text-sm">尚無玩家</p>}
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

          {/* 多房間儀表板 */}
          {roomList.length > 0 && (
            <div className="card space-y-3">
              <div className="flex items-center justify-between">
                <SectionHeading icon="🗂️" title="所有房間" meta={`${roomList.length} 間`} />
                <button
                  className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-1 text-xs font-bold text-gray-300 transition-colors hover:bg-slate-700"
                  onClick={() => emit('listRooms')}
                >重新整理</button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                {roomList.map((r) => {
                  const isCurrent = r.roomId === roomId;
                  const rDisplayUrl = `${window.location.protocol}//${window.location.host}/?display&room=${r.roomId}`;
                  const rPlayerUrl  = `${window.location.protocol}//${window.location.host}/?room=${r.roomId}`;
                  return (
                    <div
                      key={r.roomId}
                      className={`admin-room-overview-card rounded-2xl border p-4 space-y-3 transition-colors ${
                        isCurrent
                          ? 'border-indigo-500 bg-indigo-950/40'
                          : 'border-gray-700 bg-gray-800'
                      }`}
                    >
                      {/* 房間頭部 */}
                      <div className="flex items-center justify-between">
                        <div>
                          <span className="font-mono font-bold text-lg text-yellow-300">{r.roomId}</span>
                          {isCurrent && <span className="ml-2 text-xs bg-indigo-700 text-indigo-200 px-1.5 py-0.5 rounded-full">目前</span>}
                        </div>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${phaseBadge(r.phase)}`}>
                          {phaseLabel[r.phase] ?? r.phase}
                        </span>
                      </div>

                      {/* 統計 */}
                      <div className="flex gap-4 text-sm">
                        <div className="text-center">
                          <div className="text-white font-bold text-xl">{r.playerCount}</div>
                          <div className="text-gray-400 text-xs">玩家</div>
                        </div>
                        {isCurrent && isRunning && (
                          <div className="text-center">
                            <div className="text-yellow-300 font-bold text-xl">{Math.round(currentAge)}</div>
                            <div className="text-gray-400 text-xs">歲</div>
                          </div>
                        )}
                      </div>

                      {/* 操作按鈕 */}
                      <div className="flex gap-2">
                        <a
                          href={rDisplayUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex-1 text-center bg-emerald-800 hover:bg-emerald-700 text-emerald-200 text-xs font-bold py-2 px-2 rounded-xl transition-colors"
                        >
                          📺 展示頁
                        </a>
                        <a
                          href={rPlayerUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex-1 text-center bg-gray-700 hover:bg-gray-600 text-gray-200 text-xs font-bold py-2 px-2 rounded-xl transition-colors"
                        >
                          📱 玩家頁
                        </a>
                        {!isCurrent && (
                          <button
                            className="bg-indigo-900 hover:bg-indigo-800 text-indigo-200 text-xs font-bold py-2 px-2 rounded-xl transition-colors"
                            onClick={() => {
                              emit('adminLogin', { password: autoReloginPasswordRef.current, roomId: r.roomId });
                            }}
                          >
                            切換
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

interface SectionHeadingProps {
  icon: string;
  title: string;
  meta?: string;
}

function SectionHeading({ icon, title, meta }: SectionHeadingProps) {
  return (
    <div className="admin-section-heading">
      <h2 className="admin-section-title">
        <span className="admin-section-icon" aria-hidden="true">{icon}</span>
        {title}
      </h2>
      {meta ? <span className="admin-section-meta">{meta}</span> : null}
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

function PlayerRow({ player: p, currentAge, expanded, statsEdit, onToggleExpand, onStatsChange, onApplyStats, onTriggerRelationship }: PlayerRowProps) {
  const hpColor = p.stats.health >= 60 ? 'text-green-400' : p.stats.health >= 30 ? 'text-yellow-400' : 'text-red-400';
  const cfColor = p.monthlyCashflow >= 0 ? 'text-emerald-400' : 'text-red-400';
  const personalAge = p.personalAge ?? Math.max(p.startAge ?? 20, currentAge);

  return (
    <div className={`admin-player-row transition-colors ${p.isAlive ? '' : 'opacity-50'}`}>
      {/* Summary row */}
      <button className="admin-player-summary w-full text-left" onClick={onToggleExpand} aria-expanded={expanded}>
        <span className="admin-player-identity">
          <span className={`admin-player-name block ${p.isAlive ? '' : 'line-through text-gray-500'}`}>{p.name}</span>
          <span className={`admin-player-role block ${p.profession.name === '待選擇' ? 'italic' : ''}`}>
            {p.profession.name === '待選擇' ? '未選擇職業' : p.profession.name}
          </span>
        </span>
        <span className="admin-player-badges">
          <span className="rounded-lg bg-slate-700 px-2 py-1 text-xs font-bold text-gray-200">{p.quadrant}</span>
          <span className="rounded-lg bg-yellow-950 px-2 py-1 text-xs font-bold text-yellow-200">{Math.round(personalAge)} 歲</span>
          {p.isBedridden ? <span className="text-xs font-bold text-orange-300">臥床</span> : null}
          {p.isInFastTrack ? <span className="text-xs font-bold text-emerald-300">外圈</span> : null}
        </span>
        <span className="admin-player-metrics">
          <span className="admin-metric">
            <span className="admin-metric-label">健康</span>
            <span className={`admin-metric-value ${hpColor}`}>HP {p.stats.health}</span>
          </span>
          <span className="admin-metric">
            <span className="admin-metric-label">月現金流</span>
            <span className={`admin-metric-value ${cfColor}`}>${fmt(p.monthlyCashflow)}</span>
          </span>
          <span className="admin-metric">
            <span className="admin-metric-label">手中現金</span>
            <span className="admin-metric-value text-gray-200">${fmt(p.cash)}</span>
          </span>
          <span className="ml-1 text-gray-400" aria-hidden="true">{expanded ? '▲' : '▼'}</span>
        </span>
      </button>

      {/* Expanded stats editor */}
      {expanded && (
        <div className="admin-stats-editor space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {([ ['fq', '財商 FQ', 0, 10], ['hp', '健康 HP', 0, 100], ['sk', '技能 SK', 0, 100], ['nt', '人脈 NT', 0, p.profession?.salaryType === 'nt_driven' ? 50 : 10] ] as [keyof StatsEdit, string, number, number][]).map(
              ([field, label, min, max]) => (
                <div key={field} className="admin-stat-control space-y-1">
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
