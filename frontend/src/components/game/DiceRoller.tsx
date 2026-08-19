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
    setRolling(true);
    onRoll(count);
    setTimeout(() => setRolling(false), 800);
  };

  if (isBedridden) {
    return (
      <div className="senior-dice card text-center text-red-300 font-bold">
        🛏 臥床中，無法行動
        <p className="text-xs text-gray-500 mt-1">等待下回合判定是否自然死亡</p>
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

      {lastRoll && (
        <div className="text-center">
          <span className="text-4xl font-bold text-white">{lastRoll.rolled}</span>
          <p className="text-xs text-gray-400">移動至位置 {lastRoll.newPosition}</p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <button
          className="btn-primary"
          disabled={rolling || !!disabled}
          onClick={() => handleRoll(2)}
        >
          {rolling ? '🎲 擲中…' : '🎲🎲 快速推進'}
        </button>
        <button
          className="btn-secondary"
          disabled={rolling || !!disabled}
          onClick={() => handleRoll(1)}
        >
          🎲 精準移動
        </button>
      </div>
      <p className="text-center text-[11px] text-gray-500">兩顆骰走得快；一顆骰保留落點控制</p>
    </div>
  );
}
