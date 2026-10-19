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
 * Alignment: when every reference resolves to one source file the formula runs
 * row by row over that file. When references span several files the inputs are
 * matched on equal x values and a missing x is a gap. Nothing is interpolated.
 *
 * @module derivedSeries
 * @exports DERIVED_SOURCE, DERIVED_FUNCTIONS, DERIVED_PRESETS, isDerivedSeries,
 *   isDerivedRow, parseDerivedFormula, getFormulaReferences, validateDerivedFormula,
 *   formatFormulaReference, mapFormulaReferences, nextDerivedKey, applyDerivedSeries
 */

import { parseColumnId } from './columnUtils.js';

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

/**
 * Menu entries that build a formula from picked columns. `build` receives the
 * formatted references (see formatFormulaReference) and the parameter values.
 */
export const DERIVED_PRESETS = [
    { id: 'cumsum', label: 'Cumulative sum', inputs: 1, build: ([a]) => `cumsum(${a})` },
    { id: 'ma', label: 'Moving average', inputs: 1, param: { key: 'window', label: 'Window', defaultValue: 3 }, build: ([a], p = {}) => `ma(${a}, ${positiveInt(p.window, 3)})` },
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
    sum: { arity: [1, 1], kind: 'aggregate' },
    mean: { arity: [1, 1], kind: 'aggregate' },
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
            if ((name === 'ma' || name === 'lag') && args[1] && !(Number.isInteger(args[1].value) && args[1].value >= 1)) {
                throw new DerivedFormulaError(`The window for ${name}() must be a whole number of 1 or more.`);
            }
            return { type: 'call', name, args };
        }

        if (t.type === 'op' && t.value === '(') {
            pos++;
            const inner = parseExpr();
            expectOp(')');
            return inner;
        }

        throw new DerivedFormulaError(`Unexpected "${t.value}" at position ${t.pos + 1}.`);
    };

    if (tokens.length === 0) throw new DerivedFormulaError('The formula is empty.');
    const ast = parseExpr();
    if (pos < tokens.length) {
        const t = tokens[pos];
        throw new DerivedFormulaError(`Unexpected "${t.type === 'ref' ? `[${t.value}]` : t.value}" at position ${t.pos + 1}.`);
    }
    return ast;
}

function collectRefs(node, out = []) {
    if (!node) return out;
    if (node.type === 'ref') out.push(node);
    else if (node.type === 'bin') { collectRefs(node.left, out); collectRefs(node.right, out); }
    else if (node.type === 'neg') collectRefs(node.arg, out);
    else if (node.type === 'call') node.args.forEach(a => collectRefs(a, out));
    return out;
}

function refKey(ref) {
    return ref.fileName ? `${ref.columnName}::${ref.fileName}` : ref.columnName;
}

/**
 * Parse a formula into an AST. Throws DerivedFormulaError with a message that
 * can be shown to the user as-is.
 * @param {string} formula
 * @returns {Object} AST root
 */
export function parseDerivedFormula(formula) {
    if (typeof formula !== 'string' || !formula.trim()) {
        throw new DerivedFormulaError('The formula is empty.');
    }
    const ast = parseTokens(tokenise(formula));
    const refs = collectRefs(ast);
    if (refs.length === 0) throw new DerivedFormulaError('The formula must use at least one series.');
    const derivedRef = refs.find(r => r.fileName === DERIVED_SOURCE);
    if (derivedRef) throw new DerivedFormulaError('A derived series cannot use another derived series.');
    return ast;
}

/**
 * Unique column references in a formula, in first-use order.
 * @param {string} formula
 * @returns {Array<{columnName: string, fileName: string, text: string}>}
 */
export function getFormulaReferences(formula) {
    const refs = collectRefs(parseDerivedFormula(formula));
    const seen = new Set();
    return refs
        .filter((r) => {
            const key = refKey(r);
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        })
        .map(({ columnName, fileName, text }) => ({ columnName, fileName, text }));
}

/**
 * Check a formula for syntax errors and, when `columns` is given, for
 * references to columns that are not loaded.
 * @param {string} formula
 * @param {Array<{name: string, file?: string}>|null} [columns] - loaded columns, as Graph It lists them
 * @returns {string|null} An error message for the user, or null when the formula is valid
 */
export function validateDerivedFormula(formula, columns = null) {
    try {
        const refs = getFormulaReferences(formula);
        if (Array.isArray(columns)) {
            for (const ref of refs) {
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
    const loadedFiles = new Set(sourceRows.map(r => r._sourceFile).filter(Boolean));

    refs.forEach((ref) => {
        if (ref.fileName && loadedFiles.size > 0 && !loadedFiles.has(ref.fileName)) {
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
        let rows = sourceRows.filter(r => rowMatchesFile(r, file) && !isBlank(getX(r)));
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
    } else if (name === 'index') {
        const base = s.find(v => v !== null);
        if (base !== undefined && base !== 0) {
            s.forEach((v, i) => { out[i] = v === null ? null : finiteOrNull(v / base * 100); });
        }
    }
    return out;
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
                const total = present.reduce((acc, v) => acc + v, 0);
                return node.name === 'sum' ? total : total / present.length;
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

    const added = [];
    derived.forEach(({ s, seriesIndex }) => {
        const key = parseColumnId(s.yAxis).columnName;
        try {
            if (sourceRows.some(r => key in r)) {
                throw new DerivedFormulaError(`The name "${key}" is already a column in the data.`);
            }
            const ast = parseDerivedFormula(s.derived.formula);
            const table = buildAlignedTable(sourceRows, getFormulaReferences(s.derived.formula), getX);
            const result = toArray(evaluate(ast, table, table.xs.length), table.xs.length);
            result.forEach((value, i) => {
                if (value === null) return;
                added.push({ [xColumn]: table.xs[i], [key]: value, _sourceFile: DERIVED_SOURCE });
            });
        } catch (error) {
            errors.push({ seriesIndex, key, message: error?.message || String(error) });
        }
    });

    return { data: added.length > 0 ? [...sourceRows, ...added] : sourceRows, errors };
}
