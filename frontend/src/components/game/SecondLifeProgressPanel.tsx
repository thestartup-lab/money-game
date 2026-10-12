import type { SecondLifeProgress } from '../../types/game';

export default function SecondLifeProgressPanel({ progress: p }: { progress: SecondLifeProgress }) {
  return <div className="space-y-4 text-lg text-gray-100">
    <p>走過「24 第二人生」，並符合以下其中一條資格：</p>
    {Object.values(p.routes).map(r => <div key={r.label} className="rounded-xl border border-gray-600 bg-gray-800 p-3">
      <p className="font-bold text-white">{r.label}</p>
      <p>有效被動收入至少覆蓋支出 {Math.round(r.coverageRequired * 100)}%，且達成 {r.indicatorsRequired} 項人生指標。</p>
    </div>)}
    <p>人生指標：{p.indicators.map(i => `${i.label} ${i.threshold}`).join('、')}。關係指標也可透過婚姻達成。</p>
    <p>有效被動收入只計資產現金流 × 財商倍率；薪資及玩家間借貸利息不計入。</p>
    {p.stableRounds !== undefined && <p>需在連續兩輪完整結算後符合資格。目前連續達標：{p.stableRounds}／2 輪。</p>}
    <p>{p.passedCell ? '✓ 已走過第二人生格' : '尚未走過第二人生格'}；{p.seasoned ? '已達最低結算月數' : `最低結算月數 ${p.paydayCount}／${p.minPaydays}`}。</p>
    <p className="font-bold text-emerald-200">{p.eligible ? '資格已達成，等待主持人揭曉。' : '資格會在完整結算後確認；達成後無須再繞一圈。'}</p>
  </div>;
}
