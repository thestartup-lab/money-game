import type { Player } from '../../types/game';

export type MoneyDetailMode = 'cash' | 'flow' | 'income' | 'expenses' | 'networth' | 'salary' | 'passive' | 'credit' | 'stats';

interface Props {
  player: Player;
  mode: MoneyDetailMode;
  onClose: () => void;
}

const fmt = (n: number) => Math.round(n).toLocaleString();
const signed = (n: number) => `${n >= 0 ? '+' : '-'}$${fmt(Math.abs(n))}`;

const TITLES: Record<MoneyDetailMode, string> = {
  cash: '手頭現金的來源', flow: '月現金流的組成', income: '月總收入的組成', expenses: '月總支出的組成',
  networth: '淨資產的組成', salary: '薪資是怎麼算的', passive: '被動收入的組成', credit: '信用評分怎麼變', stats: '能力值各代表什麼',
};

function ItemList({ items, sign, color }: { items: { label: string; amount: number; note?: string }[]; sign: '+' | '-'; color: string }) {
  return (
    <>
      {items.map((item, i) => (
        <div key={i} className="flex justify-between gap-2 py-0.5">
          <span className="min-w-0 text-gray-200">{item.label}{item.note && <span className="block text-[11px] text-gray-500">{item.note}</span>}</span>
          <span className={`shrink-0 ${color}`}>{sign}${fmt(item.amount)}</span>
        </div>
      ))}
    </>
  );
}

