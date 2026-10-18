import { useEffect, useRef, useState } from 'react';
import { GameAudio, normalizeAudioSettings, type MusicMood, type SoundCue } from '../../lib/gameAudio';

const STORAGE_KEY = 'money-game-display-audio-v1';
export default function DisplayAudio({ mood, active, cue, cueKey }: {
  mood: MusicMood; active: boolean; cue: SoundCue; cueKey: string;
}) {
  const engine = useRef<GameAudio | null>(null);
  const seenCues = useRef(new Set([cueKey]));
  const [enabled, setEnabled] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  const [settings, setSettings] = useState(() => {
    try { return normalizeAudioSettings(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')); }
    catch { return normalizeAudioSettings(null); }
  });
  useEffect(() => {
    const audio = new GameAudio();
    engine.current = audio;
    return () => { engine.current = null; audio.dispose(); };
  }, []);
  useEffect(() => {
    const configure = () => engine.current?.configure(settings, mood, active && !document.hidden);
    configure();
    document.addEventListener('visibilitychange', configure);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); } catch { /* private browsing */ }
    return () => document.removeEventListener('visibilitychange', configure);
  }, [settings, mood, active]);
  useEffect(() => {
    if (!cueKey || seenCues.current.has(cueKey)) return;
    seenCues.current.add(cueKey);
    if (seenCues.current.size > 64) seenCues.current.delete(seenCues.current.values().next().value!);
    engine.current?.play(cue);
  }, [cue, cueKey]);

  async function toggle() {
    if (enabled) { engine.current?.mute(); setEnabled(false); return; }
    setStarting(true);
    try {
      await engine.current?.enable();
      setEnabled(true); setError('');
    } catch { setError('無法啟用聲音，請確認瀏覽器音訊權限後再試。'); }
    finally { setStarting(false); }
  }
  return <details className="relative shrink-0 text-sm">
    <summary className="cursor-pointer rounded-lg border border-gray-600 bg-gray-800 px-3 py-2">{enabled ? '🔊' : '🔇'} 聲音設定</summary>
    <div className="absolute left-0 top-full z-[100] mt-2 w-72 max-w-[90vw] space-y-3 rounded-xl border border-gray-600 bg-gray-900 p-4 shadow-xl" aria-label="展示頁音訊控制">
      <button type="button" disabled={starting} onClick={() => void toggle()} aria-pressed={enabled} className="w-full rounded-lg bg-emerald-700 p-3 font-bold">{starting ? '啟用中…' : enabled ? '全部靜音' : '啟用聲音'}</button>
      {(['music', 'effects'] as const).map(key => <label key={key} className="block">
        {key === 'music' ? '背景配樂' : '事件音效'}：{settings[key]}%
        <input className="block w-full" type="range" min="0" max="100" value={settings[key]} onChange={e => setSettings(s => ({ ...s, [key]: Number(e.target.value) }))} />
      </label>)}
      <p className="text-xs text-gray-300">只在這台展示裝置播放。多台展示頁請只開一台聲音。決策時配樂降低；暫停、斷線或切到背景時靜音。重新開頁需再次啟用。</p>
      {error && <p role="alert" className="text-amber-200">{error}</p>}
    </div>
  </details>;
}
