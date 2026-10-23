/**
 * @fileoverview Computed bias tables: how far each compared series sits from
 * each baseline series, as an average percentage.
 *
 * Series take part through two fields on their config:
 *
 *   biasRole: 'compare' | 'baseline'   which side of the table the series is on
 *   biasLabel: string                   the row or column heading, optional
 *
 * Each baseline is a row and each compared series is a column. A compared
 * series that is split into categories (a unique-symbol filter) gives one
 * column per category instead, headed by the category value.
 *
 * A cell is the average over the compared points of
 * (value - baseline) / baseline * 100, where the baseline is read at the
 * point's x by straight-line interpolation between its two nearest points.
 * Points outside the baseline's x range, and points where the baseline is 0,
 * are skipped. A cell with no points is blank.
 *
 * The roles live on the series rather than in globalSettings so that
 * reordering, renaming or dropping series (as headless folder batches do)
 * carries them along.
 *
 * @module biasTable
 * @exports BIAS_ROLES, DEFAULT_BIAS_ROW_HEADER, baselineInterpolator, biasComparison,
 *   computeBiasTable, biasTableSource, resolveBiasTableData
 */

import { parseColumnId } from './columnUtils.js';
import { SymbolFactory } from './SymbolFactory.js';

export const BIAS_ROLES = ['compare', 'baseline'];

/** Heading of the first column when globalSettings.biasRowHeader is not set. */
export const DEFAULT_BIAS_ROW_HEADER = 'Comparison';

function toNumber(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value === 'string' && value.trim() !== '') {
        const n = Number(value);
        return Number.isFinite(n) ? n : null;
    }
    return null;
}

function xNumber(x) {
    if (x instanceof Date) {
        const t = x.getTime();
        return Number.isNaN(t) ? null : t;
    }
    return toNumber(x);
}

function isBlank(value) {
    return value === undefined || value === null || (typeof value === 'string' && value.trim() === '');
}

function seriesName(series) {
    return (series.titleName || '').trim() || parseColumnId(series.yAxis).columnName;
}

// The x reader, matching applyDerivedSeries: the x column, then the join columns
// when the x-axis is joined.
function xReader(graphConfig, joinXAxis) {
    const columns = [parseColumnId(graphConfig.xAxis).columnName];
    if (joinXAxis) {
        const joins = graphConfig.joinColumns?.length ? graphConfig.joinColumns : [graphConfig.xAxis2];
        joins.forEach(c => columns.push(parseColumnId(c).columnName));
    }
    const usable = columns.filter(Boolean);
    return (row) => {
        for (const col of usable) {
            if (!isBlank(row[col])) return row[col];
        }
        return null;
    };
}

// Rows of a series with a numeric x and y, as { x, y, row }.
function seriesPoints(series, rows, getX) {
    const { columnName, fileName } = parseColumnId(series.yAxis);
    if (!columnName) return [];
    const points = [];
    rows.forEach((row) => {
        if (fileName && row._sourceFile && row._sourceFile !== fileName) return;
        const y = toNumber(row[columnName]);
        const x = xNumber(getX(row));
        if (y !== null && x !== null) points.push({ x, y, row });
    });
    return points;
}

/**
 * A baseline as a function of x, by straight-line interpolation. Points that
 * share an x are averaged first. Returns null outside the baseline's x range.
 * @param {Array<{x: number, y: number}>} points
 * @returns {function(number): (number|null)}
 */
export function baselineInterpolator(points) {
    const byX = new Map();
    points.forEach(({ x, y }) => {
        const entry = byX.get(x) || { total: 0, count: 0 };
        entry.total += y;
        entry.count++;
        byX.set(x, entry);
    });
    const xs = [...byX.keys()].sort((a, b) => a - b);
    const ys = xs.map(x => byX.get(x).total / byX.get(x).count);
    return (x) => {
        if (xs.length === 0 || x < xs[0] || x > xs[xs.length - 1]) return null;
        let lo = 0;
        let hi = xs.length - 1;
        while (hi - lo > 1) {
            const mid = (lo + hi) >> 1;
            if (xs[mid] <= x) lo = mid; else hi = mid;
        }
        if (xs[lo] === x) return ys[lo];
        if (xs[hi] === x) return ys[hi];
        return ys[lo] + (ys[hi] - ys[lo]) * (x - xs[lo]) / (xs[hi] - xs[lo]);
    };
}

/**
 * Average percentage difference of `points` from `baselineAt`.
 * @param {Array<{x: number, y: number}>} points
 * @param {function(number): (number|null)} baselineAt
 * @returns {{ value: number|null, count: number }}
 */
