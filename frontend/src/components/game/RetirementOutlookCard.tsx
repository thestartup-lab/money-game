// 退休準備度：55 歲起提醒「65 歲退休後每月夠不夠用」，還來得及準備
import type { Player } from '../../types/game';

const money = (n: number) => `$${Math.round(Math.abs(n)).toLocaleString('zh-TW')}`;

export default function RetirementOutlookCard({ player }: { player: Player }) {
  const o = player.retirementOutlook;
  if (!o) return null;
  const ok = o.gap >= 0;
  return (
    <div className={`mx-4 my-2 rounded-2xl border p-4 ${ok ? 'border-emerald-700 bg-emerald-950/40' : 'border-amber-600 bg-amber-950/40'}`}>
      <p className={`text-base font-black ${ok ? 'text-emerald-200' : 'text-amber-200'}`}>🧓 退休準備度（{o.age} 歲）</p>
      <p className="mt-1 text-xs text-gray-400">用你現在的數字估算 65 歲退休後的每月收支。退休後少了勞健保，生活支出降兩成。</p>
      <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
        <span className="text-gray-300">退休金</span><span className="text-right text-white">{money(o.pension)}</span>
        <span className="text-gray-300">被動收入（含財商）</span><span className="text-right text-white">{money(o.passive)}</span>
        {o.spouse > 0 && (<><span className="text-gray-300">配偶收入</span><span className="text-right text-white">{money(o.spouse)}</span></>)}
        <span className="text-gray-300">退休後支出</span><span className="text-right text-white">−{money(o.expensesAfter)}</span>
        <span className={`font-bold ${ok ? 'text-emerald-300' : 'text-amber-300'}`}>每月{ok ? '結餘' : '缺口'}</span>
        <span className={`text-right font-black ${ok ? 'text-emerald-300' : 'text-amber-300'}`}>{ok ? '+' : '−'}{money(o.gap)}</span>
      </div>
      {!ok && (
        <p className="mt-2 text-xs leading-relaxed text-amber-100">
          目前存款大約撐 {o.yearsCovered ?? 0} 年。想補上缺口，退休前要再多約 {money(o.passiveNeeded)} 的每月被動收入；
          也可以考慮當顧問、延後退休，或把生活方式改成節儉。
        </p>
      )}
    </div>
  );
}
