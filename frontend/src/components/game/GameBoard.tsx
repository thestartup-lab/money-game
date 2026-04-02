import type { CSSProperties } from 'react';
import { innerCircleConfig, outerCircleConfig } from './boardConfig';
import { BoardCell } from './BoardCell';
import type { BoardCellPlayer } from './BoardCell';
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

// ============================================================
// 7×7 CSS Grid 的格子位置（col, row），從 inner-0 起順時針
// 上排 col 0-6 (row 0)：格 0-6
// 右排 row 1-6 (col 6)：格 7-12
// 下排 col 5-0 (row 6)：格 13-18
// 左排 row 5-1 (col 0)：格 19-23
// ============================================================
const INNER_IDX_TO_POS: [number, number][] = [
  [0,0],[1,0],[2,0],[3,0],[4,0],[5,0],[6,0], // 0-6  上排
  [6,1],[6,2],[6,3],[6,4],[6,5],[6,6],         // 7-12 右排
  [5,6],[4,6],[3,6],[2,6],[1,6],[0,6],         // 13-18 下排
  [0,5],[0,4],[0,3],[0,2],[0,1],               // 19-23 左排
];

// ============================================================
// 圖例資料
// ============================================================
const LEGEND = [
  { type: 'payday',       icon: '💰', label: '發薪日'   },
  { type: 'smallDeal',    icon: '📋', label: '小交易'   },
  { type: 'bigDeal',      icon: '🏢', label: '大交易'   },
  { type: 'doodad',       icon: '💸', label: '意外支出'  },
  { type: 'crisis',       icon: '⚡', label: '危機事件'  },
  { type: 'market',       icon: '📈', label: '市場行情'  },
  { type: 'relationship', icon: '🤝', label: '人際關係'  },
  { type: 'baby',         icon: '👶', label: '添丁'     },
  { type: 'charity',      icon: '❤️', label: '慈善'     },
  { type: 'downsizing',   icon: '📉', label: '裁員'     },
];

