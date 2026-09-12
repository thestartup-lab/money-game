/** Validate untrusted Socket.IO payloads before any stateful handler runs. */
const required: Record<string, string[]> = {
  playerJoin: ['playerName', 'roomCode'], playerRejoin: ['playerName', 'roomCode', 'reconnectToken'],
  adminLogin: ['password'], joinDisplay: ['roomId'], requestCareerChange: ['newProfessionId'],
  sellAsset: ['assetId'], buyInsurance: ['insuranceType'], cancelInsurance: ['insuranceType'],
  takeEmergencyLoan: ['amount'], investStockDCA: ['amount'], takeLeverageLoan: ['amount', 'targetAssetName'],
  repayLoan: ['liabilityId', 'amount'], setAdaptiveDirectorEnabled: ['enabled'], triggerGlobalEvent: ['eventId'],
  allocateGrowthStats: ['academic', 'health', 'social', 'resource'], selectQuadrant: ['quadrant'],
  partnershipOffer: ['targetPlayerId'], partnershipResponse: ['offerId', 'accepted'],
  loanOffer: ['targetPlayerId', 'amount', 'monthlyRate'], loanRequest: ['targetPlayerId', 'amount', 'monthlyRate'],
  loanResponse: ['offerId', 'accepted'], loanRequestResponse: ['requestId', 'accepted'],
  bidDeal: ['auctionId', 'bidAmount'], congratulate: ['targetPlayerId', 'event'], kickPlayer: ['playerId'],
  triggerRelationship: ['targetPlayerId'], setPlayerStats: ['targetPlayerId', 'stats'], goTravel: ['destinationId'],
  submitCardDecision: ['phaseId'], submitPaydayPlan: ['phaseId'],
  startCareerScene: ['requestId'], cancelCareerRequest: ['requestId'],
  confirmCareerScene: ['sceneId', 'accepted'],
};
const numeric = new Set(['amount', 'monthlyRate', 'bidAmount', 'academic', 'health', 'social', 'resource',
  'seconds', 'addSeconds', 'durationMinutes', 'diceCount', 'cash', 'hp', 'mp', 'fq', 'creditScore']);
const boolean = new Set(['accepted', 'enabled', 'force', 'useLeverage', 'donate', 'investInFQUpgrade',
  'investInHealthMaintenance', 'investInHealthBoost', 'investInSkillTraining', 'investInNetwork']);

function safeTree(value: unknown, depth = 0): boolean {
  if (depth > 6) return false;
  if (value === null || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER;
  if (typeof value === 'string') return value.length <= 2000;
  if (Array.isArray(value)) return value.length <= 100 && value.every(v => safeTree(v, depth + 1));
  if (typeof value !== 'object') return false;
  const entries = Object.entries(value);
  return entries.length <= 80 && entries.every(([key, v]) => !['__proto__', 'constructor', 'prototype'].includes(key) && safeTree(v, depth + 1));
}

export function validateSocketPayload(event: string, payload: unknown): boolean {
  if (payload === undefined) return !required[event];
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload) || !safeTree(payload)) return false;
  const data = payload as Record<string, unknown>;
  for (const key of required[event] ?? []) if (!(key in data)) return false;
  for (const [key, value] of Object.entries(data)) {
    if (numeric.has(key) && typeof value !== 'number') return false;
    if (boolean.has(key) && typeof value !== 'boolean') return false;
    if ((key.endsWith('Id') || ['playerName', 'roomCode', 'password', 'reconnectToken', 'insuranceType', 'quadrant', 'targetAssetName'].includes(key)) &&
      (typeof value !== 'string' || !value.trim() || value.length > 256)) return false;
  }
  if ('amount' in data && (!Number.isSafeInteger(data.amount) || (data.amount as number) <= 0)) return false;
  if ('monthlyRate' in data && ((data.monthlyRate as number) < 0 || (data.monthlyRate as number) > 0.1)) return false;
  if ('diceCount' in data && data.diceCount !== 1 && data.diceCount !== 2) return false;
  if ('playerName' in data && (data.playerName as string).trim().length > 40) return false;
  if (event === 'allocateGrowthStats' && ['academic', 'health', 'social', 'resource'].some(k => !Number.isSafeInteger(data[k]) || (data[k] as number) < 0)) return false;
  if (event === 'setPlayerStats' && (!data.stats || typeof data.stats !== 'object' || Array.isArray(data.stats) || Object.values(data.stats).some(v => typeof v !== 'number' || !Number.isFinite(v)))) return false;
  if (event === 'submitPaydayPlan') {
    if ('stockDCAAmount' in data && (!Number.isSafeInteger(data.stockDCAAmount) || (data.stockDCAAmount as number) < 0)) return false;
    if ('buyInsuranceTypes' in data && (!Array.isArray(data.buyInsuranceTypes) || data.buyInsuranceTypes.some(t => !['medical', 'life', 'property'].includes(t)))) return false;
    if ('lifeChoice' in data) {
      const choice = data.lifeChoice as Record<string, unknown> | null;
      if (!choice || typeof choice !== 'object' || !['none', 'travel', 'social'].includes(String(choice.type))) return false;
      if (choice.type === 'travel' && typeof choice.destinationId !== 'string') return false;
    }
  }
  return true;
}