export function biasComparison(points, baselineAt) {
    let total = 0;
    let count = 0;
    points.forEach(({ x, y }) => {
        const base = baselineAt(x);
        if (base === null || base === 0) return;
        total += (y - base) / base * 100;
        count++;
    });
    return { value: count > 0 ? total / count : null, count };
}

// The compared columns: one per series, or one per category for a split series.
function comparedColumns(series, rows, getX) {
    const columns = [];
    series.forEach((s) => {
        const points = seriesPoints(s, rows, getX);
        if (!SymbolFactory.shouldUseUniqueSymbolEncoding(s)) {
            columns.push({ label: (s.biasLabel || '').trim() || seriesName(s), points });
            return;
        }
        const filterColumn = parseColumnId(s.filterColumn).columnName;
        const categoryOf = p => SymbolFactory.normalizeCategory(p.row[filterColumn]);
        let categories = Array.isArray(s.uniqueValues) && s.uniqueValues.length
            ? s.uniqueValues.map(v => SymbolFactory.normalizeCategory(v))
            : [...new Set(points.map(categoryOf))];
        if (Array.isArray(s.visibleCategories)) {
            const visible = new Set(s.visibleCategories.map(v => SymbolFactory.normalizeCategory(v)));
            categories = categories.filter(c => visible.has(c));
        }
        categories.forEach((category) => {
            columns.push({ label: String(category), points: points.filter(p => categoryOf(p) === category) });
        });
    });
    return columns;
}

/**
 * Build bias table rows in the shape BiasTableRenderer draws: the first key is
 * the row heading column, and each further key is a compared column. Cells hold
 * the percentage as a number, which the renderer formats, or '' when no point
 * could be compared.
 *
 * @param {Array<Object>} csvData - rows, with derived series already applied
 * @param {Object} graphConfig - xAxis and series, with biasRole on the series
 * @param {{ rowHeader?: string, joinXAxis?: boolean }} [options]
 * @returns {Array<Object>} rows, or an empty array when there is no baseline or no compared series
 */
export function computeBiasTable(csvData, graphConfig, options = {}) {
    const series = Array.isArray(graphConfig?.series) ? graphConfig.series.filter(s => s && s.yAxis) : [];
    const baselines = series.filter(s => s.biasRole === 'baseline');
    const compared = series.filter(s => s.biasRole === 'compare');
    if (!Array.isArray(csvData) || baselines.length === 0 || compared.length === 0) return [];

    const rowHeader = (options.rowHeader || '').trim() || DEFAULT_BIAS_ROW_HEADER;
    const getX = xReader(graphConfig, options.joinXAxis);
    const columns = comparedColumns(compared, csvData, getX);
    // Headings are object keys, so a repeat (or one equal to the row header) would
    // overwrite another cell. Repeats get a number.
    const used = new Set([rowHeader]);
    const keys = columns.map((c) => {
        let key = c.label;
        for (let n = 2; used.has(key); n++) key = `${c.label} (${n})`;
        used.add(key);
        return key;
    });

    return baselines.map((b) => {
        const baselineAt = baselineInterpolator(seriesPoints(b, csvData, getX));
        const row = { [rowHeader]: (b.biasLabel || '').trim() || `Bias to ${seriesName(b)}` };
        columns.forEach((column, i) => {
            const { value } = biasComparison(column.points, baselineAt);
            row[keys[i]] = value === null ? '' : value;
        });
        return row;
    });
}

/**
 * Where a bias table's rows come from: 'computed' or 'csv'. Configs saved before
 * computed tables existed have no biasTableSource and a loaded CSV, so they stay 'csv'.
 * @param {Object} globalSettings
 * @returns {'computed'|'csv'}
 */
export function biasTableSource(globalSettings = {}) {
    if (globalSettings.biasTableSource === 'computed' || globalSettings.biasTableSource === 'csv') {
        return globalSettings.biasTableSource;
    }
    return globalSettings.biasTableData ? 'csv' : 'computed';
}

/**
 * The rows a bias table should draw: computed from the series, or the loaded
 * CSV rows, as biasTableSource decides.
 * @param {Array<Object>} csvData - rows, with derived series already applied
 * @param {Object} graphConfig
 * @param {Object} globalSettings
 * @returns {Array<Object>|null}
 */
export function resolveBiasTableData(csvData, graphConfig, globalSettings = {}) {
    if (biasTableSource(globalSettings) === 'computed') {
        return computeBiasTable(csvData, graphConfig, {
            rowHeader: globalSettings.biasRowHeader,
            joinXAxis: globalSettings.joinXAxis,
        });
    }
    return globalSettings.biasTableData || null;
}
