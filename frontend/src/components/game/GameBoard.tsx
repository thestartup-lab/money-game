import { useState } from 'react';
import './GameBoard.css';

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
}

interface GameBoardProps {
  players: BoardPlayer[];
  currentTurnPlayerId?: string;
}

const PLAYER_COLORS = [
  '#f59e0b', '#60a5fa', '#f472b6', '#34d399', '#a78bfa', '#fb923c',
];

// ── 環形極座標：計算棋子在 gameboard-wrapper（16:9）上的位置 ──
// 內圈 25 格，從 cell 0 在左下方（約 200°）開始順時針
// rx / ry 為相對 wrapper 寬 / 高的半徑百分比，需配合 1.png 圖上的圓環位置調整
const INNER_RX = 27;   // % of wrapper width  ← 若偏移可在此微調
const INNER_RY = 44;   // % of wrapper height
const INNER_START_DEG = 200; // 1.png 上第 0 格在哪個角度（0°=右，90°=下，180°=左，270°=上）
const INNER_TOTAL = 25;

const OUTER_RX = 38;
const OUTER_RY = 43;
const OUTER_START_DEG = 270; // 2.png 上第 0 格（FT起點）在哪個角度
const OUTER_TOTAL = 17;

function cellPos(idx: number, total: number, startDeg: number, rx: number, ry: number) {
  const deg = startDeg + (idx / total) * 360;
  const rad = (deg * Math.PI) / 180;
  const left = 50 + rx * Math.cos(rad);
  const top  = 50 + ry * Math.sin(rad);
  return { left: `${left.toFixed(2)}%`, top: `${top.toFixed(2)}%` };
}

// ============================================================
// 主組件 — 雙底圖切換：1.png（內圈）/ 2.png（外圈）
// ============================================================
export function GameBoard({ players, currentTurnPlayerId }: GameBoardProps) {
  const [boardView, setBoardView] = useState<'inner' | 'outer'>('inner');

  const bgImage = boardView === 'inner' ? "url('/1.png')" : "url('/2.png')";

  // 依目前視圖過濾要顯示的玩家
  const visiblePlayers = players.filter((p) =>
    boardView === 'inner' ? !p.isInFastTrack : p.isInFastTrack
  );

  return (
    <div className="gameboard-scroll">
      <div
        className="gameboard-wrapper"
        style={{ backgroundImage: bgImage }}
      >

        {/* ══ 切換按鈕 ══ */}
        <button
          className="board-view-toggle"
          onClick={() => setBoardView((v) => v === 'inner' ? 'outer' : 'inner')}
        >
          {boardView === 'inner' ? 'FastTrack ▶' : '◀ 老鼠賽跑'}
        </button>

        {/* ══ 玩家棋子（環形定位）══ */}
        {visiblePlayers.map((p) => {
          const pos = boardView === 'inner'
            ? cellPos(p.position % INNER_TOTAL, INNER_TOTAL, INNER_START_DEG, INNER_RX, INNER_RY)
            : cellPos(p.fastTrackPosition % OUTER_TOTAL, OUTER_TOTAL, OUTER_START_DEG, OUTER_RX, OUTER_RY);
          const color = PLAYER_COLORS[p.colorIndex % 6];
          const isActive = p.id === currentTurnPlayerId;
          return (
            <div
              key={p.id}
              className={`board-token${isActive ? ' active' : ''}`}
              style={{ left: pos.left, top: pos.top, '--token-color': color } as React.CSSProperties}
              title={`${p.name} — 格 ${boardView === 'inner' ? p.position : p.fastTrackPosition}`}
            >
              <div className="board-token-circle" style={{ backgroundColor: color }}>
                {p.name.charAt(0)}
              </div>
              <div className="board-token-label">{p.name}</div>
            </div>
          );
        })}

        {/* ══ 玩家清單（底部半透明浮層）══ */}
        {players.length > 0 && (
          <div className="board-player-list">
            {players.map((p) => (
              <div key={p.id} className={`board-player-item${p.isMe ? ' is-me' : ''}`}>
                <div
                  className="board-player-dot"
                  style={{ backgroundColor: PLAYER_COLORS[p.colorIndex % 6] }}
                />
                <span className="board-player-name">
                  {p.name}
                  {p.id === currentTurnPlayerId && ' ▶'}
                  {p.isBedridden && ' 🛏'}
                </span>
                <span className="board-player-pos">
                  {p.isInFastTrack
                    ? `FT#${p.fastTrackPosition % 16}`
                    : `#${p.position % 25}`}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
