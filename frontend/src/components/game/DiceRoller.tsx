import { useState } from 'react';

interface Props {
  isMyTurn: boolean;
  isBedridden: boolean;
  onRoll: (diceCount: 1 | 2) => void;
  lastRoll?: { rolled: number; newPosition: number };
  disabled?: boolean;
}

export default function DiceRoller({ isMyTurn, isBedridden, onRoll, lastRoll, disabled }: Props) {
  const [rolling, setRolling] = useState(false);

  const handleRoll = (count: 1 | 2) => {
    if (rolling || disabled || !isMyTurn) return;
    setRolling(true);
    onRoll(count);
    setTimeout(() => setRolling(false), 800);
  };

  if (isBedridden) {
    return (
      <div className="senior-dice card text-center space-y-2">
        <p className="text-red-300 font-bold">🛏 臥床中，無法行動</p>
        {isMyTurn ? (
          <>
            <p className="text-xs text-gray-400">輪到你了：按下後由系統判定本回合是否康復或自然離世，然後交棒給下一位。</p>
            <button
              className="btn-secondary w-full"
              disabled={rolling || !!disabled}
              onClick={() => handleRoll(1)}
            >
              {rolling ? '判定中…' : '跳過本回合（臥床判定）'}
            </button>
          </>
        ) : (
          <p className="text-xs text-gray-500">輪到你時會進行臥床判定</p>
        )}
      </div>
    );
  }

  if (!isMyTurn) {
    return (
      <div className="senior-dice card text-center text-gray-300 font-bold">
        ⏳ 等待其他玩家行動中…
      </div>
    );
  }

  return (
    <div className="senior-dice card space-y-3">
      <p className="text-center text-emerald-300 font-black text-xl">輪到你了！</p>

      <div className="grid grid-cols-2 gap-3">
        <button
          className="btn-primary"
          disabled={rolling || !!disabled}
          onClick={() => handleRoll(2)}
        >
          {rolling ? '🎲 擲中…' : <>擲 2 顆骰<span className="block mt-1">快速推進</span></>}
        </button>
        <button
          className="btn-secondary"
          disabled={rolling || !!disabled}
          onClick={() => handleRoll(1)}
        >
          擲 1 顆骰<span className="block mt-1">小步前進</span>
        </button>
      </div>
      <p className="text-center text-sm text-gray-300">選擇骰子數量，擲出後看大螢幕</p>
      {lastRoll && <p className="text-center text-xs text-gray-400">上次擲出 {lastRoll.rolled} 點</p>}
    </div>
  );
}
