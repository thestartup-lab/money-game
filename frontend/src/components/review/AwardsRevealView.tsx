// 隱藏獎項逐一揭曉：主持人按一次「下一個」亮一個，並附上討論問題
import type { RoomAnalysis } from '../../types/game';

export default function AwardsRevealView({ analysis, step }: { analysis: RoomAnalysis; step: number }) {
  const awards = analysis.awards ?? [];
  if (awards.length === 0) {
    return <p className="card m-6 text-center text-lg text-gray-400">這一場沒有可頒發的隱藏獎項。</p>;
  }
  const current = Math.min(step, awards.length - 1);
  const award = awards[current];
  const earlier = awards.slice(0, current);
  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div className="text-center">
        <p className="text-sm font-black uppercase tracking-[0.28em] text-yellow-400">隱藏獎項 {current + 1}／{awards.length}</p>
      </div>
      <div key={award.id} className="rounded-3xl border-2 border-yellow-600 bg-gradient-to-br from-yellow-950/70 via-gray-900 to-indigo-950/60 p-8 text-center shadow-2xl">
        <div className="text-7xl" aria-hidden="true">{award.emoji}</div>
        <p className="mt-3 text-3xl font-black text-yellow-300">{award.title}</p>
        <p className="mt-2 text-5xl font-black text-white">{award.playerName}</p>
        <p className="mt-4 text-xl leading-relaxed text-gray-200">{award.reason}</p>
        <p className="mx-auto mt-6 max-w-3xl rounded-2xl bg-indigo-950/80 px-5 py-4 text-2xl font-bold leading-relaxed text-indigo-100">
          💬 {award.reflectionQuestion}
        </p>
        <p className="mt-3 text-sm text-gray-400">請 {award.playerName} 先分享，再請其他人補充。</p>
      </div>
      {earlier.length > 0 && (
        <div className="flex flex-wrap justify-center gap-2">
          {earlier.map((item) => (
            <span key={item.id} className="rounded-full border border-yellow-800 bg-black/40 px-3 py-1 text-sm text-yellow-200">
              {item.emoji} {item.title}・{item.playerName}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
