export const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:3001';
export const ADMIN_ROOM_STORAGE_KEY = 'money-game-admin-room';
const credentialCache = new Map<string, string>();

export function readAdminCode(roomId: string): string {
  if (credentialCache.has(roomId)) return credentialCache.get(roomId)!;
  try { return window.localStorage.getItem(`money-game-host-code:${roomId}`) ?? ''; } catch { return ''; }
}

export function rememberAdminCode(roomId: string, code: string): void {
  credentialCache.set(roomId, code);
  try { window.localStorage.setItem(`money-game-host-code:${roomId}`, code); } catch { /* Show the code in the control panel so it can be copied manually. */ }
}

export function readRememberedAdminRoom(): string {
  try {
    return window.localStorage.getItem(ADMIN_ROOM_STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

export function rememberAdminRoom(roomId: string): void {
  try {
    if (roomId) window.localStorage.setItem(ADMIN_ROOM_STORAGE_KEY, roomId);
    else window.localStorage.removeItem(ADMIN_ROOM_STORAGE_KEY);
  } catch {
    // Host can still enter the room-specific code manually.
  }
}
