import { createHash } from 'crypto';
import config from './frontend/src/lineConfig.json';

export interface LineIdentity {
  accountKey: string;
  displayName: string;
  picture?: string;
  expiresAt: number;
}

/** Verify with LINE, never trust decoded client profile data. No channel secret is needed. */
export async function verifyLineIdToken(idToken: unknown, request: typeof fetch = fetch): Promise<LineIdentity> {
  if (typeof idToken !== 'string' || idToken.length < 20 || idToken.length > 8000) throw new Error('invalid_token');
  const response = await request('https://api.line.me/oauth2/v2.1/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ id_token: idToken, client_id: config.channelId }),
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error('line_verification_failed');
  const data = await response.json() as Record<string, unknown>;
  if (data.iss !== 'https://access.line.me' || data.aud !== config.channelId
    || typeof data.sub !== 'string' || !/^U[0-9a-f]{32}$/i.test(data.sub)
    || typeof data.exp !== 'number' || !Number.isFinite(data.exp) || data.exp * 1000 <= Date.now()
    || typeof data.iat !== 'number' || data.iat > Date.now() / 1000 + 60) throw new Error('invalid_claims');
  let picture: string | undefined;
  if (typeof data.picture === 'string') {
    try {
      const url = new URL(data.picture);
      if (url.protocol === 'https:' && (url.hostname === 'profile.line-scdn.net' || url.hostname.endsWith('.line-scdn.net'))) picture = url.href;
    } catch { /* optional profile image */ }
  }
  return {
    // Store only an app-specific account key in room snapshots; never expose it in public game state.
    accountKey: createHash('sha256').update(`baisui:${config.channelId}:${data.sub}`).digest('hex'),
    displayName: typeof data.name === 'string' ? data.name.slice(0, 100) : 'LINE 玩家',
    picture,
    expiresAt: data.exp * 1000,
  };
}
