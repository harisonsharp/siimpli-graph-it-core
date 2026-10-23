/**
 * @fileoverview Picks a trend method for a series from the series itself. This is
 * the "Auto" choice in Graph It's trend-with-lines builder.
 *
 * Each candidate (centred x windows, nearest-neighbour averages and LOWESS at a
 * few settings) is scored by block cross-validation: every point is predicted
 * without the points within h of it in x, and the score is the mean absolute
 * miss as a share of the prediction. h is 1/80 of the x range, or 1/40 for evenly
 * spaced points. The block keeps closely spaced points from predicting each
 * other, which on monthly prices would always favour the smallest window.
 * Candidates that leave more than 5% of points with fewer than
 * 10 neighbours are dropped. Of the rest, the smoothest one whose score is within
 * 5% of the best wins. Trailing windows are not candidates, since they lag.
 *
 * The rule comes from a comparison on the metals price series (spot and
 * reported prices for five metals, also split by study type), written up in
 * script_manager/docs/agent/analysis/trend-method-defaults.md.
 *
 * @module trendAdvisor
 * @exports profileSeries, recommendTrend
 */

import { xPositions, windowStat, nearestStat, lowessMean } from './rollingStats.js';

const MS_PER_YEAR = 365.25 * 24 * 60 * 60 * 1000;
// Every trend gets standard deviation lines, and a standard deviation of fewer than
// 10 points is too uncertain to draw (about +/-24% at 10, +/-35% at 5).
const MIN_NEIGHBOURS = 10;
const MAX_THIN_SHARE = 0.05;
const TOLERANCE = 0.05;
const MIN_POINTS = 8;
const MIN_LOWESS_POINTS = 15;
// Evenness at or above this counts as evenly spaced.
const EVEN = 0.8;

const fmt = (v, digits = 2) => String(Number(v.toPrecision(digits)));

// Present points, sorted, with x in years for dates.
function points(values, xs) {
    const { pos, isDate } = xPositions(xs);
    const pts = [];
    values.forEach((y, i) => {
        if (y !== null && y !== undefined && Number.isFinite(y) && pos[i] !== null) {
            pts.push({ x: isDate ? pos[i] / MS_PER_YEAR : pos[i], y });
        }
    });
    pts.sort((a, b) => a.x - b.x);
    return { pts, isDate };
}

/**
 * Plain description of how a series' points are spread along x.
 * @param {Array<number|null>} values
 * @param {Array} xs - numbers or dates
 * @returns {{ n: number, span: number, isDate: boolean, perUnit: number, evenness: number, longGapShare: number }}
 *   evenness is the mean distance to the nearest other x over what an even spread
 *   would give: about 1 for evenly spaced points, about 0.5 for random dates.
 */
export function profileSeries(values, xs) {
    const { pts, isDate } = points(values, xs);
    const n = pts.length;
    if (n < 2) return { n, span: 0, isDate, perUnit: 0, evenness: 0, longGapShare: 0 };
    const span = pts[n - 1].x - pts[0].x;
    const ux = [...new Set(pts.map(p => p.x))];
    let nnTotal = 0;
    ux.forEach((x, i) => {
        nnTotal += Math.min(i > 0 ? x - ux[i - 1] : Infinity, i < ux.length - 1 ? ux[i + 1] - x : Infinity);
    });
    const evenness = ux.length > 1 && span > 0 ? (nnTotal / ux.length) / (span / (ux.length - 1)) : 0;
    // A gap is long when it is more than 8 times the typical spacing.
    const gaps = [];
    for (let i = 1; i < ux.length; i++) gaps.push(ux[i] - ux[i - 1]);
    const typical = [...gaps].sort((a, b) => a - b)[gaps.length >> 1] || 0;
    const longGap = gaps.filter(g => g > 8 * typical).reduce((a, g) => a + g, 0);
    return {
        n, span, isDate,
        perUnit: span > 0 ? n / span : n,
        evenness,
        longGapShare: span > 0 ? longGap / span : 0,
    };
}

// ----------------------------------------------------------------------------
// Neighbour sets for cross-validation. Points are sorted by x, so the block
// around point i (|dx| < h) is one index range [bl, br).
// ----------------------------------------------------------------------------

function lowerBound(pts, x) {
    let lo = 0, hi = pts.length;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (pts[mid].x < x) lo = mid + 1; else hi = mid;
    }
    return lo;
}

function upperBound(pts, x) {
    let lo = 0, hi = pts.length;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (pts[mid].x <= x) lo = mid + 1; else hi = mid;
    }
    return lo;
}

