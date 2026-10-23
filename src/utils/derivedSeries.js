/**
 * @fileoverview Derived series: series computed from a formula over other series
 * instead of read from a CSV column.
 *
 * A derived series is an ordinary entry in `graphConfig.series` whose `yAxis`
 * points at the virtual source file `__derived__` and which carries
 * `derived.formula`, e.g.
 *
 *   { yAxis: 'Derived 1::__derived__', derived: { formula: 'cumsum([Cost::costs.csv])' } }
 *
 * `applyDerivedSeries` evaluates every such series and appends one row per
 * point, tagged `_sourceFile: '__derived__'`, so the renderers, legends, tables
 * and curve fitting treat it like any other series.
 *
 * A formula refers to other series as [Column], [Column::file.csv], #2 (series
 * number, 1-based) or "Name" (the series' titleName). It can read another
 * derived series. applyDerivedSeries works them out in dependency order and
 * reports a cycle as an error on the series in it.
 *
 * Alignment: when every reference resolves to one source file the formula runs
 * row by row over that file. When references span several files the inputs are
 * matched on equal x values and a missing x is a gap. Nothing is interpolated.
 *
 * @module derivedSeries
 * @exports DERIVED_SOURCE, DERIVED_FUNCTIONS, DERIVED_PRESETS, isDerivedSeries,
 *   isDerivedRow, parseDerivedFormula, getFormulaReferences, validateDerivedFormula,
 *   formatFormulaReference, mapFormulaReferences, expandSeriesReferences,
 *   isDerivedReference, nextDerivedKey, applyDerivedSeries
 */

import { parseColumnId } from './columnUtils.js';
import {
    RollingStatsError, lowessMean, lowessStd, median, nearestStat, pointWindowStat, sampleStd, windowStat,
} from './rollingStats.js';

/** Virtual file name that marks a series, and its rows, as derived. */
export const DERIVED_SOURCE = '__derived__';

/**
 * Function reference for the formula language. The help modal in the UI is
 * built from this list, so the descriptions are user-facing text.
 */
export const DERIVED_FUNCTIONS = [
    { name: 'cumsum', group: 'transform', syntax: 'cumsum(s)', description: 'Running total. Gaps are skipped and the total carries over them.', example: 'cumsum([Cost])' },
    { name: 'ma', group: 'transform', syntax: 'ma(s, n)', description: 'Trailing moving average of the last n points. The first n - 1 points are gaps.', example: 'ma([Grade], 12)' },
    { name: 'pct', group: 'transform', syntax: 'pct(s)', description: 'Percent change from the previous point.', example: 'pct([Price])' },
    { name: 'diff', group: 'transform', syntax: 'diff(s)', description: 'Change from the previous point.', example: 'diff([Tonnes])' },
    { name: 'lag', group: 'transform', syntax: 'lag(s, n)', description: 'The value n points earlier. n defaults to 1.', example: 'lag([Cost], 1)' },
    { name: 'index', group: 'transform', syntax: 'index(s)', description: 'Rebases the series so its first value is 100.', example: 'index([Price])' },
    { name: 'sum', group: 'transform', syntax: 'sum(s)', description: 'Total of the whole series, as one number.', example: '[Cost] / sum([Cost]) * 100' },
    { name: 'mean', group: 'transform', syntax: 'mean(s)', description: 'Average of the whole series, as one number.', example: '[Grade] - mean([Grade])' },
    { name: 'median', group: 'transform', syntax: 'median(s)', description: 'Median of the whole series, as one number.', example: '[Grade] - median([Grade])' },
    { name: 'std', group: 'transform', syntax: 'std(s)', description: 'Sample standard deviation (n - 1) of the whole series, as one number.', example: 'mean([Price]) + 2 * std([Price])' },
    { name: 'ema', group: 'transform', syntax: 'ema(s, n)', description: 'Exponential moving average with the weight of an n-point average, 2 / (n + 1). Gaps are skipped.', example: 'ema([Price], 12)' },
    { name: 'cummean', group: 'transform', syntax: 'cummean(s)', description: 'Running average of every point so far. Gaps are skipped.', example: 'cummean([Grade])' },
    { name: 'rmean', group: 'rolling', syntax: 'rmean(s, n)', description: 'Rolling average of the last n points that have a value. Near the start it averages the points so far. On monthly prices rmean(s, 36) is the 3-year average.', example: 'rmean([Price], 36)' },
    { name: 'rmedian', group: 'rolling', syntax: 'rmedian(s, n)', description: 'Rolling median of the last n points that have a value.', example: 'rmedian([Price], 36)' },
    { name: 'rmin', group: 'rolling', syntax: 'rmin(s, n)', description: 'Rolling minimum of the last n points that have a value.', example: 'rmin([Price], 36)' },
    { name: 'rmax', group: 'rolling', syntax: 'rmax(s, n)', description: 'Rolling maximum of the last n points that have a value.', example: 'rmax([Price], 36)' },
    { name: 'rstd', group: 'rolling', syntax: 'rstd(s, n)', description: 'Rolling sample standard deviation of the last n points that have a value. Needs two points.', example: 'rmean([Price], 36) + rstd([Price], 36)' },
    { name: 'cmean', group: 'rolling', syntax: 'cmean(s, w)', description: 'Centred average over an x window of width w, from w/2 before the point to w/2 after it.', example: 'cmean([Price], 3)' },
    { name: 'cmedian', group: 'rolling', syntax: 'cmedian(s, w)', description: 'Centred median over an x window of width w.', example: 'cmedian([Price], 3)' },
    { name: 'cmin', group: 'rolling', syntax: 'cmin(s, w)', description: 'Centred minimum over an x window of width w.', example: 'cmin([Price], 3)' },
    { name: 'cmax', group: 'rolling', syntax: 'cmax(s, w)', description: 'Centred maximum over an x window of width w.', example: 'cmax([Price], 3)' },
    { name: 'cstd', group: 'rolling', syntax: 'cstd(s, w)', description: 'Centred sample standard deviation over an x window of width w.', example: 'cmean([Price], 3) - 2 * cstd([Price], 3)' },
    { name: 'knnmean', group: 'rolling', syntax: 'knnmean(s, k)', description: 'Average of the k points nearest in x. A k below 1 is a share of the points, so 0.2 means the nearest fifth.', example: 'knnmean([Price], 15)' },
    { name: 'knnmedian', group: 'rolling', syntax: 'knnmedian(s, k)', description: 'Median of the k points nearest in x.', example: 'knnmedian([Price], 0.2)' },
    { name: 'knnstd', group: 'rolling', syntax: 'knnstd(s, k)', description: 'Sample standard deviation of the k points nearest in x.', example: 'knnmean([Price], 15) + knnstd([Price], 15)' },
    { name: 'lowess', group: 'rolling', syntax: 'lowess(s, span)', description: 'LOWESS trend: a straight line through the nearest points, weighted toward the closest. span is the share of points used, as in 0.3, or a count.', example: 'lowess([Price], 0.3)' },
    { name: 'lowessstd', group: 'rolling', syntax: 'lowessstd(s, span)', description: 'Weighted standard deviation of the points around lowess(s, span), over the same neighbours.', example: 'lowess([Price], 0.3) + lowessstd([Price], 0.3)' },
    { name: 'abs', group: 'math', syntax: 'abs(s)', description: 'Absolute value.', example: 'abs(diff([Cost]))' },
    { name: 'sqrt', group: 'math', syntax: 'sqrt(s)', description: 'Square root.', example: 'sqrt([Area])' },
    { name: 'ln', group: 'math', syntax: 'ln(s)', description: 'Natural logarithm. log(s) is the same function.', example: 'ln([Price])' },
    { name: 'log', group: 'math', syntax: 'log(s)', description: 'Natural logarithm, same as ln(s).', example: 'log([Price])' },
    { name: 'log10', group: 'math', syntax: 'log10(s)', description: 'Base 10 logarithm.', example: 'log10([Tonnes])' },
    { name: 'exp', group: 'math', syntax: 'exp(s)', description: 'e raised to the value.', example: 'exp([Rate])' },
    { name: 'round', group: 'math', syntax: 'round(s, digits)', description: 'Rounds to a number of decimal places. digits defaults to 0.', example: 'round([Grade], 2)' },
    { name: 'min', group: 'math', syntax: 'min(a, b)', description: 'The smaller of two values at each point.', example: 'min([Cost], 100)' },
    { name: 'max', group: 'math', syntax: 'max(a, b)', description: 'The larger of two values at each point.', example: 'max([Cost], 0)' },
];

