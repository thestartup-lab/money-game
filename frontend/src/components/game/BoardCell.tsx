import type { CSSProperties } from 'react';
import type { SquareConfig } from './boardConfig';
import './BoardCell.css';

export interface BoardCellPlayer {
  id: string;
  name: string;
  colorIndex: number;
  isMe?: boolean;
  isBedridden?: boolean;
}

interface BoardCellProps {
  config: SquareConfig;
  index: number;
  players?: BoardCellPlayer[];
  isActiveTurn?: boolean;
  isCurrentPlayer?: boolean;
  isOuter?: boolean;
}

const PLAYER_COLORS = [
  '#f59e0b', '#60a5fa', '#f472b6', '#34d399', '#a78bfa', '#fb923c',
];

export function BoardCell({
  config,
  index,
  players = [],
  isActiveTurn = false,
  isOuter = false,
}: BoardCellProps) {
  const cssVars = {
    '--cell-color': config.color,
    '--cell-border': config.borderColor,
  } as CSSProperties;

  const classes = [
    'board-cell',
    config.type,
    isOuter ? 'outer' : 'inner',
    isActiveTurn ? 'active' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={classes} style={cssVars}>
      <span className="cell-index">{index}</span>

      <div className="cell-body">
        <span className="cell-icon" role="img" aria-label={config.name}>
          {config.icon}
        </span>
        <span className="cell-name">{config.name}</span>
      </div>

      {players.length > 0 && (
        <div className="cell-players">
          {players.slice(0, 4).map((p) => (
            <div
              key={p.id}
              className={[
                'player-token',
                p.isMe ? 'is-me' : '',
                p.isBedridden ? 'bedridden' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              style={{ backgroundColor: PLAYER_COLORS[p.colorIndex % PLAYER_COLORS.length] }}
              title={p.name}
            >
              {p.name[0]}
            </div>
          ))}
          {players.length > 4 && (
            <span className="player-overflow">+{players.length - 4}</span>
          )}
        </div>
      )}
    </div>
  );
}
