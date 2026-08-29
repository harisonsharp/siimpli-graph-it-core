/**
 * @fileoverview Fits ONE category's own line over its own points.
 *
 * Two consumers, one implementation, which is the whole point of it living here:
 *
 * - {@link UnifiedTableRenderer} fits every category on the chart, so its value column can
 *   say what each of them does AT the x a reader is asking about, rather than what each of
 *   them does on average across an x range it may never run at.
 * - the mineit flowsheet modal fits the ONE category a reader picked and draws it, so the
 *   drawn line and the tabled number can never tell different stories.
 *
 * Both forms mirror the way these charts' own reference line is fitted (in SQL, over every
 * row), so a category line and the reference it is read against are the same kind of object
 * measured over different rows:
 *
 * - `'linear'` — least-squares slope through the origin, `k = sum(xy) / sum(x^2)`. Forced
 *   through (0,0) for the same reason the SQL forces it on a mass-pull chart: zero feed
 *   grade must pull zero mass.
 * - `'median'` — a rolling median over a rank window, then a light rolling mean over that
 *   median. The median gives outlier robustness; the mean pass only removes the staircase a
 *   rank-window median leaves behind (it moves only when the middle element changes).
 *   Half-widths follow the SQL's rule scaled to the category's own count.
 *
 * Only part of a fit is evidence. `fitEvidenceEnds` returns the two points where the
 * category's own rows start and stop — what a chart marks so a reader can see where the
 * fitted stretch ends — and `fitValueAt` refuses to read outside them unless extrapolation
 * is asked for explicitly. Beyond the data the linear form keeps its slope and the median
 * form holds its end value.
 *
 * @module categoryFit
 */

/**
 * Reads a cell as a number, treating a blank as MISSING rather than as zero.
 *
 * `Number('')` and `Number(null)` are both 0, so a row whose x was never extracted lands at
 * the origin as a real-looking point: it joins the fit, shifts the rolling median, counts
 * itself in the row count, and puts an evidence marker on the y-axis where the chart plots
 * nothing (the renderers drop the same row for having no x). Seen live on a silver-recovery
 * chart — one project has 85% recovery and no head grade, which made its deposit type read
 * n=7 against a table that had counted 6.
 *
 * Deliberately NOT `parseNumber` (dataUtils): that one falls back to `Date.parse`, which
 * would turn a stray text cell into an epoch and a grade axis into nonsense.
 *
 * @param {*} value - A raw cell value.
 * @returns {number|null} The number, or `null` for blank, null, undefined or non-numeric.
 */
