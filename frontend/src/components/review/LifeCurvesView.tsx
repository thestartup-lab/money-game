// 全場人生曲線：每位玩家的淨資產與月現金流疊在同一張圖，看路線在哪個年紀分岔
import ReactECharts from '../analysis/GameChart';
import type { RoomAnalysis } from '../../types/game';

interface Props {
  analysis: RoomAnalysis;
  colorOf: (playerId: string) => string;
}

const compact = (n: number) => {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  if (abs >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(Math.round(n));
};

function buildOption(analysis: RoomAnalysis, colorOf: Props['colorOf'], field: 'netWorth' | 'cashflow') {
  return {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'axis',
      valueFormatter: (value: number) => `$${Math.round(value).toLocaleString('zh-TW')}`,
    },
    legend: { data: analysis.players.map((p) => p.playerName), textStyle: { color: '#d1d5db', fontSize: 14 }, top: 0 },
    grid: { left: 64, right: 24, top: 40, bottom: 36 },
    xAxis: {
      type: 'value', name: '年齡', min: 20, max: 100, nameTextStyle: { color: '#9ca3af' },
      axisLabel: { color: '#9ca3af' }, splitLine: { lineStyle: { color: '#1f2937' } },
    },
    yAxis: {
      type: 'value', axisLabel: { color: '#9ca3af', formatter: compact },
      splitLine: { lineStyle: { color: '#1f2937' } },
    },
    series: analysis.players.map((p) => {
      const points = p.cashflowHistory.map((h) => [h.age, h[field]]);
      const last = points[points.length - 1];
      return {
        name: p.playerName,
        type: 'line',
        showSymbol: false,
        smooth: true,
        lineStyle: { width: 3, color: colorOf(p.playerId) },
        itemStyle: { color: colorOf(p.playerId) },
        data: points,
        // 離世的玩家在曲線終點標示年齡
        markPoint: !p.isAlive && last ? {
          symbol: 'pin', symbolSize: 36,
          data: [{ coord: last, value: `${Math.round(p.deathAge)}` }],
          label: { color: '#fff', fontSize: 11 },
        } : undefined,
      };
    }),
  };
}

export default function LifeCurvesView({ analysis, colorOf }: Props) {
  return (
    <div className="space-y-4 p-4">
      <div className="text-center">
        <h2 className="text-3xl font-black text-white">📈 每個人的人生曲線</h2>
        <p className="mt-1 text-base text-gray-300">圖釘代表離世的年齡。先找出曲線開始分岔的地方，再請那位玩家說說當時做了什麼。</p>
      </div>
      <div className="card">
        <h3 className="mb-1 text-lg font-bold text-gray-200">淨資產（資產市值 + 現金 − 負債）</h3>
        <ReactECharts option={buildOption(analysis, colorOf, 'netWorth')} style={{ height: 320 }} notMerge />
      </div>
      <div className="card">
        <h3 className="mb-1 text-lg font-bold text-gray-200">每月現金流（收入 − 支出）</h3>
        <ReactECharts option={buildOption(analysis, colorOf, 'cashflow')} style={{ height: 260 }} notMerge />
      </div>
      <p className="text-center text-lg font-bold text-indigo-200">討論：哪一個決定讓你的曲線轉彎？如果重來，你會提早還是延後做？</p>
    </div>
  );
}
