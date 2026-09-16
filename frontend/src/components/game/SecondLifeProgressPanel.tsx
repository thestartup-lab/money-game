import type { SecondLifeProgress, SecondLifeRouteProgress } from '../../types/game';

const fmt = (n: number) => n.toLocaleString('zh-TW', { maximumFractionDigits: 0 });
const INDICATOR_EMOJI: Record<string, string> = { health: '❤️', growth: '📚', relationship: '💞', experience: '🌍' };
const INDICATOR_HINT: Record<string, string> = {
  health: '發薪時投資健康（+20）、旅遊、取消壞習慣',
  growth: '發薪時進修培訓（SK +20）',
  relationship: '聯誼累積 DRS，或結婚',
  experience: '旅遊、生小孩、慈善、人生事件都會累積',
};

interface Props { progress: SecondLifeProgress }

function RouteCard({ r, best }: { r: SecondLifeRouteProgress; best: boolean }) {
  const fin = r.financialMet;
  const ind = r.indicatorsMet;
  return (
    <div className={`rounded-xl border p-3 ${r.met ? 'border-emerald-500 bg-emerald-950/50' : best ? 'border-amber-500 bg-amber-950/30' : 'border-gray-700 bg-gray-800'}`}>
      <div className="flex items-center justify-between">
        <span className="text-base font-bold text-white">{r.label}</span>
        <span className={`text-xs font-bold ${r.met ? 'text-emerald-300' : best ? 'text-amber-300' : 'text-gray-400'}`}>{r.met ? '✅ 已達成' : best ? '⭐ 最接近' : ''}</span>
      </div>
      <p className="mt-1 text-xs text-gray-400">被動收入 ≥ 支出 × {Math.round(r.coverageRequired * 100)}%，人生指標 ≥ {r.indicatorsRequired} 項</p>
      <ul className="mt-2 space-y-1 text-sm">
        <li className={fin ? 'text-emerald-300' : 'text-gray-100'}>
          {fin ? '✓ 被動收入已達標' : <>✗ 有效被動收入還差 <b className="text-amber-300">${fmt(r.effectivePassiveGap)}</b>／月{r.rawPassiveGap !== r.effectivePassiveGap && <span className="text-gray-400">（實際要多買到月現金流 +${fmt(r.rawPassiveGap)} 的資產）</span>}</>}
        </li>
        <li className={ind ? 'text-emerald-300' : 'text-gray-100'}>
          {ind ? '✓ 人生指標已達標' : <>✗ 人生指標還差 <b className="text-amber-300">{r.indicatorGap}</b> 項</>}
        </li>
      </ul>
    </div>
  );
}

