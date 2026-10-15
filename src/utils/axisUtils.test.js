/**
 * Covers a soil-grid style chart: numeric x values that repeat heavily (a handful of
 * survey lines, hundreds of stations) with a static x/y scale and the axes crossing at
 * an intercept inside the plot. The static scale has to win over the low-cardinality
 * "treat as categories" heuristic, the axis lines have to sit on the intercept while
 * their titles stay on the plot edge, and the grid has to land on the labelled ticks.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import * as d3 from 'd3';
import { ScaleFactory } from '../rendering/ScaleFactory.js';
import { drawAxes, drawGuideLines } from './axisUtils.js';

const WIDTH = 600;
const HEIGHT = 300;
const margin = { top: 20, right: 20, bottom: 60, left: 60 };

// 6 survey lines × 50 stations: 2% unique x values → the band-scale heuristic fires.
const LINES = [-1010, -1000, -800, 450, 950, 1050];
const data = LINES.flatMap(line => d3.range(50).map(i => ({ line, station: -750 + i * 50 })));

const xAxisInfo = { columnName: 'line' };
const seriesInfo = [{ axisAssignment: 'primary', graphType: 'scatter', yAxisInfo: { columnName: 'station' } }];
const staticScales = {
    x: { enabled: true, min: -1500, max: 1500, step: 500 },
    y: { enabled: true, min: -1000, max: 2000, step: 500 }
};
const baseConfig = { graphType: 'scatter', series: [{ graphType: 'scatter' }] };

const buildScales = config => ScaleFactory.createScalesForGraph(data, xAxisInfo, seriesInfo, WIDTH, HEIGHT, config);
const draw = (config, globalSettings = {}) => {
    const { xScale, yScale } = buildScales(config);
    const g = d3.select(document.body).append('svg').append('g');
    const axisInfo = drawAxes(
        g, xScale, yScale, HEIGHT, WIDTH, margin, 'East (m)', 'North (m)', 'scatter',
        config, null, seriesInfo, null, globalSettings, data, xAxisInfo
    );
    return { g, xScale, yScale, axisInfo };
};
const translate = sel => sel.attr('transform').match(/translate\(([^,]+),([^)]+)\)/).slice(1).map(Number);
// d3's comma format emits a typographic minus (−) for values past ±999; normalise it.
const tickLabels = sel => sel.selectAll('.tick text').nodes().map(n => n.textContent.replace('−', '-'));

beforeEach(() => { document.body.innerHTML = ''; });

describe('static x scale vs. the categorical heuristic', () => {
    it('still treats low-cardinality numeric x as categories when no static scale is set', () => {
        const { xScale } = buildScales(baseConfig);
        expect(typeof xScale.bandwidth).toBe('function');
    });

    it('uses a linear axis over the configured min/max when the static x scale is on', () => {
        const { xScale } = buildScales({ ...baseConfig, staticScales });
        expect(xScale.bandwidth).toBeUndefined();
        expect(xScale.domain()).toEqual([-1500, 1500]);
        // real spacing, not one slot per category
        expect(xScale(-1000) - xScale(-1010)).toBeCloseTo(2, 5);
    });

    it('honours a partial static x scale (min only) the same way', () => {
        const { xScale } = buildScales({
            ...baseConfig,
            staticScales: { x: { enabled: true, min: -2000, max: '', step: '' } }
        });
        expect(xScale.bandwidth).toBeUndefined();
        expect(xScale.domain()).toEqual([-2000, 1050]);
    });

    it('keeps the band axis for bar series even with a static x scale', () => {
        const bars = [{ ...seriesInfo[0], graphType: 'bar' }];
        const { xScale } = ScaleFactory.createScalesForGraph(data, xAxisInfo, bars, WIDTH, HEIGHT, { ...baseConfig, staticScales });
        expect(typeof xScale.bandwidth).toBe('function');
    });
});

describe('drawAxes with a static scale and an intercept inside the plot', () => {
    it('labels exactly the min/max/step ticks', () => {
        const { g } = draw({ ...baseConfig, staticScales, axisIntercept: 'custom', customIntercept: { x: 0, y: 0 } });
        expect(tickLabels(g.select('.x-axis'))).toEqual(['-1,500', '-1,000', '-500', '0', '500', '1,000', '1,500']);
        expect(tickLabels(g.select('.y-axis-primary'))).toEqual(['-1,000', '-500', '0', '500', '1,000', '1,500', '2,000']);
    });

    it.each([
        ['origin', undefined, 0, 0],
        ['custom', { x: 0, y: 0 }, 0, 0],
        ['custom', { x: 500, y: 1000 }, 500, 1000]
    ])('%s intercept %o crosses the axes at (%d, %d)', (axisIntercept, customIntercept, ix, iy) => {
        const { g, xScale, yScale } = draw({ ...baseConfig, staticScales, axisIntercept, customIntercept });
        expect(translate(g.select('.y-axis-primary'))).toEqual([xScale(ix), 0]);
        expect(translate(g.select('.x-axis'))).toEqual([0, yScale(iy)]);
    });

    it('leaves the axes on the plot edge for the "minimum" intercept', () => {
        const { g } = draw({ ...baseConfig, staticScales, axisIntercept: 'minimum' });
        expect(translate(g.select('.y-axis-primary'))).toEqual([0, 0]);
        expect(translate(g.select('.x-axis'))).toEqual([0, HEIGHT]);
    });

    it('keeps the x-axis title under the plot, not under the moved axis line', () => {
        const { g, yScale, axisInfo } = draw({ ...baseConfig, staticScales, axisIntercept: 'origin' });
        expect(yScale(0)).toBeLessThan(HEIGHT); // the axis line really is mid-plot
        expect(Number(g.select('.x-axis-label').attr('y'))).toBe(HEIGHT + 60);
        // layout beneath the chart hangs off the plot edge; the line position is reported separately
        expect(axisInfo.xAxisY).toBe(HEIGHT);
        expect(axisInfo.xAxisLineY).toBe(yScale(0));
    });

    it('reports the same baseline as before when the axis is already on the bottom edge', () => {
        const { g, axisInfo } = draw({ ...baseConfig, staticScales, axisIntercept: 'minimum' });
        expect(axisInfo).toEqual({ xAxisY: HEIGHT, xAxisLineY: HEIGHT, xAxisLabelOffset: 50 });
        expect(Number(g.select('.x-axis-label').attr('y'))).toBe(HEIGHT + 60);
    });
});

describe('drawGuideLines', () => {
    const gridPositions = (g) => {
        const lines = g.selectAll('.guide-lines line').nodes().map(n => d3.select(n));
        return {
            vertical: lines.filter(l => l.attr('x1') === l.attr('x2')).map(l => Number(l.attr('x1'))),
            horizontal: lines.filter(l => l.attr('y1') === l.attr('y2')).map(l => Number(l.attr('y1')))
        };
    };

    it('puts grid lines on the static min/max/step ticks', () => {
        const config = { ...baseConfig, staticScales, axisIntercept: 'origin' };
        const { g, xScale, yScale } = draw(config, { showGuideLines: true });
        const { vertical, horizontal } = gridPositions(g);
        expect(vertical).toEqual([-1500, -1000, -500, 0, 500, 1000, 1500].map(xScale));
        expect(horizontal).toEqual([-1000, -500, 0, 500, 1000, 1500, 2000].map(yScale));
    });

    it('does not fall back to d3 automatic ticks when a static step is set', () => {
        // step 750 is not a tick spacing d3 would ever pick for these domains
        const xScale = d3.scaleLinear().domain([-1500, 1500]).range([0, WIDTH]);
        const yScale = d3.scaleLinear().domain([-1000, 2000]).range([HEIGHT, 0]);
        const g = d3.select(document.body).append('svg').append('g');
        drawGuideLines(g, xScale, yScale, WIDTH, HEIGHT, {
            staticScales: {
                x: { enabled: true, min: -1500, max: 1500, step: 750 },
                y: { enabled: true, min: -1000, max: 2000, step: 750 }
            }
        });
        const { vertical, horizontal } = gridPositions(g);
        expect(vertical).toEqual([-1500, -750, 0, 750, 1500].map(xScale));
        expect(horizontal).toEqual([-1000, -250, 500, 1250, 2000].map(yScale));
    });

    it('uses automatic ticks when no static scale is set', () => {
        const xScale = d3.scaleLinear().domain([0, 10]).range([0, WIDTH]);
        const yScale = d3.scaleLinear().domain([0, 100]).range([HEIGHT, 0]);
        const g = d3.select(document.body).append('svg').append('g');
        drawGuideLines(g, xScale, yScale, WIDTH, HEIGHT, {});
        const { vertical, horizontal } = gridPositions(g);
        expect(vertical).toEqual(xScale.ticks().map(xScale));
        expect(horizontal).toEqual(yScale.ticks().map(yScale));
    });
});
