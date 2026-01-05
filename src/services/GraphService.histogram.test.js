import { describe, it, expect } from 'vitest';
import * as d3 from 'd3';
import { GraphService } from './GraphService.js';

const COLOR_SCHEMES = {
    'warm-cool': d3.interpolateRdYlBu
};

describe('GraphService histogram support', () => {
    it('renders histogram without throwing errors', () => {
        const service = new GraphService(COLOR_SCHEMES);
        const data = Array.from({ length: 25 }, (_, i) => ({ Value: i * 2 }));
        const xAxisInfo = { columnName: 'Value' };
        const graphConfig = { graphType: 'histogram' };
        const { xScale, yScale } = service.createScales(data, xAxisInfo, [], 400, 300, graphConfig);

        const svg = d3.create('svg');
        const group = svg.append('g');

        expect(() => {
            service.drawDataSeries(
                group,
                data,
                xScale,
                yScale,
                xAxisInfo,
                [],
                null,
                null,
                graphConfig,
                null
            );
        }).not.toThrow();

        expect(group.selectAll('rect.histogram-bar').size()).toBeGreaterThan(0);
    });
});
