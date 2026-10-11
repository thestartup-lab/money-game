import config from './lineConfig.json';
import { isLineLoginReturn, normalizeRoomCode } from './lineEntry';

export class LineLoginError extends Error {}
export function lineLoginErrorMessage(error: unknown): string {
  return error instanceof LineLoginError ? error.message : '無法完成 LINE 登入。請確認網路，並點下方「從 LINE 重新開啟此房間」再試一次。';
}
let initialized: Promise<typeof import('@line/liff').default> | undefined;

export function lineClient() {
  initialized ??= import('@line/liff').then(async ({ default: liff }) => {
    await liff.init({ liffId: config.liffId });
    return liff;
  }).catch(error => { initialized = undefined; throw error; });
  return initialized;
}

/** LINE SDK owns OAuth state/nonce/redirect handling; never store raw tokens ourselves. */
export async function getLineToken(interactive: boolean, roomCode = ''): Promise<string | null> {
  // Capture callback hints before init: the SDK can remove them from the URL.
  const returning = isLineLoginReturn(window.location.search);
  const cancelled = new URLSearchParams(window.location.search).has('error');
  if (!interactive && cancelled) throw new LineLoginError('LINE 授權未完成或已取消，請重新登入並完成授權。');
  const liff = await lineClient();
  if (!liff.isLoggedIn()) {
    if (interactive) {
      const redirect = new URL('/', window.location.origin);
      const room = normalizeRoomCode(roomCode);
      if (room) redirect.searchParams.set('room', room);
      redirect.searchParams.set('lineLoginReturn', '1');
      liff.login({ redirectUri: redirect.href });
    }
    else if (returning) throw new LineLoginError('返回遊戲後尚未取得 LINE 登入狀態。請點下方「從 LINE 重新開啟此房間」，並在開啟的頁面完成登入。');
    return null;
  }
  const token = liff.getIDToken();
  if (!token) throw new LineLoginError('沒有取得 LINE 身分憑證，請重新登入並完成授權。');
  return token;
}

export async function resetLineLogin() {
  const liff = await lineClient();
  if (liff.isLoggedIn()) liff.logout();
}
