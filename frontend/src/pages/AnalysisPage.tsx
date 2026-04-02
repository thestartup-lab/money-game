import type { PlayerAnalysis } from '../types/game';
import LifeTimeline from '../components/analysis/LifeTimeline';
import FinalScoreRadar from '../components/analysis/FinalScoreRadar';
import DecisionImpactCard from '../components/analysis/DecisionImpactCard';

interface Props { analysis: PlayerAnalysis }

const EVENT_ICONS: Record<string, string> = {
  asset_buy: '🏠', asset_sell: '💰', travel: '✈️',
  marriage: '💑', child: '👶', crisis: '⚠️',
  career_change: '🔄', education: '🎓', rat_race_escaped: '🚀',
  payday: '💵', loan_taken: '🏦', bedridden: '🛏', death: '⚰️',
};

export default function AnalysisPage({ analysis }: Props) {
  const isAlive = analysis.deathAge >= 99;

  return (
    <div className="space-y-4 pb-8">
      {/* 頭部總覽 */}
      <div className="card text-center space-y-1">
        <h2 className="text-xl font-bold text-white">{analysis.playerName} 的人生</h2>
        <p className="text-gray-400 text-sm">
          {analysis.profession}（{analysis.quadrant} 象限） •
          {isAlive ? ' 活到百歲 🎉' : ` ${analysis.deathAge} 歲離世`}
        </p>
        <div className="flex justify-center gap-4 text-sm mt-2">
          {analysis.isMarried && <span className="text-pink-300">💑 已婚</span>}
          {analysis.numberOfChildren > 0 && <span className="text-blue-300">👶 {analysis.numberOfChildren} 子女</span>}
          <span className="text-amber-300">✨ 體驗值 {analysis.lifeExperience}</span>
        </div>
        <div className="text-3xl font-bold text-emerald-400 mt-2">{Math.round(analysis.finalScore.total)} 分</div>
      </div>

      {/* 人生時間軸 */}
      <LifeTimeline eventLog={analysis.eventLog} playerName={analysis.playerName} />

      {/* 評分雷達圖 */}
      <FinalScoreRadar score={analysis.finalScore} playerName={analysis.playerName} />

      {/* 決策影響分析 */}
      <DecisionImpactCard analysis={analysis} />

      {/* 完整事件日誌 */}
      <div className="card">
        <h3 className="text-sm font-semibold text-gray-300 mb-2">📜 完整人生紀錄</h3>
        <div className="space-y-1 max-h-80 overflow-y-auto">
          {[...analysis.eventLog].reverse().map((e, i) => (
            <div key={i} className="flex items-start gap-2 text-xs py-1 border-b border-gray-800">
              <span className="text-gray-500 w-10 shrink-0">{e.age.toFixed(0)}歲</span>
              <span className="text-base shrink-0">{EVENT_ICONS[e.type] ?? '•'}</span>
              <span className="text-gray-300">{e.description}</span>
              <span className={`ml-auto shrink-0 font-mono ${(e.cashflowAfter - e.cashflowBefore) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {e.cashflowAfter - e.cashflowBefore !== 0
                  ? `${e.cashflowAfter - e.cashflowBefore > 0 ? '+' : ''}${(e.cashflowAfter - e.cashflowBefore).toLocaleString()}/月`
                  : ''}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* 反思問題（講師引導用） */}
      <div className="card bg-indigo-950 border-indigo-800">
        <h3 className="text-sm font-semibold text-indigo-300 mb-2">💭 反思時間</h3>
        <ul className="space-y-2 text-xs text-indigo-200">
          <li>• 你最後悔沒做的財務決策是什麼？</li>
          <li>• 如果重來，你會在幾歲開始投資資產？</li>
          <li>• 你的危機是否因保險而減輕了損失？</li>
          <li>• 旅遊和工作，你找到了平衡嗎？</li>
          <li>• 你的傳承分（{Math.round(analysis.finalScore.legacyScore ?? 50)}分）反映了什麼？</li>
        </ul>
      </div>
    </div>
  );
}
