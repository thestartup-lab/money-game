import type { Player } from '../../types/game';

interface Props {
  player: Player;
  mode: 'cash' | 'flow';
  onClose: () => void;
}

const fmt = (n: number) => Math.round(n).toLocaleString();
const signed = (n: number) => `${n >= 0 ? '+' : '-'}$${fmt(Math.abs(n))}`;

/** 手機點「手頭現金」或「月現金流」時彈出的明細面板 */
export default function MoneyDetailSheet({ player, mode, onClose }: Props) {
  const breakdown = player.cashflowBreakdown;
  const ledger = player.cashLedger ?? [];
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70" onClick={onClose}>
      <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-t-3xl border-t-2 border-emerald-500 bg-gray-900 p-4 pb-8" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-lg font-black text-white">{mode === 'cash' ? '手頭現金的來源' : '月現金流的組成'}</h3>
          <button type="button" className="rounded-lg bg-gray-700 px-3 py-1 text-sm font-bold text-white" onClick={onClose}>關閉</button>
        </div>

        {mode === 'flow' && breakdown && (
          <div className="space-y-3 text-sm">
            <section className="rounded-xl bg-gray-800 p-3">
              <div className="mb-1 flex justify-between font-bold text-emerald-300"><span>收入</span><span>+${fmt(breakdown.totalIncome)}</span></div>
              {breakdown.income.map((item, i) => (
                <div key={i} className="flex justify-between gap-2 py-0.5">
                  <span className="min-w-0 text-gray-200">{item.label}{item.note && <span className="block text-[11px] text-gray-500">{item.note}</span>}</span>
                  <span className="shrink-0 text-emerald-200">+${fmt(item.amount)}</span>
                </div>
              ))}
            </section>
            <section className="rounded-xl bg-gray-800 p-3">
              <div className="mb-1 flex justify-between font-bold text-red-300"><span>支出</span><span>-${fmt(breakdown.totalExpenses)}</span></div>
              {breakdown.expenses.map((item, i) => (
                <div key={i} className="flex justify-between gap-2 py-0.5">
                  <span className="min-w-0 text-gray-200">{item.label}{item.note && <span className="block text-[11px] text-gray-500">{item.note}</span>}</span>
                  <span className="shrink-0 text-red-200">-${fmt(item.amount)}</span>
                </div>
              ))}
            </section>
            <div className={`flex justify-between rounded-xl border p-3 text-base font-black ${breakdown.net >= 0 ? 'border-emerald-600 text-emerald-200' : 'border-red-600 text-red-200'}`}>
              <span>每月淨現金流</span><span>{signed(breakdown.net)}</span>
            </div>
            <p className="text-[11px] text-gray-500">每次季度發薪依結算月數把淨現金流加進手頭現金；被動收入會乘上財商乘數，外圈再加倍。</p>
          </div>
        )}

        {mode === 'cash' && (
          <div className="space-y-2 text-sm">
            <div className="flex justify-between rounded-xl border border-yellow-600 p-3 text-base font-black text-yellow-200">
              <span>目前現金</span><span>${fmt(player.cash)}</span>
            </div>
            {ledger.length === 0 ? (
              <p className="text-gray-400">還沒有現金變動紀錄。起始現金來自職業起始資金、社會階層加成與資源點數。</p>
            ) : (
              <ul className="divide-y divide-gray-800 rounded-xl bg-gray-800">
                {ledger.map((entry, i) => (
                  <li key={i} className="flex items-start justify-between gap-2 px-3 py-2">
                    <span className="min-w-0 text-gray-200">
                      <span className="mr-1 text-[11px] text-gray-500">{Math.round(entry.age)} 歲</span>{entry.description}
                      <span className="block text-[11px] text-gray-500">結餘 ${fmt(entry.cashAfter)}</span>
                    </span>
                    <span className={`shrink-0 font-bold ${entry.delta >= 0 ? 'text-emerald-200' : 'text-red-200'}`}>{signed(entry.delta)}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-[11px] text-gray-500">顯示最近 20 筆有金額變動的事件，最新在上。</p>
          </div>
        )}
      </div>
    </div>
  );
}
