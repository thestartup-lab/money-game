import type { FacilitatorScene } from '../../types/game';

interface Props {
  scene: FacilitatorScene;
  myVote?: string;
  canVote: boolean;
  emit: (event: string, payload: unknown) => void;
}

/** 手機投票：全場共同抉擇（可改票；只公開票數，不公開誰投哪一票） */
export default function CommunityVotePanel({ scene, myVote, canVote, emit }: Props) {
  if (scene.kind !== 'community') return null;
  const total = Math.max(1, scene.voterCount ?? 1);
  if (scene.stage === 'result') {
    return (
      <section className="mx-4 mb-3 rounded-2xl border-2 border-cyan-400 bg-slate-900 p-5 text-white" aria-live="polite">
        <p className="text-sm font-bold text-cyan-200">🗳️ 全場共同抉擇・結果</p>
        <h3 className="mt-1 text-2xl font-black">{scene.resultTitle}</h3>
        <p className="mt-2 whitespace-pre-line text-base text-gray-200">{scene.resultDescription}</p>
      </section>
    );
  }
  return (
    <section className="mx-4 mb-3 rounded-2xl border-2 border-cyan-400 bg-slate-900 p-5 text-white" aria-label="全場共同抉擇投票">
      <p className="text-sm font-bold text-cyan-200">🗳️ 全場共同抉擇・請投票</p>
      <h3 className="mt-1 text-2xl font-black">{scene.title}</h3>
      <p className="mt-2 text-base text-gray-200">{scene.description}</p>
      <p className="mt-2 text-sm text-gray-400">結果套用到全場每一個人。先抬頭跟大家討論，再投下你的一票；揭曉前可以改票。已投票 {scene.votedCount ?? 0}／{scene.voterCount ?? 0} 人。</p>
      <div className="mt-3 space-y-2">
        {(scene.options ?? []).map((option) => {
          const votes = scene.votes?.[option.id] ?? 0;
          const mine = myVote === option.id;
          return (
            <button key={option.id} type="button" disabled={!canVote}
              onClick={() => emit('voteCommunityChoice', { sceneId: scene.id, optionId: option.id })}
              className={`relative w-full overflow-hidden rounded-xl border-2 p-3 text-left disabled:opacity-50 ${mine ? 'border-cyan-300 bg-cyan-900/60' : 'border-gray-600 bg-gray-800'}`}>
              <span className="absolute inset-y-0 left-0 bg-cyan-500/15" style={{ width: `${Math.round((votes / total) * 100)}%` }} aria-hidden="true" />
              <span className="relative flex items-center justify-between gap-2">
                <span className="text-lg font-black">{mine ? '✅ ' : ''}{option.label}</span>
                <span className="shrink-0 text-sm font-bold text-cyan-200">{votes} 票</span>
              </span>
              <span className="relative mt-1 block text-sm text-gray-300">{option.description}</span>
            </button>
          );
        })}
      </div>
      {!canVote && <p className="mt-2 text-sm text-gray-400">目前無法投票。</p>}
    </section>
  );
}
