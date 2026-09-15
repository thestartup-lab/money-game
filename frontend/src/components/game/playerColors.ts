/**
 * 全場統一的玩家色盤。index 一律用 gameState.playerOrder 的順序（伺服器 colorIndex 同源），
 * 大螢幕側欄、棋盤棋子、骰子動畫、轉場與發薪小卡才會是同一個顏色。
 */
export const PLAYER_COLORS = ['#f59e0b', '#60a5fa', '#f472b6', '#34d399', '#a78bfa', '#fb923c'] as const;

export function playerColor(index: number): string {
  return PLAYER_COLORS[((index % PLAYER_COLORS.length) + PLAYER_COLORS.length) % PLAYER_COLORS.length];
}

export function playerColorIndex(playerOrder: string[] | undefined, playerId: string, fallback = 0): number {
  const idx = playerOrder?.indexOf(playerId) ?? -1;
  return idx >= 0 ? idx : fallback;
}
