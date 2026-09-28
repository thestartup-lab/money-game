// 全場共同抉擇回顧：每次投票的結果與票數
import type { RoomAnalysis } from '../../types/game';

export default function CommunityRecapView({ analysis }: { analysis: RoomAnalysis }) {
  const choices = analysis.communityChoices ?? [];
  return (
    <div className="mx-auto max-w-6xl space-y-4 p-6">
      <div className="text-center">
        <h2 className="text-3xl font-black text-white">🗳️ 我們一起做過的選擇</h2>
        <p className="mt-1 text-base text-gray-300">這些決定影響了每一個人。當時你投給誰？為什麼？</p>
      </div>
      {choices.length === 0 ? (
        <p className="card text-center text-lg text-gray-400">這一場沒有進行全場共同抉擇。</p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {choices.map((choice, index) => {
            const max = Math.max(1, ...choice.votes.map((v) => v.count));
            return (
              <div key={`${choice.cardId}-${index}`} className="rounded-2xl border border-cyan-800 bg-cyan-950/30 p-4">
                <p className="text-sm font-bold text-cyan-300">{choice.age} 歲</p>
                <p className="text-xl font-black text-white">{choice.title}</p>
                <p className="mt-1 text-base font-bold text-emerald-300">
                  全場選擇：{choice.optionLabel}{choice.byMajority ? '' : '（主持人裁定）'}
                </p>
                <div className="mt-3 space-y-1">
                  {choice.votes.map((vote) => (
                    <div key={vote.label} className="flex items-center gap-2 text-sm">
                      <span className="w-28 shrink-0 truncate text-gray-300">{vote.label}</span>
                      <div className="h-3 flex-1 rounded bg-gray-800">
                        <div className={`h-3 rounded ${vote.label === choice.optionLabel ? 'bg-emerald-500' : 'bg-gray-500'}`} style={{ width: `${(vote.count / max) * 100}%` }} />
                      </div>
                      <span className="w-10 text-right text-gray-300">{vote.count} 票</span>
                    </div>
                  ))}
                </div>
                <p className="mt-1 text-xs text-gray-500">{choice.votedCount}／{choice.voterCount} 人投票</p>
                <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-gray-300">{choice.result}</p>
              </div>
            );
          })}
        </div>
      )}
      <p className="text-center text-lg font-bold text-indigo-200">討論：對你個人最划算的選項，和對全場最好的選項，是同一個嗎？</p>
    </div>
  );
}
