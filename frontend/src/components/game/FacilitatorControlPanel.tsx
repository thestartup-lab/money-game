import { useState } from 'react';
import type { GameState } from '../../types/game';
import DecisionCountdown from './DecisionCountdown';

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
  const [familyPlayerId, setFamilyPlayerId] = useState('');
  const scene = gameState.facilitatorScene;
  const alivePlayers = gameState.players.filter((player) => player.isAlive);
  const deceasedPlayers = gameState.players.filter((player) => !player.isAlive && !player.legacyActionUsed);
  const isRunning = gameState.gamePhase === 'RatRace' || gameState.gamePhase === 'FastTrack';
  const busy = !isRunning || Boolean(gameState.turnInProgress || gameState.decisionPhase || gameState.globalPaydayPending || gameState.globalPaydayInProgress);
  const familyPlayer = alivePlayers.find((player) => player.id === familyPlayerId);
  const familyPlayerAge = familyPlayer?.personalAge ?? gameState.currentAge;
  const arrangedMarriageCost = Math.min(450_000, 75_000 + Math.max(0, familyPlayerAge - 20) * 3_000);

  if (scene) {
    return (
      <section className="rounded-2xl border-2 border-violet-500 bg-violet-950/60 p-4" aria-label="目前大螢幕舞台事件">
        <p className="text-xs font-black uppercase tracking-widest text-violet-200">大螢幕正在顯示</p>
        <h3 className="mt-1 text-xl font-black text-white">{scene.title}</h3>
        <p className="mt-2 text-sm leading-relaxed text-violet-100">{scene.stage === 'result' ? scene.resultDescription : scene.description}</p>

        {scene.stage === 'prompt' && scene.reminderEndsAt ? (
          <div className="mt-4 rounded-xl border border-pink-400/50 bg-gray-950/70 p-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-black text-pink-100">主持人決策倒數</span>
              <DecisionCountdown reminderEndsAt={scene.reminderEndsAt} className="font-mono text-2xl font-black text-yellow-300" />
            </div>
            <div className="mt-3 grid grid-cols-4 gap-2">
              {[30, 60, 90].map((seconds) => (
                <button
                  key={seconds}
                  className="min-h-11 rounded-lg bg-gray-800 px-2 text-sm font-black text-white"
                  onClick={() => emit('setFacilitatorReminder', { sceneId: scene.id, seconds })}
                >
                  {seconds} 秒
                </button>
              ))}
              <button
                className="min-h-11 rounded-lg bg-pink-800 px-2 text-sm font-black text-white"
                onClick={() => emit('setFacilitatorReminder', { sceneId: scene.id, addSeconds: 30 })}
              >
                +30 秒
              </button>
            </div>
            <p className="mt-2 text-xs text-pink-200/80">時間到只提醒，不會自動選擇或套用效果。</p>
          </div>
        ) : null}

        {scene.stage === 'prompt' ? (
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {scene.kind === 'career' && !scene.careerConfirmed ? <p className="text-base font-bold text-yellow-200">等待本人在手機確認，主持人不能代為確認。</p> : null}
            {(scene.options ?? []).map((option) => (
              <button
                key={option.id}
                className="min-h-14 rounded-xl border border-violet-300 bg-violet-700 px-3 py-2 text-base font-black text-white hover:bg-violet-600"
                onClick={() => emit('resolveFacilitatorScene', { sceneId: scene.id, choiceId: option.id })}
              >
                {option.label}
              </button>
            ))}
            {scene.kind !== 'second_life' && <button
              className="min-h-12 rounded-xl border border-slate-500 bg-slate-800 px-3 py-2 font-bold text-gray-200"
              onClick={() => emit('closeFacilitatorScene', { sceneId: scene.id })}
            >
              取消本次舞台
            </button>}
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
      {(gameState.careerRequests?.length ?? 0) > 0 ? (
        <section className="rounded-xl border-2 border-yellow-500 bg-yellow-950/50 p-4" aria-label="轉職申請隊列">
          <h3 className="text-xl font-black text-yellow-100">🎯 等待轉職（{gameState.careerRequests!.length}）</h3>
          {gameState.careerRequests!.map((request, index) => (
            <div key={request.id} className="mt-3 rounded-xl bg-slate-950 p-3 text-base text-white">
              <p>{index + 1}. {request.playerName} → {request.professionName}</p>
              <button disabled={busy || index !== 0} className="mt-2 min-h-12 w-full rounded-xl bg-yellow-700 p-3 font-bold disabled:opacity-40"
                onClick={() => emit('startCareerScene', { requestId: request.id })}>開啟轉職舞台</button>
              <button className="mt-2 min-h-12 w-full rounded-xl border border-slate-500 p-3" onClick={() => emit('cancelCareerRequest', { requestId: request.id })}>取消申請</button>
            </div>
          ))}
          <p className="mt-2 text-base text-yellow-200">依序開啟；原回合與全體發薪先完成。開啟後遊戲暫停，關閉舞台才繼續。</p>
        </section>
      ) : null}
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

      <details className="rounded-xl border border-pink-800 bg-pink-950/40 p-3">
        <summary className="cursor-pointer font-black text-pink-100">💍 婚姻與家庭舞台</summary>
        <select
          className={`${inputClass} mt-3`}
          value={familyPlayerId}
          onChange={(event) => setFamilyPlayerId(event.target.value)}
          aria-label="婚姻與家庭玩家"
        >
          <option value="">選擇玩家</option>
          {alivePlayers.map((player) => (
            <option key={player.id} value={player.id}>
              {player.name}｜{player.isMarried ? `已婚・${player.numberOfChildren} 名子女` : `未婚・DRS ${player.relationshipPoints}/100`}
            </option>
          ))}
        </select>

        {familyPlayer ? (
          <div className="mt-3 rounded-xl bg-gray-950/55 p-3 text-sm leading-relaxed text-pink-100">
            <p className="font-black">{familyPlayer.name}｜{Math.round(familyPlayer.personalAge ?? gameState.currentAge)} 歲</p>
            <p>健康 {familyPlayer.stats.health}・現金 ${Math.round(familyPlayer.cash).toLocaleString()}・DRS {familyPlayer.relationshipPoints}/100</p>
            <p>{familyPlayer.isMarried ? `已婚，目前 ${familyPlayer.numberOfChildren} 名子女` : familyPlayer.relationshipActive ? '關係路徑進行中' : '尚未啟動關係路徑'}</p>
          </div>
        ) : null}

        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <button
            disabled={busy || !familyPlayer || familyPlayer.isMarried || familyPlayer.relationshipActive}
            className="min-h-12 rounded-xl bg-fuchsia-800 px-3 py-2 font-black text-white disabled:cursor-not-allowed disabled:opacity-45"
            onClick={() => emit('triggerRelationship', { targetPlayerId: familyPlayerId })}
          >
            觸發邂逅・DRS +40
          </button>
          <button
            disabled={busy || !familyPlayer || familyPlayer.isMarried || !familyPlayer.relationshipActive || familyPlayer.relationshipPoints < 100}
            className="min-h-12 rounded-xl bg-pink-700 px-3 py-2 font-black text-white disabled:cursor-not-allowed disabled:opacity-45"
            onClick={() => emit('startFacilitatorScene', { kind: 'marriage', marriageRoute: 'love', playerId: familyPlayerId })}
          >
            自然戀愛成婚
          </button>
          <button
            disabled={busy || !familyPlayer || familyPlayer.isMarried || !familyPlayer.relationshipActive || familyPlayer.relationshipPoints < 100}
            className="min-h-12 rounded-xl bg-violet-800 px-3 py-2 font-black text-white disabled:cursor-not-allowed disabled:opacity-45"
            onClick={() => emit('startFacilitatorScene', { kind: 'marriage', marriageRoute: 'matchmaker', playerId: familyPlayerId })}
          >
            主持人媒合成婚
          </button>
          <button
            disabled={busy || !familyPlayer || familyPlayer.isMarried || familyPlayer.isBedridden || familyPlayer.stats.health < 20 || familyPlayer.cash < arrangedMarriageCost}
            className="min-h-12 rounded-xl bg-rose-800 px-3 py-2 font-black text-white disabled:cursor-not-allowed disabled:opacity-45"
            onClick={() => emit('startFacilitatorScene', { kind: 'marriage', marriageRoute: 'arranged', playerId: familyPlayerId })}
          >
            付費婚配・${Math.round(arrangedMarriageCost).toLocaleString()}
          </button>
          <button
            disabled={busy || !familyPlayer}
            className="min-h-12 rounded-xl bg-orange-800 px-3 py-2 font-black text-white disabled:cursor-not-allowed disabled:opacity-45"
            onClick={() => emit('startFacilitatorScene', { kind: 'family', playerId: familyPlayerId })}
          >
            安排家庭事件
          </button>
        </div>
        <p className="mt-3 text-xs leading-relaxed text-pink-200/80">家庭事件平常會由家庭格或外圈關係格自動登上大螢幕；必須先結婚，最多 3 名子女，且兩次添丁至少相隔 8 年。主持人也可在這裡安排舞台。</p>
      </details>

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
