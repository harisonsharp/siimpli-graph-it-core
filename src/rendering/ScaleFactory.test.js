import { describe, it, expect } from 'vitest';
import { ScaleFactory } from './ScaleFactory';
import * as d3 from 'd3';

describe('ScaleFactory', () => {
    describe('inferScaleType', () => {
        it('should infer linear for numbers', () => {
            expect(ScaleFactory.inferScaleType([1, 2, 3])).toBe('linear');
        });

        it('should infer time for Dates', () => {
            expect(ScaleFactory.inferScaleType([new Date(), new Date()])).toBe('time');
        });

        it('should infer band for strings', () => {
            expect(ScaleFactory.inferScaleType(['a', 'b', 'c'])).toBe('band');
        });

        it('should infer band for booleans', () => {
            expect(ScaleFactory.inferScaleType([true, false, true])).toBe('band');
        });
    });

    describe('createScalesForGraph', () => {
        it('should create time scale for date x-axis', () => {
            const data = [
                { date: new Date('2023-01-01'), val: 10 },
                { date: new Date('2023-01-02'), val: 20 }
            ];
            const xAxisInfo = { columnName: 'date' };
            const seriesInfo = [{ axisAssignment: 'primary', yAxisInfo: { columnName: 'val' }, graphType: 'line' }];
            const config = { graphType: 'line' };

            const { xScale } = ScaleFactory.createScalesForGraph(data, xAxisInfo, seriesInfo, 100, 100, config);

            // Check if it has a domain method and handles dates
            expect(xScale.domain()[0]).toBeInstanceOf(Date);
            // D3 time scales have a ticks function
            expect(typeof xScale.ticks).toBe('function');
        });

        it('should create band scale for boolean x-axis', () => {
            const data = [
                { flag: true, val: 10 },
                { flag: false, val: 20 }
            ];
            const xAxisInfo = { columnName: 'flag' };
            const seriesInfo = [{ axisAssignment: 'primary', yAxisInfo: { columnName: 'val' }, graphType: 'bar' }];
            const config = { graphType: 'bar' };

            const { xScale } = ScaleFactory.createScalesForGraph(data, xAxisInfo, seriesInfo, 100, 100, config);

            expect(typeof xScale.bandwidth).toBe('function'); // Band scale characteristic
            expect(xScale.domain()).toContain(true);
            expect(xScale.domain()).toContain(false);
        });
    });
});
