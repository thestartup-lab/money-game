import { useEffect, useRef, useState } from 'react';
import './TurnIntroOverlay.css';

export interface TurnIntroData {
  key: number;
  playerId: string;
  playerName: string;
  professionName?: string;
  colorIndex: number;
  eyebrow?: string;
  launchText?: string;
}

interface Props {
  data: TurnIntroData | null;
  onDone: () => void;
}

const PLAYER_COLORS = ['#fbbf24', '#60a5fa', '#f472b6', '#34d399', '#a78bfa', '#fb923c'];
const ANNOUNCE_MS = 3_200;
const EXIT_MS = 450;

export default function TurnIntroOverlay({ data, onDone }: Props) {
  const [leaving, setLeaving] = useState(false);
  const onDoneRef = useRef(onDone);

  useEffect(() => {
    onDoneRef.current = onDone;
  }, [onDone]);

  useEffect(() => {
    if (!data) return;

    const leaveTimer = window.setTimeout(() => setLeaving(true), ANNOUNCE_MS - EXIT_MS);
    const doneTimer = window.setTimeout(() => onDoneRef.current(), ANNOUNCE_MS);

    return () => {
      window.clearTimeout(leaveTimer);
      window.clearTimeout(doneTimer);
    };
  }, [data]);

  if (!data) return null;

  const color = PLAYER_COLORS[data.colorIndex % PLAYER_COLORS.length];

  return (
    <div
      className={`turn-intro-overlay${leaving ? ' is-leaving' : ''}`}
      style={{ '--turn-color': color } as React.CSSProperties}
      aria-live="assertive"
      aria-label={`輪到 ${data.playerName}${data.launchText ?? '的人生啟動了'}`}
    >
      <div className="turn-intro-glow" />
      <div className="turn-intro-content">
        <p className="turn-intro-eyebrow">{data.eyebrow ?? '下一段人生'}</p>
        <p className="turn-intro-prefix">輪到</p>
        <h2 className="turn-intro-name">{data.playerName}</h2>
        <p className="turn-intro-launch">{data.launchText ?? '的人生啟動了'}</p>
        {data.professionName ? (
          <p className="turn-intro-profession">{data.professionName}</p>
        ) : null}
      </div>
      <div className="turn-intro-progress" />
    </div>
  );
}
