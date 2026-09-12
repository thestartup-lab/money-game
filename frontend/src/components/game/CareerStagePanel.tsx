import type { GameState, Player } from '../../types/game';

export default function CareerStagePanel({ gameState, player, emit }: {
  gameState: GameState; player: Player; emit: (event: string, payload: unknown) => void;
}) {
  const scene = gameState.facilitatorScene;
  const request = gameState.careerRequests?.find(r => r.playerId === player.id);
  const button = 'min-h-14 w-full rounded-xl border-2 border-yellow-400 bg-yellow-900 p-3 text-lg font-black text-white disabled:opacity-40';
  if (scene?.kind === 'career' && scene.careerPlayerId === player.id) {
    return <section className="mx-4 mb-3 space-y-3 rounded-2xl border-2 border-yellow-400 bg-slate-900 p-5" aria-label="本人轉職確認">
      <h3 className="text-2xl font-black text-yellow-200">你的職涯選擇</h3>
      <p className="whitespace-pre-line text-lg leading-relaxed text-white">{scene.stage === 'result' ? scene.resultDescription : scene.description}</p>
      {scene.stage === 'prompt' ? <>
        {scene.careerConfirmed ? <p className="text-xl font-bold text-emerald-200">已確認，請看大螢幕，等待主持人揭曉。</p> :
          <button className={button} onClick={() => emit('confirmCareerScene', { sceneId: scene.id, accepted: true })}>我已了解代價，確認轉職</button>}
        <button className={button} onClick={() => emit('confirmCareerScene', { sceneId: scene.id, accepted: false })}>取消本次轉職，保留原職業</button>
      </> : <p className="text-xl font-bold text-emerald-200">請等主持人繼續遊戲。</p>}
    </section>;
  }
  if (request) return <section className="mx-4 mb-3 rounded-2xl border-2 border-yellow-400 bg-slate-900 p-5 text-lg text-white" aria-live="polite">
    <p className="font-black">已申請：{request.professionName}</p>
    <p className="my-3">等待主持人開啟舞台；目前未扣款，也尚未轉職。</p>
    <button className={button} onClick={() => emit('cancelCareerRequest', { requestId: request.id })}>撤回申請</button>
  </section>;
  if (!player.isAlive || player.isBedridden || player.stats.health < 30 || !player.careerOptions?.length) return null;
  return <details className="mx-4 mb-3 rounded-2xl border-2 border-yellow-400 bg-slate-900 p-5 text-lg text-white">
    <summary className="cursor-pointer text-xl font-black text-yellow-200">🎯 申請轉職</summary>
    <p className="my-3">選擇職業只會加入隊列。主持人開啟舞台後，再由你確認代價。</p>
    <div className="space-y-3">{player.careerOptions.map(option => <button key={option.id} className={button} disabled={option.canAfford === false}
      onClick={() => emit('requestCareerChange', { newProfessionId: option.id })}>申請：{option.name} · 自有資金 ${(option.assetCost ?? 0).toLocaleString()}{option.canAfford === false ? '（現金不足）' : ''}</button>)}</div>
  </details>;
}
