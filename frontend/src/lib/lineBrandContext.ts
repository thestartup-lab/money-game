import type { Socket } from 'socket.io-client';
import type { LineBrand } from '../lineBrand';
import { LineLoginError } from '../lineLogin';

export async function resolveLineBrand(socket: Socket, roomCode: string, brandId: string): Promise<LineBrand> {
  const result: { brand?: LineBrand; error?: string } = await socket.timeout(8000).emitWithAck('getLineBrand', {
    ...(roomCode ? { roomCode } : {}), brandId,
  });
  if (!result.brand) throw new LineLoginError(result.error || '無法取得此場次的 LINE 登入設定，請向主持人確認。');
  return result.brand;
}
