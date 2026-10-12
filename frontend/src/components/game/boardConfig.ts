import { INNER_NODES, OUTER_NODES } from '../../boardLayout';

export interface SquareConfig {
  id: string;
  type: string;
  name: string;
  icon: string;
  color: string;
  borderColor: string;
  description?: string;
  pos?: [number, number];
}

const icons: Record<string, string> = { start:'🏠', deal:'💰', market:'🌍', fork:'↗️', training:'📚', career:'💼', cooperate:'🤝', travel:'✈️', social:'💬', family:'👪', service:'🏥', expense:'💸', health:'❤️', experience:'🌄', crisis:'⚡', repair:'💬', second:'🚪', dream:'🌈', assets:'🏦', legacy:'📖', charity:'💝' };
const config = (nodes: readonly (readonly [string, string, number, number])[], track: string): SquareConfig[] => nodes.map(([name,type,x,y],index) => ({
  id: `${track}-${index}`, type, name, icon: icons[type] ?? '⭐',
  color: '#153e37', borderColor: '#7bb3a3', pos: [x,y],
}));
export const innerCircleConfig = config(INNER_NODES,'inner');
export const outerCircleConfig = config(OUTER_NODES,'outer');
