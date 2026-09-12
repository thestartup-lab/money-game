import type { FacilitatorScene } from '../../types/game';
import DecisionCountdown from './DecisionCountdown';

interface Props {
  scene: FacilitatorScene;
}

const KIND_THEME: Record<FacilitatorScene['kind'], { icon: string; border: string; glow: string }> = {
  career: { icon: '🎯', border: 'border-yellow-400', glow: 'from-yellow-950/90' },
  second_life: { icon: '🌟', border: 'border-amber-400', glow: 'from-amber-950/90' },
  community: { icon: '🗳️', border: 'border-cyan-400', glow: 'from-cyan-950/90' },
  echo: { icon: '🔁', border: 'border-violet-400', glow: 'from-violet-950/90' },
  cooperation: { icon: '🤝', border: 'border-blue-400', glow: 'from-blue-950/90' },
  legacy: { icon: '🌟', border: 'border-amber-400', glow: 'from-amber-950/90' },
  marriage: { icon: '💍', border: 'border-pink-400', glow: 'from-pink-950/90' },
  family: { icon: '👨‍👩‍👧', border: 'border-rose-400', glow: 'from-rose-950/90' },
  global_event: { icon: '🌍', border: 'border-orange-400', glow: 'from-orange-950/90' },
};

export default function FacilitatorSceneOverlay({ scene }: Props) {
  const theme = KIND_THEME[scene.kind];
  const isResult = scene.stage === 'result';

  return (
    <main className={`flex flex-1 items-center justify-center overflow-y-auto bg-gradient-to-br ${theme.glow} via-gray-950 to-gray-950 p-6`}>
      <section className={`w-full max-w-6xl rounded-[2.5rem] border-4 ${theme.border} bg-gray-950/95 px-10 py-6 text-center shadow-2xl`} aria-live="polite">
        <div className="text-6xl" aria-hidden="true">{isResult ? '✨' : theme.icon}</div>
        <p className="mt-2 text-xl font-black uppercase tracking-[0.24em] text-gray-300">
          {isResult ? '結果揭曉' : scene.kicker}
        </p>
        <h2 className="mt-2 text-5xl font-black leading-tight text-white">
          {isResult ? scene.resultTitle ?? scene.title : scene.title}
        </h2>
        <p className="mx-auto mt-4 max-w-5xl whitespace-pre-line text-2xl font-bold leading-relaxed text-gray-200">
          {isResult ? scene.resultDescription ?? scene.description : scene.description}
        </p>

        {!isResult && scene.reminderEndsAt ? (
          <div className="mx-auto mt-5 w-fit rounded-2xl border-2 border-yellow-400 bg-black/60 px-8 py-3">
            <p className="text-base font-black uppercase tracking-widest text-yellow-200">討論時間</p>
            <DecisionCountdown reminderEndsAt={scene.reminderEndsAt} className="font-mono text-5xl font-black text-yellow-300" />
          </div>
        ) : null}

        {!isResult && scene.kind !== 'global_event' && scene.kind !== 'second_life' && scene.kind !== 'career' && scene.options && scene.options.length > 0 ? (
          <div className={`mx-auto mt-6 grid max-w-5xl gap-4 ${scene.options.length >= 3 ? 'grid-cols-3' : 'grid-cols-2'}`}>
            {scene.options.map((option, index) => (
              <article key={option.id} className="rounded-3xl border-2 border-gray-600 bg-gray-900 px-6 py-5 text-left">
                <p className="text-lg font-black text-yellow-300">選項 {index + 1}</p>
                <h3 className="mt-1 text-3xl font-black text-white">{option.label}</h3>
                <p className="mt-2 text-lg font-semibold leading-relaxed text-gray-300">{option.description}</p>
              </article>
            ))}
          </div>
        ) : null}

        {scene.participantNames.length > 0 ? (
          <div className="mt-5 flex flex-wrap justify-center gap-3">
            {scene.participantNames.map((name) => (
              <span key={name} className="rounded-full border border-gray-500 bg-gray-800 px-5 py-2 text-lg font-black text-white">
                {name}
              </span>
            ))}
          </div>
        ) : null}

        {isResult && scene.impacts ? (
          <div className="mt-5 max-h-72 overflow-auto rounded-2xl border border-orange-700">
            <table className="w-full text-xl text-white">
              <thead className="sticky top-0 bg-gray-800"><tr><th className="p-3">玩家</th><th>月現金流變化</th><th>淨資產變化</th><th>健康變化</th></tr></thead>
              <tbody>{scene.impacts.map((impact, index) => (
                <tr key={`${index}-${impact.playerName}`} className="border-t border-gray-700">
                  <th className="p-3">{impact.playerName}</th>
                  {[impact.cashflowDelta, impact.netWorthDelta, impact.healthDelta].map((value, column) => (
                    <td key={column} className={value < 0 ? 'font-bold text-orange-300' : 'font-bold text-emerald-300'}>
                      {value > 0 ? '+' : ''}{value.toLocaleString('zh-TW', { maximumFractionDigits: 0 })}
                    </td>
                  ))}
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : null}

        <p className="mt-5 text-xl font-black text-emerald-300">
          {isResult ? '請一起觀察：這個結果改變了誰？' : scene.kind === 'career' ? (scene.careerConfirmed ? '本人已確認，等待主持人揭曉。' : '等待本人在手機確認；時間到不會自動轉職。') : '請抬頭看大螢幕共同討論，由主持人決定何時揭曉。'}
        </p>
      </section>
    </main>
  );
}
