import { describe, it, expect } from 'vitest';
import {
    DERIVED_SOURCE,
    DERIVED_FUNCTIONS,
    DERIVED_PRESETS,
    applyDerivedSeries,
    getFormulaReferences,
    isDerivedSeries,
    nextDerivedKey,
    parseDerivedFormula,
    validateDerivedFormula,
    formatFormulaReference,
    mapFormulaReferences,
} from './derivedSeries.js';
import { performCurveFitting } from './curveFittingUtils.js';
import { renderGraph } from '../core/renderGraph.js';

const tag = (file, rows) => rows.map(r => ({ ...r, _sourceFile: file }));

function derivedConfig(formula, extra = {}) {
    return {
        xAxis: 'year::a.csv',
        series: [{ yAxis: 'Derived 1::__derived__', derived: { formula } }],
        ...extra,
    };
}

// Evaluate one formula and return the derived points as [x, y] pairs.
function points(rows, formula, extra) {
    const { data, errors } = applyDerivedSeries(rows, derivedConfig(formula, extra));
    expect(errors).toEqual([]);
    return data.filter(r => r._sourceFile === DERIVED_SOURCE).map(r => [r.year, r['Derived 1']]);
}

const yearly = tag('a.csv', [
    { year: 2020, cost: 10, tonnes: 2 },
    { year: 2021, cost: 20, tonnes: 4 },
    { year: 2022, cost: 30, tonnes: 5 },
    { year: 2023, cost: 40, tonnes: 8 },
]);

describe('parseDerivedFormula', () => {
    it('accepts bracketed and bare references, numbers and operators', () => {
        expect(() => parseDerivedFormula('[cost::a.csv] / tonnes * 1.5e2 - -1')).not.toThrow();
    });

    it('lists unique references in first-use order', () => {
        const refs = getFormulaReferences('[cost::a.csv] / tonnes + cumsum([cost::a.csv])');
        expect(refs.map(r => r.text)).toEqual(['cost::a.csv', 'tonnes']);
        expect(refs[0]).toMatchObject({ columnName: 'cost', fileName: 'a.csv' });
    });

    it.each([
        ['', 'The formula is empty.'],
        ['2 + 3', 'The formula must use at least one series.'],
        ['cost +', 'The formula ends too early.'],
        ['(cost', 'Expected ")" at the end of the formula.'],
        ['foo(cost)', 'Unknown function "foo".'],
        ['ma(cost)', 'ma() takes 2 arguments, got 1.'],
        ['ma(cost, tonnes)', 'Argument 2 of ma() must be a plain number.'],
        ['ma(cost, 0)', 'The window for ma() must be a whole number of 1 or more.'],
        ['[cost', 'Missing "]" for the reference that starts at position 1.'],
        ['cost $ 2', 'Unexpected "$" at position 6.'],
        ['cumsum([Derived 2::__derived__])', 'A derived series cannot use another derived series.'],
    ])('rejects %j', (formula, message) => {
        expect(() => parseDerivedFormula(formula)).toThrow(message);
    });
});

describe('validateDerivedFormula', () => {
    const columns = [
        { name: 'cost', file: 'a.csv', uniqueId: 'cost::a.csv' },
        { name: 'price', file: 'b.csv', uniqueId: 'price::b.csv' },
    ];

    it('returns null for a valid formula over loaded columns', () => {
        expect(validateDerivedFormula('cumsum([cost::a.csv])', columns)).toBeNull();
        expect(validateDerivedFormula('[cost] / [price]', columns)).toBeNull();
    });

    it('reports a column that is not loaded', () => {
        expect(validateDerivedFormula('[cost::b.csv]', columns)).toBe('Column "cost" is not in b.csv.');
        expect(validateDerivedFormula('grade', columns)).toBe('Column "grade" is not loaded.');
    });

    it('returns the syntax error message', () => {
        expect(validateDerivedFormula('cost +', columns)).toBe('The formula ends too early.');
    });
});