export function numericCell(value) {
    if (value === null || value === undefined) return null;
    if (typeof value === 'string' && value.trim() === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

/** Rolling-median half-width, in ranks either side. The SQL uses `round(n/4)` clamped to
 *  [8, 60] over ~80 rows; a single category has far fewer, so only the rule scales. */
const medianHalfWidth = (n) => Math.max(1, Math.round(n / 4));

/** Half-width of the mean pass that de-staircases the median. The SQL's floor of 3 is too
 *  heavy for a ten-point category — at that size it would flatten the line it is smoothing. */
const smoothHalfWidth = (window) => Math.max(2, Math.floor(window / 4));

/** Median of a numeric array. Sorts a copy, never the input. */
function median(values) {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = sorted.length >> 1;
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Inclusive window `[i - half, i + half]`, truncated at the ends. */
const windowOf = (values, i, half) => values.slice(Math.max(0, i - half), Math.min(values.length, i + half + 1));

/**
 * Fits one category's line over its own points.
 *
 * @param {Array<{index: number, x: *, y: *}>} points - That category's points. `index` is
 *   carried through untouched so a caller can write the fitted value back onto the row it
 *   came from. `x` and `y` may be raw cell values; anything blank or non-numeric drops the
 *   point (see {@link numericCell} — a blank must not become a zero).
 * @param {'linear'|'median'} form - Which of the two reference-line forms to mirror.
 * @returns {{form: string, n: number, k: number|null, window: number|null, label: string,
 *   formula: string, points: Array<{index: number, x: number, y: number}>}|null} The fitted
 *   line — `points` holds the fitted y per input point, sorted by x — or `null` when nothing
 *   can be fitted. `formula` states the fit in a table cell's worth of characters; `label`
 *   is the longer form a legend row can carry.
 */
export function fitCategoryLine(points, form) {
    const clean = (points ?? [])
        .map(p => ({ index: p?.index, x: numericCell(p?.x), y: numericCell(p?.y) }))
        .filter(p => p.x !== null && p.y !== null)
        .sort((a, b) => a.x - b.x);
    if (clean.length === 0) return null;

    if (form === 'linear') {
        let sxy = 0;
        let sxx = 0;
        for (const p of clean) {
            sxy += p.x * p.y;
            sxx += p.x * p.x;
        }
        if (sxx === 0) return null;
        const k = sxy / sxx;
        return {
            form,
            n: clean.length,
            k,
            window: null,
            label: `${k.toFixed(2)} × head`,
            formula: `${k.toFixed(2)} × head`,
            points: clean.map(p => ({ index: p.index, x: p.x, y: k * p.x }))
        };
    }

    const ys = clean.map(p => p.y);
    const window = medianHalfWidth(clean.length);
    const smooth = smoothHalfWidth(window);
    const medians = ys.map((_, i) => median(windowOf(ys, i, window)));
    const smoothed = medians.map((_, i) => {
        const slice = windowOf(medians, i, smooth);
        return slice.reduce((sum, v) => sum + v, 0) / slice.length;
    });

    return {
        form: 'median',
        n: clean.length,
        k: null,
        window,
        label: `own rolling median ±${window}`,
        formula: `median ±${window}`,
        points: clean.map((p, i) => ({ index: p.index, x: p.x, y: smoothed[i] }))
    };
}

/**
 * Reads the fitted line at one x, by linear interpolation between its own points.
 *
 * @param {ReturnType<fitCategoryLine>} fit - A fitted line.
 * @param {number} x - Where to read it.
 * @param {Object} [options]
 * @param {boolean} [options.extrapolate] - Read beyond the category's own x range too. The
 *   linear form keeps its slope (it is one parameter through the origin, so it has a value
 *   everywhere); the median form holds its end value, which is all a local median can say
 *   about an x outside its window. Off by default: a number for an x the category has never
 *   run at is invention rather than evidence.
 * @returns {number|null} The fitted value, or `null`.
 */
export function fitValueAt(fit, x, { extrapolate = false } = {}) {
    const pts = fit?.points;
    if (!pts?.length || !Number.isFinite(x)) return null;

    const first = pts[0];
    const last = pts[pts.length - 1];
    if (x < first.x || x > last.x) {
        if (!extrapolate) return null;
        if (fit.form === 'linear') return fit.k * x;
        return x < first.x ? first.y : last.y;
    }

    for (let i = 1; i < pts.length; i++) {
        const prev = pts[i - 1];
        const next = pts[i];
        if (x > next.x) continue;
        if (next.x === prev.x) return next.y;
        return prev.y + (next.y - prev.y) * ((x - prev.x) / (next.x - prev.x));
    }
    return pts[0].y;
}

/**
 * The two points where this category's own rows start and stop.
 *
 * A category line is often drawn wider than its own evidence, so these are the only thing
 * separating the stretch that is evidence from the stretch that is arithmetic. Callers
 * mark them.
 *
 * @param {ReturnType<fitCategoryLine>} fit - A fitted line.
 * @returns {{first: {x: number, y: number}, last: {x: number, y: number}}|null} The ends of
 *   the fitted range, or `null` without a fit. On a single-point fit both are the same
 *   point; the caller draws whatever it is handed.
 */
export function fitEvidenceEnds(fit) {
    const pts = fit?.points;
    if (!pts?.length) return null;
    const first = pts[0];
    const last = pts[pts.length - 1];
    return { first: { x: first.x, y: first.y }, last: { x: last.x, y: last.y } };
}
