import { describe, it, expect } from 'vitest';
import {
    DEFAULT_BIAS_ROW_HEADER,
    baselineInterpolator,
    biasComparison,
    computeBiasTable,
    resolveBiasTableData,
} from './biasTable.js';
import { applyDerivedSeries } from './derivedSeries.js';

describe('baselineInterpolator', () => {
    it('interpolates between points and is null outside them', () => {
        const at = baselineInterpolator([{ x: 0, y: 100 }, { x: 10, y: 200 }]);
        expect(at(5)).toBe(150);
        expect(at(0)).toBe(100);
        expect(at(10)).toBe(200);
        expect(at(-1)).toBeNull();
        expect(at(11)).toBeNull();
    });

    it('averages points that share an x', () => {
        const at = baselineInterpolator([{ x: 0, y: 100 }, { x: 0, y: 200 }, { x: 2, y: 150 }]);
        expect(at(0)).toBe(150);
        expect(at(1)).toBe(150);
    });
});

describe('biasComparison', () => {
    it('averages the percentage differences and skips points out of range', () => {
        const at = baselineInterpolator([{ x: 0, y: 100 }, { x: 10, y: 200 }]);
        const result = biasComparison([{ x: 5, y: 165 }, { x: 10, y: 180 }, { x: 12, y: 1 }], at);
        expect(result.count).toBe(2);
        expect(result.value).toBeCloseTo(0, 10);
    });

    it('skips points where the baseline is 0', () => {
        const at = baselineInterpolator([{ x: 0, y: 0 }, { x: 10, y: 100 }]);
        expect(biasComparison([{ x: 0, y: 5 }, { x: 10, y: 110 }], at).value).toBeCloseTo(10, 10);
    });
});

const rows = [
    { year: 2020, spot: 100, study: 'PEA', reported: 110 },
    { year: 2021, spot: 200, study: 'FS', reported: 150 },
    { year: 2022, spot: 300, study: 'PEA', reported: 270 },
    { year: 2023, spot: 400, study: 'FS', reported: '' },
    { year: 2024, study: 'FS', reported: 900 },
].map(r => ({ ...r, _sourceFile: 'prices.csv' }));

const spot = { yAxis: 'spot::prices.csv', titleName: 'Spot', biasRole: 'baseline' };
const reported = { yAxis: 'reported::prices.csv', titleName: 'Reported', biasRole: 'compare' };

describe('computeBiasTable', () => {
    it('gives one row per baseline and one column per compared series', () => {
        const table = computeBiasTable(rows, { xAxis: 'year::prices.csv', series: [reported, spot] });
        // 2020: +10%, 2021: -25%, 2022: -10%. 2024 is past the baseline and skipped.
        expect(table).toHaveLength(1);
        expect(table[0][DEFAULT_BIAS_ROW_HEADER]).toBe('Bias to Spot');
        expect(table[0].Reported).toBeCloseTo(-25 / 3, 10);
    });

    it('splits a unique-filtered series into one column per category', () => {
        const split = { ...reported, filter: true, filterColumn: 'study::prices.csv', filterType: 'unique' };
        const table = computeBiasTable(rows, { xAxis: 'year::prices.csv', series: [split, spot] }, { rowHeader: 'Historic Report Comparison' });
        expect(Object.keys(table[0])).toEqual(['Historic Report Comparison', 'PEA', 'FS']);
        expect(table[0].PEA).toBeCloseTo(0, 10);
        expect(table[0].FS).toBeCloseTo(-25, 10);
    });

    it('uses biasLabel for headings and leaves a cell blank when nothing compares', () => {
        const late = { yAxis: 'late::prices.csv', biasRole: 'compare', biasLabel: 'Late' };
        const data = [...rows, { year: 2030, late: 5, _sourceFile: 'prices.csv' }];
        const table = computeBiasTable(data, {
            xAxis: 'year::prices.csv',
            series: [late, { ...spot, biasLabel: 'Bias to Trend Mean of Spot Data' }],
        });
        expect(table[0]).toEqual({ [DEFAULT_BIAS_ROW_HEADER]: 'Bias to Trend Mean of Spot Data', Late: '' });
    });

    it('can compare against a derived series', () => {
        const trend = { yAxis: 'Derived 1::__derived__', derived: { formula: 'cmean([spot::prices.csv], 3)' }, titleName: 'Spot trend', biasRole: 'baseline' };
        const config = { xAxis: 'year::prices.csv', series: [reported, trend] };
        const { data } = applyDerivedSeries(rows, config);
        const table = computeBiasTable(data, config);
        // Trend: 2020 150, 2021 200, 2022 300, 2023 350.
        const expected = ((110 - 150) / 150 + (150 - 200) / 200 + (270 - 300) / 300) / 3 * 100;
        expect(table[0].Reported).toBeCloseTo(expected, 10);
    });

    it('is empty without a baseline or a compared series', () => {
        expect(computeBiasTable(rows, { xAxis: 'year::prices.csv', series: [reported] })).toEqual([]);
    });
});

describe('resolveBiasTableData', () => {
    it('uses the CSV rows unless the source is computed', () => {
        const config = { xAxis: 'year::prices.csv', series: [reported, spot] };
        expect(resolveBiasTableData(rows, config, { biasTableData: [{ a: 1 }] })).toEqual([{ a: 1 }]);
        expect(resolveBiasTableData(rows, config, { biasTableSource: 'computed', biasTableData: [{ a: 1 }] })).toHaveLength(1);
    });

    it('computes when no source is set and no CSV is loaded', () => {
        const config = { xAxis: 'year::prices.csv', series: [reported, spot] };
        expect(resolveBiasTableData(rows, config, {})).toHaveLength(1);
    });
});
