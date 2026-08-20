/**
 * Covers the two behaviours the flotation advice charts depend on, both of which change what
 * a reader sees rather than only where it sits:
 *   • `unifiedValueMode: 'median'` — the value column summarises each category instead of
 *     showing whichever single report happened to sit at or below the selected x.
 *   • the Series-column collapse — a chart whose one categorical series repeats its own name
 *     on every row gives that column up to the categories.
 *
 * Both are exercised through `_prepareRowData` / `_drawTableContent` rather than a full render,
 * so the assertions are about the row and column model, not about pixels.
 */
import { describe, it, expect, vi } from 'vitest';
import { UnifiedTableRenderer } from './UnifiedTableRenderer.js';

const xAxisInfo = { columnName: 'head' };
const scales = { seriesColorScale: null, xScale: (v) => v };

// Two deposit types with deliberately different shapes: VMS's last row is its lowest value,
// so a median and a "most recent at or below x" lookup cannot coincidentally agree.
const data = [
    { head: 1, mp: 10, DepositCode: 'VMS', model: 5 },
    { head: 2, mp: 30, DepositCode: 'VMS', model: 6 },
    { head: 3, mp: 2, DepositCode: 'VMS', model: 7 },
    { head: 1, mp: 40, DepositCode: 'Skarn', model: 5 },
    { head: 2, mp: 60, DepositCode: 'Skarn', model: 6 },
];

const graphConfig = (extra = {}) => ({
    xAxisLabel: 'Feed grade (%)',
    yAxisLabel: 'Mass pull (Mass%)',
    series: [{
        graphType: 'scatter',
        yAxis: 'mp::data.csv',
        filter: true,
        filterColumn: 'DepositCode::data.csv',
        colorGrading: { enabled: true, mode: 'distinct', column: 'DepositCode::data.csv' },
    }, {
        graphType: 'line',
        yAxis: 'model::data.csv',
        titleName: 'Advice line: 1.53 × head',
        colorGrading: { enabled: false },
        filter: false,
    }],
    ...extra,
});

const prepare = (config, selectedX = null) => UnifiedTableRenderer._prepareRowData(
    data, config.series, xAxisInfo, scales, selectedX, config);

const seriesRows = (rows) => rows.filter(r => r.type === 'series');
const byCategory = (rows, code) => seriesRows(rows).find(r => r.filterLabel === code);

describe('_medianOf', () => {
    it('takes the middle of an odd count and the mean of the middle two of an even count', () => {
        expect(UnifiedTableRenderer._medianOf([{ v: 3 }, { v: 1 }, { v: 2 }], 'v')).toBe(2);
        expect(UnifiedTableRenderer._medianOf([{ v: 1 }, { v: 2 }, { v: 3 }, { v: 10 }], 'v')).toBe(2.5);
    });

    it('ignores blank and non-numeric cells rather than counting them as zero', () => {
        expect(UnifiedTableRenderer._medianOf(
            [{ v: 4 }, { v: '' }, { v: null }, { v: 'n/a' }, { v: '6' }], 'v')).toBe(5);
    });

    it('reports N/A when nothing numeric is left', () => {
        expect(UnifiedTableRenderer._medianOf([{ v: '' }], 'v')).toBe('N/A');
        expect(UnifiedTableRenderer._medianOf([], 'v')).toBe('N/A');
    });
});

describe('unifiedValueMode: median', () => {
    it('gives each category the median of its OWN rows', () => {
        const rows = prepare(graphConfig({ unifiedValueMode: 'median' }));
        expect(byCategory(rows, 'VMS').value).toBe(10);      // median of 10, 30, 2
        expect(byCategory(rows, 'Skarn').value).toBe(50);    // median of 40, 60
    });

    it('differs from the default at-x lookup, which reads one raw point', () => {
        const rows = prepare(graphConfig());
        expect(byCategory(rows, 'VMS').value).toBe(2);       // the last VMS row, not its middle
    });

    it('ignores selectedXValue entirely — the median is over every report', () => {
        const atOne = prepare(graphConfig({ unifiedValueMode: 'median' }), 1);
        const atThree = prepare(graphConfig({ unifiedValueMode: 'median' }), 3);
        expect(byCategory(atOne, 'VMS').value).toBe(byCategory(atThree, 'VMS').value);
    });

    it('summarises a plain (non-categorical) series the same way, so the advice line is comparable', () => {
        const rows = prepare(graphConfig({ unifiedValueMode: 'median' }));
        const line = seriesRows(rows).find(r => r.graphType === 'line');
        expect(line.value).toBe(6);                          // median of 5,6,7,5,6
    });

    it('states the sample in the header instead of an x that no longer means anything', () => {
        const rows = prepare(graphConfig({ unifiedValueMode: 'median' }));
        expect(rows[0]).toMatchObject({ type: 'header', label: 'Across', value: 'all 5 reports' });
    });
});

describe('Series-column collapse', () => {
    // A minimal d3-selection stand-in: every append returns a chainable recorder, and the text
    // of each cell is captured so the column model can be asserted without rendering.
    function fakeGroup() {
        const texts = [];
        const node = () => {
            const self = {
                attr: () => self,
                style: () => self,
                text: (t) => { if (t !== undefined) texts.push(String(t)); return self; },
                append: () => node(),
            };
            return self;
        };
        return {
            texts,
            selectAll: () => ({ remove: () => {} }),
            append: () => node(),
        };
    }

    const draw = (config) => {
        const group = fakeGroup();
        const width = UnifiedTableRenderer._drawTableContent(
            group, prepare(config), config.series, null, config);
        return { texts: group.texts, width };
    };

    it('drops the repeated Series header and prints categories in its place', () => {
        const { texts } = draw(graphConfig({ unifiedValueMode: 'median' }));
        expect(texts).not.toContain('Series');
        expect(texts).toContain('DepositCode');
        expect(texts).toContain('VMS');
        expect(texts).toContain('Skarn');
    });

    it('keeps the uncategorised advice line labelled, in the merged column', () => {
        const { texts } = draw(graphConfig({ unifiedValueMode: 'median' }));
        expect(texts).toContain('Advice line: 1.53 × head');
    });

    it('names the value column Median only in median mode', () => {
        expect(draw(graphConfig({ unifiedValueMode: 'median' })).texts).toContain('Median, Mass%');
        expect(draw(graphConfig()).texts).toContain('Value, Mass%');
    });

    it('keepSeriesColumn puts the column back', () => {
        const { texts } = draw(graphConfig({ keepSeriesColumn: true }));
        expect(texts).toContain('Series');
    });

    it('collapsing makes the table narrower, which is what the bias table is placed against', () => {
        expect(draw(graphConfig()).width)
            .toBeLessThan(draw(graphConfig({ keepSeriesColumn: true })).width);
    });

    it('leaves a genuinely multi-series chart alone — two names are not repetition', () => {
        const config = graphConfig();
        config.series = [
            { ...config.series[0], titleName: 'Lead' },
            { ...config.series[0], yAxis: 'model::data.csv', titleName: 'Zinc' },
        ];
        expect(draw(config).texts).toContain('Series');
    });
});
