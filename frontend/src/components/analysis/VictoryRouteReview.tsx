import type { PlayerAnalysis } from '../../types/game';

interface Props {
  analysis: PlayerAnalysis;
}

interface RouteCheckpoint {
  stage: string;
  title: string;
  achieved: boolean;
  evidence: string;
  reflection: string;
}

export default function VictoryRouteReview({ analysis }: Props) {
  const { summary, finalScore: score } = analysis;
  const secondLifeReview = summary.secondLifeReview;
  const passiveCoverage = summary.finalExpenses > 0
    ? summary.finalPassiveIncome / summary.finalExpenses
    : 0;
  const achievedLifeIndicators = secondLifeReview?.indicators
    .filter((indicator) => indicator.achieved)
    .map((indicator) => indicator.label)
    .join('、');
  const lowestIndex = Math.min(
    score.lifeExperienceIndex ?? 0,
    score.achievementIndex ?? 0,
    score.relationshipIndex ?? 0,
  );

  const checkpoints: RouteCheckpoint[] = [
    {
      stage: '20–40 歲',
      title: '建立第一個正現金流引擎',
      achieved: summary.firstAssetAge !== null && summary.firstAssetAge <= 40,
      evidence: summary.firstAssetAge !== null
        ? `${Math.round(summary.firstAssetAge)} 歲完成第一筆資產投資，共買入 ${summary.assetBuyCount} 次`
        : '本局沒有完成資產買入',
      reflection: '當時保留現金與建立被動收入之間，你如何判斷？',
    },
    {
      stage: '40–60 歲',
      title: '讓收入結構不只依賴薪資',
      achieved: summary.finalPassiveIncome > 0 && summary.finalCashflow > 0,
      evidence: `最終被動收入 $${summary.finalPassiveIncome.toLocaleString()}／月，總現金流 ${summary.finalCashflow >= 0 ? '+' : ''}$${summary.finalCashflow.toLocaleString()}／月`,
      reflection: '哪一筆資產真正改變了你的現金流？哪一筆只是佔用資金？',
    },
    {
      stage: '全人生',
      title: '守住健康與風險承受力',
      achieved: summary.finalHP >= 40 && summary.insuranceCount >= 1,
      evidence: `最終 HP ${Math.round(summary.finalHP)}，持有 ${summary.insuranceCount} 種保險，經歷 ${summary.crisisCount} 次危機`,
      reflection: '你的風險準備是在危機前完成，還是在損失後才開始？',
    },
    {
      stage: '財務轉折',
      title: '財務基礎與人生累積共同成熟',
      achieved: summary.escapedRatRace,
      evidence: summary.escapedRatRace
        ? `${Math.round(summary.escapeAge ?? analysis.deathAge)} 歲以「${secondLifeReview?.routeLabel ?? '第二人生'}」進入外圈；當時完成 ${achievedLifeIndicators || '人生累積'}指標`
        : `未進入外圈；終局有效被動收入覆蓋率 ${((secondLifeReview?.coverageRatio ?? passiveCoverage) * 100).toFixed(0)}%，完成人生指標 ${secondLifeReview?.achievedIndicatorCount ?? 0}/4`,
      reflection: '當時限制你的主要是財務基礎，還是健康、成長、關係與體驗尚未成熟？',
    },
    {
      stage: '最終結算',
      title: '避免只贏一個維度',
      achieved: lowestIndex >= 55,
      evidence: `生命體驗 ${score.lifeExperienceIndex}／人生成就 ${score.achievementIndex}／人際關係 ${score.relationshipIndex}`,
      reflection: '如果只能重做一個決定，哪個決定能同時改善兩個以上的幸福指數？',
    },
  ];

  const completed = checkpoints.filter((checkpoint) => checkpoint.achieved).length;

  return (
    <section className="card border-indigo-700 bg-gradient-to-br from-indigo-950/80 to-gray-900">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-indigo-300">賽後限定</p>
          <h3 className="mt-1 text-lg font-black text-white">🧭 高勝率路線復盤</h3>
          <p className="mt-1 text-xs leading-relaxed text-gray-400">
            這不是遊戲中的提示，也不是唯一答案；它用你的實際決策檢查一條常見的穩健勝利路線。
          </p>
        </div>
        <div className="shrink-0 rounded-2xl border border-indigo-500 bg-indigo-900/70 px-4 py-2 text-center">
          <div className="text-2xl font-black text-indigo-200">{completed}/5</div>
          <div className="text-[10px] text-indigo-400">路線節點</div>
        </div>
      </div>

      <div className="mt-4 space-y-3">
        {checkpoints.map((checkpoint, index) => (
          <article
            key={checkpoint.title}
            className={`rounded-xl border p-3 ${checkpoint.achieved ? 'border-emerald-700 bg-emerald-950/35' : 'border-amber-800 bg-amber-950/25'}`}
          >
            <div className="flex items-start gap-3">
              <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-black ${checkpoint.achieved ? 'bg-emerald-600 text-white' : 'bg-amber-700 text-white'}`}>
                {checkpoint.achieved ? '✓' : index + 1}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h4 className="text-sm font-bold text-white">{checkpoint.title}</h4>
                  <span className="rounded bg-gray-800 px-1.5 py-0.5 text-[10px] text-gray-400">{checkpoint.stage}</span>
                </div>
                <p className="mt-1 text-xs text-gray-300">{checkpoint.evidence}</p>
                <p className="mt-2 text-xs text-indigo-300">復盤：{checkpoint.reflection}</p>
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