// Preset parameters. `min` and `step` feed the number input in the UI.
const WINDOW_PARAM = { key: 'window', label: 'Window (x units, years for dates)', defaultValue: 3, min: 0, step: 'any' };
const POINTS_PARAM = { key: 'window', label: 'Points', defaultValue: 36, min: 1, step: 1 };
const NEIGHBOUR_PARAM = { key: 'window', label: 'Neighbours (a count, or a share below 1)', defaultValue: 0.2, min: 0, step: 'any' };
const SPAN_PARAM = { key: 'window', label: 'Span (share of points, or a count)', defaultValue: 0.3, min: 0, step: 'any' };

/**
 * Menu entries that build a formula from picked columns. `build` receives the
 * formatted references (see formatFormulaReference) and the parameter values.
 */
export const DERIVED_PRESETS = [
    { id: 'cumsum', label: 'Cumulative sum', inputs: 1, build: ([a]) => `cumsum(${a})` },
    { id: 'ma', label: 'Moving average', inputs: 1, param: { key: 'window', label: 'Window', defaultValue: 3 }, build: ([a], p = {}) => `ma(${a}, ${positiveInt(p.window, 3)})` },
    { id: 'rmean', label: 'Rolling average of the last n points', inputs: 1, param: POINTS_PARAM, build: ([a], p = {}) => `rmean(${a}, ${positiveInt(p.window, 36)})` },
    { id: 'cmean', label: 'Centred average over an x window', inputs: 1, param: WINDOW_PARAM, build: ([a], p = {}) => `cmean(${a}, ${positiveNumber(p.window, 3)})` },
    { id: 'rmin', label: 'Rolling minimum of the last n points', inputs: 1, param: POINTS_PARAM, build: ([a], p = {}) => `rmin(${a}, ${positiveInt(p.window, 36)})` },
    { id: 'knnmean', label: 'Nearest-neighbour average', inputs: 1, param: NEIGHBOUR_PARAM, build: ([a], p = {}) => `knnmean(${a}, ${neighbourArg(p.window, 0.2)})` },
    { id: 'lowess', label: 'LOWESS trend', inputs: 1, param: SPAN_PARAM, build: ([a], p = {}) => `lowess(${a}, ${neighbourArg(p.window, 0.3)})` },
    { id: 'ema', label: 'Exponential moving average', inputs: 1, param: { key: 'window', label: 'Points', defaultValue: 12 }, build: ([a], p = {}) => `ema(${a}, ${positiveInt(p.window, 12)})` },
    { id: 'mean', label: 'Mean of the whole series', inputs: 1, build: ([a]) => `mean(${a})` },
    { id: 'pct', label: 'Percent change', inputs: 1, build: ([a]) => `pct(${a})` },
    { id: 'diff', label: 'Change from previous', inputs: 1, build: ([a]) => `diff(${a})` },
    { id: 'index', label: 'Index to 100', inputs: 1, build: ([a]) => `index(${a})` },
    { id: 'share', label: 'Percent of total', inputs: 1, build: ([a]) => `${a} / sum(${a}) * 100` },
    { id: 'ratio', label: 'Ratio (A / B)', inputs: 2, build: ([a, b]) => `${a} / ${b}` },
    { id: 'subtract', label: 'Difference (A - B)', inputs: 2, build: ([a, b]) => `${a} - ${b}` },
    { id: 'add', label: 'Sum (A + B)', inputs: 2, build: ([a, b]) => `${a} + ${b}` },
    { id: 'multiply', label: 'Product (A * B)', inputs: 2, build: ([a, b]) => `${a} * ${b}` },
];

function positiveInt(value, fallback) {
    const n = Math.floor(Number(value));
    return Number.isFinite(n) && n >= 1 ? n : fallback;
}

function positiveNumber(value, fallback) {
    const n = Number(value);
    return value !== '' && Number.isFinite(n) && n > 0 ? n : fallback;
}

// A k or span argument: a share below 1, or a whole count from 1 up.
function neighbourArg(value, fallback) {
    const n = positiveNumber(value, fallback);
    return n < 1 ? n : Math.floor(n);
}

/**
 * Ways to draw a trend line with standard deviation lines around it. `mean` and
 * `std` name the formula functions for the trend and the spread. A method
 * without `param` works over the whole series and gives flat lines.
 */
export const TREND_METHODS = [
    { id: 'centred', label: 'Centred x window', mean: 'cmean', std: 'cstd', param: WINDOW_PARAM },
    { id: 'trailing', label: 'Rolling, last n points', mean: 'rmean', std: 'rstd', param: POINTS_PARAM },
    { id: 'knn', label: 'Nearest neighbours', mean: 'knnmean', std: 'knnstd', param: NEIGHBOUR_PARAM },
    { id: 'lowess', label: 'LOWESS', mean: 'lowess', std: 'lowessstd', param: SPAN_PARAM },
    { id: 'whole', label: 'Whole series (flat lines)', mean: 'mean', std: 'std', param: null },
];

