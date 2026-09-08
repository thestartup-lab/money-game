import { useState } from 'react';
import type { GameState } from '../../types/game';

export interface AdaptiveDirectorStatus {
  enabled: boolean;
  mode: 'support' | 'balanced' | 'challenge';
  score: number;
  reason: string;
  globalPaydayNumber: number;
  lastEventTitle?: string;
  pendingEvent?: { id: string; title: string; description: string; source: string; deferred: boolean } | null;
  eventCatalog?: { id: string; title: string; description: string; major: boolean; restriction: string | null }[];
  activeEffects?: string[];
  history?: { title: string; round: number; source: string }[];
}

interface Props {
  gameState: GameState;
  status: AdaptiveDirectorStatus | null;
  emit: (name: string, payload?: unknown) => void;
}

export default function WorldEventControlPanel({ gameState, status, emit }: Props) {
  const [selectedId, setSelectedId] = useState('');
  const selected = status?.eventCatalog?.find((event) => event.id === selectedId);
  const running = ['RatRace', 'FastTrack'].includes(gameState.gamePhase) && !gameState.finalRoundStarted;
  const busy = Boolean(gameState.decisionPhase || gameState.facilitatorScene || gameState.globalPaydayPending || gameState.globalPaydayInProgress);
  const pending = status?.pendingEvent;
  const button = 'min-h-12 rounded-xl px-4 py-3 text-base font-bold text-white disabled:opacity-40 disabled:cursor-not-allowed';

  return (
    <section className="space-y-4" aria-label="世界事件控制">
      <div className="rounded-xl border border-cyan-700 bg-cyan-950/50 p-4 text-white">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-lg font-black">自動導演・{status?.mode === 'support' ? '支援全場' : status?.mode === 'challenge' ? '加入考驗' : '維持平衡'}</h3>
          <button className={`${button} bg-cyan-800`} onClick={() => emit('setAdaptiveDirectorEnabled', { enabled: status?.enabled === false })}>
            {status?.enabled === false ? '開啟自動選事件' : '自動選事件已開啟'}
          </button>
        </div>
        <p className="mt-2">上次季度評估 {status?.score ?? 50}/100</p>
        <p className="mt-1 text-sm text-cyan-100">{status?.reason ?? '等待全體發薪後評估'}</p>
        <p className="mt-2 text-sm text-cyan-100">第 2 次全體發薪起評估；自動事件至少間隔兩季。電腦選事件，由主持人揭曉後生效。</p>
      </div>

      {pending ? (
        <div className="rounded-xl border-2 border-amber-500 bg-amber-950/50 p-4 text-white" aria-live="polite">
          <p className="text-sm text-amber-200">{pending.source === 'automatic' ? '電腦安排' : '主持人安排'}・{pending.deferred ? '已延後' : '等待適合時機登場'}</p>
          <h3 className="mt-1 text-xl font-black">{pending.title}</h3>
          <p className="mt-2 text-base leading-relaxed">{pending.description}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button disabled={!running || busy} className={`${button} bg-amber-700`} onClick={() => emit('manageWorldEvent', { id: pending.id, action: 'open' })}>登上大螢幕</button>
            <button disabled={gameState.facilitatorScene?.kind === 'global_event'} className={`${button} bg-gray-700`} onClick={() => emit('manageWorldEvent', { id: pending.id, action: 'cancel' })}>取消待登場事件</button>
          </div>
        </div>
      ) : null}

      <div className="rounded-xl border border-orange-700 bg-orange-950/30 p-4 text-white">
        <label htmlFor="world-event-select" className="block text-lg font-black">安排世界事件</label>
        <select id="world-event-select" className="mt-3 min-h-12 w-full rounded-xl border border-gray-500 bg-gray-950 p-3 text-base" value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>
          <option value="">選擇事件，先查看效果</option>
          {(status?.eventCatalog ?? []).map((event) => <option key={event.id} value={event.id}>{event.title}{event.major ? '・重大' : ''}</option>)}
        </select>
        {selected ? <p className="mt-3 text-base leading-relaxed">{selected.description}</p> : null}
        {selected?.restriction ? <p className="mt-2 text-amber-200">{selected.restriction}</p> : null}
        <button disabled={!running || !selected || Boolean(selected.restriction) || Boolean(pending)} className={`${button} mt-3 w-full bg-orange-700`} onClick={() => emit('triggerGlobalEvent', { eventId: selectedId })}>
          {busy ? '排入目前流程結束後' : '開啟事件舞台'}
        </button>
        <p className="mt-3 text-sm text-orange-100">每季最多一次世界事件；同一事件至少隔兩季。重大事件各限一次，每場最多兩次。按下揭曉前不會改動玩家數值。</p>
      </div>

      {status?.activeEffects?.length ? <div className="rounded-xl bg-gray-900 p-4 text-white"><h3 className="font-bold">持續中的影響</h3><ul className="mt-2 space-y-2">{status.activeEffects.map((effect) => <li key={effect}>{effect}</li>)}</ul></div> : null}
      {status?.history?.length ? <details className="rounded-xl bg-gray-900 p-4 text-white"><summary>本場世界事件紀錄（{status.history.length}）</summary><ol className="mt-2 space-y-2">{status.history.map((entry, index) => <li key={index}>完成 {entry.round} 輪時・{entry.title}（{entry.source === 'automatic' ? '電腦安排' : '主持人安排'}）</li>)}</ol></details> : null}

      <button disabled={!running || busy} className={`${button} w-full bg-violet-800`} onClick={() => emit('triggerSpecialAuction', {})}>開啟全場特殊拍賣</button>
      <p className="text-sm text-gray-300">拍賣需等目前流程完成，結束時間由主持人控制。</p>
    </section>
  );
}