// ============================================================
// 主組件
// ============================================================
export function GameBoard({ players, currentTurnPlayerId }: GameBoardProps) {
  // ── 內圈：依格子位置分組玩家 ────────────────────────────────
  const byPos: Record<number, BoardCellPlayer[]> = {};
  const ftByPos: Record<number, BoardCellPlayer[]> = {};

  for (const p of players) {
    const token: BoardCellPlayer = {
      id: p.id,
      name: p.name,
      colorIndex: p.colorIndex,
      isMe: p.isMe,
      isBedridden: p.isBedridden,
    };
    if (p.isInFastTrack) {
      const ftIdx = p.fastTrackPosition % outerCircleConfig.length;
      if (!ftByPos[ftIdx]) ftByPos[ftIdx] = [];
      ftByPos[ftIdx].push(token);
    } else {
      const idx = p.position % innerCircleConfig.length;
      if (!byPos[idx]) byPos[idx] = [];
      byPos[idx].push(token);
    }
  }

  // ── 找出當前回合玩家位置 ─────────────────────────────────────
  const turnPlayer = players.find((p) => p.id === currentTurnPlayerId);
  const turnInnerPos =
    turnPlayer && !turnPlayer.isInFastTrack
      ? turnPlayer.position % innerCircleConfig.length
      : -1;
  const turnFtPos =
    turnPlayer && turnPlayer.isInFastTrack
      ? turnPlayer.fastTrackPosition % outerCircleConfig.length
      : -1;

  const hasFastTrackPlayers = players.some((p) => p.isInFastTrack);

  // ── 外圈格子尺寸 ─────────────────────────────────────────────
  const OUTER_CELL_PX = 52;
  const INNER_CELL_PX = 44;
  const INNER_BOARD_PX = 7 * INNER_CELL_PX; // 308px

  return (
    <div className="gameboard-scroll">
      {/* ══ SVG 濾鏡定義：rough-border 讓邊框扭曲成蠟筆手畫感 ══ */}
      <svg width="0" height="0" style={{ position: 'absolute', overflow: 'hidden' }}>
        <defs>
          <filter id="rough-border" x="-5%" y="-5%" width="110%" height="110%">
            {/* feTurbulence：產生隨機波浪形變 */}
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.04 0.04"
              numOctaves="4"
              seed="5"
              result="noise"
            />
            {/* feDisplacementMap：用噪點扭曲原始圖形邊緣 */}
            <feDisplacementMap
              in="SourceGraphic"
              in2="noise"
              scale="3"
              xChannelSelector="R"
              yChannelSelector="G"
            />
          </filter>
        </defs>
      </svg>

      <div
        className="gameboard-wrapper"
        style={
          {
            '--outer-cell': `${OUTER_CELL_PX}px`,
            '--inner-cell': `${INNER_CELL_PX}px`,
            '--inner-board': `${INNER_BOARD_PX}px`,
          } as CSSProperties
        }
      >
        {/* ══ 外圈 FastTrack（絕對定位環繞）══ */}
        {outerCircleConfig.map((sq, i) => {
          if (!sq.pos) return null;
          const [leftPct, topPct] = sq.pos;
          return (
            <div
              key={sq.id}
              className="outer-cell-wrapper"
              style={{
                left: `${leftPct}%`,
                top: `${topPct}%`,
                width: `${OUTER_CELL_PX}px`,
                height: `${OUTER_CELL_PX}px`,
              }}
            >
              <BoardCell
                config={sq}
                index={i}
                players={ftByPos[i] ?? []}
                isActiveTurn={i === turnFtPos}
                isOuter
              />
            </div>
          );
        })}

        {/* ══ 外圈標題標籤 ══ */}
        {hasFastTrackPlayers && (
          <div className="ft-label">✨ FastTrack</div>
        )}

        {/* ══ 內圈棋盤（7×7 CSS Grid）══ */}
        <div
          className="inner-ring"
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(7, ${INNER_CELL_PX}px)`,
            gridTemplateRows: `repeat(7, ${INNER_CELL_PX}px)`,
            width: `${INNER_BOARD_PX}px`,
            height: `${INNER_BOARD_PX}px`,
          }}
        >
          {/* 24 個周圍格子 */}
          {innerCircleConfig.map((sq, i) => {
            const [col, row] = INNER_IDX_TO_POS[i];
            return (
              <div
                key={sq.id}
                style={{ gridColumn: col + 1, gridRow: row + 1 }}
              >
                <BoardCell
                  config={sq}
                  index={i}
                  players={byPos[i] ?? []}
                  isActiveTurn={i === turnInnerPos}
                />
              </div>
            );
          })}

          {/* 中央資訊面板（col 2-6, row 2-6 → 5×5 span）*/}
          <div
            className="board-center"
            style={{ gridColumn: '2 / 7', gridRow: '2 / 7' }}
          >
            {/* 遊戲標題 */}
            <p className="center-title">百歲人生</p>

            {/* 圖例 */}
            <div className="center-legend">
              {LEGEND.map(({ type, icon, label }) => (
                <div key={type} className="legend-item">
                  <span className="legend-icon">{icon}</span>
                  <span className="legend-text">{label}</span>
                </div>
              ))}
            </div>

            {/* 玩家清單 */}
            {players.length > 0 && (
              <div className="center-players">
                {players.map((p) => (
                  <div key={p.id} className={`center-player ${p.isMe ? 'is-me' : ''}`}>
                    <div
                      className={`center-dot ${p.isMe ? 'is-me' : ''}`}
                      style={{
                        backgroundColor: [
                          '#f59e0b','#60a5fa','#f472b6',
                          '#34d399','#a78bfa','#fb923c',
                        ][p.colorIndex % 6],
                      }}
                    />
                    <span className="center-name">
                      {p.name}
                      {p.id === currentTurnPlayerId && ' ▶'}
                      {p.isBedridden && ' 🛏'}
                    </span>
                    <span className="center-pos">
                      {p.isInFastTrack
                        ? `FT#${p.fastTrackPosition % 16}`
                        : `#${p.position % 24}`}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
