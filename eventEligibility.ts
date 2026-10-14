import { AssetType, type Player } from './gameDataModels';
import type { CrisisCard, RelationshipCard } from './gameCards';

/** Eligibility is independent of insurance and affordability: those affect consequences, not identity. */
export function crisisFitsPlayer(player: Player, card: CrisisCard): boolean {
  if (card.id === 'cr-012') return player.retirementStatus === 'working' && player.salary > 0;
  if (card.id === 'cr-013') return player.housing === 'own';
  if (card.id === 'cr-014') return player.assets.some(a => a.type === AssetType.RealEstate && !a.isResidence && a.monthlyCashflow > 0);
  if (card.id === 'cr-004' || card.id === 'cr-006') {
    return player.housing === 'own' || player.assets.some(a => a.type === AssetType.RealEstate);
  }
  if (card.id === 'cr-005') {
    return (player.retirementStatus === 'working' && ['S', 'B'].includes(player.profession.quadrant ?? ''))
      || player.assets.some(a => a.type === AssetType.Business);
  }
  return true;
}

/** Resolve before display AND application, so an unmarried player never sees a spouse's loss. */
export function relationshipForPlayer(player: Player, card: RelationshipCard): RelationshipCard {
  const fallback = card.effect.unmarriedFallback;
  if (!player.isMarried && card.effect.spouseEvent && fallback) {
    return { ...card, title: fallback.title, description: fallback.description,
      effect: { networkDelta: fallback.networkDelta, lifeExpGain: fallback.lifeExpGain, cashCost: fallback.cashCost } };
  }
  return card;
}

export function canBeLaidOff(player: Player): boolean {
  return player.retirementStatus === 'working' && player.profession.quadrant === 'E';
}
