import ReactECharts from 'echarts-for-react';
import type { PlayerEvent } from '../../types/game';

interface Props {
  eventLog: PlayerEvent[];
  playerName: string;
}

const EVENT_ICONS: Record<string, string> = {
  asset_buy: '🏠', asset_sell: '💰', travel: '✈️',
  marriage: '💑', child: '👶', crisis: '⚠️',
  career_change: '💼', education: '🎓', rat_race_escaped: '🚀',
  payday: '💵', loan_taken: '🏦', bedridden: '🛏', death: '⚰️',
  relationship: '🤝',
};

export default function LifeTimeline({ eventLog, playerName }: Props) {
  // 過濾掉發薪日（太多），保留有意義事件
  const keyEvents = eventLog.filter((e) => e.type !== 'payday');
  const paydayEvents = eventLog.filter((e) => e.type === 'payday');

  // 現金流折線（發薪日快照）
  const cashflowSeries = paydayEvents.map((e) => [e.age, e.cashflowAfter]);
  const netWorthSeries = paydayEvents.map((e) => [e.age, e.netWorthAfter]);

  // 關鍵事件標記
  const markPoints = keyEvents.map((e) => ({
    coord: [e.age, e.cashflowAfter],
    name: `${EVENT_ICONS[e.type] ?? '•'} ${e.description.slice(0, 12)}`,
    value: EVENT_ICONS[e.type] ?? '•',
    itemStyle: {
      color: e.type === 'crisis' ? '#ef4444' : e.type === 'rat_race_escaped' ? '#10b981' : '#f59e0b',
    },
  }));

  const option = {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'axis',
      formatter: (params: unknown[]) => {
        const p = params as Array<{ axisValue: number; seriesName: string; value: [number, number] }>;
        if (!p.length) return '';
        const age = p[0].axisValue;
        // 找最近的事件
        const nearest = keyEvents.filter((e) => Math.abs(e.age - age) < 2);
        let tip = `<b>${age} 歲</b><br/>`;
        p.forEach((s) => { tip += `${s.seriesName}: $${s.value[1].toLocaleString()}<br/>`; });
        if (nearest.length) tip += `<br/>${nearest.map((e) => `${EVENT_ICONS[e.type] ?? '•'} ${e.description}`).join('<br/>')}`;
        return tip;
      },
    },
    legend: { data: ['月現金流', '淨資產'], textStyle: { color: '#9ca3af' }, top: 0 },
    grid: { left: '12%', right: '5%', bottom: '15%', top: '12%' },
    xAxis: {
      type: 'value', name: '年齡', min: 20, max: 100,
      axisLabel: { color: '#6b7280', formatter: (v: number) => `${v}歲` },
      axisLine: { lineStyle: { color: '#374151' } },
      splitLine: { lineStyle: { color: '#1f2937' } },
    },
    yAxis: {
      type: 'value',
      axisLabel: { color: '#6b7280', formatter: (v: number) => `$${(v / 1000).toFixed(0)}k` },
      axisLine: { lineStyle: { color: '#374151' } },
      splitLine: { lineStyle: { color: '#1f2937' } },
    },
    series: [
      {
        name: '月現金流',
        type: 'line',
        data: cashflowSeries,
        smooth: true,
        lineStyle: { color: '#10b981', width: 2 },
        areaStyle: { color: 'rgba(16,185,129,0.1)' },
        symbol: 'none',
        markPoint: { data: markPoints, symbolSize: 24, label: { fontSize: 14 } },
      },
      {
        name: '淨資產',
        type: 'line',
        data: netWorthSeries,
        smooth: true,
        lineStyle: { color: '#f59e0b', width: 2, type: 'dashed' },
        symbol: 'none',
        yAxisIndex: 0,
      },
    ],
  };

  return (
    <div className="card">
      <h3 className="text-sm font-semibold text-gray-300 mb-2">📈 {playerName} 的人生軌跡</h3>
      <ReactECharts option={option} style={{ height: 280 }} />
    </div>
  );
}
