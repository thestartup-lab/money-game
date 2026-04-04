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
// 主組件 — 雙底圖切換：1.png（內圈）/ 2.png（外圈）
// ============================================================
export function GameBoard({ players, currentTurnPlayerId }: GameBoardProps) {
  const [boardView, setBoardView] = useState<'inner' | 'outer'>('inner');

  const bgImage = boardView === 'inner' ? "url('/1.png')" : "url('/2.png')";

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
