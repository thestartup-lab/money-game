import { useEffect, useState } from 'react';

export interface PaydayTimerInfo {
  enabled: boolean;
  intervalMs: number;
  remainingMs: number;
  roundsSince: number;
  settlementMonths: number;
  due: boolean;
  /** 只有主持人手動暫停與發薪進行中為 true */
  frozen?: boolean;
  maxRounds?: number;
}

export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const sec = total % 60;
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

/**
 * 依伺服器給的剩餘毫秒在本地每秒倒數；只在主持人手動暫停與發薪進行中凍結（決策與舞台照常倒數）。
 * 每次伺服器送新狀態就重新對時，避免累積漂移。
 */
export function usePaydayCountdown(timer: PaydayTimerInfo | undefined, frozen: boolean): number {
  const serverRemaining = timer?.remainingMs ?? -1;
  const [remaining, setRemaining] = useState(serverRemaining);
  const [seen, setSeen] = useState(serverRemaining);
  if (serverRemaining !== seen) {
    setSeen(serverRemaining);
    setRemaining(serverRemaining);
  }
  const enabled = timer?.enabled ?? false;
  useEffect(() => {
    if (frozen || !enabled) return;
    const id = window.setInterval(() => setRemaining((r) => (r < 0 ? r : Math.max(0, r - 1000))), 1000);
    return () => window.clearInterval(id);
  }, [frozen, enabled]);
  return enabled ? remaining : -1;
}
