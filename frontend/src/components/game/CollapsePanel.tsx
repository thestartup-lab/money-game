import { useState } from 'react';

interface CollapsePanelProps {
  title: string;
  badge?: string | number;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

export default function CollapsePanel({ title, badge, defaultOpen = false, children }: CollapsePanelProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="border-t border-gray-700">
      <button
        className="w-full flex items-center justify-between px-4 py-3 bg-gray-800 hover:bg-gray-750 transition-colors"
        onClick={() => setIsOpen((v) => !v)}
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-200">{title}</span>
          {badge !== undefined && Number(badge) > 0 && (
            <span className="bg-blue-600 text-white text-xs rounded-full px-1.5 py-0.5 min-w-[20px] text-center">
              {badge}
            </span>
          )}
        </div>
        <span className="text-gray-400 text-xs">{isOpen ? '▲' : '▼'}</span>
      </button>
      {isOpen && (
        <div className="bg-gray-900 px-4 pb-4 pt-2">
          {children}
        </div>
      )}
    </div>
  );
}
