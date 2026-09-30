// 婚姻舞台：當事人在手機決定答應或婉拒（主持人不能代為答應）
import type { GameState, Player } from '../../types/game';

interface Props {
  gameState: GameState;
  player: Player;
  emit: (event: string, payload?: unknown) => void;
}

export default function MarriageChoicePanel({ gameState, player, emit }: Props) {
  const scene = gameState.facilitatorScene;
  if (!scene || scene.kind !== 'marriage' || scene.careerPlayerId !== player.id || scene.stage !== 'prompt') return null;
  const answered = Boolean(scene.careerConfirmed);
  return (
    <div className="mx-4 mb-3 rounded-2xl border-2 border-pink-500 bg-gradient-to-br from-pink-950 to-gray-900 p-5 shadow-xl">
      <p className="text-sm font-bold text-pink-300">💍 {scene.kicker}</p>
      <p className="mt-1 text-xl font-black text-white">{scene.title}</p>
      <p className="mt-2 text-sm leading-relaxed text-gray-200">{scene.description}</p>
      {answered ? (
        <p className="mt-4 rounded-xl bg-gray-900 px-4 py-3 text-center text-base font-bold text-emerald-300">已送出你的決定，請看大螢幕揭曉。</p>
      ) : (
        <>
          <p className="mt-3 text-xs text-gray-400">要不要結婚由你決定，主持人不會替你答應。</p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button className="rounded-xl bg-pink-600 py-3 text-base font-black text-white hover:bg-pink-500"
              onClick={() => emit('answerMarriage', { sceneId: scene.id, accept: true })}>💍 答應</button>
            <button className="rounded-xl bg-gray-700 py-3 text-base font-bold text-white hover:bg-gray-600"
              onClick={() => emit('answerMarriage', { sceneId: scene.id, accept: false })}>先不要</button>
          </div>
        </>
      )}
    </div>
  );
}
