/**
 * @fileoverview Local statistics over an x-ordered series, for the rolling,
 * nearest-neighbour and LOWESS functions of the derived series formula language.
 *
 * Every function takes the series values (number|null, one per aligned point)
 * and the matching x values, and returns one value per point. A point whose own
 * value is null stays null, so a trend is only drawn where the series has data.
 * Null values never count towards a window.
 *
 * windowStat's sizes are in x units. When x holds dates the unit is years, and a
 * window that is a whole number of months is measured on the calendar, so a
 * 3-year trailing window over monthly data holds 36 months whatever the leap years.
 * pointWindowStat counts points instead.
 *
 * @module rollingStats
 * @exports ROLLING_STATS, RollingStatsError, xPositions, mean, median, sampleStd,
 *   windowStat, pointWindowStat, neighbourCount, nearestStat, lowessMean, lowessStd
 */

const MS_PER_YEAR = 365.25 * 24 * 60 * 60 * 1000;

/** Statistics a window or neighbourhood can be reduced to. */
export const ROLLING_STATS = ['mean', 'median', 'min', 'max', 'std'];

// Thrown with a message that can be shown to the user as-is. derivedSeries wraps
// it in its own error type.
export class RollingStatsError extends Error {
    constructor(message) {
        super(message);
        this.name = 'RollingStatsError';
    }
}

/**
 * Numeric positions for x values: Date objects become milliseconds, numbers and
 * numeric strings stay numbers.
 * @param {Array} xs
 * @returns {{ pos: Array<number|null>, isDate: boolean }}
 * @throws {RollingStatsError} when an x value is neither a number nor a date
 */
export function xPositions(xs) {
    let isDate = false;
    const pos = xs.map((x) => {
        if (x instanceof Date) {
            isDate = true;
            const t = x.getTime();
            return Number.isNaN(t) ? null : t;
        }
        if (typeof x === 'number') return Number.isFinite(x) ? x : null;
        if (typeof x === 'string' && x.trim() !== '' && Number.isFinite(Number(x))) return Number(x);
        throw new RollingStatsError(`This function needs numbers or dates on the x-axis, and "${String(x)}" is neither.`);
    });
    return { pos, isDate };
}

export function mean(values) {
    return values.length === 0 ? null : values.reduce((a, v) => a + v, 0) / values.length;
}

