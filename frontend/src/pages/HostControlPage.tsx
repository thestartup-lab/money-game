import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import DecisionCountdown from '../components/game/DecisionCountdown';
import FacilitatorControlPanel from '../components/game/FacilitatorControlPanel';
import WorldEventControlPanel, { type AdaptiveDirectorStatus } from '../components/game/WorldEventControlPanel';
import {
  readAdminCode,
  rememberAdminCode,
  readRememberedAdminRoom,
  rememberAdminRoom,
  SERVER_URL,
} from '../lib/adminSession';
import { saveClassicReview } from '../lib/classicReviews';
import type { GameState, Player, RoomAnalysis } from '../types/game';
import './HostControl.css';

interface RoomSummary {
  roomId: string;
  phase?: string;
  gamePhase?: string;
  playerCount: number;
}


const INITIAL_ROOM_ID = readRememberedAdminRoom();
const PHASE_LABELS: Record<string, string> = {
  WaitingForPlayers: '等待玩家',
  Pre20: '玩家設定中',
  RatRace: '內圈進行中',
  FastTrack: '外圈進行中',
  GameOver: '遊戲結束',
};


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
  const analysisRequestedRoomRef = useRef('');
  const [connected, setConnected] = useState(false);
  const [loggedIn, setLoggedIn] = useState(false);
  const [roomId, setRoomId] = useState('');
  const [roomInput, setRoomInput] = useState(INITIAL_ROOM_ID);
  const [adminCodeInput, setAdminCodeInput] = useState('');
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [message, setMessage] = useState('');
  const [adaptiveDirector, setAdaptiveDirector] = useState<AdaptiveDirectorStatus | null>(null);
  const [roomAnalysis, setRoomAnalysis] = useState<RoomAnalysis | null>(null);
  const [currentReviewSaved, setCurrentReviewSaved] = useState(false);
  const [worldToolsOpen, setWorldToolsOpen] = useState(false);

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
      if (rememberedRoomRef.current && readAdminCode(rememberedRoomRef.current)) {
        socket.emit('adminLogin', {
          roomId: rememberedRoomRef.current,
          password: readAdminCode(rememberedRoomRef.current),
        });
      }
    });
    socket.on('disconnect', () => setConnected(false));
    socket.on('roomList', (nextRooms: RoomSummary[]) => setRooms(nextRooms ?? []));
    socket.on('roomCreated', (payload: { roomId: string; adminCode: string }) => {
      rememberAdminCode(payload.roomId, payload.adminCode);
      socket.emit('adminLogin', { roomId: payload.roomId, password: payload.adminCode });
    });
    socket.on('adminLoginSuccess', (payload: { roomId: string; adminCode: string }) => {
      rememberAdminCode(payload.roomId, payload.adminCode);
      setAdminCodeInput(payload.adminCode);
      analysisRequestedRoomRef.current = '';
      rememberedRoomRef.current = payload.roomId;
      rememberAdminRoom(payload.roomId);
      setRoomId(payload.roomId);
      setRoomInput(payload.roomId);
      setLoggedIn(true);
      setRoomAnalysis(null);
      setCurrentReviewSaved(false);
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
    socket.on('gameStateUpdate', (nextGameState: GameState) => {
      setGameState(nextGameState);
      if (nextGameState.gamePhase === 'GameOver' && analysisRequestedRoomRef.current !== nextGameState.roomId) {
        analysisRequestedRoomRef.current = nextGameState.roomId;
        setMessage('遊戲結束，準備帶領全場復盤。');
        socket.emit('requestRoomAnalysis');
      } else if (nextGameState.gamePhase !== 'GameOver') {
        analysisRequestedRoomRef.current = '';
        setRoomAnalysis(null);
        setCurrentReviewSaved(false);
      }
    });
    socket.on('roomAnalysis', (analysis: RoomAnalysis) => setRoomAnalysis(analysis));
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
  const saveCurrentReview = () => {
    if (!roomAnalysis) {
      emit('requestRoomAnalysis');
      setMessage('正在整理本場復盤資料，請稍後再按一次保存。');
      return;
    }
    try {
      saveClassicReview(roomAnalysis);
      setCurrentReviewSaved(true);
      setMessage('已保存為經典場次；資料只留在這台裝置。');
    } catch {
      setMessage('保存失敗：瀏覽器空間不足或停用儲存。請保留本頁，改由電腦後台匯出復盤。');
    }
  };

  const players = gameState?.players ?? [];
  const phase = gameState?.gamePhase ?? 'WaitingForPlayers';
  const isStartable = phase === 'WaitingForPlayers' || phase === 'Pre20';
  const isRunning = phase === 'RatRace' || phase === 'FastTrack';
  const hasStarted = isRunning || phase === 'GameOver';
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
          <label className="host-label" htmlFor="host-access-code">主持人控制碼</label>
          <input id="host-access-code" type="password" autoComplete="off" placeholder="從原主持人控制台取得" value={adminCodeInput} onChange={e => setAdminCodeInput(e.target.value.toUpperCase().trim())} />
          <button
            className="host-primary-button"
            disabled={!connected || roomInput.length < 4}
            onClick={() => emit('adminLogin', { roomId: roomInput, password: readAdminCode(roomInput) || adminCodeInput })}
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
                  onClick={() => { setRoomInput(room.roomId); const code = readAdminCode(room.roomId) || adminCodeInput; if (code) emit('adminLogin', { roomId: room.roomId, password: code }); else setMessage('請輸入原主持人控制台顯示的控制碼。'); }}
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
        <details className="host-alert">
          <summary>查看主持人控制碼（請保密）</summary>
          <p className="text-2xl font-mono">{adminCodeInput || readAdminCode(roomId)}</p>
          <p>請抄下控制碼。換裝置時輸入房間代碼與此碼，即可回到控場頁。</p>
        </details>
        <section className="host-status-grid" aria-label="遊戲狀態">
          <div><span>階段</span><strong>{PHASE_LABELS[phase] ?? phase}</strong></div>
          <div><span>年齡</span><strong>{hasStarted ? `${Math.round(gameState?.currentAge ?? 20)} 歲` : '尚未開始'}</strong></div>
          <div><span>人生輪</span><strong>{hasStarted ? `${phase === 'GameOver' ? gameState?.completedLifeRounds ?? gameState?.turnNumber ?? 0 : roundNumber}/${gameState?.totalLifeRounds ?? 20}` : '—'}</strong></div>
        </section>

        {message ? <p className="host-toast" role="status">{message}</p> : null}

        {phase === 'GameOver' ? (
          <section className="host-review-card" aria-label="賽後復盤控制">
            <p className="host-eyebrow">POST-GAME REVIEW</p>
            <h1>帶領全場復盤</h1>
            <p className="host-muted">點一下就切換大螢幕。建議依序進行，不在過程中給玩家答案。</p>
            <div className="host-review-grid">
              <button onClick={() => emit('setReviewView', { view: 'intro' })}>1. 復盤原則</button>
              <button onClick={() => emit('setReviewView', { view: 'analysis' })}>2. 全場分析</button>
              <button onClick={() => emit('setReviewView', { view: 'history' })}>3. 決策歷程</button>
              <button onClick={() => emit('setReviewView', { view: 'game' })}>最終棋盤</button>
            </div>
            <div className="host-save-review">
              <strong>本場不會自動保存</strong>
              <span>覺得經典時再手動保留，而且只存在這台裝置。</span>
              <button disabled={currentReviewSaved} onClick={saveCurrentReview}>
                {currentReviewSaved ? '✓ 已保存經典場次' : roomAnalysis ? '⭐ 保存為經典場次' : '正在整理資料…'}
              </button>
            </div>
          </section>
        ) : null}

        <section className="host-turn-card">
          <p className="host-eyebrow">NOW PLAYING</p>
          {phase === 'GameOver' ? (
            <>
              <h1>人生旅程已結束</h1>
              <p className="host-turn-detail">請使用上方復盤控制，帶大家從結果回看選擇與轉折。</p>
            </>
          ) : currentPlayer ? (
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
            <span>{phase === 'GameOver' ? '復盤中' : gameState?.isPaused ? '已暫停' : isRunning ? '進行中' : '準備中'}</span>
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

        {gameState && (isRunning || gameState.facilitatorScene) ? (
          <section className="host-card">
            <div className="host-section-heading">
              <div><p className="host-eyebrow">BIG SCREEN DIRECTOR</p><h2>主持人導演模式</h2></div>
              <span>大螢幕互動</span>
            </div>
            <p className="host-help">啟動後正常回合會暫停；由你負責揭曉並繼續。</p>
            <div className="mt-4">
              <FacilitatorControlPanel gameState={gameState} emit={emit} />
            </div>
          </section>
        ) : null}

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

        <section className="host-card">
          <button className="host-primary-button" aria-expanded={worldToolsOpen} aria-controls="host-world-events"
            onClick={() => setWorldToolsOpen((open) => !open)}>
            {worldToolsOpen ? '收合' : '展開'}世界事件控制
          </button>
          {worldToolsOpen && gameState ? <div id="host-world-events" className="mt-4">
            <WorldEventControlPanel gameState={gameState} status={adaptiveDirector} emit={emit} />
          </div> : null}
        </section>

        <nav className="host-footer-links" aria-label="其他主持人工具">
          <a href={`/?display&room=${roomId}`} target="_blank" rel="noreferrer">開啟大螢幕</a>
          <a href="/?admin">完整後台</a>
        </nav>
      </main>
    </div>
  );
}
