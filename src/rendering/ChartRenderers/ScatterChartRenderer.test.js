/**
 * Covers `visibleCategories`: the flotation advice charts let a reader pick one deposit type,
 * and the point of the key is that picking one changes ONLY which points are drawn. The
 * category's glyph and colour, and every other category's place in the chart, are assigned
 * from the whole dataset — so the same deposit type looks the same in every view and the
 * legend/value table beside the plot keeps listing all of them.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import * as d3 from 'd3';
import { ScatterChartRenderer } from './ScatterChartRenderer.js';

const CODES = ['VMS', 'Skarn', 'EpithermalVein', 'Porphyry'];
const data = CODES.flatMap((code, c) =>
    [1, 2, 3].map((i) => ({ head: c + i, rec: 70 + c * 5 + i, DepositCode: code }))
);

const xAxisInfo = { columnName: 'head' };
const yAxisInfo = { columnName: 'rec' };
const scales = {
    xScale: d3.scaleLinear().domain([0, 10]).range([0, 100]),
    yScale: d3.scaleLinear().domain([60, 100]).range([100, 0])
};
const colorScale = d3.scaleOrdinal().domain(CODES).range(['#111', '#222', '#333', '#444']);
const colorInfo = { columnName: 'DepositCode' };

const seriesConfig = (extra = {}) => ({
    graphType: 'scatter',
    yAxis: 'rec::data.csv',
    filter: true,
    filterColumn: 'DepositCode::data.csv',
    strokeWidth: 2.5,
    ...extra
});

/** Renders into a fresh detached group and returns each dot's glyph + fill. */
function renderDots(extra = {}) {
    const svg = d3.select(document.body).append('svg');
    const g = svg.append('g');
    const config = { series: [seriesConfig(extra)] };
    new ScatterChartRenderer().render(
        g, data, scales, xAxisInfo, yAxisInfo, config, colorScale, colorInfo, null, seriesConfig(extra)
    );
    const dots = g.selectAll('.dot').nodes()
        .map(node => ({ d: node.getAttribute('d'), fill: node.style.fill }));
    svg.remove();
    return dots;
}

describe('ScatterChartRenderer visibleCategories', () => {
    beforeEach(() => { document.body.innerHTML = ''; });

    it('plots every category when the key is absent', () => {
        expect(renderDots()).toHaveLength(data.length);
    });

    it('plots only the listed categories', () => {
        const dots = renderDots({ visibleCategories: ['EpithermalVein'] });
        expect(dots).toHaveLength(3);
    });

    it('keeps each drawn point on the glyph and colour it had among all categories', () => {
        // The reason this key exists rather than filtering the dataset upstream: with the
        // other rows gone, the survivor becomes category #1 and is re-assigned the first
        // glyph and the first colour, so the same deposit type reads differently in the two
        // views and cannot be compared across them.
        const all = renderDots();
        const one = renderDots({ visibleCategories: ['EpithermalVein'] });
        const allMarks = new Set(all.map(dot => `${dot.d}|${dot.fill}`));

        expect(one).not.toHaveLength(0);
        for (const dot of one) {
            expect(allMarks.has(`${dot.d}|${dot.fill}`)).toBe(true);
        }
        // And it is genuinely one category's worth of marks, not a coincidence of sameness.
        expect(new Set(one.map(dot => `${dot.d}|${dot.fill}`)).size).toBe(1);
    });

    it('draws nothing, and does not throw, when no row matches', () => {
        expect(renderDots({ visibleCategories: ['NotADepositCode'] })).toHaveLength(0);
    });
});
