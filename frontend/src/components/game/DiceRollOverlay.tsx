import { useEffect, useRef, useState } from 'react';
import './DiceRollOverlay.css';

export interface DiceRollData {
  key: number;
  playerId: string;
  playerName: string;
  colorIndex: number;
  dice: number[];
  total: number;
  oldPosition: number;
  newPosition: number;
}

interface Props {
  data: DiceRollData | null;
  onDone: () => void;
  /** 'large' for big screen, 'small' for player phone */
  size?: 'large' | 'small';
}

const PLAYER_COLORS = ['#fbbf24', '#60a5fa', '#f472b6', '#34d399', '#a78bfa', '#fb923c'];

// 骰子是全場共同觀看的遊戲演出，不計入玩家的決策時間。
const TUMBLE_MS = 1_150;
const HOLD_MS = 1_550;
const FADE_MS = 450;

export default function DiceRollOverlay({ data, onDone, size = 'large' }: Props) {
  const [phase, setPhase] = useState<'tumble' | 'hold' | 'fade'>('tumble');
  const [tumbleFaces, setTumbleFaces] = useState<number[]>([]);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    if (!data) return;

    setPhase('tumble');
    setTumbleFaces(data.dice.map(() => Math.floor(Math.random() * 6) + 1));

    if (tickRef.current) clearInterval(tickRef.current);
    tickRef.current = setInterval(() => {
      setTumbleFaces(data.dice.map(() => Math.floor(Math.random() * 6) + 1));
    }, 80);

    const t1 = setTimeout(() => {
      if (tickRef.current) clearInterval(tickRef.current);
      setPhase('hold');
    }, TUMBLE_MS);

    const t2 = setTimeout(() => setPhase('fade'), TUMBLE_MS + HOLD_MS);
    const t3 = setTimeout(() => onDone(), TUMBLE_MS + HOLD_MS + FADE_MS);

    timersRef.current = [t1, t2, t3];

    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
      timersRef.current.forEach(clearTimeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.key]);

  if (!data) return null;

  const facesToRender = phase === 'tumble' ? tumbleFaces : data.dice;
  const color = PLAYER_COLORS[data.colorIndex % 6];

  return (
    <div
      className={`dice-overlay-root size-${size} phase-${phase}`}
      style={{ pointerEvents: 'none' }}
    >
      <div className="dice-overlay-card" style={{ borderColor: color, boxShadow: `0 0 60px ${color}55` }}>
        <div className="dice-overlay-name" style={{ color }}>
          <span className="dice-overlay-dot" style={{ backgroundColor: color }} />
          {data.playerName}
        </div>

        <div className="dice-overlay-dice-row">
          {facesToRender.map((face, i) => (
            <Die key={i} value={face} tumbling={phase === 'tumble'} />
          ))}
        </div>

        <div className={`dice-overlay-total ${phase !== 'tumble' ? 'is-revealed' : ''}`}>
          {phase === 'tumble' ? '擲骰中…' : (
            <>
              <span className="dice-overlay-total-num">{data.total}</span>
              <span className="dice-overlay-total-label">點</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Die({ value, tumbling }: { value: number; tumbling: boolean }) {
  return (
    <div className={`die ${tumbling ? 'die-tumble' : 'die-rest'}`} data-face={value}>
      <DieFace value={value} />
    </div>
  );
}

const PIP_PATTERNS: Record<number, [number, number][]> = {
  1: [[1, 1]],
  2: [[0, 0], [2, 2]],
  3: [[0, 0], [1, 1], [2, 2]],
  4: [[0, 0], [0, 2], [2, 0], [2, 2]],
  5: [[0, 0], [0, 2], [1, 1], [2, 0], [2, 2]],
  6: [[0, 0], [0, 2], [1, 0], [1, 2], [2, 0], [2, 2]],
};

function DieFace({ value }: { value: number }) {
  const pips = PIP_PATTERNS[value] ?? [];
  return (
    <div className="die-face">
      {pips.map(([r, c], i) => (
        <span
          key={i}
          className="die-pip"
          style={{ gridRow: r + 1, gridColumn: c + 1 }}
        />
      ))}
    </div>
  );
}