describe('series transforms', () => {
    it('cumsum', () => {
        expect(points(yearly, 'cumsum(cost)')).toEqual([[2020, 10], [2021, 30], [2022, 60], [2023, 100]]);
    });

    it('diff, pct and lag compare with the previous point', () => {
        expect(points(yearly, 'diff(cost)')).toEqual([[2021, 10], [2022, 10], [2023, 10]]);
        const pct = points(yearly, 'pct(cost)');
        expect(pct.map(([x]) => x)).toEqual([2021, 2022, 2023]);
        [100, 50, 100 / 3].forEach((expected, i) => expect(pct[i][1]).toBeCloseTo(expected, 10));
        expect(points(yearly, 'lag(cost, 2)')).toEqual([[2022, 10], [2023, 20]]);
        expect(points(yearly, 'lag(cost)')).toEqual([[2021, 10], [2022, 20], [2023, 30]]);
    });

    it('ma is a trailing average that needs n points', () => {
        expect(points(yearly, 'ma(cost, 3)')).toEqual([[2022, 20], [2023, 30]]);
    });

    it('index rebases the first value to 100', () => {
        expect(points(yearly, 'index(cost)')).toEqual([[2020, 100], [2021, 200], [2022, 300], [2023, 400]]);
    });

    it('sum and mean broadcast as scalars', () => {
        expect(points(yearly, 'cost / sum(cost) * 100')).toEqual([[2020, 10], [2021, 20], [2022, 30], [2023, 40]]);
        expect(points(yearly, 'cost - mean(cost)')).toEqual([[2020, -15], [2021, -5], [2022, 5], [2023, 15]]);
    });

    it('element-wise math functions', () => {
        expect(points(yearly, 'round(cost / 3, 1)')).toEqual([[2020, 3.3], [2021, 6.7], [2022, 10], [2023, 13.3]]);
        expect(points(yearly, 'min(cost, 25)')).toEqual([[2020, 10], [2021, 20], [2022, 25], [2023, 25]]);
        expect(points(yearly, 'max(cost, tonnes * 5)')).toEqual([[2020, 10], [2021, 20], [2022, 30], [2023, 40]]);
        expect(points(yearly, 'log10(cost * 10)')).toEqual([[2020, 2], [2021, Math.log10(200)], [2022, Math.log10(300)], [2023, Math.log10(400)]]);
        expect(points(yearly, '2 ^ tonnes')).toEqual([[2020, 4], [2021, 16], [2022, 32], [2023, 256]]);
    });

    it('function names are case-insensitive', () => {
        expect(points(yearly, 'CumSum(cost)')).toEqual(points(yearly, 'cumsum(cost)'));
    });
});

describe('gaps', () => {
    const gappy = tag('a.csv', [
        { year: 2020, cost: 10, tonnes: 2 },
        { year: 2021, cost: '', tonnes: 0 },
        { year: 2022, cost: 30, tonnes: 5 },
        { year: 2023, cost: 'n/a', tonnes: 8 },
        { year: 2024, cost: 50, tonnes: 10 },
    ]);

    it('a gap in any input makes that point a gap, and division by zero is a gap', () => {
        expect(points(gappy, 'cost / tonnes')).toEqual([[2020, 5], [2022, 6], [2024, 5]]);
        expect(points(gappy, 'tonnes / tonnes')).toEqual([[2020, 1], [2022, 1], [2023, 1], [2024, 1]]);
    });

    it('cumsum carries the total over gaps', () => {
        expect(points(gappy, 'cumsum(cost)')).toEqual([[2020, 10], [2022, 40], [2024, 90]]);
    });

    it('diff and ma do not reach across a gap', () => {
        expect(points(gappy, 'diff(cost)')).toEqual([]);
        expect(points(gappy, 'ma(cost, 2)')).toEqual([]);
    });

    it('rows without an x value are skipped', () => {
        const rows = tag('a.csv', [{ year: 2020, cost: 1 }, { year: '', cost: 2 }, { year: 2021, cost: 3 }]);
        expect(points(rows, 'cumsum(cost)')).toEqual([[2020, 1], [2021, 4]]);
    });
});

