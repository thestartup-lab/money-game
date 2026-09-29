/** 大螢幕舞台事件：婚姻、家庭、社區選擇、合作契約、決策回聲、傳承儀式 */
import { randomBytes } from 'crypto';
import { GameState, Player, GamePhase, PlayerEvent, PlayerEventType, FacilitatorSceneState, AssetType } from './gameDataModels';
import { createSpouse, describeMarriagePreview, payWedding } from './gameLogic';
import { communityVoters } from './lateLife';
import { addLifeExperience, getCurrentAge, pauseGameClock, resumeGameClock, confirmMarriage, buyArrangedMarriage, getArrangedMarriageCost } from './gameLogic';
import { LIFE_EXP, LIFE_EVENT_WINDOWS, MARRIAGE_GIFT, MARRIAGE_GIFT_RANDOM_BONUS, CHILD_GIFT_BASE, CHILD_GIFT_RANDOM_BONUS, MAX_CHILDREN, MIN_CHILD_SPACING_YEARS, MIN_CHILD_AGE, MAX_CHILD_AGE, MARRIED_RENT_INCREASE, RELATIONSHIP_MARRIAGE_THRESHOLD, HP_ACTIVITY_THRESHOLDS } from './gameConfig';
import { PER_CHILD_EXPENSE } from './gameConstants';
import { MARRIAGE_CARDS, MarriageCard } from './gameCards';
import { applyBabyCard } from './cardSystem';
import { serializeGameState } from './playerView';
import {
  COMMUNITY_CHOICE_CARDS, COOPERATION_CONTRACTS, LEGACY_CHOICES, MarriageSceneRoute, calcNetWorth, continueAfterTurnAdvance,
  emitAdaptiveDirectorStatus, emitToRoom, getPlayerAge, logPlayerEvent, tryOpenWorldEvent,
} from './socketServer';

