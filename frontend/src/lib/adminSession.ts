export const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:3001';
export const DEFAULT_ADMIN_PASSWORD = '123';
export const ADMIN_ROOM_STORAGE_KEY = 'money-game-admin-room';

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
    // 瀏覽器停用儲存時仍可手動使用 123 登入，不阻斷主持流程。
  }
}