describe('alignment', () => {
    it('row mode sorts numeric x before running transforms', () => {
        const shuffled = [yearly[2], yearly[0], yearly[3], yearly[1]];
        expect(points(shuffled, 'cumsum(cost)')).toEqual([[2020, 10], [2021, 30], [2022, 60], [2023, 100]]);
    });

    it('row mode keeps file order for text x values', () => {
        const rows = tag('a.csv', [{ year: 'Q3', cost: 1 }, { year: 'Q1', cost: 2 }, { year: 'Q2', cost: 3 }]);
        expect(points(rows, 'cumsum(cost)')).toEqual([['Q3', 1], ['Q1', 3], ['Q2', 6]]);
    });

    it('row mode keeps repeated x values row by row', () => {
        const rows = tag('a.csv', [{ year: 2020, cost: 4, tonnes: 2 }, { year: 2020, cost: 9, tonnes: 3 }]);
        expect(points(rows, 'cost / tonnes')).toEqual([[2020, 2], [2020, 3]]);
    });

    it('only reads rows from the referenced file when several files are loaded', () => {
        const rows = [...yearly, ...tag('b.csv', [{ year: 2020, cost: 1000 }])];
        expect(points(rows, 'cumsum([cost::a.csv])')).toEqual([[2020, 10], [2021, 30], [2022, 60], [2023, 100]]);
    });

    it('x mode matches files on equal x and leaves gaps where an input is missing', () => {
        const rows = [
            ...tag('a.csv', [{ year: 2020, cost: 10 }, { year: 2021, cost: 20 }, { year: 2022, cost: 30 }]),
            ...tag('b.csv', [{ year: '2021', price: 4 }, { year: 2022.0, price: 5 }, { year: 2023, price: 6 }]),
        ];
        expect(points(rows, '[cost::a.csv] / [price::b.csv]')).toEqual([[2021, 5], [2022, 6]]);
        expect(points(rows, 'cumsum([price::b.csv]) + 0 * [cost::a.csv]')).toEqual([[2021, 4], [2022, 9]]);
    });

    it('x mode matches Date x values', () => {
        const d = (s) => new Date(s);
        const rows = [
            ...tag('a.csv', [{ year: d('2024-01-01'), cost: 10 }, { year: d('2024-02-01'), cost: 20 }]),
            ...tag('b.csv', [{ year: d('2024-02-01'), price: 4 }, { year: d('2024-01-01'), price: 5 }]),
        ];
        const out = points(rows, '[cost::a.csv] / [price::b.csv]');
        expect(out.map(([x, y]) => [x.toISOString().slice(0, 10), y])).toEqual([['2024-01-01', 2], ['2024-02-01', 5]]);
    });

    it('x mode refuses an input that repeats an x value', () => {
        const rows = [
            ...tag('a.csv', [{ year: 2020, cost: 1 }, { year: 2020, cost: 2 }]),
            ...tag('b.csv', [{ year: 2020, price: 3 }]),
        ];
        const { errors } = applyDerivedSeries(rows, derivedConfig('[cost::a.csv] / [price::b.csv]'));
        expect(errors[0].message).toBe('"[cost::a.csv]" has more than one row at x = 2020, so it cannot be matched by x with another file.');
    });

    it('x mode lines up a merged CSV that stacks two files with blanks, as the graph API builds it', () => {
        const merged = [
            { year: 2021, cost: 20, price: '' },
            { year: 2022, cost: 30, price: '' },
            { year: 2021, cost: '', price: 4 },
            { year: 2022, cost: '', price: 5 },
        ];
        expect(points(merged, '[cost::a.csv] / [price::b.csv]')).toEqual([[2021, 5], [2022, 6]]);
    });

    it('untagged rows match any file reference, as batch and headless load them', () => {
        const rows = yearly.map(({ _sourceFile, ...r }) => r);
        expect(points(rows, 'cumsum([cost::other-name.csv])')).toEqual([[2020, 10], [2021, 30], [2022, 60], [2023, 100]]);
    });

    it('uses join columns for x when joinXAxis is on', () => {
        const rows = [
            ...tag('a.csv', [{ year: 2020, cost: 10 }]),
            ...tag('b.csv', [{ yr: 2020, price: 5 }]),
        ];
        const config = derivedConfig('[cost::a.csv] / [price::b.csv]', { joinColumns: ['yr::b.csv'] });
        // Without the join, b.csv rows have no x, so no point lines up.
        expect(points(rows, '[cost::a.csv] / [price::b.csv]', { joinColumns: ['yr::b.csv'] })).toEqual([]);
        const { data, errors } = applyDerivedSeries(rows, config, { joinXAxis: true });
        expect(errors).toEqual([]);
        expect(data.at(-1)).toEqual({ year: 2020, 'Derived 1': 2, _sourceFile: DERIVED_SOURCE });
    });
});

