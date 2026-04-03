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

const GRADE_CONFIG: Record<string, { label: string; color: string; bg: string; border: string }> = {
  S: { label: '百歲智者', color: 'text-yellow-300', bg: 'bg-yellow-950',  border: 'border-yellow-600' },
  A: { label: '人生贏家', color: 'text-emerald-300', bg: 'bg-emerald-950', border: 'border-emerald-600' },
  B: { label: '穩健前行', color: 'text-blue-300',    bg: 'bg-blue-950',    border: 'border-blue-600' },
  C: { label: '努力學習', color: 'text-orange-300',  bg: 'bg-orange-950',  border: 'border-orange-700' },
  D: { label: '重來一次', color: 'text-red-300',     bg: 'bg-red-950',     border: 'border-red-700' },
};

const ACHIEVEMENT_CONFIG: Record<string, { icon: string; category: string }> = {
  '財務自由':   { icon: '🚀', category: '人生成就' },
  '百歲人瑞':   { icon: '🎂', category: '生命體驗' },
  '世界旅人':   { icon: '🌍', category: '生命體驗' },
  '家庭至上':   { icon: '👨‍👩‍👧', category: '人際關係' },
  '鐵打身體':   { icon: '💪', category: '生命體驗' },
  '智慧投資':   { icon: '📈', category: '人生成就' },
  '被動收入王': { icon: '💎', category: '人生成就' },
  '無債一身輕': { icon: '🕊', category: '人生成就' },
  '傳承者':     { icon: '🏛', category: '人生成就' },
  '人脈大師':   { icon: '🤝', category: '人際關係' },
};
const ALL_ACHIEVEMENTS = Object.keys(ACHIEVEMENT_CONFIG);

function IndexBar({ label, icon, value, color }: { label: string; icon: string; value: number; color: string }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-gray-400">{icon} {label}</span>
        <span className={`font-bold ${color}`}>{value}</span>
      </div>
      <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${color.replace('text-', 'bg-')}`}
          style={{ width: `${value}%` }}
        />
      </div>
    </div>
  );
}

export default function AnalysisPage({ analysis }: Props) {
  const isAlive = analysis.deathAge >= 99;
  const score = analysis.finalScore;
  const grade = score.grade ?? 'C';
  const gradeConf = GRADE_CONFIG[grade] ?? GRADE_CONFIG.C;
  const earned = new Set(score.achievements ?? []);

  return (
    <div className="space-y-4 pb-8">
      {/* 頭部總覽 + 等級 */}
      <div className="card text-center space-y-2">
        <h2 className="text-xl font-bold text-white">{analysis.playerName} 的人生</h2>
        <p className="text-gray-400 text-sm">
          {analysis.profession}（{analysis.quadrant} 象限） •
          {isAlive ? ' 活到百歲 🎉' : ` ${analysis.deathAge} 歲離世`}
        </p>
        <div className="flex justify-center gap-4 text-sm">
          {analysis.isMarried && <span className="text-pink-300">💑 已婚</span>}
          {analysis.numberOfChildren > 0 && <span className="text-blue-300">👶 {analysis.numberOfChildren} 子女</span>}
          <span className="text-amber-300">✨ 體驗值 {analysis.lifeExperience}</span>
        </div>

        {/* 等級徽章 */}
        <div className={`inline-flex flex-col items-center gap-1 px-6 py-3 rounded-2xl border ${gradeConf.bg} ${gradeConf.border} mx-auto`}>
          <span className={`text-5xl font-black ${gradeConf.color}`}>{grade}</span>
          <span className={`text-sm font-bold ${gradeConf.color}`}>{gradeConf.label}</span>
        </div>

        {/* 幸福總分 */}
        <div className="text-3xl font-bold text-emerald-400">{Math.round(score.total)} <span className="text-base text-gray-400 font-normal">幸福總分</span></div>
      </div>

      {/* 三大幸福指數 */}
      <div className="card space-y-3">
        <h3 className="text-sm font-semibold text-gray-300">🌟 三大幸福指數</h3>
        <div className="grid grid-cols-3 gap-3 mb-2">
          {[
            { label: '生命體驗', value: score.lifeExperienceIndex ?? 0, icon: '🌱', color: 'text-teal-400', weight: '40%' },
            { label: '人生成就', value: score.achievementIndex ?? 0,    icon: '🏆', color: 'text-amber-400', weight: '30%' },
            { label: '人際關係', value: score.relationshipIndex ?? 0,   icon: '💞', color: 'text-pink-400',  weight: '30%' },
          ].map(({ label, value, icon, color, weight }) => (
            <div key={label} className="text-center bg-gray-800 rounded-xl p-3 space-y-1">
              <div className="text-xl">{icon}</div>
              <div className={`text-2xl font-black ${color}`}>{value}</div>
              <div className="text-xs text-gray-400">{label}</div>
              <div className="text-xs text-gray-600">權重 {weight}</div>
            </div>
          ))}
        </div>
        <div className="space-y-2">
          <IndexBar label="生命體驗指數" icon="🌱" value={score.lifeExperienceIndex ?? 0} color="text-teal-400" />
          <IndexBar label="人生成就指數" icon="🏆" value={score.achievementIndex ?? 0}    color="text-amber-400" />
          <IndexBar label="人際關係指數" icon="💞" value={score.relationshipIndex ?? 0}   color="text-pink-400" />
        </div>
      </div>

      {/* 成就徽章 */}
      <div className="card">
        <h3 className="text-sm font-semibold text-gray-300 mb-3">🏅 人生成就徽章 ({earned.size}/{ALL_ACHIEVEMENTS.length})</h3>
        <div className="grid grid-cols-2 gap-2">
          {ALL_ACHIEVEMENTS.map((name) => {
            const conf = ACHIEVEMENT_CONFIG[name];
            const got = earned.has(name);
            return (
              <div
                key={name}
                className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-sm ${
                  got
                    ? 'bg-emerald-950 border-emerald-700 text-emerald-200'
                    : 'bg-gray-900 border-gray-800 text-gray-600'
                }`}
              >
                <span className={`text-lg ${got ? '' : 'grayscale opacity-30'}`}>{conf.icon}</span>
                <div>
                  <div className="font-semibold text-xs leading-tight">{name}</div>
                  <div className="text-xs opacity-60">{conf.category}</div>
                </div>
                {got && <span className="ml-auto text-emerald-400 text-xs">✓</span>}
              </div>
            );
          })}
        </div>
      </div>

      {/* 人生時間軸 */}
      <LifeTimeline eventLog={analysis.eventLog} playerName={analysis.playerName} />

      {/* 評分雷達圖 */}
      <FinalScoreRadar score={score} playerName={analysis.playerName} />

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

      {/* 反思問題 */}
      <div className="card bg-indigo-950 border-indigo-800">
        <h3 className="text-sm font-semibold text-indigo-300 mb-2">💭 反思時間</h3>
        <ul className="space-y-2 text-xs text-indigo-200">
          <li>• 你最後悔沒做的財務決策是什麼？</li>
          <li>• 如果重來，你會在幾歲開始投資資產？</li>
          <li>• 你的危機是否因保險而減輕了損失？</li>
          <li>• 旅遊和工作，你找到了平衡嗎？</li>
          <li>• 你的傳承分（{Math.round(score.legacyScore ?? 50)}分）反映了什麼？</li>
        </ul>
      </div>
    </div>
  );
}
