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

    it('names what the sample IS when the chart says, so the count is not read as every report', () => {
        const rows = prepare(graphConfig({
            unifiedValueMode: 'median', unifiedSampleNote: 'LHIR + LOR',
        }));
        expect(rows[0]).toMatchObject({ value: 'all 5 reports (LHIR + LOR)' });
    });

    it('leaves the sample bare when no note is given', () => {
        const rows = prepare(graphConfig({ unifiedValueMode: 'median', unifiedSampleNote: '' }));
        expect(rows[0].value).toBe('all 5 reports');
    });
});

describe('unifiedValueMode: fitAtX', () => {
    const linear = (extra = {}) => graphConfig({
        unifiedValueMode: 'fitAtX', unifiedFitForm: 'linear', ...extra });

    it('reads each category\'s OWN fitted line at the selected x, not one of its points', () => {
        const rows = prepare(linear(), 2);
        // Skarn: k = sum(xy)/sum(xx) = (1*40 + 2*60) / (1 + 4) = 32 ; at x=2 that is 64,
        // which is neither of the two Skarn points and is not their median either.
        expect(byCategory(rows, 'Skarn').value).toBeCloseTo(64, 10);
        expect(byCategory(rows, 'Skarn').formula).toBe('32.00 × head');
    });

    it('answers at an x the category has never run at — that is the question being asked', () => {
        const rows = prepare(linear(), 10);
        expect(byCategory(rows, 'Skarn').value).toBeCloseTo(320, 10);   // 32 × 10
    });

    it('counts the rows behind the fit, so a thin category can be seen to be thin', () => {
        const rows = prepare(linear(), 2);
        expect(byCategory(rows, 'Skarn').count).toBe(2);
        expect(byCategory(rows, 'VMS').count).toBe(3);
    });

    it('reads the reference line where it is DRAWN rather than refitting a fit', () => {
        const rows = prepare(linear(), 1.5);
        const line = seriesRows(rows).find(r => r.graphType === 'line');
        expect(line.value).toBeCloseTo(5.5, 10);             // between model 5 at x=1 and 6 at x=2
        expect(line.formula).toBe('');
        expect(line.count).toBe(5);
    });

    it('falls back to the plain median with no x, and says so in both headings', () => {
        const rows = prepare(linear());
        expect(byCategory(rows, 'VMS').value).toBe(10);      // median of 10, 30, 2
        expect(rows[0]).toMatchObject({ label: 'Across', value: 'all 5 reports', atPoint: false });
        expect(UnifiedTableRenderer._valueHeader(rows, linear())).toBe('Median, Mass%');
    });

    it('names the column for what it holds once there IS a point', () => {
        const rows = prepare(linear(), 2);
        expect(rows[0]).toMatchObject({ label: 'Read at', value: 2, atPoint: true });
        expect(UnifiedTableRenderer._valueHeader(rows, linear())).toBe('Median at point, Mass%');
    });

    it('keeps the sample size alongside the point, not instead of it', () => {
        expect(prepare(linear(), 2)[0].sample).toBe('all 5 reports');
        // In the summarising modes the sample already IS the header pair.
        expect(prepare(linear())[0]).toMatchObject({ value: 'all 5 reports', sample: null });
        expect(prepare(graphConfig({ unifiedValueMode: 'median' }))[0].sample).toBe(null);
    });

    it('leaves other chart families\' headers alone', () => {
        expect(prepare(graphConfig(), 2)[0].sample).toBe(null);
    });

    it('defaults to the median form, which is a different number from the linear one', () => {
        const asMedian = prepare(graphConfig({ unifiedValueMode: 'fitAtX' }), 2);
        expect(byCategory(asMedian, 'Skarn').formula).toBe('median ±1');
        expect(byCategory(asMedian, 'Skarn').value).not.toBeCloseTo(64, 10);
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

    const draw = (config, selectedX = null) => {
        const group = fakeGroup();
        const width = UnifiedTableRenderer._drawTableContent(
            group, prepare(config, selectedX), config.series, null, config);
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

    it('heads the category column with what the categories ARE, when told to', () => {
        const { texts } = draw(graphConfig({
            unifiedValueMode: 'median', unifiedCategoryHeader: 'Deposit type' }));
        expect(texts).toContain('Deposit type');
        expect(texts).not.toContain('DepositCode');
    });

    it('fitAtX draws the four headings the flotation charts ask for, and their cells', () => {
        const { texts } = draw(graphConfig({
            unifiedValueMode: 'fitAtX',
            unifiedFitForm: 'linear',
            unifiedCategoryHeader: 'Deposit type',
        }), 2);
        expect(texts).toContain('Deposit type');
        expect(texts).toContain('Median at point, Mass%');
        expect(texts).toContain('formula');
        expect(texts).toContain('number of data');
        expect(texts).toContain('32.00 × head');            // Skarn's own fit
        expect(texts).toContain('n=2');
    });

    it('leaves every other chart\'s table at its own columns', () => {
        const { texts } = draw(graphConfig({ unifiedValueMode: 'median' }));
        expect(texts).not.toContain('formula');
        expect(texts).not.toContain('number of data');
    });

    it('drops a qualifier column the chart does not list — a window IS its row count', () => {
        const { texts } = draw(graphConfig({
            unifiedValueMode: 'fitAtX',
            unifiedCategoryHeader: 'Deposit type',
            unifiedFitColumns: ['count'],
        }), 2);
        expect(texts).toContain('Median at point, Mass%');
        expect(texts).toContain('number of data');
        expect(texts).toContain('n=2');
        expect(texts).not.toContain('formula');
        expect(texts.some(t => /median ±/.test(t))).toBe(false);
    });

    it('prints both header pairs — the point read at, and what it rests on', () => {
        const { texts } = draw(graphConfig({
            unifiedValueMode: 'fitAtX', unifiedCategoryHeader: 'Deposit type' }), 2);
        expect(texts).toContain('Read at:');
        expect(texts).toContain('2.00');
        expect(texts).toContain('Across:');
        expect(texts).toContain('all 5 reports');
    });

    it('narrowing the columns narrows the table', () => {
        const both = graphConfig({ unifiedValueMode: 'fitAtX' });
        const one = graphConfig({ unifiedValueMode: 'fitAtX', unifiedFitColumns: ['count'] });
        expect(draw(one, 2).width).toBeLessThan(draw(both, 2).width);
    });
});
