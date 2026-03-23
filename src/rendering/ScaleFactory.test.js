import { describe, it, expect } from 'vitest';
import { ScaleFactory } from './ScaleFactory.js';
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

        it('should apply static numeric x-axis scale when enabled', () => {
            const data = [
                { x: 1, y: 10 },
                { x: 2, y: 20 },
                { x: 3, y: 30 }
            ];
            const xAxisInfo = { columnName: 'x' };
            const seriesInfo = [{ axisAssignment: 'primary', yAxisInfo: { columnName: 'y' }, graphType: 'line' }];
            const config = {
                graphType: 'line',
                staticScales: {
                    x: { enabled: true, min: 0, max: 10, step: 2 }
                }
            };

            const { xScale } = ScaleFactory.createScalesForGraph(data, xAxisInfo, seriesInfo, 100, 100, config);
            expect(xScale.domain()).toEqual([0, 10]);
        });

        it('should apply static numeric primary and secondary y-axis scales when enabled', () => {
            const data = [
                { x: 1, y1: 10, y2: 100 },
                { x: 2, y1: 20, y2: 120 },
                { x: 3, y1: 30, y2: 140 }
            ];
            const xAxisInfo = { columnName: 'x' };
            const seriesInfo = [
                { axisAssignment: 'primary', yAxisInfo: { columnName: 'y1' }, graphType: 'line' },
                { axisAssignment: 'secondary', yAxisInfo: { columnName: 'y2' }, graphType: 'line' }
            ];
            const config = {
                graphType: 'line',
                staticScales: {
                    y: { enabled: true, min: 0, max: 40, step: 10 },
                    y2: { enabled: true, min: 80, max: 160, step: 20 }
                }
            };

            const { yScale } = ScaleFactory.createScalesForGraph(data, xAxisInfo, seriesInfo, 100, 100, config);
            expect(yScale.primary.domain()).toEqual([0, 40]);
            expect(yScale.secondary.domain()).toEqual([80, 160]);
        });
    });
});