describe('applyDerivedSeries', () => {
    it('returns the input array when there are no derived series', () => {
        const config = { xAxis: 'year::a.csv', series: [{ yAxis: 'cost::a.csv' }] };
        expect(applyDerivedSeries(yearly, config).data).toBe(yearly);
    });

    it('is idempotent', () => {
        const config = derivedConfig('cumsum(cost)');
        const once = applyDerivedSeries(yearly, config).data;
        const twice = applyDerivedSeries(once, config).data;
        expect(twice).toEqual(once);
    });

    it('does not mutate the input rows', () => {
        const before = JSON.stringify(yearly);
        applyDerivedSeries(yearly, derivedConfig('cumsum(cost)'));
        expect(JSON.stringify(yearly)).toBe(before);
    });

    it('reports errors per series and still computes the others', () => {
        const config = {
            xAxis: 'year::a.csv',
            series: [
                { yAxis: 'Derived 1::__derived__', derived: { formula: 'cumsum(grade)' } },
                { yAxis: 'Derived 2::__derived__', derived: { formula: 'cumsum(cost)' } },
                { yAxis: 'Derived 3::__derived__', derived: { formula: '[cost::missing.csv]' } },
            ],
        };
        const { data, errors } = applyDerivedSeries(yearly, config);
        expect(errors).toEqual([
            { seriesIndex: 0, key: 'Derived 1', message: 'Column "grade" is not in the data.' },
            { seriesIndex: 2, key: 'Derived 3', message: 'missing.csv is not loaded, so "[cost::missing.csv]" has no data.' },
        ]);
        expect(data.filter(r => r['Derived 2'] !== undefined)).toHaveLength(4);
    });

    it('refuses a key that is already a column', () => {
        const config = { xAxis: 'year::a.csv', series: [{ yAxis: 'cost::__derived__', derived: { formula: 'tonnes' } }] };
        expect(applyDerivedSeries(yearly, config).errors[0].message).toBe('The name "cost" is already a column in the data.');
    });

    it('needs an x-axis column', () => {
        const config = { series: [{ yAxis: 'Derived 1::__derived__', derived: { formula: 'cost' } }] };
        expect(applyDerivedSeries(yearly, config).errors[0].message).toBe('Pick an x-axis column first.');
    });
});

