import type { PlayerAnalysis } from '../../types/game';

interface Props { analysis: PlayerAnalysis }

const fmt = (n: number) => n.toLocaleString('zh-TW', { maximumFractionDigits: 0 });
const sign = (n: number) => (n >= 0 ? '+' : '') + fmt(n);
const cls = (n: number) => n >= 0 ? 'text-emerald-400' : 'text-red-400';

const EVENT_TYPE_LABEL: Record<string, string> = {
  asset_buy: '投資', asset_sell: '出售資產', travel: '旅遊',
  marriage: '婚姻', child: '生育', crisis: '危機',
  career_change: '轉職', education: '進修', rat_race_escaped: '脫出老鼠賽跑',
};

export default function DecisionImpactCard({ analysis }: Props) {
  const { keyDecisions, summary } = analysis;

  return (
    <div className="card space-y-3">
      <h3 className="text-sm font-semibold text-gray-300">🔑 關鍵決策影響</h3>

      {/* 統計摘要 */}
      <div className="grid grid-cols-3 gap-2 text-center text-xs">
        <div className="bg-gray-800 rounded-lg p-2">
          <div className="text-lg font-bold text-blue-400">{summary.assetBuyCount}</div>
          <div className="text-gray-500">資產投資</div>
        </div>
        <div className="bg-gray-800 rounded-lg p-2">
          <div className="text-lg font-bold text-red-400">{summary.crisisCount}</div>
          <div className="text-gray-500">遭遇危機</div>
        </div>
        <div className="bg-gray-800 rounded-lg p-2">
          <div className="text-lg font-bold text-yellow-400">{summary.travelCount}</div>
          <div className="text-gray-500">出遊次數</div>
        </div>
        <div className="bg-gray-800 rounded-lg p-2">
          <div className={`text-lg font-bold ${summary.escapedRatRace ? 'text-emerald-400' : 'text-gray-500'}`}>
            {summary.escapedRatRace ? '✓' : '✗'}
          </div>
          <div className="text-gray-500">脫出老鼠賽</div>
        </div>
        <div className="bg-gray-800 rounded-lg p-2">
          <div className={`text-lg font-bold ${summary.isMarried ? 'text-pink-400' : 'text-gray-500'}`}>
            {summary.isMarried ? '💑' : '—'}
          </div>
          <div className="text-gray-500">婚姻</div>
        </div>
        <div className="bg-gray-800 rounded-lg p-2">
          <div className="text-lg font-bold text-blue-300">{summary.numberOfChildren}</div>
          <div className="text-gray-500">子女</div>
        </div>
      </div>

      {/* Top 5 決策 */}
      {keyDecisions.length > 0 && (
        <div>
          <p className="text-xs text-gray-400 mb-1">影響最大的決策（依現金流影響排序）</p>
          <div className="space-y-2">
            {keyDecisions.map((d, i) => (
              <div key={i} className="bg-gray-800 rounded-xl p-2 text-xs">
                <div className="flex justify-between items-start">
                  <div>
                    <span className="text-gray-500 mr-1">{d.age.toFixed(0)} 歲</span>
                    <span className="text-xs text-gray-400 bg-gray-700 px-1 rounded">{EVENT_TYPE_LABEL[d.type] ?? d.type}</span>
                  </div>
                  <div className="text-right">
                    <div className={`font-bold ${cls(d.cashflowDelta)}`}>
                      現金流 {sign(d.cashflowDelta)}/月
                    </div>
                    <div className={`text-xs ${cls(d.netWorthDelta)}`}>
                      淨資產 {sign(d.netWorthDelta)}
                    </div>
                  </div>
                </div>
                <p className="text-gray-300 mt-1 truncate">{d.description}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 最終財務 */}
      <div className="border-t border-gray-700 pt-2 text-xs space-y-1">
        <div className="flex justify-between">
          <span className="text-gray-400">最終淨資產</span>
          <span className={`font-bold ${cls(summary.finalNetWorth)}`}>${fmt(summary.finalNetWorth)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">最終月現金流</span>
          <span className={`font-bold ${cls(summary.finalCashflow)}`}>${fmt(summary.finalCashflow)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">最終被動收入</span>
          <span className="font-bold text-emerald-400">${fmt(summary.finalPassiveIncome)}/月</span>
        </div>
      </div>
    </div>
  );
}
