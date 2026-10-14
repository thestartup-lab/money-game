import type { SecondLifeProgress } from '../../types/game';

const money = (value: number) => `$${Math.ceil(value).toLocaleString('zh-TW')}`;

export default function SecondLifeProgressPanel({ progress: p }: { progress: SecondLifeProgress }) {
  return <div className="space-y-4 text-lg text-gray-100">
    <div className="rounded-xl border-2 border-blue-400 bg-slate-900 p-3">
      <h3 className="font-bold text-white">目前進度</h3>
      <p>有效被動收入：{money(p.effectivePassiveIncome)}／月</p>
      <p>目前支出：{money(p.totalExpenses)}／月</p>
      <p>人生指標：已達成 {p.achievedIndicatorCount}／{p.indicators.length} 項</p>
    </div>
    <p>以下兩條路線擇一達成即可，不用兩條都完成。缺口依目前收入與支出計算：</p>
    {Object.values(p.routes).map(r => <div key={r.label} className="rounded-xl border border-gray-600 bg-gray-800 p-3">
      <h3 className="font-bold text-white">{r.label}{r.met ? ' ✓ 本路線條件已達標' : ''}</h3>
      <p>財務目標：{money(r.targetEffectivePassiveIncome)}／月（支出的 {Math.round(r.coverageRequired * 100)}%）</p>
      <p className={`font-bold ${r.financialMet ? 'text-emerald-200' : 'text-yellow-200'}`}>
        {r.financialMet ? '✓ 財務已達標' : `還差有效被動收入 ${money(r.effectivePassiveGap)}／月`}
      </p>
      {!r.financialMet && <p className="text-sm text-gray-300">以目前財商倍率換算，約需再增加資產月現金流 {money(r.rawPassiveGap)}。</p>}
      <p className={`font-bold ${r.indicatorsMet ? 'text-emerald-200' : 'text-yellow-200'}`}>
        {r.indicatorsMet ? `✓ 人生指標已達標（需要 ${r.indicatorsRequired} 項）` : `人生指標還差 ${r.indicatorGap} 項（目前 ${p.achievedIndicatorCount}／需要 ${r.indicatorsRequired} 項）`}
      </p>
    </div>)}
    <div className="rounded-xl border border-gray-600 bg-gray-800 p-3 space-y-2">
      <h3 className="font-bold text-white">各項人生指標還差多少</h3>
      {p.indicators.map(i => <div key={i.key} className="border-t border-gray-600 pt-2">
        <p>{i.label}：目前 {i.value}／門檻 {i.threshold}</p>
        <p className={`font-bold ${i.achieved ? 'text-emerald-200' : 'text-yellow-200'}`}>
          {i.achieved ? `✓ 已達標${i.key === 'relationship' && i.value < i.threshold ? '（婚姻條件達成）' : ''}` : `還差 ${i.gap} 點`}
        </p>
      </div>)}
      <p className="text-sm text-gray-300">關係指標也可透過婚姻達成；不需要所有人生指標都達標。</p>
    </div>
    <div className="rounded-xl border border-gray-600 bg-gray-800 p-3 space-y-2">
      <h3 className="font-bold text-white">共同必要條件</h3>
      <p>{p.passedCell ? '✓ 已走過「24 第二人生」格' : '尚需走過「24 第二人生」格'}</p>
      <p>{p.seasoned ? '✓ 已達最低結算月數' : `結算月數 ${p.paydayCount}／${p.minPaydays}，還差 ${Math.max(0, p.minPaydays - p.paydayCount)} 個月（不是回合數）`}</p>
      {p.stableRounds !== undefined && <p>{p.stableRounds >= 2 ? '✓ 已連續兩輪達標' : `連續達標 ${p.stableRounds}／2 輪，還需連續 ${Math.max(0, 2 - p.stableRounds)} 輪完整結算達標。`}</p>}
    </div>
    <p>有效被動收入只計資產現金流 × 財商倍率；薪資及玩家間借貸利息不計入。</p>
    <p className="font-bold text-emerald-200">{p.eligible ? '資格已達成，等待主持人揭曉。' : '資格會在完整結算後確認；達成後無須再繞一圈。'}</p>
  </div>;
}
