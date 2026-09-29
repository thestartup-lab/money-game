// 每輪（4 年）結束的自動發薪：大螢幕逐年跑出每位玩家的入帳，讓「這 4 年」有被活過的感覺
import { useEffect, useState } from 'react';

export interface RoundPaydayPayout {
  playerId: string;
  playerName: string;
  fromAge: number;
  toAge: number;
  years: { age: number; cash: number }[];
  total: number;
  cashAfter: number;
  taxPaid?: number;
}

interface Props {
  payouts: RoundPaydayPayout[];
  colorOf: (playerId: string) => string;
  onDone: () => void;
}

const YEAR_MS = 700;
const HOLD_MS = 5000;

const money = (n: number) => {
  const abs = Math.abs(n);
  const text = abs >= 1_000_000 ? `${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M` : abs >= 1_000 ? `${Math.round(abs / 1_000)}k` : String(Math.round(abs));
  return `${n >= 0 ? '+' : '−'}$${text}`;
};

export default function RoundPaydayBanner({ payouts, colorOf, onDone }: Props) {
  const yearCount = Math.max(1, ...payouts.map((p) => p.years.length));
  const [shown, setShown] = useState(0);

  useEffect(() => {
    if (shown < yearCount) {
      const timer = setTimeout(() => setShown((n) => n + 1), YEAR_MS);
      return () => clearTimeout(timer);
    }
    const timer = setTimeout(onDone, HOLD_MS);
    return () => clearTimeout(timer);
  }, [shown, yearCount, onDone]);

  const first = payouts[0];
  return (
    <div className="pointer-events-auto absolute bottom-4 left-1/2 z-40 w-[min(96%,1100px)] -translate-x-1/2 cursor-pointer rounded-2xl border border-emerald-600 bg-gray-950/95 p-4 shadow-2xl" onClick={onDone} role="status">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <p className="text-xl font-black text-emerald-300">💵 發薪：{first ? `${first.fromAge}–${first.toAge} 歲` : ''}這 {yearCount} 年的收支入帳</p>
        <p className="text-xs text-gray-400">點一下關閉</p>
      </div>
      <div className="space-y-1.5">
        {payouts.map((payout) => {
          const running = payout.years.slice(0, shown).reduce((sum, y) => sum + y.cash, 0);
          return (
            <div key={payout.playerId} className="grid grid-cols-[7rem_1fr_8rem] items-center gap-3">
              <span className="truncate text-lg font-bold" style={{ color: colorOf(payout.playerId) }}>{payout.playerName}</span>
              <div className="flex gap-1.5">
                {payout.years.map((year, index) => (
                  <span
                    key={year.age}
                    className={`flex-1 rounded-lg px-2 py-1 text-center text-sm transition-opacity duration-300 ${index < shown ? 'opacity-100' : 'opacity-0'} ${year.cash >= 0 ? 'bg-emerald-950 text-emerald-200' : 'bg-red-950 text-red-200'}`}
                  >
                    <span className="block text-[11px] text-gray-400">{year.age} 歲</span>
                    {money(year.cash)}
                  </span>
                ))}
              </div>
              <span className="text-right">
                <span className={`block text-xl font-black ${running >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>{money(running)}</span>
                {payout.taxPaid ? <span className="block text-[11px] text-gray-400">已扣稅 ${Math.round(payout.taxPaid / 1000)}k</span> : null}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
