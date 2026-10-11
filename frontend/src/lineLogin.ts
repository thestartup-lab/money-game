import config from './lineConfig.json';

export const LINE_ENTRY_URL = `https://liff.line.me/${config.liffId}`;
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
  const liff = await lineClient();
  if (!liff.isLoggedIn()) {
    if (interactive) {
      const redirect = new URL('/', window.location.origin);
      if (/^[A-Z0-9]{4,6}$/.test(roomCode)) redirect.searchParams.set('room', roomCode);
      liff.login({ redirectUri: redirect.href });
    }
    return null;
  }
  const token = liff.getIDToken();
  if (!token) throw new Error('沒有取得 LINE 身分憑證，請重新登入。');
  return token;
}

export async function resetLineLogin() {
  const liff = await lineClient();
  if (liff.isLoggedIn()) liff.logout();
}