/**
 * Formulas for a trend line and its standard deviation lines.
 * @param {string} methodId - a TREND_METHODS id
 * @param {string} reference - formatted reference to the source series, e.g. #2 or "Copper"
 * @param {number|string} [param] - the method's window, neighbour count or span
 * @param {Array<number>} [levels] - signed multiples, e.g. [1, -1, 2, -2]
 * @returns {{ trend: string, bands: Array<{ level: number, formula: string }> }}
 */
export function buildTrendFormulas(methodId, reference, param, levels = [1, -1, 2, -2]) {
    const method = TREND_METHODS.find(m => m.id === methodId) || TREND_METHODS[0];
    let arg = '';
    if (method.param) {
        let value;
        if (method.id === 'knn' || method.id === 'lowess') value = neighbourArg(param, method.param.defaultValue);
        else if (method.id === 'trailing') value = positiveInt(param, method.param.defaultValue);
        else value = positiveNumber(param, method.param.defaultValue);
        arg = `, ${value}`;
    }
    const trend = `${method.mean}(${reference}${arg})`;
    const spread = `${method.std}(${reference}${arg})`;
    const bands = levels.map(level => ({
        level,
        formula: `${trend} ${level < 0 ? '-' : '+'} ${Math.abs(level) === 1 ? '' : `${Math.abs(level)} * `}${spread}`,
    }));
    return { trend, bands };
}

// ---------------------------------------------------------------------------
// Function table. `arity` is [min, max]. `literal` lists argument positions
// that must be number literals, checked at parse time. `kind` picks how
// evaluate() applies the function.
// ---------------------------------------------------------------------------

const FUNCTION_SPECS = {
    abs: { arity: [1, 1], kind: 'map', fn: Math.abs },
    sqrt: { arity: [1, 1], kind: 'map', fn: Math.sqrt },
    ln: { arity: [1, 1], kind: 'map', fn: Math.log },
    log: { arity: [1, 1], kind: 'map', fn: Math.log },
    log10: { arity: [1, 1], kind: 'map', fn: Math.log10 },
    exp: { arity: [1, 1], kind: 'map', fn: Math.exp },
    round: { arity: [1, 2], kind: 'round', literal: [1] },
    min: { arity: [2, 2], kind: 'binary', fn: Math.min },
    max: { arity: [2, 2], kind: 'binary', fn: Math.max },
    cumsum: { arity: [1, 1], kind: 'series' },
    diff: { arity: [1, 1], kind: 'series' },
    pct: { arity: [1, 1], kind: 'series' },
    index: { arity: [1, 1], kind: 'series' },
    ma: { arity: [2, 2], kind: 'series', literal: [1] },
    lag: { arity: [1, 2], kind: 'series', literal: [1] },
    ema: { arity: [2, 2], kind: 'series', literal: [1] },
    cummean: { arity: [1, 1], kind: 'series' },
    sum: { arity: [1, 1], kind: 'aggregate' },
    mean: { arity: [1, 1], kind: 'aggregate' },
    median: { arity: [1, 1], kind: 'aggregate' },
    std: { arity: [1, 1], kind: 'aggregate' },
    rmean: { arity: [2, 2], kind: 'points', literal: [1], stat: 'mean' },
    rmedian: { arity: [2, 2], kind: 'points', literal: [1], stat: 'median' },
    rmin: { arity: [2, 2], kind: 'points', literal: [1], stat: 'min' },
    rmax: { arity: [2, 2], kind: 'points', literal: [1], stat: 'max' },
    rstd: { arity: [2, 2], kind: 'points', literal: [1], stat: 'std' },
    cmean: { arity: [2, 2], kind: 'window', literal: [1], align: 'centred', stat: 'mean' },
    cmedian: { arity: [2, 2], kind: 'window', literal: [1], align: 'centred', stat: 'median' },
    cmin: { arity: [2, 2], kind: 'window', literal: [1], align: 'centred', stat: 'min' },
    cmax: { arity: [2, 2], kind: 'window', literal: [1], align: 'centred', stat: 'max' },
    cstd: { arity: [2, 2], kind: 'window', literal: [1], align: 'centred', stat: 'std' },
    knnmean: { arity: [2, 2], kind: 'nearest', literal: [1], stat: 'mean' },
    knnmedian: { arity: [2, 2], kind: 'nearest', literal: [1], stat: 'median' },
    knnstd: { arity: [2, 2], kind: 'nearest', literal: [1], stat: 'std' },
    lowess: { arity: [2, 2], kind: 'lowess', literal: [1] },
    lowessstd: { arity: [2, 2], kind: 'lowess', literal: [1] },
};

export class DerivedFormulaError extends Error {
    constructor(message) {
        super(message);
        this.name = 'DerivedFormulaError';
    }
}

// ---------------------------------------------------------------------------
// Tokeniser and parser
// ---------------------------------------------------------------------------

function tokenise(src) {
    const tokens = [];
    let i = 0;
    while (i < src.length) {
        const ch = src[i];
        if (/\s/.test(ch)) { i++; continue; }

        if (/[0-9.]/.test(ch)) {
            const match = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(src.slice(i));
            if (!match) throw new DerivedFormulaError(`Unexpected "${ch}" at position ${i + 1}.`);
            tokens.push({ type: 'num', value: Number(match[0]), pos: i, end: i + match[0].length });
            i += match[0].length;
            continue;
        }

        if (ch === '[') {
            const end = src.indexOf(']', i + 1);
            if (end === -1) throw new DerivedFormulaError(`Missing "]" for the reference that starts at position ${i + 1}.`);
            const text = src.slice(i + 1, end).trim();
            if (!text) throw new DerivedFormulaError(`Empty reference "[]" at position ${i + 1}.`);
            tokens.push({ type: 'ref', value: text, pos: i, end: end + 1 });
            i = end + 1;
            continue;
        }

        if (ch === '#') {
            const match = /^#(\d+)/.exec(src.slice(i));
            if (!match) throw new DerivedFormulaError(`"#" at position ${i + 1} must be followed by a series number, as in #2.`);
            tokens.push({ type: 'seriesNumber', value: Number(match[1]), pos: i, end: i + match[0].length });
            i += match[0].length;
            continue;
        }

        if (ch === '"') {
            const end = src.indexOf('"', i + 1);
            if (end === -1) throw new DerivedFormulaError(`Missing closing quote for the series name that starts at position ${i + 1}.`);
            const text = src.slice(i + 1, end).trim();
            if (!text) throw new DerivedFormulaError(`Empty series name "" at position ${i + 1}.`);
            tokens.push({ type: 'seriesName', value: text, pos: i, end: end + 1 });
            i = end + 1;
            continue;
        }

        if (/[A-Za-z_]/.test(ch)) {
            const match = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i));
            tokens.push({ type: 'ident', value: match[0], pos: i, end: i + match[0].length });
            i += match[0].length;
            continue;
        }

        if ('+-*/^(),'.includes(ch)) {
            tokens.push({ type: 'op', value: ch, pos: i, end: i + 1 });
            i++;
            continue;
        }

        throw new DerivedFormulaError(`Unexpected "${ch}" at position ${i + 1}.`);
    }
    return tokens;
}