export function clampFacilitatorStat(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

/** 舞台事件的 HP 增減；HP 回到 0 以上時同步解除臥床。 */
export function adjustFacilitatorHealth(player: Player, delta: number): void {
  player.stats.health = clampFacilitatorStat(player.stats.health + delta, 1, 100);
  if (player.stats.health > 0 && player.isBedridden) player.isBedridden = false;
}

export function spendAvailableCash(player: Player, requested: number): number {
  const paid = Math.min(Math.max(0, player.cash), requested);
  player.cash -= paid;
  return paid;
}

export function beginFacilitatorScene(
  gs: GameState,
  scene: Omit<FacilitatorSceneState, 'id' | 'stage' | 'resumeOnClose'>,
  context: Record<string, unknown>,
): void {
  const resumeOnClose = gs.pausedAt === null;
  if (resumeOnClose) pauseGameClock(gs);
  gs.facilitatorScene = {
    ...scene,
    id: `scene-${Date.now()}-${randomBytes(3).toString('hex')}`,
    stage: 'prompt',
    resumeOnClose,
  };
  gs.facilitatorSceneContext = context;
  emitToRoom(gs.gameId, 'gamePaused', {
    reason: scene.title,
    currentAge: Math.round(getCurrentAge(gs) * 10) / 10,
    controlledByHost: true,
  });
  emitToRoom(gs.gameId, 'gameStateUpdate', serializeGameState(gs));
}

export function revealFacilitatorResult(gs: GameState, title: string, description: string): void {
  const scene = gs.facilitatorScene;
  if (!scene) return;
  gs.facilitatorScene = {
    ...scene,
    stage: 'result',
    options: undefined,
    resultTitle: title,
    resultDescription: description,
  };
  emitToRoom(gs.gameId, 'gameStateUpdate', serializeGameState(gs));
}

export function pickMarriageCard(currentAge: number): MarriageCard {
  const ageAppropriateCards = currentAge >= 50
    ? MARRIAGE_CARDS
    : MARRIAGE_CARDS.filter((candidate) => candidate.id !== 'marry-003');
  return ageAppropriateCards[Math.floor(Math.random() * ageAppropriateCards.length)];
}

export function buildMarriageScene(
  player: Player,
  route: MarriageSceneRoute,
  card?: MarriageCard,
  currentAge = 20,
): Omit<FacilitatorSceneState, 'id' | 'stage' | 'resumeOnClose'> {
  if (route === 'arranged') {
    const cost = getArrangedMarriageCost(currentAge);
    return {
      kind: 'marriage',
      kicker: '婚姻與人生選擇',
      title: `${player.name} 的付費婚配機會`,
      description: `需要 $${cost.toLocaleString()}，生命體驗 +${LIFE_EXP.MARRIAGE_ARRANGED}。${describeMarriagePreview(player, 0.8, false)}。`,
      participantNames: [player.name],
      reminderEndsAt: Date.now() + 60_000,
      options: [
        { id: 'accept', label: '接受婚配', description: '承擔較高的一次性費用，換取較穩定但有限的婚姻支持。' },
        { id: 'decline', label: '保留單身', description: '保留現金，繼續等待其他關係機會。' },
      ],
    };
  }

  if (route === 'love' || route === 'matchmaker') {
    const isMatchmaker = route === 'matchmaker';
    const lifeExp = isMatchmaker ? LIFE_EXP.MARRIAGE_MATCHMAKER : LIFE_EXP.MARRIAGE_LOVE;
    return {
      kind: 'marriage',
      kicker: isMatchmaker ? '主持人媒合・關係達標' : '深度關係達標',
      title: `${player.name}，要一起走下去嗎？`,
      description: `關係經營值已達 ${player.relationshipPoints}/${RELATIONSHIP_MARRIAGE_THRESHOLD}。${isMatchmaker ? '由主持人促成這段緣分，' : ''}生命體驗 +${lifeExp}。${describeMarriagePreview(player)}。`,
      participantNames: [player.name],
      reminderEndsAt: Date.now() + 60_000,
      options: [
        { id: 'accept', label: '決定結婚', description: '讓長期經營的關係成為人生共同體。' },
        { id: 'decline', label: '暫不結婚', description: '保留關係累積，未來仍可再次提出。' },
      ],
    };
  }

  const selectedCard = card ?? pickMarriageCard(currentAge);
  return {
    kind: 'marriage',
    kicker: '緣分來到人生路口',
    title: `${player.name}｜${selectedCard.title}`,
    description: `${selectedCard.description} 生命體驗 +${selectedCard.lifeExpGain}。${describeMarriagePreview(player)}。`,
    participantNames: [player.name],
    reminderEndsAt: Date.now() + 60_000,
    options: [
      { id: 'accept', label: '答應，一起走下去', description: '接受這段關係帶來的支持、責任與未知。' },
      { id: 'decline', label: '婉拒，走自己的路', description: '不套用效果，保留現在的人生方向。' },
    ],
  };
}

export function startMarriageScene(
  gs: GameState,
  player: Player,
  route: MarriageSceneRoute,
  card?: MarriageCard,
): void {
  const selectedCard = route === 'window'
    ? (card ?? pickMarriageCard(getPlayerAge(gs, player)))
    : undefined;
  beginFacilitatorScene(
    gs,
    buildMarriageScene(player, route, selectedCard, getPlayerAge(gs, player)),
    { playerId: player.id, marriageRoute: route, marriageCard: selectedCard },
  );
}

export function transitionFamilySceneToMarriage(gs: GameState, player: Player): void {
  const current = gs.facilitatorScene;
  if (!current) return;
  const card = pickMarriageCard(getPlayerAge(gs, player));
  gs.facilitatorScene = {
    ...buildMarriageScene(player, 'window', card, getPlayerAge(gs, player)),
    id: current.id,
    stage: 'prompt',
    resumeOnClose: current.resumeOnClose,
  };
  gs.facilitatorSceneContext = { playerId: player.id, marriageRoute: 'window', marriageCard: card };
  emitToRoom(gs.gameId, 'gameStateUpdate', serializeGameState(gs));
}

export function startFamilyScene(gs: GameState, player: Player, source: 'inner' | 'outer'): void {
  beginFacilitatorScene(gs, {
    kind: 'family',
    kicker: source === 'outer' ? '第二人生家庭篇章' : '家庭事件',
    title: `${player.name} 的家庭迎來轉折`,
    description: player.isMarried
      ? '共同生活正在進入下一個階段。主持人準備好後，揭曉這次家庭事件。'
      : '人生可能出現一段新的關係。主持人準備好後，揭曉這次家庭事件。',
    participantNames: [player.name],
    options: [{ id: 'reveal', label: '揭曉家庭事件', description: '結果會依年齡、健康、婚姻狀態與過往家庭歷程判定。' }],
  }, { playerId: player.id, familySource: source });
}

/** 結婚後的金錢說明：配偶實拿、家裡多的支出、每月淨變化、婚禮與禮金 */
function marriageMoneyText(player: Player, cashflowBefore: number, wedding: ReturnType<typeof payWedding> | null, gift: number): string {
  const extra = player.spouseLivingExpenses + (player.housing === 'own' ? 0 : Math.round((player.expenses.rent ?? 0) * player.livingCostMultiplier * MARRIED_RENT_INCREASE));
  const net = player.monthlyCashflow - cashflowBefore;
  const parts = [
    `配偶每月實拿 +$${(player.spouse?.income ?? 0).toLocaleString()}`,
    `家裡每月多 $${extra.toLocaleString()} 支出`,
    `每月淨${net >= 0 ? '增' : '減'} $${Math.abs(net).toLocaleString()}`,
  ];
  if (wedding) parts.push(`婚禮 −$${wedding.paid.toLocaleString()}${wedding.simplified ? '（現金不夠，簡單辦）' : ''}`);
  if (gift) parts.push(`禮金 +$${gift.toLocaleString()}`);
  return parts.join('、');
}

export function applyMarriageScene(gs: GameState, player: Player, context: Record<string, unknown>): string | null {
  const route = context.marriageRoute as MarriageSceneRoute;
  const card = context.marriageCard as MarriageCard | undefined;
  const cashBefore = player.cash;
  const cashflowBefore = player.monthlyCashflow;
  const netWorthBefore = calcNetWorth(player);
  let lifeExpGained = 0;
  let marriageGift = 0;
  let healthGained = 0;
  let description: string;

  if (route === 'window') {
    if (!card || player.isMarried) return null;
    player.isMarried = true;
    player.marriageType = 'love';
    player.marriageBonus = 0;
    createSpouse(player);
    lifeExpGained = card.lifeExpGain;
    addLifeExperience(player, lifeExpGained);
    marriageGift = gs.marriageGiftOverride ?? (MARRIAGE_GIFT.window + Math.round(Math.random() * MARRIAGE_GIFT_RANDOM_BONUS));
    player.cash += marriageGift;
    if (card.id === 'marry-003') {
      const previousHealth = player.stats.health;
      adjustFacilitatorHealth(player, 10);
      healthGained = player.stats.health - previousHealth;
    }
    description = `${player.name} 接受「${card.title}」：${marriageMoneyText(player, cashflowBefore, payWedding(player), marriageGift)}、生命體驗 +${lifeExpGained}${healthGained > 0 ? `、健康 +${healthGained}` : ''}。`;
  } else if (route === 'love' || route === 'matchmaker') {
    const result = confirmMarriage(player, route);
    if (!result.success) return null;
    lifeExpGained = result.lifeExpGained ?? 0;
    marriageGift = gs.marriageGiftOverride ?? (MARRIAGE_GIFT[route] + Math.round(Math.random() * MARRIAGE_GIFT_RANDOM_BONUS));
    player.cash += marriageGift;
    description = `${player.name} 把${route === 'matchmaker' ? '主持人促成的緣分' : '長期經營的關係'}帶進婚姻：${marriageMoneyText(player, cashflowBefore, payWedding(player), marriageGift)}、生命體驗 +${lifeExpGained}。`;
  } else {
    const currentAge = getPlayerAge(gs, player);
    const cost = getArrangedMarriageCost(currentAge);
    const result = buyArrangedMarriage(player, currentAge);
    if (!result.success) return null;
    lifeExpGained = result.lifeExpGained ?? 0;
    description = `${player.name} 完成付費婚配：支出 $${cost.toLocaleString()}，${marriageMoneyText(player, cashflowBefore, null, 0)}、生命體驗 +${lifeExpGained}。`;
  }

  logPlayerEvent(player, gs, 'marriage', description, cashBefore, cashflowBefore, netWorthBefore, {
    marriageRoute: route,
    cardId: card?.id,
    spouseIncome: player.spouse?.income ?? 0,
    monthlyCashflowChange: player.monthlyCashflow - cashflowBefore,
    lifeExpGained,
    marriageGift,
    healthGained,
  });
  emitToRoom(gs.gameId, 'marriageAnnouncement', {
    playerId: player.id,
    playerName: player.name,
    marriageType: player.marriageType,
    spouseIncome: player.spouse?.income ?? 0,
    lifeExpGained,
    marriageGift,
    healthGained,
    canCongratulate: true,
  });
  return description;
}

export function resolveFamilyScene(gs: GameState, player: Player): void {
  const currentAge = getPlayerAge(gs, player);
  if (!player.isMarried) {
    const marriageWindow = LIFE_EVENT_WINDOWS.marriage;
    const inPeak = currentAge >= marriageWindow.peakStart && currentAge <= marriageWindow.peakEnd;
    const probability = inPeak ? marriageWindow.peakProbability : marriageWindow.baseProbability;
    if (Math.random() < probability) {
      transitionFamilySceneToMarriage(gs, player);
    } else {
      revealFacilitatorResult(gs, '這次沒有進入婚姻', `${player.name} 保持現在的生活方向；關係仍可能在往後的人生出現。`);
    }
    return;
  }

  if (player.numberOfChildren >= MAX_CHILDREN) {
    revealFacilitatorResult(gs, '家庭進入穩定階段', `${player.name} 已有 ${player.numberOfChildren} 名子女，本局不再新增子女，但家庭關係仍會影響復盤。`);
    return;
  }
  if (player.stats.health < HP_ACTIVITY_THRESHOLDS.baby) {
    revealFacilitatorResult(gs, '這次先照顧好自己', `${player.name} 的健康低於 ${HP_ACTIVITY_THRESHOLDS.baby}，這次不新增家庭成員。`);
    return;
  }
  if (currentAge < MIN_CHILD_AGE || currentAge > MAX_CHILD_AGE) {
    revealFacilitatorResult(gs, '家庭以另一種方式前進', `${player.name} 目前不在 ${MIN_CHILD_AGE}～${MAX_CHILD_AGE} 歲的添丁階段，這次沒有新增子女。`);
    return;
  }
  const lastChildEvent = [...player.eventLog].reverse().find((event) => event.type === 'child');
  if (lastChildEvent && currentAge - lastChildEvent.age < MIN_CHILD_SPACING_YEARS) {
    const remainingYears = Math.ceil(MIN_CHILD_SPACING_YEARS - (currentAge - lastChildEvent.age));
    revealFacilitatorResult(gs, '家庭仍在適應上一個階段', `${player.name} 距離上次添丁還需約 ${remainingYears} 年，這次不新增家庭成員。`);
    return;
  }

  const childWindow = LIFE_EVENT_WINDOWS.children;
  const inPeak = currentAge >= childWindow.peakStart && currentAge <= childWindow.peakEnd;
  const probability = inPeak ? childWindow.peakProbability : childWindow.baseProbability;
  if (Math.random() >= probability) {
    revealFacilitatorResult(gs, '這次沒有新成員', `${player.name} 的家庭維持現在的樣子，把資源留給目前的人生安排。`);
    return;
  }

  const cashBefore = player.cash;
  const cashflowBefore = player.monthlyCashflow;
  const netWorthBefore = calcNetWorth(player);
  applyBabyCard(player);
  addLifeExperience(player, LIFE_EXP.HAVE_CHILD);
  const childGift = CHILD_GIFT_BASE + Math.round(Math.random() * CHILD_GIFT_RANDOM_BONUS);
  player.cash += childGift;
  const description = `${player.name} 迎來第 ${player.numberOfChildren} 名子女：生命體驗 +${LIFE_EXP.HAVE_CHILD}、紅包 +$${childGift.toLocaleString()}，每月家庭支出 +$${PER_CHILD_EXPENSE.toLocaleString()}。`;
  logPlayerEvent(player, gs, 'child', description, cashBefore, cashflowBefore, netWorthBefore, {
    childCount: player.numberOfChildren,
    childGift,
    monthlyExpense: PER_CHILD_EXPENSE,
  });
  emitToRoom(gs.gameId, 'cardApplied', {
    playerId: player.id,
    effect: { type: 'baby', numberOfChildren: player.numberOfChildren, lifeExpGained: LIFE_EXP.HAVE_CHILD, childGift },
  });
  revealFacilitatorResult(gs, '家庭迎來新成員 👶', description);
}

export function closeFacilitatorScene(gs: GameState): void {
  if (gs.facilitatorScene?.kind === 'second_life' && gs.facilitatorScene.stage === 'prompt') return;
  if (gs.facilitatorScene?.kind === 'global_event' && gs.facilitatorScene.stage === 'prompt'
    && !gs.pendingWorldEvent?.deferred) gs.pendingWorldEvent = null;
  const shouldResume = Boolean(gs.facilitatorScene?.resumeOnClose);
  gs.facilitatorScene = null;
  gs.facilitatorSceneContext = null;
  if (shouldResume && gs.pausedAt !== null && gs.gamePhase !== GamePhase.GameOver) {
    resumeGameClock(gs);
    emitToRoom(gs.gameId, 'gameResumed', {
      resumedAt: new Date(),
      currentAge: Math.round(getCurrentAge(gs) * 10) / 10,
      controlledByHost: true,
    });
  }
  continueAfterTurnAdvance(gs);
  tryOpenWorldEvent(gs);
  emitAdaptiveDirectorStatus(gs);
  emitToRoom(gs.gameId, 'gameStateUpdate', serializeGameState(gs));
}

export function applyCommunityChoice(gs: GameState, cardId: string, choiceId: string): string | null {
  const card = COMMUNITY_CHOICE_CARDS.find((candidate) => candidate.id === cardId);
  const choice = card?.options.find((candidate) => candidate.id === choiceId);
  if (!card || !choice) return null;

  const alivePlayers = [...gs.players.values()].filter((player) => player.isAlive);
  for (const player of alivePlayers) {
    const cashBefore = player.cash;
    const cashflowBefore = player.monthlyCashflow;
    const netWorthBefore = calcNetWorth(player);

    // 花費依各人每月支出計算，讓不同收入的人都有感
    const months = (m: number, min: number) => Math.max(min, Math.round(player.totalExpenses * m));
    const working = player.retirementStatus === 'working' && player.salary > 0;
    if (cardId === 'healthcare' && choiceId === 'safety_net') {
      spendAvailableCash(player, months(1, 12_000));
      adjustFacilitatorHealth(player, 10);
      player.stats.network = clampFacilitatorStat(player.stats.network + 1, 1, 10);
    } else if (cardId === 'healthcare') {
      player.cash += months(0.3, 5_000);
      adjustFacilitatorHealth(player, -6);
    } else if (cardId === 'technology' && choiceId === 'learn_together') {
      spendAvailableCash(player, months(1, 12_000));
      player.stats.financialIQ = clampFacilitatorStat(player.stats.financialIQ + 1, 1, 10);
      player.stats.careerSkill = clampFacilitatorStat(player.stats.careerSkill + 8, 0, 100);
    } else if (cardId === 'technology' && choiceId === 'invest_early') {
      const target = months(2, 20_000);
      if (player.cash >= target / 2) {
        const invested = Math.min(player.cash, target);
        player.cash -= invested;
        player.assets.push({ id: `community-tech-${Date.now()}-${player.id}`, name: '共同科技轉型基金', type: AssetType.Business,
          cost: invested, currentValue: invested, monthlyCashflow: Math.round(invested * 0.006) });
      } else {
        player.stats.careerSkill = clampFacilitatorStat(player.stats.careerSkill + 3, 0, 100);
      }
    } else if (cardId === 'technology') {
      adjustFacilitatorHealth(player, 3);
    } else if (cardId === 'climate' && choiceId === 'rebuild') {
      spendAvailableCash(player, months(1, 10_000));
      adjustFacilitatorHealth(player, 5);
      player.stats.network = clampFacilitatorStat(player.stats.network + 2, 1, 10);
      player.lifeExperience += 6;
    } else if (cardId === 'climate') {
      adjustFacilitatorHealth(player, -4);
      for (const asset of player.assets) {
        asset.currentValue = Math.round((asset.currentValue ?? asset.cost) * 0.92);
      }
    } else if (cardId === 'housing' && choiceId === 'social_housing') {
      spendAvailableCash(player, months(0.5, 8_000));
      if (player.housing === 'rent') player.expenses.rent = Math.round(player.expenses.rent * 0.9);
      for (const asset of player.assets) if (asset.isResidence) asset.currentValue = Math.round((asset.currentValue ?? asset.cost) * 0.95);
    } else if (cardId === 'housing') {
      if (player.housing === 'rent') player.expenses.rent = Math.round(player.expenses.rent * 1.1);
      for (const asset of player.assets) if (asset.type === AssetType.RealEstate) asset.currentValue = Math.round((asset.currentValue ?? asset.cost) * 1.1);
    } else if (cardId === 'aging' && choiceId === 'care_fund') {
      spendAvailableCash(player, months(1, 10_000));
      adjustFacilitatorHealth(player, 5);
      player.legacyBonusPoints = (player.legacyBonusPoints ?? 0) + 3;
    } else if (cardId === 'aging') {
      if (player.currentAge >= 35 && player.currentAge < 65) {
        player.recurringExpenses.push({ id: `community-care-${Date.now()}-${player.id}`, label: '家中長輩照護', monthly: 8_000, monthsLeft: 12 });
      }
      player.lifeExperience += 3;
    } else if (cardId === 'literacy' && choiceId === 'fund_education') {
      spendAvailableCash(player, months(0.5, 6_000));
      player.stats.financialIQ = clampFacilitatorStat(player.stats.financialIQ + 1, 1, 10);
    } else if (cardId === 'literacy') {
      spendAvailableCash(player, Math.min(50_000, Math.round(Math.max(0, player.cash) * 0.05)));
    } else if (cardId === 'workweek' && choiceId === 'four_day') {
      if (working) player.salaryGrowthMultiplier = Math.round(player.salaryGrowthMultiplier * 0.95 * 1000) / 1000;
      adjustFacilitatorHealth(player, 8);
      player.lifeExperience += 5;
    } else if (cardId === 'workweek') {
      if (working) player.cash += Math.round(player.salary * 0.5);
      adjustFacilitatorHealth(player, -3);
    } else if (cardId === 'green' && choiceId === 'invest_green') {
      const invested = Math.min(Math.max(0, player.cash), months(1, 10_000));
      if (invested > 0) {
        player.cash -= invested;
        player.assets.push({ id: `community-green-${Date.now()}-${player.id}`, name: '綠能共同基金', type: AssetType.Other,
          cost: invested, currentValue: invested, monthlyCashflow: Math.round(invested * 0.006) });
      }
    } else if (cardId === 'green') {
      player.livingCostMultiplier = Math.round(player.livingCostMultiplier * 1.03 * 1000) / 1000;
    }

    logPlayerEvent(
      player,
      gs,
      'community_choice',
      `全場共同抉擇「${card.title}」：${choice.label}`,
      cashBefore,
      cashflowBefore,
      netWorthBefore,
      { cardId, choiceId },
    );
  }

  const resultDescriptions: Record<string, string> = {
    safety_net: '全場共同投入安全網：現金減少，但健康與人脈獲得保護。',
    self_reliance: '大家保留更多現金與自主空間，同時承擔了額外健康風險。',
    learn_together: '全場共同進修，財商與第二專長同步成長。',
    invest_early: '有足夠資源的人建立科技現金流；資源不足者也獲得了一次學習。',
    wait: '大家保留資源並恢復健康，但這一輪沒有獲得科技成長。',
    rebuild: '共同重建讓現金減少，卻提高了全場的健康、人脈與生命體驗。',
    protect_self: '大家守住了眼前現金，但健康與現有資產價值都受到衝擊。',
    social_housing: '社會住宅動工：大家分攤經費，租屋族房租下降，屋主房價小跌。',
    market: '房價繼續飆：屋主資產增值，租屋族的房租也跟著漲。',
    care_fund: '長照基金成立：大家出了一筆錢，換來健康與世代之間的信任。',
    family_care: '各家自己照顧長輩：中年的人接下來一年多了照護支出。',
    fund_education: '理財教育上路：大家花了一點錢，財商都提升了。',
    skip: '沒有推動理財教育，詐騙集團趁虛而入，每個人都損失了一些現金。',
    four_day: '週休三日通過：薪水少了一點，健康與生活體驗變好了。',
    keep_five: '維持週休二日：多領了加班費，但身體更累了。',
    invest_green: '綠能基金成立：大家把一個月的錢換成穩定的月配息。',
    status_quo: '維持現狀：能源漲價，生活成本永久上升。',
  };
  return resultDescriptions[choiceId] ?? choice.description;
}

export function applyCooperationContract(
  gs: GameState,
  contractId: keyof typeof COOPERATION_CONTRACTS,
  playerA: Player,
  playerB: Player,
): string {
  const snapshots = [playerA, playerB].map((player) => ({
    player,
    cash: player.cash,
    cashflow: player.monthlyCashflow,
    netWorth: calcNetWorth(player),
  }));

  if (contractId === 'joint_venture') {
    for (const player of [playerA, playerB]) {
      player.cash -= 10_000;
      player.assets.push({
        id: `joint-venture-${Date.now()}-${player.id}`,
        name: `與夥伴共同創業`,
        type: AssetType.Business,
        cost: 10_000,
        currentValue: 10_000,
        monthlyCashflow: 1_500,
      });
      player.stats.network = clampFacilitatorStat(player.stats.network + 1, 1, 10);
    }
  } else if (contractId === 'mutual_aid') {
    playerA.cash -= 15_000;
    playerB.cash += 15_000;
    for (const player of [playerA, playerB]) {
      player.stats.network = clampFacilitatorStat(player.stats.network + 2, 1, 10);
      player.lifeExperience += 5;
    }
  } else {
    for (const player of [playerA, playerB]) {
      player.cash -= 8_000;
      player.stats.financialIQ = clampFacilitatorStat(player.stats.financialIQ + 1, 1, 10);
      player.stats.careerSkill = clampFacilitatorStat(player.stats.careerSkill + 6, 0, 100);
      player.stats.network = clampFacilitatorStat(player.stats.network + 1, 1, 10);
    }
  }

  for (const snapshot of snapshots) {
    logPlayerEvent(
      snapshot.player,
      gs,
      'cooperation',
      `${COOPERATION_CONTRACTS[contractId].title}：${playerA.name} × ${playerB.name}`,
      snapshot.cash,
      snapshot.cashflow,
      snapshot.netWorth,
      { contractId, partnerNames: [playerA.name, playerB.name] },
    );
  }

  if (contractId === 'joint_venture') return '雙方各投入 $10,000，並各自獲得每月 $1,500 的共同事業現金流。';
  if (contractId === 'mutual_aid') return `${playerA.name} 支援 ${playerB.name} $15,000；兩人的人脈與生命體驗同步提升。`;
  return '雙方各投入 $8,000，財商、第二專長與人脈同步成長。';
}

export function findDecisionEcho(gs: GameState): { player: Player; event: PlayerEvent; key: string } | null {
  const eligibleTypes = new Set<PlayerEventType>([
    'asset_buy', 'education', 'career_change', 'relationship', 'marriage', 'crisis', 'loan_taken', 'travel',
  ]);
  const currentAge = getCurrentAge(gs);
  const candidates: { player: Player; event: PlayerEvent; key: string }[] = [];
  for (const player of gs.players.values()) {
    if (!player.isAlive) continue;
    player.eventLog.forEach((event, index) => {
      const key = `${player.id}:${index}:${event.type}`;
      if (
        eligibleTypes.has(event.type) &&
        event.age <= currentAge - 8 &&
        !gs.facilitatorEchoHistory.has(key)
      ) candidates.push({ player, event, key });
    });
  }
  if (candidates.length === 0) return null;
  return candidates[Math.floor(Math.random() * candidates.length)] ?? null;
}

export function applyDecisionEcho(gs: GameState, player: Player, originalEvent: PlayerEvent): string {
  const cashBefore = player.cash;
  const cashflowBefore = player.monthlyCashflow;
  const netWorthBefore = calcNetWorth(player);
  const challenging = gs.adaptiveDirector.mode === 'challenge'
    && ['asset_buy', 'loan_taken', 'crisis'].includes(originalEvent.type);
  let result: string;

  if (challenging && originalEvent.type === 'asset_buy') {
    spendAvailableCash(player, 12_000);
    adjustFacilitatorHealth(player, -3);
    result = '早年的資產開始需要維修與管理：現金減少 $12,000，健康也承受壓力。';
  } else if (challenging && originalEvent.type === 'loan_taken') {
    player.expenses.otherExpenses += 500;
    result = '早年的借款延伸成長期負擔：每月其他支出增加 $500。';
  } else if (challenging) {
    spendAvailableCash(player, 8_000);
    adjustFacilitatorHealth(player, -5);
    result = '曾經的危機留下後續影響：現金減少 $8,000、健康下降 5。';
  } else if (originalEvent.type === 'asset_buy') {
    player.cash += 12_000;
    player.lifeExperience += 3;
    result = '早年的資產開始回報：獲得 $12,000，生命體驗增加 3。';
  } else if (['education', 'career_change'].includes(originalEvent.type)) {
    player.salaryBonus += 1_000;
    player.salary += 1_000;
    player.stats.careerSkill = clampFacilitatorStat(player.stats.careerSkill + 5, 0, 100);
    result = '早年的學習與轉職產生複利：月薪增加 $1,000，第二專長增加 5。';
  } else if (['relationship', 'marriage'].includes(originalEvent.type)) {
    player.stats.network = clampFacilitatorStat(player.stats.network + 2, 1, 10);
    player.lifeExperience += 6;
    result = '曾經經營的人際關係在關鍵時刻回來支持你：人脈增加 2、生命體驗增加 6。';
  } else if (originalEvent.type === 'travel') {
    player.cash += 5_000;
    player.lifeExperience += 6;
    result = '旅途中建立的視野轉化為新機會：現金增加 $5,000、生命體驗增加 6。';
  } else {
    adjustFacilitatorHealth(player, 5);
    player.legacyBonusPoints += 4;
    result = '走過的困難成為韌性：健康增加 5、傳承增加 4。';
  }

  logPlayerEvent(
    player,
    gs,
    'decision_echo',
    `決策回聲：${originalEvent.description} → ${result}`,
    cashBefore,
    cashflowBefore,
    netWorthBefore,
    { originalAge: originalEvent.age, originalType: originalEvent.type },
  );
  return result;
}

export function applyLegacyAction(
  gs: GameState,
  legacyId: keyof typeof LEGACY_CHOICES,
  deceased: Player,
  beneficiary: Player,
): string {
  const deceasedSnapshot = {
    cash: deceased.cash,
    cashflow: deceased.monthlyCashflow,
    netWorth: calcNetWorth(deceased),
  };
  const beneficiarySnapshot = {
    cash: beneficiary.cash,
    cashflow: beneficiary.monthlyCashflow,
    netWorth: calcNetWorth(beneficiary),
  };

  if (legacyId === 'wisdom') {
    beneficiary.stats.financialIQ = clampFacilitatorStat(beneficiary.stats.financialIQ + 1, 1, 10);
    beneficiary.stats.careerSkill = clampFacilitatorStat(beneficiary.stats.careerSkill + 6, 0, 100);
    deceased.legacyBonusPoints += 6;
  } else if (legacyId === 'network') {
    beneficiary.stats.network = clampFacilitatorStat(beneficiary.stats.network + 3, 1, 10);
    beneficiary.lifeExperience += 5;
    deceased.legacyBonusPoints += 8;
  } else {
    const contribution = Math.min(15_000, Math.max(0, deceased.cash));
    deceased.cash -= contribution;
    deceased.charityTotal += contribution;
    deceased.legacyBonusPoints += 10;
    for (const player of gs.players.values()) {
      if (player.isAlive) player.lifeExperience += 4;
    }
  }
  deceased.legacyActionUsed = true;

  logPlayerEvent(
    deceased,
    gs,
    'legacy',
    `${LEGACY_CHOICES[legacyId].title}：將影響力交給 ${beneficiary.name}`,
    deceasedSnapshot.cash,
    deceasedSnapshot.cashflow,
    deceasedSnapshot.netWorth,
    { legacyId, beneficiaryName: beneficiary.name },
  );
  logPlayerEvent(
    beneficiary,
    gs,
    'legacy',
    `承接 ${deceased.name} 的${LEGACY_CHOICES[legacyId].title}`,
    beneficiarySnapshot.cash,
    beneficiarySnapshot.cashflow,
    beneficiarySnapshot.netWorth,
    { legacyId, deceasedName: deceased.name },
  );

  if (legacyId === 'wisdom') return `${beneficiary.name} 承接智慧：財商增加 1、第二專長增加 6。`;
  if (legacyId === 'network') return `${beneficiary.name} 承接人脈：人脈增加 3、生命體驗增加 5。`;
  return `${deceased.name} 將最後資源化為公益影響；所有仍在旅途中的玩家增加 4 點生命體驗。`;
}


/** 開啟全場共同抉擇（主持人手動或發薪後自動）；每位存活玩家都能在手機投票 */
export function startCommunityChoice(gs: GameState, cardId: string, reminderSeconds = 90): boolean {
  const card = COMMUNITY_CHOICE_CARDS.find((candidate) => candidate.id === cardId);
  if (!card) return false;
  // 離世的玩家以「家族顧問」身分一起投票
  const voters = communityVoters(gs);
  beginFacilitatorScene(gs, {
    kind: 'community',
    kicker: '全場共同抉擇・每人在手機投票',
    title: card.title,
    description: card.description,
    participantNames: voters.map((player) => player.name),
    options: card.options,
    reminderEndsAt: Date.now() + reminderSeconds * 1000,
    votes: Object.fromEntries(card.options.map((option) => [option.id, 0])),
    votedCount: 0,
    voterCount: voters.length,
  }, { cardId: card.id, ballots: {} as Record<string, string> });
  gs.communityChoiceHistory = [...gs.communityChoiceHistory.filter((id) => id !== card.id), card.id];
  return true;
}

/** 記錄一票（可改票）；回傳錯誤訊息或 null */
export function recordCommunityVote(gs: GameState, playerId: string, sceneId: string, optionId: string): string | null {
  const scene = gs.facilitatorScene;
  const context = gs.facilitatorSceneContext;
  if (!scene || !context || scene.kind !== 'community' || scene.stage !== 'prompt' || scene.id !== sceneId) return '這次投票已經結束。';
  const player = gs.players.get(playerId);
  if (!player) return '玩家不存在。';
  if (!scene.options?.some((option) => option.id === optionId)) return '沒有這個選項。';
  const ballots = (context.ballots ?? {}) as Record<string, string>;
  // 重複投同一票：不重算、不廣播（避免出錯的頁面一直重送造成全房更新風暴）
  if (ballots[playerId] === optionId) return null;
  ballots[playerId] = optionId;
  context.ballots = ballots;
  const votes: Record<string, number> = Object.fromEntries((scene.options ?? []).map((option) => [option.id, 0]));
  for (const choice of Object.values(ballots)) votes[choice] = (votes[choice] ?? 0) + 1;
  scene.votes = votes;
  scene.votedCount = Object.keys(ballots).length;
  scene.voterCount = Math.max(Object.keys(ballots).length, communityVoters(gs).length);
  emitToRoom(gs.gameId, 'gameStateUpdate', serializeGameState(gs));
  return null;
}

/** 多數決：票數最多者；同票取畫面上排前面的選項；沒人投票時取第一個選項 */
export function majorityCommunityChoice(scene: FacilitatorSceneState): string {
  const options = scene.options ?? [];
  let best = options[0]?.id ?? '';
  let bestVotes = -1;
  for (const option of options) {
    const votes = scene.votes?.[option.id] ?? 0;
    if (votes > bestVotes) { best = option.id; bestVotes = votes; }
  }
  return best;
}

export function describeCommunityVotes(scene: FacilitatorSceneState): string {
  const parts = (scene.options ?? []).map((option) => `${option.label} ${scene.votes?.[option.id] ?? 0} 票`);
  return `投票結果（${scene.votedCount ?? 0}／${scene.voterCount ?? 0} 人投票）：${parts.join('、')}`;
}

/** 每次發薪結算後自動出現一張，依序輪替沒出現過的卡 */
export function tryOpenScheduledCommunityChoice(gs: GameState): boolean {
  if (!gs.communityChoiceAuto || gs.facilitatorScene || gs.decisionPhase) return false;
  if (gs.gamePhase !== GamePhase.RatRace && gs.gamePhase !== GamePhase.FastTrack) return false;
  if (gs.globalPaydayNumber <= gs.lastCommunityChoicePayday) return false;
  if ([...gs.players.values()].filter((player) => player.isAlive).length === 0) return false;
  gs.lastCommunityChoicePayday = gs.globalPaydayNumber;
  const unused = COMMUNITY_CHOICE_CARDS.find((card) => !gs.communityChoiceHistory.includes(card.id));
  const card = unused ?? COMMUNITY_CHOICE_CARDS.find((candidate) => candidate.id === gs.communityChoiceHistory[0]) ?? COMMUNITY_CHOICE_CARDS[0];
  return startCommunityChoice(gs, card.id);
}
