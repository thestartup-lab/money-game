import { createHash, timingSafeEqual } from 'crypto';
import { DEFAULT_LINE_BRAND, type LineBrand, type LineBrandOption } from './frontend/src/lineBrand';

interface RegisteredBrand extends LineBrand { creationCodeHash: string; enabled: boolean }
const pendingBrands: LineBrandOption[] = [
  { id: 'oa225mphca', name: '官方帳號 @225mphca', officialAccountId: '@225mphca', status: 'pending', requiresAccessCode: true },
  { id: 'oa550lgunv', name: '官方帳號 @550lgunv', officialAccountId: '@550lgunv', status: 'pending', requiresAccessCode: true },
];

/** Platform operators configure partner brands on the backend, never through public room creation. */
export function parseLineBrands(raw: string | undefined): RegisteredBrand[] {
  if (!raw) return [];
  const values: unknown = JSON.parse(raw);
  if (!Array.isArray(values) || values.length > 50) throw Error('Invalid LINE brand registry');
  const ids = new Set(['xinli']);
  const channels = new Set([DEFAULT_LINE_BRAND.channelId]);
  const liffs = new Set([DEFAULT_LINE_BRAND.liffId]);
  return values.map(value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid LINE brand');
    const b = value as Record<string, unknown>;
    if (typeof b.id !== 'string' || !/^[a-z][a-z0-9-]{1,39}$/.test(b.id) || ids.has(b.id)
      || typeof b.name !== 'string' || !b.name.trim() || b.name.length > 60
      || typeof b.officialAccountId !== 'string' || !/^@[a-zA-Z0-9._-]{3,40}$/.test(b.officialAccountId)
      || typeof b.channelId !== 'string' || !/^\d{8,15}$/.test(b.channelId) || channels.has(b.channelId)
      || typeof b.liffId !== 'string' || !/^\d{8,15}-[a-zA-Z0-9_-]{4,80}$/.test(b.liffId) || liffs.has(b.liffId)
      || !b.liffId.startsWith(`${b.channelId}-`)
      || typeof b.creationCodeHash !== 'string' || !/^[a-f0-9]{64}$/.test(b.creationCodeHash)
      || typeof b.enabled !== 'boolean') throw Error('Invalid LINE brand configuration');
    ids.add(b.id); channels.add(b.channelId); liffs.add(b.liffId);
    // Explicit projection: unexpected fields and raw credentials are not retained.
    return { id: b.id, name: b.name.trim(), officialAccountId: b.officialAccountId,
      channelId: b.channelId, liffId: b.liffId, creationCodeHash: b.creationCodeHash, enabled: b.enabled };
  });
}

let registry: RegisteredBrand[] = [];
try { registry = parseLineBrands(process.env.LINE_BRANDS_JSON); }
catch { console.error('[LINE brands] Invalid registry; partner creation disabled. Xinli remains available.'); }

export function publicLineBrand(brand: LineBrand): LineBrand {
  return { id: brand.id, name: brand.name, officialAccountId: brand.officialAccountId, channelId: brand.channelId, liffId: brand.liffId };
}
export function listLineBrands(): LineBrandOption[] {
  const ready = registry.filter(b => b.enabled).map(b => ({ id: b.id, name: b.name, officialAccountId: b.officialAccountId,
    status: 'ready' as const, requiresAccessCode: true }));
  return [{ id: 'xinli', name: '鑫力', officialAccountId: DEFAULT_LINE_BRAND.officialAccountId, status: 'ready', requiresAccessCode: false },
    ...ready, ...pendingBrands.filter(p => !ready.some(b => b.officialAccountId === p.officialAccountId))];
}
export function getLineBrand(id = 'xinli'): LineBrand | undefined {
  if (id === 'xinli') return publicLineBrand(DEFAULT_LINE_BRAND);
  const b = registry.find(b => b.id === id && b.enabled);
  return b ? publicLineBrand(b) : undefined;
}
export function authorizeLineBrand(id = 'xinli', code?: string): LineBrand | undefined {
  if (id === 'xinli') return getLineBrand();
  const b = registry.find(b => b.id === id && b.enabled);
  if (!b || typeof code !== 'string' || code.length < 24 || code.length > 256) return;
  const hash = createHash('sha256').update(code).digest();
  return timingSafeEqual(hash, Buffer.from(b.creationCodeHash, 'hex')) ? publicLineBrand(b) : undefined;
}

/** Snapshot is authoritative for existing rooms, even when future registrations change. */
export function roomLineBrand(room: { lineBrand?: LineBrand }): LineBrand {
  return publicLineBrand(room.lineBrand ?? DEFAULT_LINE_BRAND);
}
