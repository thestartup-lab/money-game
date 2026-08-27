import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import DecisionCountdown from '../components/game/DecisionCountdown';
import {
  DEFAULT_ADMIN_PASSWORD,
  readRememberedAdminRoom,
  rememberAdminRoom,
  SERVER_URL,
} from '../lib/adminSession';
import type { GameState, Player } from '../types/game';
import './HostControl.css';

interface RoomSummary {
  roomId: string;
  phase?: string;
  gamePhase?: string;
  playerCount: number;
}

interface AdaptiveDirectorStatus {
  enabled: boolean;
  mode: 'support' | 'balanced' | 'challenge';
  score: number;
  reason: string;
  lastEventTitle?: string;
}

const INITIAL_ROOM_ID = readRememberedAdminRoom();
const PHASE_LABELS: Record<string, string> = {
  WaitingForPlayers: '等待玩家',
  Pre20: '玩家設定中',
  RatRace: '內圈進行中',
  FastTrack: '外圈進行中',
  GameOver: '遊戲結束',
};

const GLOBAL_EVENTS = [
  { id: 'stock_crash', label: '股市崩盤' },
  { id: 'stock_boom', label: '股市繁榮' },
  { id: 'realestate_crash', label: '房市崩盤' },
  { id: 'realestate_boom', label: '房市繁榮' },
  { id: 'inflation', label: '通貨膨脹' },
  { id: 'business_collapse', label: '企業倒閉' },
  { id: 'natural_disaster', label: '天然災害' },
  { id: 'pandemic', label: '全球疫情' },
];

function getOrderedAlivePlayers(gameState: GameState): Player[] {
  const playerById = new Map(gameState.players.map((player) => [player.id, player]));
  return gameState.playerOrder
    .map((playerId) => playerById.get(playerId))
    .filter((player): player is Player => Boolean(player?.isAlive));
}

function getNextPlayer(gameState: GameState, currentPlayerId: string): Player | null {
  const orderedPlayers = getOrderedAlivePlayers(gameState);
  if (orderedPlayers.length < 2) return null;
  const currentIndex = orderedPlayers.findIndex((player) => player.id === currentPlayerId);
  if (currentIndex < 0) return orderedPlayers[0] ?? null;
  return orderedPlayers[(currentIndex + 1) % orderedPlayers.length] ?? null;
}

