import ReactEChartsCore from 'echarts-for-react/lib/core';
import type { EChartsReactProps } from 'echarts-for-react';
import * as echarts from 'echarts/core';
import { LineChart, RadarChart } from 'echarts/charts';
import { GridComponent, RadarComponent, TooltipComponent, LegendComponent, MarkPointComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

echarts.use([LineChart, RadarChart, GridComponent, RadarComponent, TooltipComponent, LegendComponent, MarkPointComponent, CanvasRenderer]);

/** Only register chart types used by the game, instead of shipping the full chart library. */
export default function GameChart(props: EChartsReactProps) {
  return <ReactEChartsCore {...props} echarts={echarts} />;
}
