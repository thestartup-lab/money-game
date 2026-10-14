// PNG v6: IDs are zero-based; printed numbers are ID + 1.
export const INNER_NODES = [
  ['人生起點','start',51.3,8.5], ['投資機會','deal',63.3,8.5],
  ['世界變化','market',72.7,8.5], ['人生選路','fork',83.7,8.5],
  ['進修培訓','training',92.2,33], ['職涯機會','career',92.2,51],
  ['合作邀約','cooperate',92.2,70], ['出國旅遊','travel',81.4,33],
  ['人際關係','social',81.4,51], ['家庭抉擇','family',81.4,70],
  ['生活服務站','service',80,86], ['意外支出','expense',62.5,86],
  ['家庭抉擇','family',44.4,86], ['人生選路','fork',24,86],
  ['投資機會','deal',7.8,70], ['職涯機會','career',7.8,51],
  ['市場行情','market',7.8,33], ['健康照顧','health',19.1,70],
  ['人生體驗','experience',19.1,51], ['家庭抉擇','family',19.1,33],
  ['生活服務站','service',9.2,8.5], ['危機事件','crisis',19.8,8.5],
  ['關係修復','repair',29.5,8.5], ['第二人生','second',39.1,8.5],
] as const;
export const OUTER_NODES = [
  ['第二人生起點','start',10,65], ['事業擴張','deal',6,36],
  ['家庭抉擇','family',15,24], ['人生夢想','dream',30,24],
  ['世界變化','market',44.5,24], ['健康照顧','health',59.5,24],
  ['合作邀約','cooperate',74.1,24], ['家庭抉擇','family',89.4,23],
  ['生活服務站','service',94.5,45], ['資產調整','assets',94.5,72],
  ['人生體驗','travel',85.8,93], ['傳承與指導','legacy',71.8,93],
  ['家庭抉擇','family',59,93], ['危機考驗','crisis',46.3,93],
  ['慈善行動','charity',34.1,93], ['關係修復','repair',22.2,93],
  ['生活服務站','service',9.6,93],
] as const;
export function nextInnerNode(position: number, direction: 'career' | 'life' = 'career'): number {
  if (position === 3) return direction === 'career' ? 4 : 7;
  if (position === 13) return direction === 'career' ? 14 : 17;
  if (position === 6 || position === 9) return 10;
  if (position === 16 || position === 19) return 20;
  return (position + 1) % 24;
}

/** All reachable destinations, not probabilities or recommendations. Unchosen forks include both paths. */
export function reachableDiceCells(position: number, outer: boolean, dice: number, direction?: 'career' | 'life'): number[] {
  let frontier = new Set([position]);
  const result = new Set<number>();
  for (let step = 1; step <= dice * 6; step++) {
    const next = new Set<number>();
    for (const cell of frontier) {
      if (outer) next.add((cell + 1) % OUTER_NODES.length);
      else if (cell === 3 || cell === 13) {
        const choices = step === 1 && direction ? [direction] : ['career', 'life'] as const;
        for (const choice of choices) next.add(nextInnerNode(cell, choice));
      } else next.add(nextInnerNode(cell));
    }
    frontier = next;
    if (step >= dice) for (const cell of frontier) result.add(cell);
  }
  return [...result].sort((a,b) => a-b);
}