export default function HostControlPage() {
  const socketRef = useRef<Socket | null>(null);
  const rememberedRoomRef = useRef(INITIAL_ROOM_ID);
  const [connected, setConnected] = useState(false);
  const [loggedIn, setLoggedIn] = useState(false);
  const [roomId, setRoomId] = useState('');
  const [roomInput, setRoomInput] = useState(INITIAL_ROOM_ID);
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [message, setMessage] = useState('');
  const [adaptiveDirector, setAdaptiveDirector] = useState<AdaptiveDirectorStatus | null>(null);

  useEffect(() => {
    const socket = io(SERVER_URL, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 20000,
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      setConnected(true);
      socket.emit('listRooms');
      if (rememberedRoomRef.current) {
        socket.emit('adminLogin', {
          roomId: rememberedRoomRef.current,
          password: DEFAULT_ADMIN_PASSWORD,
        });
      }
    });
    socket.on('disconnect', () => setConnected(false));
    socket.on('roomList', (nextRooms: RoomSummary[]) => setRooms(nextRooms ?? []));
    socket.on('roomCreated', (payload: { roomId: string }) => {
      socket.emit('adminLogin', { roomId: payload.roomId, password: DEFAULT_ADMIN_PASSWORD });
    });
    socket.on('adminLoginSuccess', (payload: { roomId: string }) => {
      rememberedRoomRef.current = payload.roomId;
      rememberAdminRoom(payload.roomId);
      setRoomId(payload.roomId);
      setRoomInput(payload.roomId);
      setLoggedIn(true);
      setMessage('');
      socket.emit('getAdaptiveDirectorStatus', { roomId: payload.roomId });
    });
    socket.on('adminLoginFail', (payload: { message?: string }) => {
      rememberedRoomRef.current = '';
      rememberAdminRoom('');
      setLoggedIn(false);
      setRoomInput('');
      setMessage(payload.message ?? '無法進入房間，請再試一次。');
    });
    socket.on('gameStateUpdate', (nextGameState: GameState) => setGameState(nextGameState));
    socket.on('adaptiveDirectorStatus', (status: AdaptiveDirectorStatus) => setAdaptiveDirector(status));
    socket.on('gameStarted', () => setMessage('遊戲已開始。'));
    socket.on('gamePaused', () => setMessage('遊戲已暫停。'));
    socket.on('gameResumed', () => setMessage('遊戲已繼續。'));
    socket.on('globalEventAnnouncement', (payload: { event?: { title?: string } }) => {
      setMessage(`已觸發：${payload.event?.title ?? '全局事件'}`);
    });
    socket.on('roomDeleted', (payload: { roomId: string }) => {
      if (payload.roomId !== rememberedRoomRef.current) return;
      rememberedRoomRef.current = '';
      rememberAdminRoom('');
      setLoggedIn(false);
      setGameState(null);
      setRoomId('');
      socket.emit('listRooms');
    });
    socket.on('error', (payload: { message?: string }) => {
      setMessage(payload.message ?? '操作失敗，請再試一次。');
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  const emit = (eventName: string, payload?: unknown) => {
    if (payload === undefined) socketRef.current?.emit(eventName);
    else socketRef.current?.emit(eventName, payload);
  };

  const players = gameState?.players ?? [];
  const phase = gameState?.gamePhase ?? 'WaitingForPlayers';
  const isStartable = phase === 'WaitingForPlayers' || phase === 'Pre20';
  const isRunning = phase === 'RatRace' || phase === 'FastTrack';
  const notReadyPlayers = players.filter((player) => !player.pre20Done && !player.isDisconnected);
  const decisionPhase = gameState?.decisionPhase ?? null;
  const activePlayerId = decisionPhase?.playerId ?? gameState?.currentPlayerTurnId ?? '';
  const currentPlayer = gameState?.players.find((player) => player.id === activePlayerId) ?? null;
  const nextPlayer = gameState && currentPlayer ? getNextPlayer(gameState, currentPlayer.id) : null;

  if (!loggedIn) {
    return (
      <div className="host-control host-login-shell">
        <main className="host-login-card">
          <div className="host-login-mark" aria-hidden="true">🎙️</div>
          <p className="host-eyebrow">MOBILE CONTROL</p>
          <h1>主持人手機控場</h1>
          <p className="host-muted">控制節奏、倒數與玩家輪次；完整資料仍可回電腦後台查看。</p>

          <div className="host-connection" data-connected={connected}>
            <span aria-hidden="true" />
            {connected ? '伺服器已連線' : '正在連接伺服器…'}
          </div>

          <label className="host-label" htmlFor="host-room-input">房間代碼</label>
          <input
            id="host-room-input"
            inputMode="text"
            autoCapitalize="characters"
            maxLength={6}
            placeholder="例如：A123BC"
            value={roomInput}
            onChange={(event) => {
              setRoomInput(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''));
              setMessage('');
            }}
          />
          <button
            className="host-primary-button"
            disabled={!connected || roomInput.length < 4}
            onClick={() => emit('adminLogin', { roomId: roomInput, password: DEFAULT_ADMIN_PASSWORD })}
          >
            進入控場頁
          </button>
          <button
            className="host-secondary-button"
            disabled={!connected}
            onClick={() => emit('createRoom', { roomId: roomInput || undefined })}
          >
            {roomInput ? `建立房間 ${roomInput}` : '建立新房間'}
          </button>

          {message ? <p className="host-alert" role="alert">{message}</p> : null}

          {rooms.length > 0 ? (
            <section className="host-room-list" aria-label="現有房間">
              <h2>現有房間</h2>
              {rooms.map((room) => (
                <button
                  key={room.roomId}
                  onClick={() => emit('adminLogin', { roomId: room.roomId, password: DEFAULT_ADMIN_PASSWORD })}
                >
                  <strong>{room.roomId}</strong>
                  <span>{PHASE_LABELS[room.phase ?? room.gamePhase ?? ''] ?? '等待中'}</span>
                  <span>{room.playerCount} 人</span>
                </button>
              ))}
            </section>
          ) : null}

          <a className="host-text-link" href="/?admin">前往完整電腦後台</a>
        </main>
      </div>
    );
  }

  const roundNumber = Math.min(
    gameState?.totalLifeRounds ?? 20,
    (gameState?.completedLifeRounds ?? gameState?.turnNumber ?? 0) + 1,
  );

  return (
    <div className="host-control">
      <header className="host-topbar">
        <div>
          <p>主持人控場</p>
          <strong>{roomId}</strong>
        </div>
        <div className="host-topbar-actions">
          <span className="host-live-dot" data-connected={connected} aria-label={connected ? '連線正常' : '連線中斷'} />
          <a href={`/?display&room=${roomId}`} target="_blank" rel="noreferrer" aria-label="開啟大螢幕展示頁">📺</a>
          <button
            aria-label="切換房間"
            onClick={() => {
              emit('adminLeaveRoom');
              rememberedRoomRef.current = '';
              rememberAdminRoom('');
              setLoggedIn(false);
              setGameState(null);
              setRoomId('');
              setRoomInput('');
              socketRef.current?.emit('listRooms');
            }}
          >切換</button>
        </div>
      </header>

      <main className="host-main">
        <section className="host-status-grid" aria-label="遊戲狀態">
          <div><span>階段</span><strong>{PHASE_LABELS[phase] ?? phase}</strong></div>
          <div><span>年齡</span><strong>{isRunning ? `${Math.round(gameState?.currentAge ?? 20)} 歲` : '尚未開始'}</strong></div>
          <div><span>人生輪</span><strong>{isRunning ? `${roundNumber}/${gameState?.totalLifeRounds ?? 20}` : '—'}</strong></div>
        </section>

        {message ? <p className="host-toast" role="status">{message}</p> : null}

        <section className="host-turn-card">
          <p className="host-eyebrow">NOW PLAYING</p>
          {currentPlayer ? (
            <>
              <p className="host-turn-label">現在輪到</p>
              <h1>{currentPlayer.name}</h1>
              <p className="host-turn-detail">
                {currentPlayer.profession?.name ?? '未選職業'} · {Math.round(currentPlayer.personalAge ?? gameState?.currentAge ?? 20)} 歲
              </p>
              <div className="host-next-player">
                <span>下一位</span>
                <strong>{nextPlayer?.name ?? '本輪結束'}</strong>
              </div>
            </>
          ) : decisionPhase ? (
            <>
              <p className="host-turn-label">現在決策</p>
              <h1>{decisionPhase.playerName}</h1>
              <p className="host-turn-detail">{decisionPhase.title}</p>
            </>
          ) : (
            <>
              <h1>{players.length === 0 ? '等待玩家加入' : '等待遊戲開始'}</h1>
              <p className="host-turn-detail">大螢幕會在輪次開始時放大提醒下一位玩家。</p>
            </>
          )}
        </section>

        {decisionPhase ? (
          <section className="host-decision-card" aria-label="決策倒數控制">
            <div className="host-decision-heading">
              <div>
                <p className="host-eyebrow">決策時間</p>
                <h2>{decisionPhase.title}</h2>
                <p>{decisionPhase.playerName} 正在決策</p>
              </div>
              <DecisionCountdown
                reminderEndsAt={decisionPhase.reminderEndsAt}
                className="host-countdown"
              />
            </div>
            <div className="host-reminder-grid">
              {[30, 60, 90].map((seconds) => (
                <button
                  key={seconds}
                  onClick={() => emit('setDecisionReminder', { phaseId: decisionPhase.id, seconds })}
                >{seconds} 秒</button>
              ))}
              <button onClick={() => emit('setDecisionReminder', { phaseId: decisionPhase.id, addSeconds: 30 })}>+30 秒</button>
            </div>
            <p className="host-help">倒數歸零只會提醒，不會替玩家做決定。</p>
            <button
              className="host-primary-button host-continue-button"
              onClick={() => emit('continueDecisionPhase', { phaseId: decisionPhase.id })}
            >
              {decisionPhase.kind === 'auction'
                ? '結束競標並揭曉'
                : decisionPhase.submitted
                  ? '揭曉結果並繼續'
                  : '略過本次決策並繼續'}
            </button>
          </section>
        ) : null}

        <section className="host-card">
          <div className="host-section-heading">
            <div><p className="host-eyebrow">GAME FLOW</p><h2>遊戲控制</h2></div>
            <span>{gameState?.isPaused ? '已暫停' : isRunning ? '進行中' : '準備中'}</span>
          </div>

          {isStartable ? (
            <div className="host-action-stack">
              <button
                className="host-primary-button"
                disabled={players.length === 0 || notReadyPlayers.length > 0}
                onClick={() => emit('startGame')}
              >
                {players.length === 0
                  ? '請先讓玩家加入'
                  : notReadyPlayers.length > 0
                    ? `等待 ${notReadyPlayers.length} 人完成設定`
                    : '開始 20 回合遊戲'}
              </button>
              {notReadyPlayers.length > 0 ? (
                <button
                  className="host-warning-button"
                  onClick={() => {
                    const names = notReadyPlayers.map((player) => player.name).join('、');
                    if (window.confirm(`系統將自動補齊：${names}\n\n確定強制開始？`)) {
                      emit('startGame', { force: true });
                    }
                  }}
                >自動補齊並強制開始</button>
              ) : null}
            </div>
          ) : null}

          {isRunning && !decisionPhase ? (
            gameState?.isPaused ? (
              <button className="host-primary-button" onClick={() => emit('resumeGame')}>▶ 繼續遊戲</button>
            ) : (
              <button className="host-pause-button" onClick={() => emit('pauseGame', { reason: '主持人手機暫停' })}>⏸ 暫停遊戲</button>
            )
          ) : null}
        </section>

        <section className="host-card">
          <div className="host-section-heading">
            <div><p className="host-eyebrow">PLAYERS</p><h2>玩家狀態</h2></div>
            <span>{players.length} 人</span>
          </div>
          <div className="host-player-list">
            {players.length === 0 ? <p className="host-muted">尚無玩家加入。</p> : null}
            {players.map((player) => (
              <div key={player.id} data-current={player.id === currentPlayer?.id}>
                <span className="host-player-dot" data-ready={player.pre20Done} />
                <div>
                  <strong>{player.name}</strong>
                  <span>{player.profession?.name === '待選擇' ? '設定中' : player.profession?.name}</span>
                </div>
                <span>{player.isDisconnected ? '離線' : player.pre20Done ? '就緒' : '設定中'}</span>
              </div>
            ))}
          </div>
        </section>

        <details className="host-card host-details">
          <summary>難度與全局事件</summary>
          <div className="host-director">
            <div>
              <strong>{adaptiveDirector?.mode === 'support' ? '降低難度' : adaptiveDirector?.mode === 'challenge' ? '提高難度' : '維持平衡'}</strong>
              <span>全場狀態 {adaptiveDirector?.score ?? 50}/100</span>
            </div>
            <button
              onClick={() => emit('setAdaptiveDirectorEnabled', {
                roomId,
                enabled: adaptiveDirector?.enabled === false,
              })}
            >{adaptiveDirector?.enabled === false ? '開啟自動調節' : '自動調節中'}</button>
          </div>
          <p className="host-help">{adaptiveDirector?.reason ?? '季度結算後自動評估全場狀態。'}</p>
          <div className="host-event-grid">
            {GLOBAL_EVENTS.map((event) => (
              <button
                key={event.id}
                onClick={() => {
                  if (window.confirm(`確定觸發「${event.label}」？`)) {
                    emit('triggerGlobalEvent', { eventId: event.id, roomId });
                  }
                }}
              >{event.label}</button>
            ))}
          </div>
        </details>

        <nav className="host-footer-links" aria-label="其他主持人工具">
          <a href={`/?display&room=${roomId}`} target="_blank" rel="noreferrer">開啟大螢幕</a>
          <a href="/?admin">完整後台</a>
        </nav>
      </main>
    </div>
  );
}
