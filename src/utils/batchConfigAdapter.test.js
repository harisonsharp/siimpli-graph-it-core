import { describe, it, expect } from 'vitest';
import { adaptBatchConfig } from './batchConfigAdapter.js';

describe('adaptBatchConfig', () => {
    it('converts histogram config to renderer format', () => {
        const config = {
            graphType: 'histogram',
            xAxis: 'Temperature',
            colorGrading: 'Quality',
            title: 'Histogram'
        };

        const adapted = adaptBatchConfig(config);
        expect(adapted.graphType).toBe('histogram');
        expect(adapted.series).toEqual([]);
        expect(adapted.xAxis).toBe('Temperature');
        expect(adapted.colorGrading).toBe('Quality');
    });

    it('wraps legacy yAxis into series array', () => {
        const config = {
            graphType: 'scatter',
            xAxis: 'X',
            yAxis: 'Y'
        };

        const adapted = adaptBatchConfig(config);
        expect(adapted.series).toHaveLength(1);
        expect(adapted.series[0].yAxis).toBe('Y');
    });
});
