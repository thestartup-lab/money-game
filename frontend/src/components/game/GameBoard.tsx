import { useState } from 'react';
import './GameBoard.css';
import { innerCircleConfig, outerCircleConfig } from './boardConfig';

// ============================================================
// 型別定義（與 PlayerPage.tsx 中的用法相容）
// ============================================================
export interface BoardPlayer {
  id: string;
  name: string;
  position: number;
  fastTrackPosition: number;
  isInFastTrack: boolean;
  isMe: boolean;
  colorIndex: number;
  isBedridden?: boolean;
  /** 額外資訊：用於棋盤中央資訊面板顯示（DisplayScreen 用） */
  health?: number;
  monthlyCashflow?: number;
  age?: number;
  isAlive?: boolean;
  isMarried?: boolean;
  roundAction?: string;
}

interface GameBoardProps {
  players: BoardPlayer[];
  currentTurnPlayerId?: string;
  /** 特殊流程（例如季度結算、剛晉級外圈）可暫時指定大螢幕跟隨的玩家。 */
  focusPlayerId?: string;
  /** 大螢幕已有獨立側欄時可關閉，避免資訊卡壓住棋盤格。 */
  showPlayerPanel?: boolean;
  /** 僅供棋盤調校頁使用，不在正式遊戲中顯示。 */
  enableCalibration?: boolean;
  showMiniMap?: boolean;
  /** 已完成的季度輪數（0–2）；第三輪結束進入統一發薪日。 */
  completedRoundsInCycle?: number;
  /** 全體玩家是否正處於統一發薪日。 */
  isGlobalPayday?: boolean;
}

const PLAYER_COLORS = [
  '#f59e0b', '#60a5fa', '#f472b6', '#34d399', '#a78bfa', '#fb923c',
];

// ============================================================
// 格子座標（以 gameboard-wrapper 寬/高的 % 為單位）。
// 座標直接對齊手繪 PNG 的留白格位；程式只疊上文字、進度與玩家棋子。
const INNER_CELL_POSITIONS: [number, number][] = [
  [39.8, 28.4], [46.6, 27.1], [53.3, 31.4], [58.2, 43.5],
  [59.0, 56.8], [56.0, 70.9], [49.2, 82.5], [40.7, 87.7],
  [31.4, 86.3], [23.6, 78.2], [17.2, 67.9], [15.0, 51.7],
  [15.9, 37.3], [20.7, 22.7], [28.5, 13.1], [37.5, 10.5],
  [45.8, 10.0], [53.7, 12.2], [60.8, 21.0], [65.8, 32.6],
  [68.0, 47.7], [72.2, 59.8], [80.3, 64.4], [88.9, 40.7],
];

const OUTER_CELL_POSITIONS: [number, number][] = [
  [10.7, 18.0], [16.5, 40.0], [22.4, 64.8], [32.3, 76.8],
  [44.3, 82.2], [56.9, 83.2], [69.8, 77.4], [78.2, 67.0],
  [85.1, 55.0], [86.6, 39.0], [77.6, 23.2], [67.8, 15.8],
  [55.4, 15.2], [44.4, 19.3], [34.5, 35.1], [36.5, 53.0],
  [46.0, 61.0],
];

function getPos(idx: number, isOuter: boolean): { left: string; top: string } {
  const table = isOuter ? OUTER_CELL_POSITIONS : INNER_CELL_POSITIONS;
  const [l, t] = table[Math.min(idx, table.length - 1)] ?? [50, 50];
  // 棋子稍微往軌道內側移，避免遮住格名與圖示。
  const inward = 0.88;
  return {
    left: `${50 + (l - 50) * inward}%`,
    top: `${50 + (t - 50) * inward}%`,
  };
}

