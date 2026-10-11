import xinli from './lineConfig.json';

export interface LineBrand {
  id: string;
  name: string;
  officialAccountId: string;
  channelId: string;
  liffId: string;
}
export interface LineBrandOption {
  id: string;
  name: string;
  officialAccountId: string;
  status: 'ready' | 'pending';
  requiresAccessCode: boolean;
}
export const DEFAULT_LINE_BRAND: Readonly<LineBrand> = Object.freeze({
  id: 'xinli', name: '鑫力', ...xinli,
});