function makeRef(text) {
    const { columnName, fileName } = parseColumnId(text);
    if (!columnName) throw new DerivedFormulaError(`Reference "[${text}]" has no column name.`);
    return { type: 'ref', columnName, fileName, text };
}

function parseTokens(tokens) {
    let pos = 0;
    const peek = () => tokens[pos];
    const isOp = (value) => peek()?.type === 'op' && peek().value === value;
    const expectOp = (value) => {
        if (!isOp(value)) {
            const t = peek();
            throw new DerivedFormulaError(t
                ? `Expected "${value}" at position ${t.pos + 1}.`
                : `Expected "${value}" at the end of the formula.`);
        }
        pos++;
    };

    // expr := term (('+' | '-') term)*
    const parseExpr = () => {
        let node = parseTerm();
        while (isOp('+') || isOp('-')) {
            const op = tokens[pos++].value;
            node = { type: 'bin', op, left: node, right: parseTerm() };
        }
        return node;
    };

    // term := unary (('*' | '/') unary)*
    const parseTerm = () => {
        let node = parseUnary();
        while (isOp('*') || isOp('/')) {
            const op = tokens[pos++].value;
            node = { type: 'bin', op, left: node, right: parseUnary() };
        }
        return node;
    };

    // unary := ('-' | '+') unary | power
    const parseUnary = () => {
        if (isOp('-')) { pos++; return { type: 'neg', arg: parseUnary() }; }
        if (isOp('+')) { pos++; return parseUnary(); }
        return parsePower();
    };

    // power := primary ('^' unary)?   (right-associative)
    const parsePower = () => {
        const base = parsePrimary();
        if (isOp('^')) {
            pos++;
            return { type: 'bin', op: '^', left: base, right: parseUnary() };
        }
        return base;
    };

    const parsePrimary = () => {
        const t = peek();
        if (!t) throw new DerivedFormulaError('The formula ends too early.');

        if (t.type === 'num') { pos++; return { type: 'num', value: t.value }; }
        if (t.type === 'ref') { pos++; return makeRef(t.value); }
        if (t.type === 'seriesNumber' || t.type === 'seriesName') {
            pos++;
            return { type: 'seriesRef', by: t.type === 'seriesNumber' ? 'number' : 'name', value: t.value, text: tokenText(t) };
        }

        if (t.type === 'ident') {
            pos++;
            if (!isOp('(')) return makeRef(t.value);

            const name = t.value.toLowerCase();
            const spec = FUNCTION_SPECS[name];
            if (!spec) throw new DerivedFormulaError(`Unknown function "${t.value}".`);
            pos++;
            const args = [];
            if (!isOp(')')) {
                args.push(parseExpr());
                while (isOp(',')) { pos++; args.push(parseExpr()); }
            }
            expectOp(')');

            const [minArgs, maxArgs] = spec.arity;
            if (args.length < minArgs || args.length > maxArgs) {
                const wanted = minArgs === maxArgs ? `${minArgs}` : `${minArgs} or ${maxArgs}`;
                throw new DerivedFormulaError(`${name}() takes ${wanted} argument${maxArgs === 1 ? '' : 's'}, got ${args.length}.`);
            }
            (spec.literal || []).forEach((index) => {
                if (index < args.length && args[index].type !== 'num') {
                    throw new DerivedFormulaError(`Argument ${index + 1} of ${name}() must be a plain number.`);
                }
            });
            if ((name === 'ma' || name === 'lag' || name === 'ema' || spec.kind === 'points') && args[1] && !(Number.isInteger(args[1].value) && args[1].value >= 1)) {
                throw new DerivedFormulaError(`The window for ${name}() must be a whole number of 1 or more.`);
            }
            if (spec.kind === 'window' && !(args[1].value > 0)) {
                throw new DerivedFormulaError(`The window for ${name}() must be more than 0.`);
            }
            if ((spec.kind === 'nearest' || spec.kind === 'lowess')
                && !(args[1].value > 0 && (args[1].value < 1 || Number.isInteger(args[1].value)))) {
                throw new DerivedFormulaError(`The second argument of ${name}() must be a share between 0 and 1, or a whole count.`);
            }
            return { type: 'call', name, args };
        }

        if (t.type === 'op' && t.value === '(') {
            pos++;
            const inner = parseExpr();
            expectOp(')');
            return inner;
        }

        throw new DerivedFormulaError(`Unexpected ${tokenText(t)} at position ${t.pos + 1}.`);
    };

    if (tokens.length === 0) throw new DerivedFormulaError('The formula is empty.');
    const ast = parseExpr();
    if (pos < tokens.length) {
        const t = tokens[pos];
        throw new DerivedFormulaError(`Unexpected ${tokenText(t)} at position ${t.pos + 1}.`);
    }
    return ast;
}

// How a token is quoted back to the user in error messages.
function tokenText(t) {
    if (t.type === 'ref') return `"[${t.value}]"`;
    if (t.type === 'seriesNumber') return `#${t.value}`;
    return `"${t.value}"`;
}

// Collects column references and, with includeSeries, series references (#2, "Name").
function collectRefs(node, out = [], includeSeries = false) {
    if (!node) return out;
    if (node.type === 'ref' || (includeSeries && node.type === 'seriesRef')) out.push(node);
    else if (node.type === 'bin') { collectRefs(node.left, out, includeSeries); collectRefs(node.right, out, includeSeries); }
    else if (node.type === 'neg') collectRefs(node.arg, out, includeSeries);
    else if (node.type === 'call') node.args.forEach(a => collectRefs(a, out, includeSeries));
    return out;
}

