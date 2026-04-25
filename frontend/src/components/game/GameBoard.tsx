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

// ── 外圈 FastTrack 17 格（index 0–16）— 使用者以校準工具實測
const OUTER_CELL_POSITIONS: [number, number][] = [
  [ 9.9, 17.6],  //  0 FT 發薪日
  [16.6, 42.7],  //  1 FT 小交易
  [22.1, 65.4],  //  2 FT 大交易
  [32.6, 76.8],  //  3 FT 人際關係
  [44.1, 82.6],  //  4 FT 發薪日
  [56.4, 87.9],  //  5 FT 危機事件
  [69.5, 82.1],  //  6 FT 科技新創
  [78.7, 71.8],  //  7 FT 資產槓桿
  [85.2, 61.0],  //  8 FT 發薪日
  [85.8, 42.7],  //  9 FT 大交易
  [78.5, 27.5],  // 10 FT 人際關係
  [67.5, 20.5],  // 11 FT 小交易
  [55.5, 10.7],  // 12 FT 發薪日
  [44.7, 17.9],  // 13 FT 大交易
  [35.9, 40.0],  // 14 FT 科技新創
  [37.8, 59.0],  // 15 FT 資產槓桿
  [45.2, 60.8],  // 16 疾病危機
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
        {(() => {
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
                        ? `外圈 #${p.fastTrackPosition % 16}`
                        : `內圈 #${p.position % 25}`}
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
