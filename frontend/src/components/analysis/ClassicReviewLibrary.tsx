import { useState } from 'react';
import type { SavedClassicReview } from '../../lib/classicReviews';
import DecisionHistoryView from './DecisionHistoryView';

interface Props {
  reviews: SavedClassicReview[];
  onDelete: (reviewId: string) => void;
}

const fmt = (value: number) => value.toLocaleString('zh-TW', { maximumFractionDigits: 0 });

export default function ClassicReviewLibrary({ reviews, onDelete }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = reviews.find((review) => review.id === selectedId) ?? null;

  if (reviews.length === 0) return null;

  return (
    <details className="card" open={Boolean(selected)}>
      <summary className="cursor-pointer text-lg font-black text-white">
        ⭐ 經典場次（這台裝置，共 {reviews.length} 場）
      </summary>
      <p className="mt-2 text-sm text-gray-400">
        只有你主動保存的場次會出現在這裡；資料只留在目前瀏覽器，不會上傳雲端。
      </p>
      <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        {reviews.map((review) => (
          <div key={review.id} className="rounded-xl border border-slate-600 bg-slate-900/70 p-3">
            <p className="font-black text-yellow-200">{review.title}</p>
            <p className="mt-1 text-xs text-gray-400">
              {new Date(review.savedAt).toLocaleString('zh-TW')} · {review.analysis.players.length} 位玩家
            </p>
            <div className="mt-3 flex gap-2">
              <button
                className="flex-1 rounded-lg bg-indigo-700 px-3 py-2 text-sm font-bold text-white hover:bg-indigo-600"
                onClick={() => setSelectedId(selectedId === review.id ? null : review.id)}
              >
                {selectedId === review.id ? '收起復盤' : '開啟復盤'}
              </button>
              <button
                className="rounded-lg border border-red-700 bg-red-950 px-3 py-2 text-sm font-bold text-red-200 hover:bg-red-900"
                onClick={() => {
                  if (!window.confirm(`確定刪除「${review.title}」？刪除後無法復原。`)) return;
                  onDelete(review.id);
                  if (selectedId === review.id) setSelectedId(null);
                }}
              >
                刪除
              </button>
            </div>
          </div>
        ))}
      </div>

      {selected ? (
        <div className="mt-5 rounded-2xl border border-indigo-700 bg-gray-950 p-4">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-indigo-300">經典場次復盤</p>
              <h3 className="mt-1 text-xl font-black text-white">{selected.title}</h3>
            </div>
            <div className="flex flex-wrap gap-2">
              {selected.analysis.players.slice(0, 3).map((player, index) => (
                <span key={player.playerId} className="rounded-lg bg-slate-800 px-3 py-2 text-xs text-gray-200">
                  #{index + 1} {player.playerName} · {Math.round(player.score.total)} 分 · 淨資產 ${fmt(player.finalNetWorth)}
                </span>
              ))}
            </div>
          </div>
          <DecisionHistoryView analysis={selected.analysis} />
        </div>
      ) : null}
    </details>
  );
}
