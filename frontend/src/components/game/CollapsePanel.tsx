import { useId, useState } from 'react';

interface CollapsePanelProps {
  title: string;
  badge?: string | number;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

export default function CollapsePanel({ title, badge, defaultOpen = false, children }: CollapsePanelProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const contentId = useId();

  return (
    <div className="senior-collapse-panel border-t border-gray-700">
      <button
        className="senior-collapse-trigger w-full flex items-center justify-between px-4 py-3 bg-gray-800 hover:bg-gray-750 transition-colors"
        onClick={() => setIsOpen((v) => !v)}
        aria-expanded={isOpen}
        aria-controls={contentId}
      >
        <div className="flex items-center gap-2">
          <span className="text-base font-bold text-white">{title}</span>
          {badge !== undefined && Number(badge) > 0 && (
            <span className="bg-blue-600 text-white text-xs rounded-full px-1.5 py-0.5 min-w-[20px] text-center">
              {badge}
            </span>
          )}
        </div>
        <span className="text-gray-300 text-base" aria-hidden="true">{isOpen ? '收起 ▲' : '展開 ▼'}</span>
      </button>
      {isOpen && (
        <div id={contentId} className="senior-collapse-content bg-gray-900 px-4 pb-4 pt-2">
          {children}
        </div>
      )}
    </div>
  );
}
