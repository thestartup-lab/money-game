import config from './lineConfig.json';
import type { LineBrand } from './lineBrand';

export const LINE_ENTRY_URL = `https://liff.line.me/${config.liffId}`;

export function normalizeRoomCode(value: string | null): string {
  const code = (value ?? '').trim().toUpperCase();
  return /^[A-Z0-9]{4,6}$/.test(code) ? code : '';
}

export function lineRoomUrl(roomCode: string, brand?: LineBrand): string {
  const url = new URL(brand ? `https://liff.line.me/${brand.liffId}` : LINE_ENTRY_URL);
  const room = normalizeRoomCode(roomCode);
  if (room) url.searchParams.set('room', room);
  if (brand && brand.id !== 'xinli') url.searchParams.set('brand', brand.id);
  return url.href;
}

export function brandIdFromSearch(search: string): string {
  const params = new URLSearchParams(search);
  const id = params.get('brand') ?? new URLSearchParams((params.get('liff.state') ?? '').replace(/^\/?\?/, '')).get('brand');
  return id && /^[a-z][a-z0-9-]{1,39}$/.test(id) ? id : 'xinli';
}

// LIFF first arrives with liff.state, then initializes and redirects to ?room=….
// Read only the room hint here; OAuth state and tokens remain owned by the SDK.
export function roomCodeFromSearch(search: string): string {
  const params = new URLSearchParams(search);
  return normalizeRoomCode(params.get('room')) ||
    normalizeRoomCode(new URLSearchParams((params.get('liff.state') ?? '').replace(/^\/?\?/, '')).get('room'));
}

export function isLineLoginReturn(search: string): boolean {
  const params = new URLSearchParams(search);
  return params.get('lineLoginReturn') === '1' || params.has('code') || params.has('error') || params.has('liff.state');
}
