import ReactECharts from 'echarts-for-react';
import type { LifeScoreBreakdown } from '../../types/game';

interface Props {
  score: LifeScoreBreakdown;
  playerName: string;
  compareScore?: LifeScoreBreakdown;
  compareLabel?: string;
}

const DIMENSIONS = [
  { key: 'netWorth', label: '淨資產' },
  { key: 'passiveIncome', label: '被動收入' },
  { key: 'financialHealth', label: '財務健康' },
  { key: 'family', label: '家庭' },
  { key: 'lifeExperience', label: '生命體驗' },
  { key: 'hp', label: '健康長壽' },
  { key: 'legacyScore', label: '傳承' },
] as const;

export default function FinalScoreRadar({ score, playerName, compareScore, compareLabel }: Props) {
  const indicator = DIMENSIONS.map((d) => ({ name: d.label, max: 100 }));

  const myValues = DIMENSIONS.map((d) => Math.round((score[d.key] ?? 0)));
  const series: object[] = [
    {
      name: playerName,
      type: 'radar',
      data: [{ value: myValues, name: playerName }],
      lineStyle: { color: '#10b981' },
      areaStyle: { color: 'rgba(16,185,129,0.2)' },
    },
  ];

  if (compareScore && compareLabel) {
    const cmpValues = DIMENSIONS.map((d) => Math.round((compareScore[d.key] ?? 0)));
    series.push({
      name: compareLabel,
      type: 'radar',
      data: [{ value: cmpValues, name: compareLabel }],
      lineStyle: { color: '#f59e0b' },
      areaStyle: { color: 'rgba(245,158,11,0.1)' },
    });
  }

  const option = {
    backgroundColor: 'transparent',
    legend: compareScore ? { data: [playerName, compareLabel], textStyle: { color: '#9ca3af' }, bottom: 0 } : undefined,
    radar: {
      indicator,
      shape: 'polygon',
      splitNumber: 4,
      axisName: { color: '#9ca3af', fontSize: 11 },
      splitLine: { lineStyle: { color: '#374151' } },
      splitArea: { areaStyle: { color: ['rgba(31,41,55,0.5)', 'transparent'] } },
    },
    series,
  };

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-sm font-semibold text-gray-300">🕸 人生評分雷達</h3>
        <span className="text-2xl font-bold text-emerald-400">{Math.round(score.total)} 分</span>
      </div>
      <ReactECharts option={option} style={{ height: 260 }} />
      {/* 細項分數 */}
      <div className="grid grid-cols-4 gap-1 mt-2">
        {DIMENSIONS.map((d) => (
          <div key={d.key} className="text-center">
            <div className="text-base font-bold text-white">{Math.round(score[d.key] ?? 0)}</div>
            <div className="text-xs text-gray-500">{d.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
