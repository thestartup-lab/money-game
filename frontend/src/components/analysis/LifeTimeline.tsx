import ReactECharts from './GameChart';
import type { PlayerEvent } from '../../types/game';
import { EVENT_ICONS } from './eventMeta';

interface Props {
  eventLog: PlayerEvent[];
  playerName: string;
}


function compactMoney(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `$${(v / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  return `$${(v / 1000).toFixed(0)}k`;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
}

export default function LifeTimeline({ eventLog, playerName }: Props) {
  // 時間軸只標影響最大的幾個事件，避免圖上擠滿圖示；其餘事件在提示框與完整紀錄裡看
  const MARKER_TYPES = new Set(['asset_buy', 'asset_sell', 'payday_plan', 'career_change', 'crisis', 'rat_race_escaped', 'marriage', 'child', 'loan_taken', 'franchise', 'education']);
  const keyEvents = eventLog.filter((e) => e.type !== 'payday');
  const markerEvents = keyEvents
    .filter((e) => MARKER_TYPES.has(e.type))
    .map((e) => ({ e, weight: Math.abs(e.cashflowAfter - e.cashflowBefore) * 120 + Math.abs(e.netWorthAfter - e.netWorthBefore) }))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 8)
    .map(({ e }) => e);
  const paydayEvents = eventLog.filter((e) => e.type === 'payday');

  // 現金流折線（發薪日快照）
  const cashflowSeries = paydayEvents.map((e) => [e.age, e.cashflowAfter]);
  const netWorthSeries = paydayEvents.map((e) => [e.age, e.netWorthAfter]);

  // 關鍵事件標記
  const markPoints = markerEvents.map((e) => ({
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
        if (nearest.length) tip += `<br/>${nearest.map((e) => `${EVENT_ICONS[e.type] ?? '•'} ${escapeHtml(e.description)}`).join('<br/>')}`;
        return tip;
      },
    },
    legend: { data: ['月現金流', '淨資產'], textStyle: { color: '#9ca3af' }, top: 0 },
    grid: { left: '12%', right: '13%', bottom: '15%', top: '16%' },
    xAxis: {
      type: 'value', name: '年齡', min: 20, max: 100,
      axisLabel: { color: '#6b7280', formatter: (v: number) => `${v}歲` },
      axisLine: { lineStyle: { color: '#374151' } },
      splitLine: { lineStyle: { color: '#1f2937' } },
    },
    // 月現金流與淨資產差好幾個數量級，各用一條 y 軸，現金流才不會被壓成一條平線
    yAxis: [
      {
        type: 'value', name: '月現金流', nameTextStyle: { color: '#10b981' },
        axisLabel: { color: '#6b7280', formatter: compactMoney },
        axisLine: { lineStyle: { color: '#374151' } },
        splitLine: { lineStyle: { color: '#1f2937' } },
      },
      {
        type: 'value', name: '淨資產', nameTextStyle: { color: '#f59e0b' },
        axisLabel: { color: '#6b7280', formatter: compactMoney },
        axisLine: { lineStyle: { color: '#374151' } },
        splitLine: { show: false },
      },
    ],
    series: [
      {
        name: '月現金流',
        type: 'line',
        data: cashflowSeries,
        smooth: true,
        lineStyle: { color: '#10b981', width: 2 },
        itemStyle: { color: '#10b981' },
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
        itemStyle: { color: '#f59e0b' },
        symbol: 'none',
        yAxisIndex: 1,
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
