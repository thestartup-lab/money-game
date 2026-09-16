export interface EffectRow {
  label: string;
  value: string;
  /** good=綠、bad=紅、neutral=白 */
  tone?: 'good' | 'bad' | 'neutral';
}

interface Props {
  title: string;
  rows: EffectRow[];
  notes?: string[];
  confirmLabel?: string;
  cancelLabel?: string;
  disabled?: boolean;
  disabledReason?: string;
  onConfirm?: () => void;
  onCancel: () => void;
}

/** 點選任何行動時彈出的「效果與價值」說明卡；確認後才真正執行。 */
export default function EffectPreview({ title, rows, notes, confirmLabel = '確認執行', cancelLabel = '取消', disabled, disabledReason, onConfirm, onCancel }: Props) {
  return (
    <div className="rounded-xl border border-yellow-600 bg-gray-800 p-3 space-y-2" role="dialog" aria-label={title}>
      <p className="text-sm font-bold text-white">{title}</p>
      <div className="space-y-1">
        {rows.map((r, i) => (
          <div key={i} className="flex items-start justify-between gap-3 text-sm">
            <span className="text-gray-300">{r.label}</span>
            <span className={`shrink-0 text-right font-bold ${r.tone === 'good' ? 'text-emerald-300' : r.tone === 'bad' ? 'text-red-300' : 'text-white'}`}>{r.value}</span>
          </div>
        ))}
      </div>
      {notes && notes.length > 0 && (
        <ul className="space-y-0.5 border-t border-gray-700 pt-2">
          {notes.map((n, i) => <li key={i} className="text-[11px] leading-snug text-gray-400">• {n}</li>)}
        </ul>
      )}
      {disabled && disabledReason && <p className="text-xs text-red-300">✗ {disabledReason}</p>}
      <div className={`grid gap-2 pt-1 ${onConfirm ? 'grid-cols-2' : 'grid-cols-1'}`}>
        <button type="button" className="btn-secondary text-sm" onClick={onCancel}>{cancelLabel}</button>
        {onConfirm && <button type="button" className="btn-primary text-sm" disabled={disabled} onClick={onConfirm}>{confirmLabel}</button>}
      </div>
    </div>
  );
}