export function median(values) {
    if (values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = sorted.length >> 1;
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Sample standard deviation (n - 1). Null for fewer than two values. */
export function sampleStd(values) {
    if (values.length < 2) return null;
    const m = mean(values);
    const ss = values.reduce((a, v) => a + (v - m) * (v - m), 0);
    return Math.sqrt(ss / (values.length - 1));
}

function reduce(stat, values) {
    switch (stat) {
        case 'mean': return mean(values);
        case 'median': return median(values);
        case 'min': return values.length ? Math.min(...values) : null;
        case 'max': return values.length ? Math.max(...values) : null;
        case 'std': return sampleStd(values);
        default: throw new RollingStatsError(`Unknown statistic "${stat}".`);
    }
}

// Present points sorted by x: { i, x, y }, where i is the index in the input.
function presentPoints(values, pos) {
    const points = [];
    values.forEach((y, i) => {
        if (y !== null && y !== undefined && pos[i] !== null) points.push({ i, x: pos[i], y });
    });
    return points.sort((a, b) => a.x - b.x || a.i - b.i);
}

function shiftMonths(ms, months) {
    const d = new Date(ms);
    const day = d.getDate();
    d.setDate(1);
    d.setMonth(d.getMonth() + months);
    // Clamp to the last day of the target month, so 31 March less one month is 28 or 29 February.
    const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(day, lastDay));
    return d.getTime();
}

// Moves x by `years` (negative moves back). Whole months move on the calendar.
function shiftDate(ms, years) {
    const months = years * 12;
    if (Math.abs(months - Math.round(months)) < 1e-9) return shiftMonths(ms, Math.round(months));
    return ms + years * MS_PER_YEAR;
}

/**
 * A statistic of the points in an x window around each point.
 *
 * 'trailing' covers (x - w, x]: a 3-year trailing window over yearly data holds
 * the current year and the two before it. 'centred' covers [x - w/2, x + w/2].
 * Points that share an x value are all in or all out. Near the ends a centred
 * window holds fewer points, since nothing is invented past the data.
 *
 * @param {Array<number|null>} values
 * @param {Array} xs - x values matching `values`
 * @param {number} width - window width, in years when x holds dates
 * @param {'trailing'|'centred'} align
 * @param {string} stat - one of ROLLING_STATS
 * @returns {Array<number|null>}
 */
export function windowStat(values, xs, width, align, stat) {
    const out = new Array(values.length).fill(null);
    const { pos, isDate } = xPositions(xs);
    const points = presentPoints(values, pos);
    if (points.length === 0) return out;

    const eps = 1e-9 * Math.max(1, Math.abs(points[points.length - 1].x), Math.abs(points[0].x));
    const shift = (x, years) => (isDate ? shiftDate(x, years) : x + years);

    let lo = 0;
    let hi = 0;
    points.forEach((p) => {
        const lower = align === 'trailing' ? shift(p.x, -width) : shift(p.x, -width / 2);
        const upper = align === 'trailing' ? p.x : shift(p.x, width / 2);
        // Both bounds only move forward as x grows, so two pointers cover the series once.
        while (hi < points.length && points[hi].x <= upper + eps) hi++;
        while (lo < hi && (align === 'trailing' ? points[lo].x <= lower + eps : points[lo].x < lower - eps)) lo++;
        out[p.i] = reduce(stat, points.slice(lo, hi).map(q => q.y));
    });
    return out;
}

/**
 * A statistic of the last n points with a value, the point itself included,
 * counted in the order the values come in, which is x order for a derived series.
 * Near the start the window holds the points there are so far, as pandas'
 * rolling(n, min_periods=1) does, so the line starts with the series. The
 * metal price jobs on the server compute their 3- and 5-year lines this way.
 * @param {Array<number|null>} values
 * @param {number} n - window size in points, 1 or more
 * @param {string} stat - one of ROLLING_STATS
 * @returns {Array<number|null>}
 */
export function pointWindowStat(values, n, stat) {
    const out = new Array(values.length).fill(null);
    const window = [];
    values.forEach((y, i) => {
        if (y === null || y === undefined) return;
        window.push(y);
        if (window.length > n) window.shift();
        out[i] = reduce(stat, window);
    });
    return out;
}

/**
 * How many neighbours a k argument means: a whole number of 1 or more is a
 * count, and a number between 0 and 1 is that share of the points.
 */
export function neighbourCount(k, total) {
    const count = k < 1 ? Math.round(k * total) : Math.floor(k);
    return Math.max(1, Math.min(total, count));
}

// The k points nearest x by x distance, the point itself included. Ties go to
// the lower x, so the choice does not depend on input order.
function nearest(points, index, k) {
    const x = points[index].x;
    let left = index - 1;
    let right = index + 1;
    const picked = [points[index]];
    while (picked.length < k && (left >= 0 || right < points.length)) {
        const dL = left >= 0 ? x - points[left].x : Infinity;
        const dR = right < points.length ? points[right].x - x : Infinity;
        if (dL <= dR) picked.push(points[left--]);
        else picked.push(points[right++]);
    }
    return picked;
}

/**
 * A statistic of the k points nearest each point along x.
 * @param {Array<number|null>} values
 * @param {Array} xs
 * @param {number} k - a count (1 or more), or a share of the points (below 1)
 * @param {string} stat - one of ROLLING_STATS
 * @returns {Array<number|null>}
 */
export function nearestStat(values, xs, k, stat) {
    const out = new Array(values.length).fill(null);
    const { pos } = xPositions(xs);
    const points = presentPoints(values, pos);
    if (points.length === 0) return out;
    const count = neighbourCount(k, points.length);
    points.forEach((p, index) => {
        out[p.i] = reduce(stat, nearest(points, index, count).map(q => q.y));
    });
    return out;
}

function tricube(u) {
    if (u >= 1) return 0;
    const v = 1 - u * u * u;
    return v * v * v;
}

// Tricube weights over the k nearest points. The bandwidth is the distance to
// the k-th neighbour, widened slightly so that neighbour keeps a small weight.
function tricubeNeighbourhood(points, index, k) {
    const hood = nearest(points, index, k);
    const x = points[index].x;
    const dMax = Math.max(...hood.map(q => Math.abs(q.x - x)));
    if (dMax === 0) return hood.map(q => ({ q, w: 1 }));
    const band = dMax * 1.000001;
    return hood.map(q => ({ q, w: tricube(Math.abs(q.x - x) / band) }));
}

// Weighted straight line through the neighbourhood, evaluated at x. Falls back
// to the weighted mean when every neighbour sits at the same x.
function localLinear(weighted, x) {
    let sw = 0, sx = 0, sy = 0;
    weighted.forEach(({ q, w }) => { sw += w; sx += w * q.x; sy += w * q.y; });
    if (sw <= 0) return null;
    const mx = sx / sw;
    const my = sy / sw;
    let sxx = 0, sxy = 0;
    weighted.forEach(({ q, w }) => {
        sxx += w * (q.x - mx) * (q.x - mx);
        sxy += w * (q.x - mx) * (q.y - my);
    });
    const scale = Math.max(1, Math.abs(mx));
    if (sxx <= 1e-12 * scale * scale * sw) return my;
    return my + (sxy / sxx) * (x - mx);
}

/**
 * LOWESS trend: at each point, a tricube-weighted straight line through its k
 * nearest neighbours, read at that point. One pass, no robustness iterations.
 * @param {Array<number|null>} values
 * @param {Array} xs
 * @param {number} span - share of the points in each neighbourhood (below 1), or a count
 * @returns {Array<number|null>}
 */
export function lowessMean(values, xs, span) {
    const out = new Array(values.length).fill(null);
    const { pos } = xPositions(xs);
    const points = presentPoints(values, pos);
    if (points.length === 0) return out;
    const count = Math.max(Math.min(2, points.length), neighbourCount(span, points.length));
    points.forEach((p, index) => {
        out[p.i] = localLinear(tricubeNeighbourhood(points, index, count), p.x);
    });
    return out;
}

/**
 * Spread around the LOWESS trend: at each point, the tricube-weighted standard
 * deviation of the residuals from lowessMean in the same neighbourhood. The
 * residuals are measured from the trend, not from their own mean. The weights
 * are reliability weights, so with equal weights the divisor is n - 1.
 * @param {Array<number|null>} values
 * @param {Array} xs
 * @param {number} span
 * @returns {Array<number|null>}
 */
export function lowessStd(values, xs, span) {
    const out = new Array(values.length).fill(null);
    const fit = lowessMean(values, xs, span);
    const { pos } = xPositions(xs);
    const points = presentPoints(values, pos);
    if (points.length < 2) return out;
    const residual = new Map(points.map(p => [p.i, p.y - fit[p.i]]));
    const count = Math.max(2, neighbourCount(span, points.length));
    points.forEach((p, index) => {
        let sw = 0, sw2 = 0, swr2 = 0;
        tricubeNeighbourhood(points, index, count).forEach(({ q, w }) => {
            const r = residual.get(q.i);
            sw += w;
            sw2 += w * w;
            swr2 += w * r * r;
        });
        const denominator = sw - sw2 / sw;
        out[p.i] = sw > 0 && denominator > 0 ? Math.sqrt(swr2 / denominator) : null;
    });
    return out;
}
