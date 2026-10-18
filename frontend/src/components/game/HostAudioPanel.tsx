import { DEFAULT_ROOM_AUDIO } from '../../audioSettings';
import type { GameState } from '../../types/game';

export default function HostAudioPanel({ gameState, emit }: {
  gameState: GameState | null; emit: (event: string, payload: unknown) => void;
}) {
  if (!gameState) return null;
  const audio = gameState.audioSettings ?? DEFAULT_ROOM_AUDIO;
  return <details className="rounded-xl border border-emerald-800 bg-gray-900 p-4">
    <summary className="cursor-pointer text-lg font-bold">🎵 大螢幕聲音 · {audio.enabled ? '已開啟' : '已靜音'}</summary>
    <div className="mt-3 space-y-4">
      <p className="text-sm text-gray-300">輕快原創配樂。聲音只從已啟用音訊的大螢幕播放，手機不播放。</p>
      <button type="button" className="w-full rounded-xl bg-emerald-700 p-3 font-bold" aria-pressed={!audio.enabled}
        onClick={() => emit('setRoomAudio', { enabled: !audio.enabled })}>{audio.enabled ? '全部靜音' : '恢復聲音'}</button>
      {(['music', 'effects'] as const).map(key => <div key={key} className="flex flex-wrap items-center justify-between gap-2">
        <span>{key === 'music' ? '背景配樂' : '事件音效'}：{audio[key]}%{audio[key] === 0 ? '（關閉）' : ''}</span>
        <div className="flex gap-2">
          <button type="button" className="rounded-lg bg-gray-700 px-4 py-3" disabled={audio[key] === 0}
            aria-label={`降低${key === 'music' ? '配樂' : '音效'}音量`} onClick={() => emit('setRoomAudio', { [key]: Math.max(0, audio[key] - 10) })}>−</button>
          <button type="button" className="rounded-lg bg-gray-700 px-4 py-3" disabled={audio[key] === 100}
            aria-label={`提高${key === 'music' ? '配樂' : '音效'}音量`} onClick={() => emit('setRoomAudio', { [key]: Math.min(100, audio[key] + 10) })}>＋</button>
          <button type="button" className="rounded-lg bg-gray-700 px-3 py-3" onClick={() => emit('setRoomAudio', { [key]: audio[key] ? 0 : DEFAULT_ROOM_AUDIO[key] })}>{audio[key] ? '關閉' : '開啟'}</button>
        </div>
      </div>)}
      <p className="text-sm text-amber-200">首次請在大螢幕點「聲音設定 → 啟用本機聲音」。手機不能代替瀏覽器首次授權；重新開頁後需再啟用一次。遊戲暫停時仍會靜音。</p>
    </div>
  </details>;
}