export default function SecondLifeProgressPanel({ progress: pg }: Props) {
  const pct = Math.min(150, Math.round(pg.coverageRatio * 100));
  const barPct = Math.min(100, pct / 1.0);
  const fb = pg.routes.financialBreakthrough;
  const bl = pg.routes.balancedLife;
  // 「最接近」：先看是否只差錢；都差錢時比較缺口金額，加上指標缺口的權重
  const score = (r: SecondLifeRouteProgress) => r.effectivePassiveGap + r.indicatorGap * Math.max(3000, pg.totalExpenses * 0.15);
  const best = pg.eligible ? null : (score(bl) <= score(fb) ? 'balancedLife' : 'financialBreakthrough');
  const pending = pg.indicators.filter((i) => !i.achieved).sort((a, b) => a.gap / a.threshold - b.gap / b.threshold);
  const prereqMissing = !pg.passedCell || !pg.seasoned;

  return (
    <div className="space-y-3 text-gray-100">
      {pg.eligible && (
        <p className="rounded-xl bg-emerald-900/60 px-3 py-2 text-sm font-bold text-emerald-200">🎉 已達成「{pg.route === 'balancedLife' ? '平衡人生' : '財務突破'}」資格，等主持人在大螢幕揭曉就進外圈。</p>
      )}

      {/* 覆蓋率進度條 */}
      <div>
        <div className="flex items-end justify-between">
          <span className="text-sm text-gray-300">被動收入覆蓋支出</span>
          <span className={`text-2xl font-black ${pct >= 100 ? 'text-emerald-300' : pct >= 75 ? 'text-amber-300' : 'text-white'}`}>{pct}%</span>
        </div>
        <div className="relative mt-1 h-4 w-full overflow-hidden rounded-full bg-gray-700">
          <div className={`h-full ${pct >= 100 ? 'bg-emerald-500' : pct >= 75 ? 'bg-amber-500' : 'bg-blue-500'}`} style={{ width: `${barPct}%` }} />
          <div className="absolute inset-y-0 w-0.5 bg-white/70" style={{ left: '75%' }} title="平衡人生 75%" />
        </div>
        <div className="mt-0.5 flex justify-between text-[10px] text-gray-400"><span>0%</span><span>75% 平衡人生</span><span>100% 財務突破</span></div>
        <p className="mt-2 text-sm text-gray-200">
          有效被動收入 <b className="text-white">${fmt(pg.effectivePassiveIncome)}</b>／月
          <span className="text-gray-400">（被動 ${fmt(pg.rawPassiveIncome)} × 財商 {pg.fqMultiplier}）</span>
          ，月總支出 <b className="text-white">${fmt(pg.totalExpenses)}</b>
        </p>
      </div>

      {/* 兩條路徑 */}
      <div className="space-y-2">
        <RouteCard r={bl} best={best === 'balancedLife'} />
        <RouteCard r={fb} best={best === 'financialBreakthrough'} />
      </div>

      {/* 四項人生指標 */}
      <div>
        <p className="text-sm font-bold text-gray-300">人生指標（已完成 {pg.achievedIndicatorCount}／4）</p>
        <div className="mt-1 grid grid-cols-2 gap-2">
          {pg.indicators.map((i) => (
            <div key={i.key} className={`rounded-lg border px-2 py-1.5 ${i.achieved ? 'border-emerald-700 bg-emerald-950/40' : 'border-gray-700 bg-gray-800'}`}>
              <div className="flex items-center justify-between text-sm">
                <span>{INDICATOR_EMOJI[i.key]} {i.label}</span>
                <span className={`font-bold ${i.achieved ? 'text-emerald-300' : 'text-white'}`}>{i.value}／{i.threshold}</span>
              </div>
              <p className="text-[11px] text-gray-400">{i.achieved ? '✓ 達成' : `還差 ${i.gap}｜${INDICATOR_HINT[i.key]}`}</p>
            </div>
          ))}
        </div>
      </div>

      {/* 前置條件 */}
      <div className={`rounded-lg px-3 py-2 text-sm ${prereqMissing ? 'bg-gray-800' : 'bg-gray-800/60 text-gray-400'}`}>
        <p className={pg.passedCell ? 'text-emerald-300' : 'text-gray-100'}>{pg.passedCell ? '✓' : '✗'} 走過「第二人生」格{!pg.passedCell && <span className="text-gray-400">（繞到第 23 格就解鎖）</span>}</p>
        <p className={pg.seasoned ? 'text-emerald-300' : 'text-gray-100'}>{pg.seasoned ? '✓' : '✗'} 結算月數 {pg.paydayCount}／{pg.minPaydays}{!pg.seasoned && <span className="text-gray-400">（至少經歷一次發薪）</span>}</p>
      </div>

      {/* 下一步建議 */}
      {!pg.eligible && best && (() => {
        const r = pg.routes[best];
        const steps: string[] = [];
        if (!r.financialMet) steps.push(`多買到月現金流 +$${fmt(r.rawPassiveGap)} 的資產（交易卡、基本投資、定期定額配息、租金）`);
        if (!r.indicatorsMet) steps.push(`再完成 ${r.indicatorGap} 項指標，最接近的是：${pending.slice(0, r.indicatorGap).map((i) => `${i.label}（差 ${i.gap}）`).join('、')}`);
        if (!pg.passedCell) steps.push('先繞到「第二人生」格');
        if (!pg.seasoned) steps.push('等下一次發薪結算');
        return (
          <div className="rounded-xl border border-amber-700 bg-amber-950/30 p-3">
            <p className="text-sm font-bold text-amber-200">🧭 最短路徑：{r.label}</p>
            <ol className="mt-1 list-decimal space-y-1 pl-5 text-sm text-gray-100">{steps.map((t, i) => <li key={i}>{t}</li>)}</ol>
            <p className="mt-1 text-[11px] text-gray-400">被動收入只算資產現金流，薪水與玩家借貸利息不算；升財商可放大有效被動收入。</p>
          </div>
        );
      })()}
    </div>
  );
}
