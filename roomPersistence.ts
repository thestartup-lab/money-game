import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { GameState, Player } from './gameDataModels';
import { Deck } from './gameCards';
import { PLACEHOLDER_PROFESSION } from './gameLogic';

/**
 * 房間存檔：伺服器重啟（部署、當機、Railway 重開容器）後把進行中的遊戲還原。
 *
 * - 存檔位置：STATE_DIR → Railway 掛載的 volume（RAILWAY_VOLUME_MOUNT_PATH）→ ./data。
 *   Railway 容器的本機硬碟在重新部署時會被清掉，要跨部署保留必須掛 volume。
 * - 只在「靜止點」存檔（沒有人在行動、沒有決策、舞台或發薪進行中），
 *   還原後一定是一致的狀態；進行到一半的回合會回到該回合開始前。
 * - 類別實例（GameState、Player、Deck）、Map、Set、Date、Buffer、Infinity 都會完整還原。
 */

export const SNAPSHOT_VERSION = 1;

export function resolveStateDir(): string {
  return process.env.STATE_DIR
    || (process.env.RAILWAY_VOLUME_MOUNT_PATH ? join(process.env.RAILWAY_VOLUME_MOUNT_PATH, 'money-game') : '')
    || join(process.cwd(), 'data');
}

export function isPersistentVolume(): boolean {
  return Boolean(process.env.STATE_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH) || !process.env.RAILWAY_ENVIRONMENT;
}

type Tagged =
  | { __t: 'Map'; v: [unknown, unknown][] }
  | { __t: 'Set'; v: unknown[] }
  | { __t: 'Date'; v: string }
  | { __t: 'Buffer'; v: string }
  | { __t: 'Num'; v: 'Infinity' | '-Infinity' | 'NaN' }
  | { __t: 'GameState' | 'Player' | 'Deck'; v: Record<string, unknown> };

/** 轉成可 JSON 化的結構（保留類別與特殊型別的標記） */
export function encode(value: unknown, seen = new WeakSet<object>()): unknown {
  if (typeof value === 'number') {
    if (Number.isFinite(value)) return value;
    return { __t: 'Num', v: Number.isNaN(value) ? 'NaN' : value > 0 ? 'Infinity' : '-Infinity' } satisfies Tagged;
  }
  if (value === null || typeof value !== 'object') {
    return typeof value === 'function' || typeof value === 'symbol' ? undefined : value;
  }
  if (seen.has(value)) throw new Error('存檔遇到循環參照');
  seen.add(value);
  try {
    if (value instanceof Date) return { __t: 'Date', v: value.toISOString() } satisfies Tagged;
    if (Buffer.isBuffer(value)) return { __t: 'Buffer', v: value.toString('hex') } satisfies Tagged;
    if (value instanceof Map) return { __t: 'Map', v: [...value.entries()].map(([k, v]) => [encode(k, seen), encode(v, seen)]) } satisfies Tagged;
    if (value instanceof Set) return { __t: 'Set', v: [...value].map((v) => encode(v, seen)) } satisfies Tagged;
    if (Array.isArray(value)) return value.map((v) => encode(v, seen));
    const plain = (obj: object) => Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, encode(v, seen)]).filter(([, v]) => v !== undefined));
    if (value instanceof GameState) return { __t: 'GameState', v: plain(value) } satisfies Tagged;
    if (value instanceof Player) return { __t: 'Player', v: plain(value) } satisfies Tagged;
    if (value instanceof Deck) return { __t: 'Deck', v: plain(value) } satisfies Tagged;
    return plain(value);
  } finally {
    seen.delete(value);
  }
}

/** 還原：類別實例先用建構子建出「新版預設值」再蓋上存檔，舊存檔缺的新欄位會有預設值。 */
export function decode(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(decode);
  const obj = value as Record<string, unknown>;
  if (typeof obj.__t === 'string' && 'v' in obj) {
    const t = obj as Tagged;
    switch (t.__t) {
      case 'Num': return t.v === 'Infinity' ? Infinity : t.v === '-Infinity' ? -Infinity : NaN;
      case 'Date': return new Date(t.v);
      case 'Buffer': return Buffer.from(t.v, 'hex');
      case 'Map': return new Map(t.v.map(([k, v]) => [decode(k), decode(v)]));
      case 'Set': return new Set(t.v.map(decode));
      case 'GameState': {
        const fields = decodeFields(t.v);
        return Object.assign(new GameState(String(fields.gameId)), fields);
      }
      case 'Player': {
        const fields = decodeFields(t.v);
        const profession = (fields.profession as Player['profession']) ?? PLACEHOLDER_PROFESSION;
        return Object.assign(new Player(String(fields.id), String(fields.name), profession), fields);
      }
      case 'Deck': {
        const fields = decodeFields(t.v);
        return Object.assign(new Deck([]), fields);
      }
    }
  }
  return decodeFields(obj);
}

function decodeFields(obj: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, decode(v)]));
}

export interface RoomSnapshot {
  version: number;
  savedAt: string;
  roomId: string;
  gameState: GameState;
  credential: { salt: Buffer; hash: Buffer } | null;
  sessions: [string, { roomId: string; token: string; socketId: string; setupStep?: string }][];
}

function roomsDir(dir = resolveStateDir()): string {
  const path = join(dir, 'rooms');
  mkdirSync(path, { recursive: true });
  return path;
}

const safeId = (roomId: string) => roomId.replace(/[^A-Za-z0-9_-]/g, '');

/** 原子寫入：先寫暫存檔再改名，斷電或重啟時不會留下半個檔案 */
export function writeSnapshot(snapshot: RoomSnapshot, dir?: string): void {
  const folder = roomsDir(dir);
  const file = join(folder, `${safeId(snapshot.roomId)}.json`);
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(encode(snapshot)));
  renameSync(tmp, file);
}

export function deleteSnapshot(roomId: string, dir?: string): void {
  const file = join(roomsDir(dir), `${safeId(roomId)}.json`);
  if (existsSync(file)) rmSync(file);
}

export function readSnapshots(dir?: string): { snapshots: RoomSnapshot[]; errors: string[] } {
  const folder = roomsDir(dir);
  const snapshots: RoomSnapshot[] = [];
  const errors: string[] = [];
  for (const name of readdirSync(folder)) {
    if (!name.endsWith('.json')) continue;
    try {
      const snap = decode(JSON.parse(readFileSync(join(folder, name), 'utf8'))) as RoomSnapshot;
      if (snap.version !== SNAPSHOT_VERSION || !(snap.gameState instanceof GameState)) throw new Error(`版本 ${snap.version} 不相容`);
      snapshots.push(snap);
    } catch (error) {
      errors.push(`${name}: ${(error as Error).message}`);
    }
  }
  return { snapshots, errors };
}