// The series a #N or "Name" reference points at, as a column reference node.
function resolveSeriesRef(node, series) {
    let index;
    if (node.by === 'number') {
        index = node.value - 1;
        if (!series[index]) throw new DerivedFormulaError(`There is no series #${node.value}.`);
    } else {
        const wanted = node.value.toLowerCase();
        const matches = series
            .map((s, i) => ({ s, i }))
            .filter(({ s }) => typeof s?.titleName === 'string' && s.titleName.trim().toLowerCase() === wanted);
        if (matches.length === 0) throw new DerivedFormulaError(`No series is named "${node.value}".`);
        if (matches.length > 1) {
            throw new DerivedFormulaError(`More than one series is named "${node.value}". Use a series number instead, as in #${matches[0].i + 1}.`);
        }
        index = matches[0].i;
    }
    const yAxis = series[index].yAxis;
    if (!parseColumnId(yAxis).columnName) {
        throw new DerivedFormulaError(`Series #${index + 1} has no column picked yet.`);
    }
    return { ...makeRef(yAxis), text: node.text };
}

// Copy of the AST with every #N and "Name" reference replaced by the column it
// points at. The saved formula keeps the short form, so it keeps working after
// the series' column or file is renamed.
function resolveSeriesRefs(node, series) {
    switch (node.type) {
        case 'seriesRef': return resolveSeriesRef(node, series);
        case 'bin': return { ...node, left: resolveSeriesRefs(node.left, series), right: resolveSeriesRefs(node.right, series) };
        case 'neg': return { ...node, arg: resolveSeriesRefs(node.arg, series) };
        case 'call': return { ...node, args: node.args.map(a => resolveSeriesRefs(a, series)) };
        default: return node;
    }
}