// The k points nearest x from outside [bl, br).
function nearestOutside(pts, x, bl, br, k) {
    const out = [];
    let left = bl - 1;
    let right = br;
    while (out.length < k && (left >= 0 || right < pts.length)) {
        const dL = left >= 0 ? x - pts[left].x : Infinity;
        const dR = right < pts.length ? pts[right].x - x : Infinity;
        if (dL <= dR) out.push(pts[left--]);
        else out.push(pts[right++]);
    }
    return out;
}

function tricubeLine(hood, x) {
    const dMax = Math.max(...hood.map(q => Math.abs(q.x - x))) * 1.000001;
    if (!(dMax > 0)) return hood.reduce((a, q) => a + q.y, 0) / hood.length;
    let sw = 0, sx = 0, sy = 0;
    const w = hood.map((q) => {
        const u = Math.abs(q.x - x) / dMax;
        return u >= 1 ? 0 : (1 - u * u * u) ** 3;
    });
    hood.forEach((q, i) => { sw += w[i]; sx += w[i] * q.x; sy += w[i] * q.y; });
    if (sw <= 0) return null;
    const mx = sx / sw, my = sy / sw;
    let sxx = 0, sxy = 0;
    hood.forEach((q, i) => { sxx += w[i] * (q.x - mx) ** 2; sxy += w[i] * (q.x - mx) * (q.y - my); });
    return sxx <= 1e-12 * sw * Math.max(1, mx * mx) ? my : my + (sxy / sxx) * (x - mx);
}

// Prediction of point i with the block around it left out, or null.
function predictWithout(cand, pts, prefix, i, h) {
    const x = pts[i].x;
    const bl = lowerBound(pts, x - h + 1e-12);
    const br = upperBound(pts, x + h - 1e-12);
    if (cand.kind === 'centred') {
        const l = lowerBound(pts, x - cand.param / 2 - 1e-9);
        const r = upperBound(pts, x + cand.param / 2 + 1e-9);
        let total = prefix[r] - prefix[l];
        let count = r - l;
        const ol = Math.max(l, bl), or = Math.min(r, br);
        if (or > ol) { total -= prefix[or] - prefix[ol]; count -= or - ol; }
        return count > 0 ? total / count : null;
    }
    if (cand.kind === 'knn') {
        const hood = nearestOutside(pts, x, bl, br, cand.param);
        return hood.length ? hood.reduce((a, q) => a + q.y, 0) / hood.length : null;
    }
    const k = Math.max(2, Math.round(cand.param * pts.length));
    const hood = nearestOutside(pts, x, bl, br, k);
    return hood.length >= 2 ? tricubeLine(hood, x) : null;
}

function candidates(pts, isDate, span) {
    const n = pts.length;
    const list = [];
    const widths = isDate ? [0.5, 1, 2, 3, 4, 5] : [1 / 40, 1 / 20, 1 / 10, 1 / 7, 1 / 5, 1 / 4].map(f => Number((f * span).toPrecision(2)));
    widths.filter(w => w > 0 && w < span).forEach(w => list.push({ kind: 'centred', methodId: 'centred', param: w }));
    [10, 15, 20, 30, 40].filter(k => k <= n / 2).forEach(k => list.push({ kind: 'knn', methodId: 'knn', param: k }));
    // LOWESS fits a line through each neighbourhood, and on the metals data a line
    // through fewer than 15 points swung wildly between neighbouring x values.
    [0.1, 0.2, 0.3, 0.5].filter(f => f * n >= MIN_LOWESS_POINTS).forEach(f => list.push({ kind: 'lowess', methodId: 'lowess', param: f }));
    return list;
}

function fullTrend(cand, values, xs) {
    if (cand.kind === 'centred') return windowStat(values, xs, cand.param, 'centred', 'mean');
    if (cand.kind === 'knn') return nearestStat(values, xs, cand.param, 'mean');
    return lowessMean(values, xs, cand.param);
}

function neighbourCounts(cand, pts) {
    if (cand.kind !== 'centred') return pts.map(() => (cand.kind === 'knn' ? cand.param : Math.round(cand.param * pts.length)));
    return pts.map(p => upperBound(pts, p.x + cand.param / 2 + 1e-9) - lowerBound(pts, p.x - cand.param / 2 - 1e-9));
}