// ============================================================
// 主組件 — 雙手繪 PNG 切換：內圈 / 外圈
// ============================================================
export function GameBoard({
  players,
  currentTurnPlayerId,
  focusPlayerId,
  showPlayerPanel = true,
  enableCalibration = false,
  showMiniMap = true,
  completedRoundsInCycle = 0,
  isGlobalPayday = false,
}: GameBoardProps) {
  const [manualBoardView, setManualBoardView] = useState<{ anchor: string; view: 'inner' | 'outer' } | null>(null);
  const [calibrate, setCalibrate] = useState(false);

  const automaticFocusId = focusPlayerId ?? currentTurnPlayerId;
  const focusedPlayer = players.find((player) => player.id === automaticFocusId);
  const focusedTrack = focusedPlayer?.isInFastTrack ? 'outer' : focusedPlayer ? 'inner' : null;
  const automaticAnchor = `${automaticFocusId ?? 'none'}:${focusedTrack ?? 'inner'}`;
  const boardView = manualBoardView?.anchor === automaticAnchor
    ? manualBoardView.view
    : focusedTrack ?? 'inner';
  const setBoardViewManual = (view: 'inner' | 'outer') => {
    setManualBoardView({ anchor: automaticAnchor, view });
  };

  const isOuter = boardView === 'outer';
  const bgImage = isOuter
    ? "url('/board-outer-painted-v2.png')"
    : "url('/board-inner-painted-v2.png')";
  const posTable = isOuter ? OUTER_CELL_POSITIONS : INNER_CELL_POSITIONS;
  const squareConfig = isOuter ? outerCircleConfig : innerCircleConfig;

  const visiblePlayers = players.filter((p) =>
    boardView === 'inner' ? !p.isInFastTrack : p.isInFastTrack
  );
  const otherTrackPlayers = players.filter((p) =>
    boardView === 'inner' ? p.isInFastTrack : !p.isInFastTrack
  );

  return (
    <div className="gameboard-scroll">
      <div
        className={`gameboard-wrapper board-surface ${isOuter ? 'is-outer' : 'is-inner'}`}
        style={{ backgroundImage: bgImage }}
      >

        {/* ══ PNG 留白格位上的文字層；不再由程式繪製棋盤 ══ */}
        {!calibrate && squareConfig.map((square, idx) => {
          const [left, top] = posTable[idx];
          return (
            <div
              key={square.id}
              className={`quarter-board-cell type-${square.type}`}
              style={{
                left: `${left}%`,
                top: `${top}%`,
                '--cell-color': square.color,
                '--cell-border': square.borderColor,
              } as React.CSSProperties}
            >
              <span className="quarter-board-cell-index">{idx + 1}</span>
              <span className="quarter-board-cell-icon">{square.icon}</span>
              <span className="quarter-board-cell-name">{square.name}</span>
            </div>
          );
        })}

        <QuarterDial
          completedRounds={completedRoundsInCycle}
          isGlobalPayday={isGlobalPayday}
          isOuter={isOuter}
        />

        {/* ══ 切換按鈕 ══ */}
        <button
          className="board-view-toggle"
          onClick={() => setBoardViewManual(boardView === 'inner' ? 'outer' : 'inner')}
        >
          {boardView === 'inner' ? 'FastTrack ▶' : '◀ 老鼠賽跑'}
        </button>

        {/* ══ 校準模式切換 ══ */}
        {enableCalibration ? (
          <button
            className="board-calibrate-toggle"
            onClick={() => setCalibrate((v) => !v)}
          >
            {calibrate ? '關閉校準' : '🔧 校準'}
          </button>
        ) : null}

        {/* ══ 對方圈 mini-map（當對方圈有玩家時才顯示）══ */}
        {!calibrate && showMiniMap && otherTrackPlayers.length > 0 && (
          <MiniMap
            isOuter={!isOuter}
            players={otherTrackPlayers}
            currentTurnPlayerId={currentTurnPlayerId}
            onClick={() => setBoardViewManual(isOuter ? 'inner' : 'outer')}
          />
        )}

        {/* ══ 校準模式：顯示所有格子編號 + 座標 ══ */}
        {calibrate && posTable.map(([l, t], idx) => (
          <div
            key={`cal-${idx}`}
            className="board-calibrate-dot"
            style={{ left: `${l}%`, top: `${t}%` }}
          >
            <div className="board-calibrate-num">{idx}</div>
            <div className="board-calibrate-coord">{l},{t}</div>
          </div>
        ))}

        {/* ══ 玩家棋子（座標表定位）══ */}
        {!calibrate && (() => {
          // 按格子分組，計算每格有多少玩家，以便分散排列避免重疊
          const cellGroups = new Map<number, typeof visiblePlayers>();
          for (const p of visiblePlayers) {
            const cellIdx = isOuter
              ? p.fastTrackPosition % OUTER_CELL_POSITIONS.length
              : p.position % INNER_CELL_POSITIONS.length;
            if (!cellGroups.has(cellIdx)) cellGroups.set(cellIdx, []);
            cellGroups.get(cellIdx)!.push(p);
          }

          return visiblePlayers.map((p) => {
            const cellIdx = isOuter
              ? p.fastTrackPosition % OUTER_CELL_POSITIONS.length
              : p.position % INNER_CELL_POSITIONS.length;
            const pos = getPos(cellIdx, isOuter);
            const color = PLAYER_COLORS[p.colorIndex % 6];
            const isActive = p.id === currentTurnPlayerId;

            // 計算此格的偏移
            const group = cellGroups.get(cellIdx)!;
            const slotIndex = group.indexOf(p);
            const total = group.length;
            let offsetX = 0;
            let offsetY = 0;
            if (total > 1) {
              // 以圓形分散排列，半徑 1.8%（相對容器）
              const angle = (2 * Math.PI * slotIndex) / total - Math.PI / 2;
              offsetX = Math.cos(angle) * 1.8;
              offsetY = Math.sin(angle) * 1.8;
            }

            const left = `calc(${pos.left} + ${offsetX.toFixed(2)}%)`;
            const top  = `calc(${pos.top}  + ${offsetY.toFixed(2)}%)`;

            return (
              <div
                key={p.id}
                className={`board-token${isActive ? ' active' : ''}`}
                style={{ left, top, '--token-color': color } as React.CSSProperties}
                title={`${p.name} — 格 ${isOuter ? p.fastTrackPosition : p.position}`}
              >
                <div className="board-token-circle" style={{ backgroundColor: color }}>
                  {p.name.charAt(0)}
                </div>
                <div className="board-token-label">{p.name}</div>
              </div>
            );
          });
        })()}

        {/* ══ 當前回合玩家資訊大卡（右下角）══ */}
        {showPlayerPanel && (() => {
          const activePlayer = players.find((p) => p.id === currentTurnPlayerId)
            ?? players.find((p) => p.isAlive !== false);
          if (!activePlayer) return null;

          const p = activePlayer;
          const cf = p.monthlyCashflow;
          const cfColor = cf === undefined
            ? '#888'
            : cf >= 0 ? '#34d399' : '#f87171';
          const hp = p.health;
          const hpColor = hp === undefined
            ? '#888'
            : hp >= 60 ? '#86efac' : hp >= 30 ? '#fde047' : '#fca5a5';
          const dead = p.isAlive === false;

          return (
            <div className={`board-player-list${dead ? ' is-dead' : ''}`}>
              <div className="board-player-list-title">▶ 當前回合</div>
              <div className="board-player-card">
                <div className="board-player-card-header">
                  <div
                    className="board-player-dot-big"
                    style={{ backgroundColor: PLAYER_COLORS[p.colorIndex % 6] }}
                  />
                  <span className="board-player-name-big">{p.name}</span>
                  {p.age !== undefined && (
                    <span className="board-player-age-big">{p.age}歲</span>
                  )}
                </div>

                <div className="board-player-stats-grid">
                  {cf !== undefined && (
                    <div className="board-player-stat">
                      <div className="board-player-stat-label">月現金流</div>
                      <div className="board-player-stat-value" style={{ color: cfColor }}>
                        ${cf >= 0 ? '+' : ''}{cf.toLocaleString()}
                      </div>
                    </div>
                  )}
                  {hp !== undefined && (
                    <div className="board-player-stat">
                      <div className="board-player-stat-label">健康 HP</div>
                      <div className="board-player-stat-value" style={{ color: hpColor }}>
                        {hp}
                      </div>
                    </div>
                  )}
                  <div className="board-player-stat">
                    <div className="board-player-stat-label">所在位置</div>
                    <div className="board-player-stat-value board-player-pos-value">
                      {p.isInFastTrack
                        ? `外圈 #${p.fastTrackPosition % OUTER_CELL_POSITIONS.length}`
                        : `內圈 #${p.position % INNER_CELL_POSITIONS.length}`}
                    </div>
                  </div>
                </div>

                <div className="board-player-tags">
                  {p.isBedridden && <span className="board-player-tag tag-warn">🛏 臥床</span>}
                  {p.isMarried && <span className="board-player-tag tag-pink">💍 已婚</span>}
                  {p.isInFastTrack && <span className="board-player-tag tag-emerald">🚀 外圈</span>}
                  {dead && <span className="board-player-tag tag-dead">⚰ 結束</span>}
                </div>

                {p.roundAction && (
                  <div className="board-player-action-big">→ {p.roundAction}</div>
                )}
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}

function QuarterDial({
  completedRounds,
  isGlobalPayday,
  isOuter,
}: {
  completedRounds: number;
  isGlobalPayday: boolean;
  isOuter: boolean;
}) {
  const completed = Math.min(3, Math.max(0, completedRounds));
  const currentRound = Math.min(3, completed + 1);
  const roundsLeft = Math.max(0, 3 - completed);

  return (
    <div className={`quarter-dial ${isOuter ? 'is-outer' : 'is-inner'}${isGlobalPayday ? ' is-payday' : ''}`}>
      <div className="quarter-dial-rings" />
      <p className="quarter-dial-kicker">{isOuter ? 'FASTTRACK · 同步季曆' : '人生季度'}</p>
      <p className="quarter-dial-title">
        {isGlobalPayday ? '全體發薪日' : `第 ${currentRound} 輪`}
      </p>
      <div className="quarter-dial-segments" aria-label={`季度進度 ${completed}/3`}>
        {[0, 1, 2].map((index) => (
          <span
            key={index}
            className={`quarter-dial-segment${index < completed ? ' is-complete' : ''}${index === completed && !isGlobalPayday ? ' is-current' : ''}`}
          >
            {index + 1}
          </span>
        ))}
      </div>
      <p className="quarter-dial-status">
        {isGlobalPayday ? '本季三個月統一結算' : `再 ${roundsLeft} 輪進入統一發薪`}
      </p>
    </div>
  );
}

// ============================================================
// MiniMap：對方圈玩家位置概覽
// ── 設計理念：當有玩家進到外圈但其他人還在內圈時，主畫面只能顯示一邊。
//    這個 SVG 縮圖以圓形軌道呈現對方圈，玩家以小色點標示位置；
//    點擊整個 mini-map 即切換主畫面到該圈。
// ============================================================
interface MiniMapProps {
  isOuter: boolean;
  players: BoardPlayer[];
  currentTurnPlayerId?: string;
  onClick: () => void;
}

function MiniMap({ isOuter, players, currentTurnPlayerId, onClick }: MiniMapProps) {
  const cellCount = isOuter ? 17 : 25;
  // 內圈標準發薪日格 index（每隔 6 格）
  const paydayIndices = isOuter ? new Set([0, 4, 8, 12]) : new Set([0, 6, 12, 18]);

  // SVG viewBox 100x100，軌道圓心 50,50；半徑 40
  const cx = 50, cy = 50, r = 40;

  // 把每格繪在等間距的圓周上（從 12 點鐘方向順時針）
  const cellAt = (idx: number): { x: number; y: number } => {
    const angle = (2 * Math.PI * idx) / cellCount - Math.PI / 2;
    return {
      x: cx + Math.cos(angle) * r,
      y: cy + Math.sin(angle) * r,
    };
  };

  return (
    <div
      className="board-minimap"
      onClick={onClick}
      title={`點擊切換到${isOuter ? '外圈' : '內圈'}主畫面`}
    >
      <div className="board-minimap-title">
        {isOuter ? '🚀 外圈動態' : '🏃 內圈動態'}
      </div>
      <svg className="board-minimap-svg" viewBox="0 0 100 100">
        {/* 軌道格子（小圓圈） */}
        {Array.from({ length: cellCount }).map((_, idx) => {
          const { x, y } = cellAt(idx);
          return (
            <circle
              key={`cell-${idx}`}
              cx={x}
              cy={y}
              r={2.2}
              className={`board-minimap-cell${paydayIndices.has(idx) ? ' payday' : ''}`}
            />
          );
        })}

        {/* 玩家棋子（按格子分組分散） */}
        {(() => {
          const groups = new Map<number, BoardPlayer[]>();
          for (const p of players) {
            const idx = isOuter
              ? p.fastTrackPosition % 17
              : p.position % 25;
            if (!groups.has(idx)) groups.set(idx, []);
            groups.get(idx)!.push(p);
          }
          return players.map((p) => {
            const idx = isOuter
              ? p.fastTrackPosition % 17
              : p.position % 25;
            const { x, y } = cellAt(idx);
            const group = groups.get(idx)!;
            const slot = group.indexOf(p);
            const total = group.length;
            // 多人同格時環繞排列
            let ox = 0, oy = 0;
            if (total > 1) {
              const ang = (2 * Math.PI * slot) / total - Math.PI / 2;
              ox = Math.cos(ang) * 2.5;
              oy = Math.sin(ang) * 2.5;
            }
            const color = PLAYER_COLORS[p.colorIndex % 6];
            const active = p.id === currentTurnPlayerId;
            return (
              <circle
                key={p.id}
                cx={x + ox}
                cy={y + oy}
                r={active ? 3.0 : 2.4}
                fill={color}
                className={`board-minimap-token${active ? ' active' : ''}`}
              >
                <title>{p.name}（{isOuter ? '外圈' : '內圈'} #{idx}）</title>
              </circle>
            );
          });
        })()}
      </svg>
      <div className="board-minimap-count">
        {players.length} 人在此 · 點擊切換
      </div>
    </div>
  );
}
