import { useEffect, useState } from 'react';

interface Props {
  reminderEndsAt: number;
  className?: string;
  showWaitingText?: boolean;
}

function getRemainingSeconds(reminderEndsAt: number): number {
  return Math.max(0, Math.ceil((reminderEndsAt - Date.now()) / 1000));
}

export default function DecisionCountdown({ reminderEndsAt, className = '', showWaitingText = true }: Props) {
  const [secondsLeft, setSecondsLeft] = useState(() => getRemainingSeconds(reminderEndsAt));

  useEffect(() => {
    const update = () => setSecondsLeft(getRemainingSeconds(reminderEndsAt));
    const timer = window.setInterval(update, 250);
    return () => window.clearInterval(timer);
  }, [reminderEndsAt]);

  if (secondsLeft <= 0) {
    return (
      <span className={className}>
        {showWaitingText ? '時間到 · 等待主持人' : '00:00'}
      </span>
    );
  }

  const minutes = Math.floor(secondsLeft / 60).toString().padStart(2, '0');
  const seconds = (secondsLeft % 60).toString().padStart(2, '0');
  return <span className={className}>{minutes}:{seconds}</span>;
}
