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

// ============================================================
// 格子座標（以 gameboard-wrapper 寬/高的 % 為單位）
// 依 1.png 圖片目測校準：時鐘中心 ≈ (44%, 46%)
// 螺旋由內圈（順時針）展開至外圈
// ── 內圈 25 格（index 0–24）────────────────────────────────
const INNER_CELL_POSITIONS: [number, number][] = [
  // [left%, top%]  — 使用者以校準工具實測
  [39.8, 28.4],  //  0 發薪日
  [46.6, 27.1],  //  1 小交易
  [53.3, 31.4],  //  2 意外支出
  [58.2, 43.5],  //  3 小交易
  [59.0, 56.8],  //  4 大交易
  [56.0, 70.9],  //  5 危機事件
  [49.2, 82.5],  //  6 發薪日
  [40.7, 87.7],  //  7 小交易
  [31.4, 86.3],  //  8 意外支出
  [23.6, 78.2],  //  9 添丁
  [17.2, 67.9],  // 10 人際關係
  [15.0, 51.7],  // 11 慈善捐款
  [15.9, 37.3],  // 12 發薪日
  [20.7, 22.7],  // 13 意外支出
  [28.5, 13.1],  // 14 大交易
  [37.5, 10.5],  // 15 小交易
  [45.8, 10.0],  // 16 市場行情
  [53.7, 12.2],  // 17 危機事件
  [60.8, 21.0],  // 18 發薪日
  [65.8, 32.6],  // 19 小交易
  [68.0, 47.7],  // 20 人際關係
  [72.2, 59.8],  // 21 大交易
  [80.3, 64.4],  // 22 裁員
  [86.4, 53.8],  // 23 危機事件
  [88.9, 40.7],  // 24 第二人生
];

// ── 外圈 FastTrack 17 格（index 0–16）──────────────────────
const OUTER_CELL_POSITIONS: [number, number][] = [
  [50.0, 8.0],   //  0 FT 發薪日
  [63.0, 9.0],   //  1
  [74.0, 14.0],  //  2
  [83.0, 22.0],  //  3
  [88.0, 33.0],  //  4
  [88.0, 45.0],  //  5
  [83.0, 57.0],  //  6
  [74.0, 66.0],  //  7
  [62.0, 72.0],  //  8
  [50.0, 74.0],  //  9
  [38.0, 72.0],  // 10
  [26.0, 66.0],  // 11
  [17.0, 57.0],  // 12
  [12.0, 45.0],  // 13
  [12.0, 33.0],  // 14
  [17.0, 22.0],  // 15
  [28.0, 14.0],  // 16
];

function getPos(idx: number, isOuter: boolean): { left: string; top: string } {
  const table = isOuter ? OUTER_CELL_POSITIONS : INNER_CELL_POSITIONS;
  const [l, t] = table[Math.min(idx, table.length - 1)] ?? [50, 50];
  return { left: `${l}%`, top: `${t}%` };
}

// ============================================================
// 主組件 — 雙底圖切換：1.png（內圈）/ 2.png（外圈）
// ============================================================
export function GameBoard({ players, currentTurnPlayerId }: GameBoardProps) {
  const [boardView, setBoardView] = useState<'inner' | 'outer'>('inner');
  const [calibrate, setCalibrate] = useState(false);

  const bgImage = boardView === 'inner' ? "url('/1.png')" : "url('/2.png')";
  const isOuter = boardView === 'outer';
  const posTable = isOuter ? OUTER_CELL_POSITIONS : INNER_CELL_POSITIONS;

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

        {/* ══ 校準模式切換 ══ */}
        <button
          className="board-calibrate-toggle"
          onClick={() => setCalibrate((v) => !v)}
        >
          {calibrate ? '關閉校準' : '🔧 校準'}
        </button>

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
        {!calibrate && visiblePlayers.map((p) => {
          const cellIdx = isOuter
            ? p.fastTrackPosition % OUTER_CELL_POSITIONS.length
            : p.position % INNER_CELL_POSITIONS.length;
          const pos = getPos(cellIdx, isOuter);
          const color = PLAYER_COLORS[p.colorIndex % 6];
          const isActive = p.id === currentTurnPlayerId;
          return (
            <div
              key={p.id}
              className={`board-token${isActive ? ' active' : ''}`}
              style={{ left: pos.left, top: pos.top, '--token-color': color } as React.CSSProperties}
              title={`${p.name} — 格 ${isOuter ? p.fastTrackPosition : p.position}`}
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
