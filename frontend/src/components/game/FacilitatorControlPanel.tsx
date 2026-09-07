import { useState } from 'react';
import type { GameState } from '../../types/game';

interface Props {
  gameState: GameState;
  emit: (eventName: string, payload?: unknown) => void;
}

const COMMUNITY_EVENTS = [
  { id: 'healthcare', label: '🏥 城市醫療改革' },
  { id: 'technology', label: '🤖 科技轉型浪潮' },
  { id: 'climate', label: '🌏 氣候災害重建' },
];

const CONTRACTS = [
  { id: 'joint_venture', label: '共同創業契約' },
  { id: 'mutual_aid', label: '人生互助契約' },
  { id: 'learning_alliance', label: '共學成長契約' },
];

const LEGACIES = [
  { id: 'wisdom', label: '智慧傳承' },
  { id: 'network', label: '人脈傳承' },
  { id: 'public_good', label: '公益傳承' },
];

const inputClass = 'min-h-12 w-full rounded-xl border-2 border-slate-500 bg-slate-950 px-3 py-2 text-base font-bold text-white';

export default function FacilitatorControlPanel({ gameState, emit }: Props) {
  const [contractId, setContractId] = useState('joint_venture');
  const [playerAId, setPlayerAId] = useState('');
  const [playerBId, setPlayerBId] = useState('');
  const [legacyId, setLegacyId] = useState('wisdom');
  const [deceasedPlayerId, setDeceasedPlayerId] = useState('');
  const [beneficiaryId, setBeneficiaryId] = useState('');
  const scene = gameState.facilitatorScene;
  const alivePlayers = gameState.players.filter((player) => player.isAlive);
  const deceasedPlayers = gameState.players.filter((player) => !player.isAlive && !player.legacyActionUsed);
  const isRunning = gameState.gamePhase === 'RatRace' || gameState.gamePhase === 'FastTrack';
  const busy = !isRunning || Boolean(gameState.decisionPhase || gameState.globalPaydayPending || gameState.globalPaydayInProgress);

  if (scene) {
    return (
      <section className="rounded-2xl border-2 border-violet-500 bg-violet-950/60 p-4" aria-label="目前大螢幕舞台事件">
        <p className="text-xs font-black uppercase tracking-widest text-violet-200">大螢幕正在顯示</p>
        <h3 className="mt-1 text-xl font-black text-white">{scene.title}</h3>
        <p className="mt-2 text-sm leading-relaxed text-violet-100">{scene.stage === 'result' ? scene.resultDescription : scene.description}</p>

        {scene.stage === 'prompt' ? (
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {(scene.options ?? []).map((option) => (
              <button
                key={option.id}
                className="min-h-14 rounded-xl border border-violet-300 bg-violet-700 px-3 py-2 text-base font-black text-white hover:bg-violet-600"
                onClick={() => emit('resolveFacilitatorScene', { sceneId: scene.id, choiceId: option.id })}
              >
                {option.label}
              </button>
            ))}
            <button
              className="min-h-12 rounded-xl border border-slate-500 bg-slate-800 px-3 py-2 font-bold text-gray-200"
              onClick={() => emit('closeFacilitatorScene', { sceneId: scene.id })}
            >
              取消本次舞台
            </button>
          </div>
        ) : (
          <button
            className="mt-4 min-h-14 w-full rounded-xl border-2 border-emerald-300 bg-emerald-700 px-4 py-3 text-lg font-black text-white hover:bg-emerald-600"
            onClick={() => emit('closeFacilitatorScene', { sceneId: scene.id })}
          >
            關閉舞台，繼續遊戲 ▶
          </button>
        )}
      </section>
    );
  }

  return (
    <section className="space-y-4" aria-label="主持人導演模式">
      <div className="rounded-xl border border-cyan-800 bg-cyan-950/45 p-3">
        <h3 className="font-black text-cyan-100">🗳️ 全場共同抉擇</h3>
        <p className="mt-1 text-xs leading-relaxed text-cyan-200/80">公布到大螢幕，全場討論後由主持人選擇結果。</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          {COMMUNITY_EVENTS.map((event) => (
            <button
              key={event.id}
              disabled={busy}
              className="min-h-12 rounded-xl bg-cyan-800 px-3 py-2 text-sm font-black text-white hover:bg-cyan-700 disabled:cursor-not-allowed disabled:opacity-45"
              onClick={() => emit('startFacilitatorScene', { kind: 'community', cardId: event.id })}
            >
              {event.label}
            </button>
          ))}
        </div>
      </div>

      <button
        disabled={busy}
        className="min-h-14 w-full rounded-xl border-2 border-violet-400 bg-violet-800 px-4 py-3 text-lg font-black text-white hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-45"
        onClick={() => emit('startFacilitatorScene', { kind: 'echo' })}
      >
        🔁 抽出一段決策回聲
      </button>
      <p className="-mt-2 text-xs text-gray-400">系統只會回看至少 8 年前的關鍵選擇，結果到揭曉前不會出現。</p>

      <details className="rounded-xl border border-blue-800 bg-blue-950/40 p-3">
        <summary className="cursor-pointer font-black text-blue-100">🤝 安排玩家合作契約</summary>
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          <select className={inputClass} value={contractId} onChange={(event) => setContractId(event.target.value)} aria-label="合作契約類型">
            {CONTRACTS.map((contract) => <option key={contract.id} value={contract.id}>{contract.label}</option>)}
          </select>
          <select className={inputClass} value={playerAId} onChange={(event) => setPlayerAId(event.target.value)} aria-label="合作玩家 A">
            <option value="">選擇夥伴 A</option>
            {alivePlayers.map((player) => <option key={player.id} value={player.id}>{player.name}</option>)}
          </select>
          <select className={inputClass} value={playerBId} onChange={(event) => setPlayerBId(event.target.value)} aria-label="合作玩家 B">
            <option value="">選擇夥伴 B</option>
            {alivePlayers.map((player) => <option key={player.id} value={player.id}>{player.name}</option>)}
          </select>
        </div>
        <button
          disabled={busy || !playerAId || !playerBId || playerAId === playerBId}
          className="mt-3 min-h-12 w-full rounded-xl bg-blue-700 px-3 py-2 font-black text-white disabled:cursor-not-allowed disabled:opacity-45"
          onClick={() => emit('startFacilitatorScene', { kind: 'cooperation', contractId, playerAId, playerBId })}
        >
          在大螢幕提出契約
        </button>
      </details>

      <details className="rounded-xl border border-amber-800 bg-amber-950/40 p-3">
        <summary className="cursor-pointer font-black text-amber-100">🌟 安排已故玩家傳承</summary>
        {deceasedPlayers.length === 0 ? (
          <p className="mt-2 text-sm text-amber-200/70">目前沒有可以進行傳承儀式的已故玩家。</p>
        ) : (
          <>
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              <select className={inputClass} value={legacyId} onChange={(event) => setLegacyId(event.target.value)} aria-label="傳承類型">
                {LEGACIES.map((legacy) => <option key={legacy.id} value={legacy.id}>{legacy.label}</option>)}
              </select>
              <select className={inputClass} value={deceasedPlayerId} onChange={(event) => setDeceasedPlayerId(event.target.value)} aria-label="傳承玩家">
                <option value="">選擇傳承者</option>
                {deceasedPlayers.map((player) => <option key={player.id} value={player.id}>{player.name}</option>)}
              </select>
              <select className={inputClass} value={beneficiaryId} onChange={(event) => setBeneficiaryId(event.target.value)} aria-label="傳承承接者">
                <option value="">選擇承接者</option>
                {alivePlayers.map((player) => <option key={player.id} value={player.id}>{player.name}</option>)}
              </select>
            </div>
            <button
              disabled={busy || !deceasedPlayerId || !beneficiaryId}
              className="mt-3 min-h-12 w-full rounded-xl bg-amber-700 px-3 py-2 font-black text-white disabled:cursor-not-allowed disabled:opacity-45"
              onClick={() => emit('startFacilitatorScene', { kind: 'legacy', legacyId, deceasedPlayerId, beneficiaryId })}
            >
              在大螢幕舉行傳承
            </button>
          </>
        )}
      </details>

      {busy ? <p className="text-xs font-bold text-orange-300">請先完成目前玩家決策或季度發薪，再啟動導演事件。</p> : null}
    </section>
  );
}
