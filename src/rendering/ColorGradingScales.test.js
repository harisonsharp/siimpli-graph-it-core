/**
 * Covers the continuous colour grading scale types (`series.colorGrading.scale`):
 * linear (the default, unchanged), quantile, log, pretty breaks and standard deviations —
 * the class boundaries each one produces, the fallbacks when the data can't support the
 * requested scale, and the legend panel drawn for each.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import * as d3 from 'd3';
import { ScaleFactory } from './ScaleFactory.js';
import { LegendRenderer } from './LegendRenderer.js';
import { SymbolFactory } from '../utils/SymbolFactory.js';

const colorInfo = { columnName: 'grade' };
const rows = values => values.map(grade => ({ grade }));
const build = (values, scale, classes) =>
    ScaleFactory.createColorScale(rows(values), colorInfo, 'warm-cool', {}, { scale, classes });

// Skewed: most values low, a long tail — the case linear grading handles badly.
const SKEWED = [1, 2, 3, 4, 5, 6, 7, 8, 9, 1000];

describe('colour grading scales', () => {
    describe('linear (default)', () => {
        it('is unchanged when no scale options are given', () => {
            const scale = ScaleFactory.createColorScale(rows(SKEWED), colorInfo);
            expect(scale.domain()).toEqual([1, 1000]);
            expect(scale.gradingType).toBeUndefined();
            expect(scale(1)).toBe(d3.interpolateRdYlBu(0));
            expect(scale(1000)).toBe(d3.interpolateRdYlBu(1));
        });

        it('treats scale: "linear" the same as omitting it', () => {
            const scale = build(SKEWED, 'linear');
            expect(scale.gradingClasses).toBeUndefined();
            expect(scale.domain()).toEqual([1, 1000]);
        });
    });

    describe('quantile', () => {
        it('puts an equal number of points in each class', () => {
            const scale = build(SKEWED, 'quantile', 5);
            expect(scale.gradingType).toBe('quantile');
            expect(scale.gradingClasses).toHaveLength(5);

            const counts = d3.rollup(SKEWED, v => v.length, v => scale(v));
            expect([...counts.values()]).toEqual([2, 2, 2, 2, 2]);
        });

        it('spans the data extent and uses both ends of the scheme', () => {
            const classes = build(SKEWED, 'quantile', 5).gradingClasses;
            expect(classes[0].min).toBe(1);
            expect(classes[4].max).toBe(1000);
            expect(classes[0].color).toBe(d3.interpolateRdYlBu(0));
            expect(classes[4].color).toBe(d3.interpolateRdYlBu(1));
        });

        it('collapses duplicate breaks when there are fewer unique values than classes', () => {
            const scale = build([1, 1, 1, 1, 1, 1, 2, 2, 3], 'quantile', 8);
            const classes = scale.gradingClasses;
            expect(classes.length).toBeLessThanOrEqual(3);
            // no empty classes: every class boundary is strictly increasing
            classes.forEach(c => expect(c.max).toBeGreaterThan(c.min));
            expect(new Set([1, 2, 3].map(v => scale(v))).size).toBe(classes.length);
        });

        it('clamps the class count to 2-10 and defaults to 5', () => {
            const many = d3.range(1, 101);
            expect(build(many, 'quantile', 50).gradingClasses).toHaveLength(10);
            expect(build(many, 'quantile', 1).gradingClasses).toHaveLength(2);
            expect(build(many, 'quantile').gradingClasses).toHaveLength(5);
        });
    });

    describe('pretty breaks', () => {
        it('breaks on round numbers', () => {
            const scale = build([0.4, 3, 7, 11, 14.2], 'pretty', 3);
            expect(scale.gradingType).toBe('pretty');
            expect(scale.gradingClasses.map(c => [c.min, c.max])).toEqual([[0, 5], [5, 10], [10, 15]]);
        });

        it('assigns a value on a break to the upper class', () => {
            const scale = build([0.4, 3, 7, 11, 14.2], 'pretty', 3);
            const [low, mid, high] = scale.gradingClasses.map(c => c.color);
            expect(scale(4.99)).toBe(low);
            expect(scale(5)).toBe(mid);
            expect(scale(14.2)).toBe(high);
        });
    });

    describe('standard deviations', () => {
        // mean 5, sample sd ≈ 2.74
        const VALUES = [1, 2, 3, 4, 5, 6, 7, 8, 9];

        it('breaks at the mean and whole standard deviations either side', () => {
            const scale = build(VALUES, 'stddev');
            const mean = d3.mean(VALUES);
            const sd = d3.deviation(VALUES);
            expect(scale.gradingType).toBe('stddev');
            expect(scale.domain()).toEqual([-3, -2, -1, 0, 1, 2, 3].map(k => mean + k * sd));
        });

        it('is symmetric about the mean', () => {
            const scale = build(VALUES, 'stddev');
            expect(scale(4.9)).toBe(d3.interpolateRdYlBu(3 / 7));
            expect(scale(5.1)).toBe(d3.interpolateRdYlBu(4 / 7));
        });

        it('lists only the bands the data reaches, labelled in σ', () => {
            const classes = build(VALUES, 'stddev').gradingClasses;
            expect(classes.map(c => c.sigmaLabel)).toEqual([
                '−2σ to −1σ', '−1σ to mean', 'mean to +1σ', '+1σ to +2σ'
            ]);
        });

        it('keeps the open-ended outer bands when outliers reach them', () => {
            const withOutlier = [...d3.range(40).map(() => 10), ...d3.range(40).map(() => 11), 100];
            const classes = build(withOutlier, 'stddev').gradingClasses;
            const last = classes[classes.length - 1];
            expect(last.sigmaLabel).toBe('> +3σ');
            expect(last.max).toBeNull();
        });
    });

    describe('log', () => {
        it('spaces colour evenly per decade', () => {
            const scale = build([1, 10, 100, 1000, 10000], 'log');
            expect(scale.gradingType).toBe('log');
            expect(scale.gradingDomain).toEqual([1, 10000]);
            expect(scale(1)).toBe(d3.interpolateRdYlBu(0));
            expect(scale(100)).toBe(d3.interpolateRdYlBu(0.5));
            expect(scale(10000)).toBe(d3.interpolateRdYlBu(1));
        });

        it('builds from positive values only and greys out zero / negative points', () => {
            const scale = build([-5, 0, 1, 10, 100], 'log');
            expect(scale.gradingDomain).toEqual([1, 100]);
            expect(scale(0)).toBe(SymbolFactory.MISSING_COLOR);
            expect(scale(-5)).toBe(SymbolFactory.MISSING_COLOR);
        });

        it('falls back to linear when no values are positive', () => {
            const scale = build([-3, -2, -1, 0], 'log');
            expect(scale.gradingType).toBeUndefined();
            expect(scale.domain()).toEqual([-3, 0]);
        });
    });

    describe('fallbacks', () => {
        it.each(['quantile', 'log', 'pretty', 'stddev'])(
            '%s falls back to linear when every value is identical',
            (type) => {
                const scale = build([7, 7, 7, 7], type);
                expect(scale.gradingType).toBeUndefined();
                expect(scale.domain()).toEqual([7, 7]);
            }
        );

        it('falls back to linear for an unknown scale name', () => {
            expect(build(SKEWED, 'nonsense').gradingType).toBeUndefined();
        });

        it('leaves categorical (string) columns ordinal', () => {
            const scale = ScaleFactory.createColorScale(
                [{ grade: 'a' }, { grade: 'b' }], colorInfo, 'warm-cool', {}, { scale: 'quantile' }
            );
            expect(scale.domain()).toEqual(['a', 'b']);
        });
    });

    describe('createSeriesColorScales', () => {
        const series = (colorGrading) => [{ colorGrading: { enabled: true, column: 'grade::data.csv', ...colorGrading } }];

        it('passes the series scale and class count through', () => {
            const [grading] = ScaleFactory.createSeriesColorScales(rows(SKEWED), series({ scale: 'quantile', classes: 2 }));
            expect(grading.colorScale.gradingClasses).toHaveLength(2);
        });

        it('is linear for configs saved before the scale option existed', () => {
            const [grading] = ScaleFactory.createSeriesColorScales(rows(SKEWED), series({ mode: 'continuous' }));
            expect(grading.colorScale.gradingType).toBeUndefined();
        });

        it('ignores the scale in distinct mode', () => {
            const [grading] = ScaleFactory.createSeriesColorScales(rows(SKEWED), series({ mode: 'distinct', scale: 'quantile' }));
            expect(grading.colorScale.gradingClasses).toBeUndefined();
        });
    });

    describe('legend', () => {
        const dimensions = { width: 400, height: 300, margin: { top: 20, right: 180, bottom: 40, left: 50 } };
        const draw = (values, colorGrading) => {
            const svg = d3.select(document.body).append('svg');
            const seriesInfo = [{
                titleName: 'Recovery',
                colorGrading: { enabled: true, column: 'grade::data.csv', ...colorGrading }
            }];
            const data = rows(values);
            LegendRenderer.drawColorGradingLegends(
                svg, seriesInfo, ScaleFactory.createSeriesColorScales(data, seriesInfo), data, dimensions
            );
            return svg;
        };
        const texts = svg => svg.selectAll('.color-grading-legend text').nodes().map(n => n.textContent);

        beforeEach(() => { document.body.innerHTML = ''; });

        it('draws one labelled swatch per class for pretty breaks', () => {
            const svg = draw([0.4, 3, 7, 11, 14.2], { scale: 'pretty', classes: 3 });
            expect(svg.selectAll('linearGradient').size()).toBe(0);
            expect(texts(svg)).toEqual(['Recovery', 'grade', '0 – 5', '5 – 10', '10 – 15']);
        });

        it('shows the σ band and its actual values for standard deviations', () => {
            const labels = texts(draw([1, 2, 3, 4, 5, 6, 7, 8, 9], { scale: 'stddev' }));
            expect(labels).toContain('−1σ to mean');
            expect(labels).toContain('2.261 – 5');
        });

        it('draws a gradient bar with a geometric-mean midpoint label for log', () => {
            const svg = draw([0, 1, 10, 100, 10000], { scale: 'log' });
            expect(svg.selectAll('linearGradient').size()).toBe(1);
            expect(texts(svg)).toEqual(['Recovery', 'grade', '1', '1.00e+4', '100']);
        });

        it('still draws the min / max gradient bar for linear', () => {
            const svg = draw([2, 4, 8], {});
            expect(svg.selectAll('linearGradient').size()).toBe(1);
            expect(texts(svg)).toEqual(['Recovery', 'grade', '2', '8']);
        });
    });
});
