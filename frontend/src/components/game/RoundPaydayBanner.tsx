import { useEffect, useState } from 'react';

export interface RoundPaydayPayout {
  playerId: string; playerName: string; fromAge: number; toAge: number;
  years: { age: number; cash: number }[];
  total: number; cashBefore: number; cashAfter: number; taxSaved: number;
  ledger: Record<string, number>;
}
const money = (n: number) => `${n < 0 ? '−' : ''}$${Math.round(Math.abs(n)).toLocaleString()}`;
export default function RoundPaydayBanner({ payouts }: { payouts: RoundPaydayPayout[] }) {
  const yearCount = Math.max(1, ...payouts.map(p => p.years.length));
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (shown >= yearCount) return;
    const timer = setTimeout(() => setShown(n => n + 1), 700);
    return () => clearTimeout(timer);
  }, [shown, yearCount]);
  return <div className="max-h-[55vh] overflow-y-auto text-left">
    <div className="grid gap-4 lg:grid-cols-2">
      {payouts.map(p => <article key={p.playerId} className="rounded-xl border border-slate-500 bg-slate-900 p-4 text-lg">
        <h3 className="text-2xl font-black text-yellow-200">{p.playerName} · {p.fromAge}–{p.toAge} 歲</h3>
        <div className="my-3 flex flex-wrap gap-2" aria-label="逐年收支動畫">
          {p.years.map((y, i) => <span key={i} className={`rounded bg-slate-800 p-2 transition-opacity ${i < shown ? 'opacity-100' : 'opacity-0'}`}>{y.age} 歲：{money(y.cash)}</span>)}
        </div>
        <dl className="space-y-1">
          <div className="flex justify-between gap-3"><dt>期初現金</dt><dd>{money(p.cashBefore)}</dd></div>
          {Object.entries(p.ledger).map(([label, amount]) => <div key={label} className="flex justify-between gap-3"><dt>{label}</dt><dd className={`shrink-0 tabular-nums ${amount < 0 ? 'text-red-200' : 'text-emerald-200'}`}>{amount > 0 ? '+' : ''}{money(amount)}</dd></div>)}
          <div className="flex justify-between gap-3 border-t border-slate-500 pt-2 font-bold"><dt>本輪現金淨變化</dt><dd>{p.total > 0 ? '+' : ''}{money(p.total)}</dd></div>
          <div className="flex justify-between gap-3 text-xl font-black text-yellow-200"><dt>期末現金</dt><dd>{money(p.cashAfter)}</dd></div>
        </dl>
        {p.taxSaved > 0 ? <p className="mt-2">稅務規劃省下 {money(p.taxSaved)}（已反映於稅額，不重複加總）</p> : null}
      </article>)}
    </div>
    <p className="mt-3 text-base text-slate-300">被動收入為扣除投資內含成本後的淨額；資產出售與借款增加現金，不等於獲利。資產未實現漲跌不列入現金收支。</p>
  </div>;
}