/** 手機點任何財務數字時彈出的明細面板 */
export default function MoneyDetailSheet({ player, mode, onClose }: Props) {
  const breakdown = player.cashflowBreakdown;
  const ledger = player.cashLedger ?? [];
  const nw = player.netWorthBreakdown;
  const info = player.actionInfo;
  const fq = player.stats.financialIQ;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70" onClick={onClose}>
      <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-t-3xl border-t-2 border-emerald-500 bg-gray-900 p-4 pb-8" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-lg font-black text-white">{TITLES[mode]}</h3>
          <button type="button" className="rounded-lg bg-gray-700 px-3 py-1 text-sm font-bold text-white" onClick={onClose}>關閉</button>
        </div>

        {(mode === 'flow' || mode === 'income' || mode === 'expenses') && breakdown && (
          <div className="space-y-3 text-sm">
            {mode !== 'expenses' && (
              <section className="rounded-xl bg-gray-800 p-3">
                <div className="mb-1 flex justify-between font-bold text-emerald-300"><span>收入</span><span>+${fmt(breakdown.totalIncome)}</span></div>
                <ItemList items={breakdown.income} sign="+" color="text-emerald-200" />
              </section>
            )}
            {mode !== 'income' && (
              <section className="rounded-xl bg-gray-800 p-3">
                <div className="mb-1 flex justify-between font-bold text-red-300"><span>支出</span><span>-${fmt(breakdown.totalExpenses)}</span></div>
                <ItemList items={breakdown.expenses} sign="-" color="text-red-200" />
              </section>
            )}
            {mode === 'flow' && (
              <div className={`flex justify-between rounded-xl border p-3 text-base font-black ${breakdown.net >= 0 ? 'border-emerald-600 text-emerald-200' : 'border-red-600 text-red-200'}`}>
                <span>每月淨現金流</span><span>{signed(breakdown.net)}</span>
              </div>
            )}
            <p className="text-[11px] text-gray-500">
              {mode === 'income' ? '收入 = 薪資（或退休金／顧問收入）＋ 被動收入 × 財商乘數（外圈再 ×2）＋ 婚姻加成 ＋ 配偶收入。'
                : mode === 'expenses' ? '支出每月從現金扣；生活支出會隨生活方式與物價變動，保費隨年齡上升，子女支出依孩子年齡分段。'
                : '每次發薪依結算月數把淨現金流加進手頭現金；被動收入會乘上財商乘數，外圈再加倍。'}
            </p>
          </div>
        )}

        {mode === 'salary' && (
          <div className="space-y-2 text-sm">
            <ol className="space-y-1 rounded-xl bg-gray-800 p-3">
              {(player.salaryItems ?? []).map((it, i) => (
                <li key={i} className="border-b border-gray-700 pb-1 last:border-0">
                  <span className="font-bold text-white">{it.label}</span>
                  {it.note && <span className="block text-[11px] text-gray-400">{it.note}</span>}
                </li>
              ))}
            </ol>
            <p className="text-[11px] text-gray-500">薪資只在發薪結算時重算；退休後改為退休金、顧問收入或創業現金流。</p>
          </div>
        )}

        {mode === 'passive' && (
          <div className="space-y-2 text-sm">
            <section className="rounded-xl bg-gray-800 p-3">
              {(player.assets ?? []).filter((a) => a.monthlyCashflow !== 0).length === 0 && <p className="text-gray-400">還沒有會產生現金流的資產。交易卡、基本投資、定期定額配息、租金都算被動收入。</p>}
              {(player.assets ?? []).filter((a) => a.monthlyCashflow !== 0).map((a) => (
                <div key={a.id} className="flex justify-between py-0.5">
                  <span className="text-gray-200">{a.name}<span className="block text-[11px] text-gray-500">市值 ${fmt(a.currentValue ?? a.cost)}</span></span>
                  <span className={a.monthlyCashflow >= 0 ? 'text-emerald-200' : 'text-red-200'}>{signed(a.monthlyCashflow)}/月</span>
                </div>
              ))}
              <div className="mt-1 flex justify-between border-t border-gray-700 pt-1 font-bold text-white"><span>資產現金流合計</span><span>${fmt(player.totalPassiveIncome)}</span></div>
              <div className="flex justify-between text-gray-300"><span>× 財商乘數（FQ {fq}）</span><span>×{info?.fqMultipliers?.[fq] ?? 1}{player.isInFastTrack ? '，外圈 ×2' : ''}</span></div>
            </section>
            <p className="text-[11px] text-gray-500">脫離內圈看的是「有效被動收入 ÷ 月支出」；玩家借貸利息與自住房不算。</p>
          </div>
        )}

        {mode === 'networth' && nw && (
          <div className="space-y-2 text-sm">
            <div className="flex justify-between rounded-xl bg-gray-800 p-3 font-bold text-yellow-200"><span>現金</span><span>${fmt(nw.cash)}</span></div>
            <section className="rounded-xl bg-gray-800 p-3">
              <div className="mb-1 flex justify-between font-bold text-emerald-300"><span>＋ 資產市值</span><span>${fmt(nw.assetTotal)}</span></div>
              {nw.assets.map((a) => (
                <div key={a.id} className="flex justify-between py-0.5">
                  <span className="text-gray-200">{a.name}<span className="block text-[11px] text-gray-500">成本 ${fmt(a.cost)}{a.debt ? `，連結負債 $${fmt(a.debt)}` : ''}{a.value !== a.cost ? `，${a.value > a.cost ? '增值' : '減值'} ${signed(a.value - a.cost)}` : ''}</span></span>
                  <span className="text-emerald-200">${fmt(a.value)}</span>
                </div>
              ))}
            </section>
            <section className="rounded-xl bg-gray-800 p-3">
              <div className="mb-1 flex justify-between font-bold text-red-300"><span>− 負債</span><span>${fmt(nw.liabilityTotal)}</span></div>
              {nw.liabilities.map((l) => (
                <div key={l.id} className="flex justify-between py-0.5">
                  <span className="text-gray-200">{l.name}<span className="block text-[11px] text-gray-500">月付 ${fmt(l.monthlyPayment)}</span></span>
                  <span className="text-red-200">${fmt(l.debt)}</span>
                </div>
              ))}
            </section>
            <div className={`flex justify-between rounded-xl border p-3 text-base font-black ${nw.total >= 0 ? 'border-emerald-600 text-emerald-200' : 'border-red-600 text-red-200'}`}><span>＝ 淨資產</span><span>${fmt(nw.total)}</span></div>
            <p className="text-[11px] text-gray-500">市值隨市場行情卡與世界事件漲跌；出售時以市值計，一般資產獲利課 20% 資本利得稅，自住房免稅。</p>
          </div>
        )}

        {mode === 'credit' && info && (
          <div className="space-y-2 text-sm">
            <div className="flex justify-between rounded-xl bg-gray-800 p-3 font-bold text-white"><span>目前信用分</span><span>{player.creditScore}</span></div>
            <section className="rounded-xl bg-gray-800 p-3 space-y-1">
              <p className="font-bold text-gray-200">信用分決定借款利率與上限</p>
              {info.loan.tiers.map((t) => (
                <div key={t.minScore} className={`flex justify-between ${player.creditScore >= t.minScore && !info.loan.tiers.some((o) => o.minScore > t.minScore && player.creditScore >= o.minScore) ? 'text-emerald-300 font-bold' : 'text-gray-400'}`}>
                  <span>≥ {t.minScore}</span><span>月利率 {(t.rate * 100).toFixed(1)}%，上限 ${fmt(t.limit)}</span>
                </div>
              ))}
            </section>
            <section className="rounded-xl bg-gray-800 p-3 space-y-1 text-gray-200">
              <p className="font-bold">怎麼變動</p>
              <p className="text-emerald-300">＋ 還款：依還款佔債務比例最多 +{info.loan.repayCredit}；還清整筆另 +{info.loan.clearCredit}</p>
              <p className="text-red-300">− 申請應急借款 {info.loan.emergencyCreditPenalty}</p>
              <p className="text-red-300">− 結算月淨現金流為負，每月 {info.loan.negativeCashflowCredit}</p>
              <p className="text-gray-400">投資槓桿借款與玩家借貸不扣信用；房貸、事業貸款、學貸不占額度。</p>
            </section>
          </div>
        )}

        {mode === 'stats' && info && (
          <div className="space-y-2 text-sm">
            <section className="rounded-xl bg-gray-800 p-3">
              <p className="font-bold text-blue-300">財商 FQ {fq}：被動收入乘數 ×{info.fqMultipliers[fq] ?? 1}</p>
              <p className="text-[11px] text-gray-400">發薪規劃可升級；FQ ≥ 7 發薪時看得到股市內幕；乘數表 {info.fqMultipliers.slice(1).map((m, i) => `${i + 1}:${m}`).join(' ')}</p>
            </section>
            <section className="rounded-xl bg-gray-800 p-3">
              <p className="font-bold text-green-300">健康 HP {player.stats.health}：每輪自然衰退 {info.hpDecayPerRound}</p>
              <p className="text-[11px] text-gray-400">≥ 70 完成人生指標「健康」且危機費用減半；&lt; {info.hpThresholds.travel} 不能旅遊；&lt; {info.hpThresholds.socialEvent} 不能聯誼；&lt; 30 危機費用 ×1.5；0 臥床。65 歲後 &lt; 60 每月醫療 +$5,000、&lt; 30 長照 +$25,000；80 歲起 HP 越低自然壽命判定機率越高。</p>
            </section>
            <section className="rounded-xl bg-gray-800 p-3">
              <p className="font-bold text-purple-300">第二專長 SK {player.stats.careerSkill}</p>
              <p className="text-[11px] text-gray-400">{info.skill.perSK ? `技能驅動職業：每 1 SK 月薪 +$${fmt(info.skill.perSK)}；` : ''}≥ {info.skill.raiseThreshold} 每輪多加薪 2%、裁員月數減半、完成人生指標「成長」；{info.skill.careerChangeThreshold} 可申請轉職；退休顧問收入 SK × 300。</p>
            </section>
            <section className="rounded-xl bg-gray-800 p-3">
              <p className="font-bold text-yellow-300">人脈 NT {player.stats.network}</p>
              <p className="text-[11px] text-gray-400">{info.network.perNT ? `人脈驅動職業：每 1 NT 月薪 +$${fmt(info.network.perNT)}；` : ''}≥ {info.network.shieldNT} 一次人脈護盾免除危機；≥ {info.network.dealPickNT} 交易抽 2 張擇一、父母事件親友分攤減半、退休創業擲骰 +1；退休顧問收入 NT × 3,000；每 2 輪自然 +1。</p>
            </section>
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
