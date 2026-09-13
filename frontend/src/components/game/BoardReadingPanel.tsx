import type { GameState } from '../../types/game';

export default function BoardReadingPanel({ phase, emit }: {
  phase: NonNullable<GameState['decisionPhase']>;
  emit?: (event: string, payload: unknown) => void;
}) {
  return <section className={`rounded-3xl border-2 border-yellow-400 bg-slate-950 p-6 text-white ${emit ? '' : 'mx-auto w-full max-w-5xl p-10 text-center'}`} aria-label="落格與事件閱讀" aria-live="polite">
    <p className="text-xl font-bold text-yellow-200">{phase.playerName} · 全場共同觀看</p>
    <h2 className={`my-5 font-black leading-tight ${emit ? 'text-2xl' : 'text-5xl'}`}>{phase.title}</h2>
    <p className={`whitespace-pre-line leading-relaxed ${emit ? 'text-lg' : 'text-3xl'}`}>{phase.description}</p>
    <p className="mt-6 text-xl font-bold text-emerald-200">不會自動消失，請主持人確認後繼續。</p>
    {emit ? <button className="mt-5 min-h-16 w-full rounded-xl bg-emerald-700 p-4 text-xl font-black"
      onClick={() => emit('continueDecisionPhase', { phaseId: phase.id })}>看完了，繼續 ▶</button> : null}
  </section>;
}