describe('helpers', () => {
    it('isDerivedSeries needs the virtual file and a formula', () => {
        expect(isDerivedSeries({ yAxis: 'Derived 1::__derived__', derived: { formula: 'cost' } })).toBe(true);
        expect(isDerivedSeries({ yAxis: 'Derived 1::__derived__', derived: { formula: '  ' } })).toBe(false);
        expect(isDerivedSeries({ yAxis: 'cost::a.csv', derived: { formula: 'cost' } })).toBe(false);
    });

    it('mapFormulaReferences rewrites references and keeps everything else', () => {
        const mapped = mapFormulaReferences('cumsum([cost::a.csv]) / tonnes + ma(cost, 3)', r => `${r.columnName}__data1`);
        expect(mapped).toBe('cumsum([cost__data1]) / [tonnes__data1] + ma([cost__data1], 3)');
        expect(() => mapFormulaReferences('cumsum(', r => r.text)).toThrow('The formula ends too early.');
    });

    it('nextDerivedKey picks the next free number', () => {
        expect(nextDerivedKey([])).toBe('Derived 1');
        expect(nextDerivedKey([{ yAxis: 'Derived 3::__derived__' }, { yAxis: 'cost::a.csv' }])).toBe('Derived 4');
    });

    it('every preset builds a formula that parses', () => {
        const refs = [formatFormulaReference('cost::a.csv'), formatFormulaReference('tonnes::a.csv')];
        DERIVED_PRESETS.forEach((preset) => {
            const formula = preset.build(refs.slice(0, preset.inputs), { window: 4 });
            expect(validateDerivedFormula(formula), preset.id).toBeNull();
        });
        expect(DERIVED_PRESETS.find(p => p.id === 'ma').build(refs, { window: 'x' })).toBe('ma([cost::a.csv], 3)');
    });

    it('every documented function example parses', () => {
        DERIVED_FUNCTIONS.forEach((fn) => {
            expect(validateDerivedFormula(fn.example), fn.name).toBeNull();
        });
    });
});

describe('integration', () => {
    it('performCurveFitting can fit a derived series', () => {
        const config = {
            xAxis: 'year::a.csv',
            series: [
                { yAxis: 'cost::a.csv' },
                { yAxis: 'Derived 1::__derived__', derived: { formula: 'cost * 2' } },
            ],
        };
        const [fit] = performCurveFitting(yearly, config, [{ enabled: true, seriesIndex: 1, fitType: 'polynomial', order: 1 }]);
        expect(fit.result).toBeTruthy();
        expect(fit.result.rSquared).toBeCloseTo(1, 6);
        expect(fit.result.coefficients[1]).toBeCloseTo(20, 6);
    });

    it('renderGraph draws a derived series with its own legend entry', () => {
        document.body.innerHTML = '';
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        document.body.appendChild(svg);
        const graphConfig = {
            graphType: 'line',
            xAxis: 'year::a.csv',
            series: [
                { yAxis: 'cost::a.csv', graphType: 'line', axisAssignment: 'primary' },
                { yAxis: 'Derived 1::__derived__', titleName: 'Cumulative cost', graphType: 'line', axisAssignment: 'primary', derived: { formula: 'cumsum([cost::a.csv])' } },
            ],
        };
        const result = renderGraph({
            svg,
            csvData: yearly,
            graphConfig,
            globalSettings: { graphDimensions: { width: 1200, height: 800 }, colorScheme: 'default' },
            colorSchemes: { default: ['#037703', '#3E68C6'] },
        });
        expect(result.success).toBe(true);
        expect(result.derivedErrors).toEqual([]);
        expect(result.validData.filter(r => r._sourceFile === DERIVED_SOURCE)).toHaveLength(4);
        expect(svg.textContent).toContain('Cumulative cost');
        // The y domain has to stretch to the cumulative total of 100.
        expect(result.scales.yScale.domain()[1]).toBeGreaterThanOrEqual(100);
    });

    it('renderGraph reports a broken formula and still draws the other series', () => {
        document.body.innerHTML = '';
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        document.body.appendChild(svg);
        const result = renderGraph({
            svg,
            csvData: yearly,
            graphConfig: {
                graphType: 'scatter',
                xAxis: 'year::a.csv',
                series: [
                    { yAxis: 'cost::a.csv' },
                    { yAxis: 'Derived 1::__derived__', derived: { formula: 'cumsum(' } },
                ],
            },
            globalSettings: { graphDimensions: { width: 1200, height: 800 }, colorScheme: 'default' },
            colorSchemes: { default: ['#037703', '#3E68C6'] },
        });
        expect(result.success).toBe(true);
        expect(result.derivedErrors).toEqual([{ seriesIndex: 1, key: 'Derived 1', message: 'The formula ends too early.' }]);
        expect(svg.querySelectorAll('path.dot').length).toBe(4);
    });
});
