// 後半場目標：外圈玩家的夢想清單與「指導後輩」；離世玩家的「家族顧問」
import { useState } from 'react';
import type { GameState, Player } from '../../types/game';

interface Props {
  gameState: GameState;
  me: Player;
  canUseActions: boolean;
  emit: (event: string, payload?: unknown) => void;
}

export default function LateLifePanel({ gameState, me, canUseActions, emit }: Props) {
  if (me.isAlive && me.isInFastTrack) return <SecondLifeGoals gameState={gameState} me={me} canUseActions={canUseActions} emit={emit} />;
  if (!me.isAlive) return <FamilyAdvisor gameState={gameState} me={me} emit={emit} />;
  return null;
}

function SecondLifeGoals({ gameState, me, canUseActions, emit }: Props) {
  const juniors = gameState.players.filter((p) => p.isAlive && !p.isInFastTrack && p.id !== me.id);
  const mentoredThisRound = me.lastMentorRound === gameState.turnNumber;
  const goals = me.bucketGoals ?? [];
  return (
    <div className="mx-4 my-2 space-y-3 rounded-2xl border border-purple-700 bg-purple-950/40 p-4">
      <div>
        <p className="text-base font-black text-purple-200">🎯 第二人生的目標</p>
        <p className="text-xs text-gray-400">錢已經不是問題了。接下來看你怎麼過：完成夢想、照顧健康、把經驗傳下去。</p>
      </div>
      {goals.length > 0 && (
        <div className="space-y-1.5">
          {goals.map((goal) => (
            <div key={goal.id} className={`rounded-lg border px-3 py-2 text-sm ${goal.claimed ? 'border-emerald-700 bg-emerald-950/50' : 'border-gray-700 bg-gray-900'}`}>
              <div className="flex items-center gap-2">
                <span className="text-lg">{goal.emoji}</span>
                <span className={`flex-1 font-bold ${goal.claimed ? 'text-emerald-200' : 'text-white'}`}>{goal.title}</span>
                {goal.claimed ? <span className="text-emerald-300">✓ 達成</span> : <span className="text-[11px] text-gray-400">傳承 +{goal.legacyReward}</span>}
              </div>
              <p className="mt-0.5 text-xs text-gray-400">{goal.description}</p>
              {!goal.claimed && goal.progress && <p className="text-xs text-purple-200">{goal.progress}</p>}
            </div>
          ))}
        </div>
      )}
      <div className="rounded-xl border border-indigo-700 bg-indigo-950/50 p-3">
        <p className="text-sm font-bold text-indigo-100">🧑‍🏫 指導後輩（每輪一次）</p>
        <p className="text-xs text-gray-400">選一位還在內圈的玩家：對方專長 +10、體驗 +3；你傳承 +5、體驗 +5。在全體行動時間進行。</p>
        {juniors.length === 0 ? (
          <p className="mt-2 text-xs text-gray-500">大家都已經進入外圈了。</p>
        ) : mentoredThisRound ? (
          <p className="mt-2 text-xs text-emerald-300">這一輪已經指導過了，下一輪再來。</p>
        ) : (
          <div className="mt-2 flex flex-wrap gap-2">
            {juniors.map((p) => (
              <button key={p.id} disabled={!canUseActions} onClick={() => emit('mentorPlayer', { targetPlayerId: p.id })}
                className="rounded-lg bg-indigo-700 px-3 py-2 text-sm font-bold text-white disabled:bg-gray-800 disabled:text-gray-500">
                指導 {p.name}
              </button>
            ))}
          </div>
        )}
        {!canUseActions && !mentoredThisRound && juniors.length > 0 && <p className="mt-1 text-[11px] text-gray-500">等下一次全體行動時間再指導。</p>}
      </div>
    </div>
  );
}

function FamilyAdvisor({ gameState, me, emit }: Omit<Props, 'canUseActions'>) {
  const [targetId, setTargetId] = useState<string>('');
  const living = gameState.players.filter((p) => p.isAlive);
  const cards = gameState.adviceCards ?? [];
  const running = gameState.gamePhase === 'RatRace' || gameState.gamePhase === 'FastTrack';
  const usedThisRound = me.lastAdviceRound === gameState.turnNumber;
  if (!running) return null;
  return (
    <div className="mx-4 my-2 space-y-2 rounded-2xl border border-amber-700 bg-amber-950/30 p-4">
      <p className="text-base font-black text-amber-200">👴 你現在是家族顧問</p>
      <p className="text-xs text-gray-300">你的人生分數已經定格，但你還在這場遊戲裡：全場共同抉擇時你可以投票，每一輪也可以給一位還在世的玩家一句建議，大螢幕會顯示。</p>
      {usedThisRound ? (
        <p className="text-sm text-emerald-300">這一輪的建議已經送出，下一輪再來。</p>
      ) : living.length === 0 ? null : (
        <>
          <div className="flex flex-wrap gap-2">
            {living.map((p) => (
              <button key={p.id} onClick={() => setTargetId(p.id)}
                className={`rounded-lg px-3 py-1.5 text-sm font-bold ${targetId === p.id ? 'bg-amber-600 text-gray-950' : 'bg-gray-800 text-gray-200'}`}>
                {p.name}
              </button>
            ))}
          </div>
          {targetId && (
            <div className="space-y-1.5">
              {cards.map((card) => (
                <button key={card.id} onClick={() => { emit('sendAdvice', { targetPlayerId: targetId, adviceId: card.id }); setTargetId(''); }}
                  className="block w-full rounded-lg border border-amber-800 bg-gray-900 px-3 py-2 text-left text-sm text-gray-100 hover:bg-gray-800">
                  {card.emoji} {card.text}
                </button>
              ))}
            </div>
          )}
        </>
      )}
      {(me.adviceGiven ?? 0) > 0 && <p className="text-[11px] text-gray-500">已給過 {me.adviceGiven} 次建議。</p>}
    </div>
  );
}