// Mean |second difference| of the trend over distinct x, relative to its level.
function roughness(trend, xs) {
    const { pos } = xPositions(xs);
    const byX = new Map();
    trend.forEach((v, i) => { if (v !== null && pos[i] !== null && !byX.has(pos[i])) byX.set(pos[i], v); });
    const ys = [...byX.entries()].sort((a, b) => a[0] - b[0]).map(e => e[1]);
    let total = 0;
    for (let i = 1; i < ys.length - 1; i++) total += Math.abs(ys[i + 1] - 2 * ys[i] + ys[i - 1]) / Math.max(Math.abs(ys[i]), 1e-12);
    return ys.length > 2 ? total / (ys.length - 2) : 0;
}

function describe(cand, isDate) {
    if (cand.kind === 'centred') return `a centred window of ${fmt(cand.param)}${isDate ? ` year${cand.param === 1 ? '' : 's'}` : ' x units'}`;
    if (cand.kind === 'knn') return `the average of the ${cand.param} nearest points`;
    return `LOWESS over ${Math.round(cand.param * 100)}% of the points`;
}

function describeProfile(profile) {
    const parts = [`${profile.n} points`];
    if (profile.isDate) parts.push(`about ${fmt(profile.perUnit)} a year`);
    parts.push(profile.evenness >= EVEN ? 'evenly spaced' : 'at irregular x');
    if (profile.longGapShare > 0.25) parts.push(`with long gaps over ${Math.round(profile.longGapShare * 100)}% of the range`);
    return parts.join(', ');
}

/**
 * Recommend a trend method for a series.
 * @param {Array<number|null>} values
 * @param {Array} xs - numbers or dates, matching values
 * @returns {{ methodId: string, param: number|null, reason: string, profile: Object,
 *   scores: Array<{ methodId: string, param: number, error: number|null, roughness: number|null, thinShare: number, kept: boolean }> }}
 *   methodId is a TREND_METHODS id ('centred', 'knn', 'lowess' or 'whole').
 */
export function recommendTrend(values, xs) {
    const profile = profileSeries(values, xs);
    const { pts, isDate } = points(values, xs);
    if (pts.length < MIN_POINTS || !(profile.span > 0)) {
        return {
            methodId: 'whole', param: null, profile, scores: [],
            reason: `Only ${pts.length} point${pts.length === 1 ? '' : 's'}, too few for a moving trend, so the lines are flat over the whole series.`,
        };
    }

    // Evenly spaced market prices change slowly, so a narrow block still lets the
    // next month predict this one and every score favours the smallest window.
    const h = profile.span / (profile.evenness >= EVEN ? 40 : 80);
    const prefix = [0];
    pts.forEach(p => prefix.push(prefix[prefix.length - 1] + p.y));
    const sortedValues = pts.map(p => p.y);
    const sortedXs = pts.map(p => p.x);

    const scores = candidates(pts, isDate, profile.span).map((cand) => {
        const counts = neighbourCounts(cand, pts);
        const thinShare = counts.filter(c => c < MIN_NEIGHBOURS).length / pts.length;
        let miss = 0, scored = 0;
        pts.forEach((p, i) => {
            const pred = predictWithout(cand, pts, prefix, i, h);
            if (pred === null || pred === 0) return;
            miss += Math.abs(p.y - pred) / Math.abs(pred);
            scored++;
        });
        const error = scored >= 0.9 * pts.length ? miss / scored : null;
        const kept = error !== null && thinShare <= MAX_THIN_SHARE;
        return { ...cand, error, thinShare, kept, roughness: kept ? roughness(fullTrend(cand, sortedValues, sortedXs), sortedXs) : null };
    });

    const kept = scores.filter(s => s.kept);
    if (kept.length === 0) {
        const k = Math.max(2, Math.min(pts.length, 10));
        return {
            methodId: 'knn', param: k, profile, scores: scores.map(strip),
            reason: `${describeProfile(profile)}. No window kept enough neighbours at every point, so it uses the average of the ${k} nearest points.`,
        };
    }
    const best = Math.min(...kept.map(s => s.error));
    const near = kept.filter(s => s.error <= best * (1 + TOLERANCE)).sort((a, b) => a.roughness - b.roughness);
    const pick = near[0];
    const pct = v => `${fmt(v * 100, 3)}%`;
    const reason = `${describeProfile(profile)}. Picked ${describe(pick, isDate)}: the smoothest of the ${kept.length} options tried`
        + ` whose typical miss on a left-out point (${pct(pick.error)}) is within 5% of the best (${pct(best)}).`;
    return { methodId: pick.methodId, param: pick.param, reason, profile, scores: scores.map(strip) };
}

function strip(s) {
    return { methodId: s.methodId, param: s.param, error: s.error, roughness: s.roughness, thinShare: s.thinShare, kept: s.kept };
}