function uniqueRefs(refs) {
    const seen = new Set();
    return refs.filter((r) => {
        const key = refKey(r);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function refKey(ref) {
    return ref.fileName ? `${ref.columnName}::${ref.fileName}` : ref.columnName;
}

/**
 * Parse a formula into an AST. Throws DerivedFormulaError with a message that
 * can be shown to the user as-is.
 *
 * A formula refers to other series as [Column], [Column::file.csv], #2 (the
 * series number shown in Graph It) or "Name" (the series' optional name). With
 * `options.series`, #N and "Name" are resolved to the column they point at.
 * Without it they stay in the AST as seriesRef nodes, which cannot be evaluated.
 * @param {string} formula
 * @param {{ series?: Array<Object> }} [options] - graphConfig.series
 * @returns {Object} AST root
 */
export function parseDerivedFormula(formula, options = {}) {
    if (typeof formula !== 'string' || !formula.trim()) {
        throw new DerivedFormulaError('The formula is empty.');
    }
    const ast = parseTokens(tokenise(formula));
    if (collectRefs(ast, [], true).length === 0) throw new DerivedFormulaError('The formula must use at least one series.');
    return Array.isArray(options.series) ? resolveSeriesRefs(ast, options.series) : ast;
}

/**
 * Unique column references in a formula, in first-use order. Without
 * `options.series`, #N and "Name" references are left out, since only the
 * series list says which column they mean.
 * @param {string} formula
 * @param {{ series?: Array<Object> }} [options] - graphConfig.series
 * @returns {Array<{columnName: string, fileName: string, text: string}>}
 */
export function getFormulaReferences(formula, options = {}) {
    return uniqueRefs(collectRefs(parseDerivedFormula(formula, options)))
        .map(({ columnName, fileName, text }) => ({ columnName, fileName, text }));
}

// Keys ("Derived 1") of the derived series in a series list.
function derivedKeysOf(series) {
    return new Set((Array.isArray(series) ? series : [])
        .filter(isDerivedSeries)
        .map(s => parseColumnId(s.yAxis).columnName));
}

// True when a reference reads another derived series' points rather than a CSV
// column. An unqualified [Derived 1] counts, since no CSV column can share that
// name (applyDerivedSeries refuses the key when one does).
function isDerivedRef(ref, derivedKeys) {
    return ref.fileName === DERIVED_SOURCE || (!ref.fileName && derivedKeys.has(ref.columnName));
}

/**
 * Check a formula for syntax errors and, when `columns` is given, for
 * references to columns that are not loaded. With `options.series`, #N and
 * "Name" references are resolved and references to other derived series are
 * checked against that list. A cycle between derived series is reported by
 * applyDerivedSeries, which sees every formula at once.
 * @param {string} formula
 * @param {Array<{name: string, file?: string}>|null} [columns] - loaded columns, as Graph It lists them
 * @param {{ series?: Array<Object>, seriesIndex?: number }} [options] - graphConfig.series, and the
 *   index of the series that owns this formula
 * @returns {string|null} An error message for the user, or null when the formula is valid
 */
export function validateDerivedFormula(formula, columns = null, options = {}) {
    try {
        const refs = getFormulaReferences(formula, options);
        const derivedKeys = derivedKeysOf(options.series);
        const ownKey = Number.isInteger(options.seriesIndex)
            ? parseColumnId(options.series?.[options.seriesIndex]?.yAxis).columnName
            : null;
        for (const ref of refs) {
            if (!isDerivedRef(ref, derivedKeys)) continue;
            if (ref.columnName === ownKey) return 'A derived series cannot use itself.';
            if (Array.isArray(options.series) && !derivedKeys.has(ref.columnName)) {
                return `There is no derived series named "${ref.columnName}".`;
            }
        }
        if (Array.isArray(columns)) {
            for (const ref of refs) {
                if (isDerivedRef(ref, derivedKeys)) continue;
                const found = columns.some(col =>
                    col && col.name === ref.columnName && (!ref.fileName || col.file === ref.fileName)
                );
                if (!found) {
                    return ref.fileName
                        ? `Column "${ref.columnName}" is not in ${ref.fileName}.`
                        : `Column "${ref.columnName}" is not loaded.`;
                }
            }
        }
        return null;
    } catch (error) {
        return error instanceof DerivedFormulaError ? error.message : String(error?.message || error);
    }
}

/**
 * Rewrite every column reference in a formula. Used when a config is applied to
 * data whose columns have different names, as headless folder batches do.
 * The rest of the formula keeps its original spelling.
 * @param {string} formula
 * @param {function({columnName: string, fileName: string, text: string}): string} mapRef -
 *   returns the new column id for a reference, e.g. "cost__data1"
 * @returns {string}
 */
export function mapFormulaReferences(formula, mapRef) {
    parseDerivedFormula(formula);
    const tokens = tokenise(formula);
    let out = '';
    let last = 0;
    tokens.forEach((t, i) => {
        const isRef = t.type === 'ref'
            || (t.type === 'ident' && !(tokens[i + 1]?.type === 'op' && tokens[i + 1].value === '('));
        if (!isRef) return;
        const { columnName, fileName } = parseColumnId(t.value);
        out += formula.slice(last, t.pos) + formatFormulaReference(mapRef({ columnName, fileName, text: t.value }));
        last = t.end;
    });
    return out + formula.slice(last);
}

/**
 * Rewrite every #N and "Name" reference as the bracketed column it points at
 * in `series`, e.g. #2 becomes [price::prices.csv]. Headless calls this before it
 * drops, copies or renames series, since each of those changes what #N and
 * "Name" would mean. Column references and the rest of the formula keep their
 * original spelling.
 * @param {string} formula
 * @param {Array<Object>} series - graphConfig.series the formula was written against
 * @returns {string}
 * @throws {DerivedFormulaError} when a reference has no matching series
 */
export function expandSeriesReferences(formula, series) {
    parseDerivedFormula(formula);
    const tokens = tokenise(formula);
    let out = '';
    let last = 0;
    tokens.forEach((t) => {
        if (t.type !== 'seriesNumber' && t.type !== 'seriesName') return;
        const node = { by: t.type === 'seriesNumber' ? 'number' : 'name', value: t.value, text: tokenText(t) };
        out += formula.slice(last, t.pos) + formatFormulaReference(refKey(resolveSeriesRef(node, series)));
        last = t.end;
    });
    return out + formula.slice(last);
}

/**
 * True when a formula reference reads another derived series in `series`
 * instead of a CSV column: [Derived 1::__derived__], or an unqualified
 * [Derived 1] that names a derived series.
 * @param {{columnName: string, fileName: string}} ref - from getFormulaReferences
 * @param {Array<Object>} series - graphConfig.series
 * @returns {boolean}
 */
export function isDerivedReference(ref, series) {
    return isDerivedRef(ref, derivedKeysOf(series));
}

/**
 * Format a Graph It column id ("Column::file.csv") as a formula reference.
 * @param {string} columnId
 * @returns {string}
 */
export function formatFormulaReference(columnId) {
    return `[${columnId}]`;
}

/**
 * True when a series config is a derived series with a non-empty formula.
 * @param {Object} series
 * @returns {boolean}
 */
export function isDerivedSeries(series) {
    return Boolean(
        series
        && parseColumnId(series.yAxis).fileName === DERIVED_SOURCE
        && typeof series.derived?.formula === 'string'
        && series.derived.formula.trim()
    );
}

/** True for a row that applyDerivedSeries added. */
export function isDerivedRow(row) {
    return Boolean(row) && row._sourceFile === DERIVED_SOURCE;
}

/**
 * Next free key of the form "Derived N" for a new derived series.
 * @param {Array<Object>} series - current graphConfig.series
 * @returns {string} e.g. "Derived 2"
 */
export function nextDerivedKey(series = []) {
    let max = 0;
    series.forEach((s) => {
        const { columnName, fileName } = parseColumnId(s?.yAxis);
        const match = fileName === DERIVED_SOURCE && /^Derived (\d+)$/.exec(columnName);
        if (match) max = Math.max(max, Number(match[1]));
    });
    return `Derived ${max + 1}`;
}

// ---------------------------------------------------------------------------
// Data alignment
// ---------------------------------------------------------------------------

function isBlank(value) {
    return value === undefined || value === null || (typeof value === 'string' && value.trim() === '');
}

function toNumber(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value === 'string' && value.trim() !== '') {
        const n = Number(value);
        return Number.isFinite(n) ? n : null;
    }
    return null;
}

// Numeric sort key for an x value, or null when it cannot be ordered numerically.
function orderKey(x) {
    if (x instanceof Date) {
        const t = x.getTime();
        return Number.isNaN(t) ? null : t;
    }
    return toNumber(x);
}

// Key used to match x values across files: 2025, "2025" and "2025.0" match.
function matchKey(x) {
    const n = orderKey(x);
    return n !== null ? `n:${n}` : `s:${String(x).trim()}`;
}

function rowMatchesFile(row, fileName) {
    return !fileName || !row._sourceFile || row._sourceFile === fileName;
}

/**
 * Build the aligned table that a formula runs over.
 * @returns {{ xs: Array, values: Map<string, Array<number|null>> }}
 */
function buildAlignedTable(sourceRows, refs, getX) {
    // Derived rows are always tagged, so they are left out here. Otherwise untagged
    // CSV rows (headless renders) would look unloaded once one derived series exists.
    const loadedFiles = new Set(sourceRows.filter(r => !isDerivedRow(r)).map(r => r._sourceFile).filter(Boolean));

    refs.forEach((ref) => {
        if (ref.fileName && ref.fileName !== DERIVED_SOURCE && loadedFiles.size > 0 && !loadedFiles.has(ref.fileName)) {
            throw new DerivedFormulaError(`${ref.fileName} is not loaded, so "[${ref.text}]" has no data.`);
        }
        const hasColumn = sourceRows.some(r => rowMatchesFile(r, ref.fileName) && ref.columnName in r);
        if (!hasColumn) {
            throw new DerivedFormulaError(ref.fileName
                ? `Column "${ref.columnName}" is not in ${ref.fileName}.`
                : `Column "${ref.columnName}" is not in the data.`);
        }
    });

    // Two named files means x matching even when rows are untagged. The graph API
    // stacks a two-dataset template into one merged CSV with blanks in the other
    // file's columns, and only x matching pairs those rows up.
    const refFiles = new Set(refs.map(r => r.fileName).filter(Boolean));

    if (refFiles.size <= 1) {
        // Row mode: one source, evaluated row by row.
        const [file] = [...refFiles];
        // Every derived series shares the __derived__ file, so keep only the derived
        // rows this formula reads. Rows of another derived series would be gaps
        // between its points and break diff, pct, ma and lag.
        let rows = sourceRows.filter(r => rowMatchesFile(r, file) && !isBlank(getX(r))
            && (!isDerivedRow(r) || refs.some(ref => ref.columnName in r)));
        if (rows.length > 0 && rows.every(r => orderKey(getX(r)) !== null)) {
            rows = rows
                .map((r, i) => ({ r, i, k: orderKey(getX(r)) }))
                .sort((a, b) => a.k - b.k || a.i - b.i)
                .map(e => e.r);
        }
        const values = new Map();
        refs.forEach((ref) => {
            values.set(refKey(ref), rows.map(r => toNumber(r[ref.columnName])));
        });
        return { xs: rows.map(getX), values };
    }

    // X mode: several files, matched on equal x values.
    const order = [];
    const firstX = new Map();
    const perRef = new Map();
    refs.forEach((ref) => {
        const byX = new Map();
        sourceRows.forEach((r) => {
            if (!rowMatchesFile(r, ref.fileName) || !(ref.columnName in r)) return;
            const x = getX(r);
            const value = toNumber(r[ref.columnName]);
            // A blank value is a gap either way. Skipping it keeps the other file's
            // rows in a merged CSV from counting as repeats of this x.
            if (isBlank(x) || value === null) return;
            const key = matchKey(x);
            if (byX.has(key)) {
                throw new DerivedFormulaError(`"[${ref.text}]" has more than one row at x = ${String(x)}, so it cannot be matched by x with another file.`);
            }
            byX.set(key, value);
            if (!firstX.has(key)) {
                firstX.set(key, x);
                order.push(key);
            }
        });
        perRef.set(refKey(ref), byX);
    });

    let keys = order;
    const numericX = keys.length > 0 && keys.every(k => orderKey(firstX.get(k)) !== null);
    if (numericX) {
        keys = [...keys].sort((a, b) => orderKey(firstX.get(a)) - orderKey(firstX.get(b)));
    }
    const values = new Map();
    perRef.forEach((byX, key) => {
        values.set(key, keys.map(k => (byX.has(k) ? byX.get(k) : null)));
    });
    // Files can spell the same x differently ("2021" and 2021), so numeric x values
    // come out as numbers. Dates stay Date objects.
    const xs = keys.map((k) => {
        const x = firstX.get(k);
        return numericX && typeof x === 'string' ? orderKey(x) : x;
    });
    return { xs, values };
}

// ---------------------------------------------------------------------------
// Evaluation. A value is a number (scalar) or an array of number|null with one
// entry per aligned point.
// ---------------------------------------------------------------------------

function finiteOrNull(v) {
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function toArray(value, n) {
    return Array.isArray(value) ? value : new Array(n).fill(finiteOrNull(value));
}

function mapValues(value, fn) {
    if (!Array.isArray(value)) return finiteOrNull(fn(value));
    return value.map(v => (v === null ? null : finiteOrNull(fn(v))));
}

function combine(a, b, fn) {
    if (!Array.isArray(a) && !Array.isArray(b)) return finiteOrNull(fn(a, b));
    const n = Array.isArray(a) ? a.length : b.length;
    const left = toArray(a, n);
    const right = toArray(b, n);
    return left.map((v, i) => (v === null || right[i] === null ? null : finiteOrNull(fn(v, right[i]))));
}

const BINARY_OPS = {
    '+': (a, b) => a + b,
    '-': (a, b) => a - b,
    '*': (a, b) => a * b,
    '/': (a, b) => (b === 0 ? null : a / b),
    '^': (a, b) => Math.pow(a, b),
};

function applySeriesFunction(name, s, param) {
    const out = new Array(s.length).fill(null);
    if (name === 'cumsum') {
        let total = 0;
        s.forEach((v, i) => {
            if (v === null) return;
            total += v;
            out[i] = total;
        });
    } else if (name === 'diff') {
        for (let i = 1; i < s.length; i++) {
            if (s[i] !== null && s[i - 1] !== null) out[i] = s[i] - s[i - 1];
        }
    } else if (name === 'pct') {
        for (let i = 1; i < s.length; i++) {
            if (s[i] !== null && s[i - 1] !== null && s[i - 1] !== 0) out[i] = finiteOrNull((s[i] - s[i - 1]) / s[i - 1] * 100);
        }
    } else if (name === 'lag') {
        const n = param ?? 1;
        for (let i = n; i < s.length; i++) out[i] = s[i - n];
    } else if (name === 'ma') {
        const n = param;
        for (let i = n - 1; i < s.length; i++) {
            let total = 0;
            let complete = true;
            for (let j = i - n + 1; j <= i; j++) {
                if (s[j] === null) { complete = false; break; }
                total += s[j];
            }
            if (complete) out[i] = total / n;
        }
    } else if (name === 'ema') {
        const alpha = 2 / (param + 1);
        let current = null;
        s.forEach((v, i) => {
            if (v === null) return;
            current = current === null ? v : alpha * v + (1 - alpha) * current;
            out[i] = current;
        });
    } else if (name === 'cummean') {
        let total = 0;
        let count = 0;
        s.forEach((v, i) => {
            if (v === null) return;
            total += v;
            count++;
            out[i] = total / count;
        });
    } else if (name === 'index') {
        const base = s.find(v => v !== null);
        if (base !== undefined && base !== 0) {
            s.forEach((v, i) => { out[i] = v === null ? null : finiteOrNull(v / base * 100); });
        }
    }
    return out;
}

// Rolling, nearest-neighbour and LOWESS functions. These read x as well as the
// values, so they work on the aligned table's x column.
function applyLocalFunction(name, spec, s, xs, param) {
    try {
        if (spec.kind === 'window') return windowStat(s, xs, param, spec.align, spec.stat);
        if (spec.kind === 'points') return pointWindowStat(s, param, spec.stat);
        if (spec.kind === 'nearest') return nearestStat(s, xs, param, spec.stat);
        return name === 'lowess' ? lowessMean(s, xs, param) : lowessStd(s, xs, param);
    } catch (error) {
        if (error instanceof RollingStatsError) throw new DerivedFormulaError(`${name}(): ${error.message}`);
        throw error;
    }
}

// Canonical text of a resolved formula part, so equal parts share a cache entry.
function nodeKey(node) {
    switch (node.type) {
        case 'num': return String(node.value);
        case 'ref': return `[${refKey(node)}]`;
        case 'neg': return `-(${nodeKey(node.arg)})`;
        case 'bin': return `(${nodeKey(node.left)}${node.op}${nodeKey(node.right)})`;
        case 'call': return `${node.name}(${node.args.map(nodeKey).join(',')})`;
        default: return `?${node.type}`;
    }
}

function evaluate(node, table, n) {
    switch (node.type) {
        case 'num':
            return node.value;
        case 'ref':
            return table.values.get(refKey(node));
        case 'neg':
            return mapValues(evaluate(node.arg, table, n), v => -v);
        case 'bin':
            return combine(evaluate(node.left, table, n), evaluate(node.right, table, n), BINARY_OPS[node.op]);
        case 'call': {
            // A trend and its standard deviation lines repeat the same calls, such
            // as lowess(#1, 0.5) in every line. Results are never changed in
            // place, so a table's results can be shared.
            if (!table.cache) return evaluateCall(node, table, n);
            const key = nodeKey(node);
            if (!table.cache.has(key)) table.cache.set(key, evaluateCall(node, table, n));
            return table.cache.get(key);
        }
        default:
            throw new DerivedFormulaError(`Unsupported formula part "${node.type}".`);
    }
}

function evaluateCall(node, table, n) {
    switch (node.type) {
        case 'call': {
            const spec = FUNCTION_SPECS[node.name];
            const first = evaluate(node.args[0], table, n);
            if (spec.kind === 'map') return mapValues(first, spec.fn);
            if (spec.kind === 'binary') return combine(first, evaluate(node.args[1], table, n), spec.fn);
            if (spec.kind === 'round') {
                const digits = node.args[1]?.value ?? 0;
                const factor = Math.pow(10, digits);
                return mapValues(first, v => Math.round(v * factor) / factor);
            }
            if (spec.kind === 'aggregate') {
                const present = toArray(first, n).filter(v => v !== null);
                if (present.length === 0) return null;
                if (node.name === 'median') return median(present);
                if (node.name === 'std') return sampleStd(present);
                const total = present.reduce((acc, v) => acc + v, 0);
                return node.name === 'sum' ? total : total / present.length;
            }
            if (spec.kind === 'window' || spec.kind === 'points' || spec.kind === 'nearest' || spec.kind === 'lowess') {
                return applyLocalFunction(node.name, spec, toArray(first, n), table.xs, node.args[1].value);
            }
            return applySeriesFunction(node.name, toArray(first, n), node.args[1]?.value);
        }
        default:
            throw new DerivedFormulaError(`Unsupported formula part "${node.type}".`);
    }
}

/**
 * Evaluate every derived series in the config and append its points as rows.
 *
 * Idempotent: rows added by an earlier call are dropped first, so callers can
 * pass already-processed data (renderGraph and performCurveFitting both call
 * this). Returns the input array unchanged when there are no derived series.
 *
 * @param {Array<Object>} csvData - parsed rows, optionally tagged with _sourceFile
 * @param {Object} graphConfig - graph config with xAxis and series
 * @param {{ joinXAxis?: boolean }} [options] - joinXAxis mirrors globalSettings.joinXAxis
 * @returns {{ data: Array<Object>, errors: Array<{ seriesIndex: number, key: string, message: string }> }}
 */
export function applyDerivedSeries(csvData, graphConfig, options = {}) {
    if (!Array.isArray(csvData)) return { data: csvData, errors: [] };

    const sourceRows = csvData.some(isDerivedRow) ? csvData.filter(r => !isDerivedRow(r)) : csvData;
    const series = Array.isArray(graphConfig?.series) ? graphConfig.series : [];
    const derived = series
        .map((s, seriesIndex) => ({ s, seriesIndex }))
        .filter(({ s }) => isDerivedSeries(s));
    if (derived.length === 0) return { data: sourceRows, errors: [] };

    const errors = [];
    const xColumn = parseColumnId(graphConfig.xAxis).columnName;
    if (!xColumn) {
        derived.forEach(({ s, seriesIndex }) => errors.push({
            seriesIndex, key: parseColumnId(s.yAxis).columnName, message: 'Pick an x-axis column first.'
        }));
        return { data: sourceRows, errors };
    }

    const joinColumns = options.joinXAxis
        ? (graphConfig.joinColumns?.length ? graphConfig.joinColumns : [graphConfig.xAxis2])
            .map(c => parseColumnId(c).columnName)
            .filter(Boolean)
        : [];
    const xCandidates = [xColumn, ...joinColumns];
    const getX = (row) => {
        for (const col of xCandidates) {
            if (!isBlank(row[col])) return row[col];
        }
        return null;
    };

    // Parse every formula first, so each series knows which derived series it reads.
    const derivedKeys = derivedKeysOf(series);
    const entries = new Map();
    derived.forEach(({ s, seriesIndex }) => {
        const key = parseColumnId(s.yAxis).columnName;
        const entry = { seriesIndex, key, state: 'pending' };
        entries.set(key, entry);
        try {
            if (sourceRows.some(r => key in r)) {
                throw new DerivedFormulaError(`The name "${key}" is already a column in the data.`);
            }
            entry.ast = parseDerivedFormula(s.derived.formula, { series });
            const refNodes = collectRefs(entry.ast);
            // An unqualified [Derived 1] reads that series' rows, so give it the
            // virtual file like the qualified form.
            refNodes.forEach((ref) => {
                if (isDerivedRef(ref, derivedKeys)) ref.fileName = DERIVED_SOURCE;
            });
            entry.refs = uniqueRefs(refNodes);
            entry.deps = entry.refs.filter(ref => ref.fileName === DERIVED_SOURCE).map(ref => ref.columnName);
        } catch (error) {
            entry.state = 'failed';
            entry.message = error?.message || String(error);
        }
    });

    // Evaluate depth first, so a series runs after every derived series it reads.
    // `added` grows as series finish, and later formulas read those rows.
    const added = [];
    // Formulas that read the same columns get the same aligned table, since a
    // table only takes in the derived rows its formula reads. Sharing it also
    // shares its cache of function results.
    const tables = new Map();
    const run = (entry) => {
        if (entry.state !== 'pending') return;
        entry.state = 'running';
        try {
            for (const depKey of entry.deps) {
                const dep = entries.get(depKey);
                if (!dep) throw new DerivedFormulaError(`There is no derived series named "${depKey}".`);
                if (dep === entry) throw new DerivedFormulaError('A derived series cannot use itself.');
                if (dep.state === 'running') throw new DerivedFormulaError(`${entry.key} and ${depKey} use each other, so neither can be worked out.`);
                run(dep);
                if (dep.state === 'failed') throw new DerivedFormulaError(`It uses ${depKey}, which has an error.`);
                if (dep.points === 0) throw new DerivedFormulaError(`It uses ${depKey}, which has no points.`);
            }
            const signature = entry.refs.map(refKey).sort().join('|');
            let table = tables.get(signature);
            if (!table) {
                const pool = added.length > 0 ? [...sourceRows, ...added] : sourceRows;
                table = { ...buildAlignedTable(pool, entry.refs, getX), cache: new Map() };
                tables.set(signature, table);
            }
            const result = toArray(evaluate(entry.ast, table, table.xs.length), table.xs.length);
            entry.points = 0;
            result.forEach((value, i) => {
                if (value === null) return;
                added.push({ [xColumn]: table.xs[i], [entry.key]: value, _sourceFile: DERIVED_SOURCE });
                entry.points++;
            });
            entry.state = 'done';
        } catch (error) {
            entry.state = 'failed';
            entry.message = error?.message || String(error);
        }
    };
    entries.forEach(run);

    entries.forEach(({ state, seriesIndex, key, message }) => {
        if (state === 'failed') errors.push({ seriesIndex, key, message });
    });
    errors.sort((a, b) => a.seriesIndex - b.seriesIndex);

    return { data: added.length > 0 ? [...sourceRows, ...added] : sourceRows, errors };
}
