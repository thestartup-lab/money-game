// 復盤畫面共用的事件圖示與中文標籤；後端新增事件類型時在這裡補一行即可。
export const EVENT_ICONS: Record<string, string> = {
  game_start: '🎬', payday: '💵', payday_plan: '🗓️', insurance: '🛡️',
  asset_buy: '🏠', asset_sell: '💰', travel: '✈️',
  marriage: '💑', child: '👶', crisis: '⚠️',
  career_change: '💼', education: '🎓', rat_race_escaped: '🚀',
  loan_taken: '🏦', loan_repaid: '✅', bedridden: '🛏', death: '⚰️',
  relationship: '🤝', franchise: '🏪', global_event: '🌍',
  bucket_goal_achieved: '🎯', life_milestone: '🏅', lucky_card: '🍀',
  property_event: '🏚️', community_choice: '🗳️', decision_echo: '🔁',
  cooperation: '🤲', legacy: '🌟',
};

export const EVENT_LABELS: Record<string, string> = {
  game_start: '開局', payday: '發薪', payday_plan: '發薪規劃', insurance: '投保',
  asset_buy: '投資', asset_sell: '出售資產', travel: '旅遊',
  marriage: '婚姻', child: '生育', crisis: '危機',
  career_change: '轉職', education: '進修', rat_race_escaped: '脫出老鼠賽跑',
  loan_taken: '借款', loan_repaid: '還清貸款', bedridden: '臥床', death: '離世',
  relationship: '人際', franchise: '加盟創業', global_event: '世界事件',
  bucket_goal_achieved: '夢想達成', life_milestone: '人生里程碑', lucky_card: '幸運卡',
  property_event: '房東事件', community_choice: '共同抉擇', decision_echo: '決策回聲',
  cooperation: '合作契約', legacy: '傳承',
};

export const eventIcon = (type: string, fallback = '•') => EVENT_ICONS[type] ?? fallback;
export const eventLabel = (type: string) => EVENT_LABELS[type] ?? type;
