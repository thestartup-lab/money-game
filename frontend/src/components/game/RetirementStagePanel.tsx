import { useState } from 'react';
import type { GameState, Player } from '../../types/game';

const STARTUP_AMOUNTS = [300_000, 750_000, 1_500_000];

/** 65 歲人生轉折：本人在手機選擇退休／顧問／創業／延後 */
export default function RetirementStagePanel({ gameState, player, emit }: {
  gameState: GameState; player: Player; emit: (event: string, payload: unknown) => void;
}) {
  const scene = gameState.facilitatorScene;
  const [startupAmount, setStartupAmount] = useState(STARTUP_AMOUNTS[0]);
  if (scene?.kind !== 'retirement' || scene.careerPlayerId !== player.id) return null;
  const button = 'min-h-14 w-full rounded-xl border-2 border-amber-400 bg-amber-900/70 p-3 text-lg font-black text-white disabled:opacity-40';
  const choose = (choice: string, extra: Record<string, unknown> = {}) => emit('chooseRetirement', { sceneId: scene.id, choice, ...extra });
  const canDefer = scene.description.includes('延後一輪');
  return (
    <section className="mx-4 mb-3 space-y-3 rounded-2xl border-2 border-amber-400 bg-slate-900 p-5" aria-label="65 歲人生轉折">
      <h3 className="text-2xl font-black text-amber-200">🎂 65 歲，你的下一段人生</h3>
      <p className="whitespace-pre-line text-base leading-relaxed text-white">{scene.stage === 'result' ? scene.resultDescription : scene.description}</p>
      {scene.stage === 'prompt' ? (
        scene.careerConfirmed ? (
          <p className="text-xl font-bold text-emerald-200">已選擇，請看大螢幕，等待主持人揭曉。</p>
        ) : (
          <div className="space-y-2">
            <button className={button} onClick={() => choose('retire')}>1. 退休，領退休金</button>
            <button className={button} onClick={() => choose('consultant')}>2. 當顧問（靠專長與人脈接案）</button>
            <div className="rounded-xl border border-amber-700 p-2">
              <p className="mb-2 text-sm text-amber-100">3. 退休創業，選擇投入金額（現金 ${player.cash.toLocaleString()}）</p>
              <div className="mb-2 grid grid-cols-3 gap-2">
                {STARTUP_AMOUNTS.map((amt) => (
                  <button key={amt} type="button" disabled={player.cash < amt}
                    className={`rounded-lg py-2 text-sm font-bold ${startupAmount === amt ? 'bg-amber-600 text-white' : 'bg-gray-800 text-gray-200'} disabled:opacity-40`}
                    onClick={() => setStartupAmount(amt)}>${(amt / 10000).toLocaleString()} 萬</button>
                ))}
              </div>
              <button className={button} disabled={player.cash < startupAmount} onClick={() => choose('startup', { startupAmount })}>投入 ${startupAmount.toLocaleString()} 創業</button>
            </div>
            {canDefer && <button className={button} onClick={() => choose('defer')}>4. 再工作一輪（HP −10）</button>}
          </div>
        )
      ) : <p className="text-xl font-bold text-emerald-200">請等主持人繼續遊戲。</p>}
    </section>
  );
}
