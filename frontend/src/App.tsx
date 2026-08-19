import { lazy, Suspense, useMemo, type ReactNode } from 'react';
import { GameBoard } from './components/game/GameBoard';
import { ErrorBoundary } from './components/ErrorBoundary';

const PlayerPage = lazy(() => import('./pages/PlayerPage'));
const DisplayScreen = lazy(() => import('./pages/DisplayScreen'));
const AdminPage = lazy(() => import('./pages/AdminPage'));

/**
 * 路由：根據 URL 參數決定顯示哪個介面
 *   /           → 玩家手機頁
 *   /?display   → 大螢幕展示
 *   /?admin     → 主持人後台
 *   /?board     → 棋盤預覽（開發用）
 */
export default function App() {
  const mode = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.has('display')) return 'display';
    if (params.has('admin')) return 'admin';
    if (params.has('board')) return 'board';
    return 'player';
  }, []);

  if (mode === 'display') return <RouteShell><DisplayScreen /></RouteShell>;
  if (mode === 'admin') return <RouteShell><AdminPage /></RouteShell>;
  if (mode === 'board') return <ErrorBoundary><BoardPreview /></ErrorBoundary>;
  return <RouteShell><PlayerPage /></RouteShell>;
}

function RouteShell({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundary>
      <Suspense fallback={<div className="min-h-screen bg-gray-950" aria-label="載入遊戲畫面" />}>
        {children}
      </Suspense>
    </ErrorBoundary>
  );
}

function BoardPreview() {
  const demoPLayers = [
    { id: '1', name: '小明', position: 0,  fastTrackPosition: 0,  isInFastTrack: false, isMe: true,  colorIndex: 0 },
    { id: '2', name: '小華', position: 5,  fastTrackPosition: 0,  isInFastTrack: false, isMe: false, colorIndex: 1 },
    { id: '3', name: '阿珍', position: 12, fastTrackPosition: 0,  isInFastTrack: false, isMe: false, colorIndex: 2 },
    { id: '4', name: '大偉', position: 18, fastTrackPosition: 0,  isInFastTrack: false, isMe: false, colorIndex: 3, isBedridden: true },
    { id: '5', name: '雅婷', position: 0,  fastTrackPosition: 3,  isInFastTrack: true,  isMe: false, colorIndex: 4 },
    { id: '6', name: '志遠', position: 0,  fastTrackPosition: 10, isInFastTrack: true,  isMe: false, colorIndex: 5 },
  ];
  return (
    <div className="min-h-screen bg-gray-900 flex flex-col items-center justify-center p-4 gap-4">
      <h1 className="text-emerald-400 font-bold text-lg">棋盤預覽</h1>
      <div className="h-[min(78vh,760px)] w-full max-w-[1360px]">
        <GameBoard
          players={demoPLayers}
          currentTurnPlayerId="2"
          completedRoundsInCycle={2}
          showPlayerPanel={false}
          showMiniMap={false}
          enableCalibration
        />
      </div>
      <p className="text-gray-500 text-xs">發光棋子 = 當前回合玩家 ▎ 中央三段圓盤 = 統一發薪進度</p>
    </div>
  );
}
