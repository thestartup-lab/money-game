import { innerCircleConfig, outerCircleConfig } from './boardConfig';
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
// 主組件 — 以 board.jpg 為底圖，純代幣疊加層
// ============================================================
export function GameBoard({ players, currentTurnPlayerId }: GameBoardProps) {
  // ── 依格子位置分組玩家 ────────────────────────────────────
  const byPos: Record<number, BoardPlayer[]> = {};
  const ftByPos: Record<number, BoardPlayer[]> = {};

  for (const p of players) {
    if (p.isInFastTrack) {
      const idx = p.fastTrackPosition % outerCircleConfig.length;
      if (!ftByPos[idx]) ftByPos[idx] = [];
      ftByPos[idx].push(p);
    } else {
      const idx = p.position % innerCircleConfig.length;
      if (!byPos[idx]) byPos[idx] = [];
      byPos[idx].push(p);
    }
  }

  // ── 當前回合玩家格位 ──────────────────────────────────────
  const turnPlayer = players.find((p) => p.id === currentTurnPlayerId);
  const turnInnerPos =
    turnPlayer && !turnPlayer.isInFastTrack
      ? turnPlayer.position % innerCircleConfig.length
      : -1;
  const turnFtPos =
    turnPlayer && turnPlayer.isInFastTrack
      ? turnPlayer.fastTrackPosition % outerCircleConfig.length
      : -1;

  return (
    <div className="gameboard-scroll">
      <div className="gameboard-wrapper">

        {/* ══ 內圈代幣層 ══ */}
        {innerCircleConfig.map((sq, i) => {
          if (!sq.pos) return null;
          const cellPlayers = byPos[i] ?? [];
          const isActive = i === turnInnerPos;
          if (cellPlayers.length === 0 && !isActive) return null;
          const [lp, tp] = sq.pos;
          return (
            <div
              key={sq.id}
              className={`token-cluster${isActive ? ' active' : ''}`}
              style={{ left: `${lp}%`, top: `${tp}%` }}
            >
              {isActive && <div className="active-ring" />}
              {cellPlayers.map((p) => (
                <div
                  key={p.id}
                  className={`player-token${p.isMe ? ' is-me' : ''}${p.isBedridden ? ' bedridden' : ''}`}
                  style={{ backgroundColor: PLAYER_COLORS[p.colorIndex % 6] }}
                  title={p.name}
                >
                  {p.name[0]}
                </div>
              ))}
            </div>
          );
        })}

        {/* ══ 外圈代幣層（FastTrack）══ */}
        {outerCircleConfig.map((sq, i) => {
          if (!sq.pos) return null;
          const cellPlayers = ftByPos[i] ?? [];
          const isActive = i === turnFtPos;
          if (cellPlayers.length === 0 && !isActive) return null;
          const [lp, tp] = sq.pos;
          return (
            <div
              key={sq.id}
              className={`token-cluster outer${isActive ? ' active' : ''}`}
              style={{ left: `${lp}%`, top: `${tp}%` }}
            >
              {isActive && <div className="active-ring" />}
              {cellPlayers.map((p) => (
                <div
                  key={p.id}
                  className={`player-token${p.isMe ? ' is-me' : ''}${p.isBedridden ? ' bedridden' : ''}`}
                  style={{ backgroundColor: PLAYER_COLORS[p.colorIndex % 6] }}
                  title={p.name}
                >
                  {p.name[0]}
                </div>
              ))}
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
                    : `#${p.position % 24}`}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
