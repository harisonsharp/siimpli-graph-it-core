import { describe, it, expect } from 'vitest';
import { profileSeries, recommendTrend } from './trendAdvisor.js';
import { TREND_METHODS, buildTrendFormulas, validateDerivedFormula } from './derivedSeries.js';

// Deterministic noise, so the picks do not change between runs.
function noise(seed) {
    let s = seed;
    return () => {
        s = (s * 1103515245 + 12345) % 2147483648;
        return s / 2147483648 - 0.5;
    };
}

function monthly(years, seed = 1) {
    const r = noise(seed);
    const xs = [];
    const ys = [];
    let level = 100;
    for (let m = 0; m < years * 12; m++) {
        xs.push(new Date(2000, m, 1));
        level = 0.9 * level + 0.1 * (100 + 30 * Math.sin(m / 30)) + 4 * r();
        ys.push(level);
    }
    return { xs, ys };
}

function scattered(n, years, seed = 2) {
    const r = noise(seed);
    const pts = [];
    for (let i = 0; i < n; i++) {
        const t = (r() + 0.5) * years;
        pts.push({ x: new Date(2000 + Math.floor(t), Math.floor((t % 1) * 12), 15), y: 100 + 20 * Math.sin(t / 3) + 15 * r() });
    }
    return { xs: pts.map(p => p.x), ys: pts.map(p => p.y) };
}

describe('profileSeries', () => {
    it('reads monthly data as evenly spaced and random dates as irregular', () => {
        const even = monthly(10);
        expect(profileSeries(even.ys, even.xs).evenness).toBeGreaterThan(0.9);
        const random = scattered(200, 20);
        const p = profileSeries(random.ys, random.xs);
        expect(p.evenness).toBeLessThan(0.8);
        expect(p.n).toBe(200);
        expect(p.perUnit).toBeCloseTo(10, 0);
    });
});

describe('recommendTrend', () => {
    it('gives flat lines when there are too few points', () => {
        const rec = recommendTrend([1, 2, 3], [1, 2, 3]);
        expect(rec.methodId).toBe('whole');
        expect(rec.reason).toMatch(/too few/);
    });

    it('picks a centred window of a year or more for monthly prices', () => {
        const { xs, ys } = monthly(30);
        const rec = recommendTrend(ys, xs);
        expect(['centred', 'lowess']).toContain(rec.methodId);
        if (rec.methodId === 'centred') expect(rec.param).toBeGreaterThanOrEqual(1);
        expect(rec.reason).toMatch(/evenly spaced/);
    });

    it('never picks a setting that leaves points with too few neighbours', () => {
        const { xs, ys } = scattered(45, 20, 7);
        const rec = recommendTrend(ys, xs);
        const picked = rec.scores.find(s => s.methodId === rec.methodId && s.param === rec.param);
        expect(picked.kept).toBe(true);
        expect(picked.thinShare).toBeLessThanOrEqual(0.05);
        rec.scores.filter(s => s.methodId === 'knn').forEach(s => expect(s.param).toBeGreaterThanOrEqual(10));
    });

    it('works on numeric x and skips gaps', () => {
        const xs = Array.from({ length: 60 }, (_, i) => i * 2);
        const ys = xs.map((x, i) => (i % 7 === 0 ? null : 50 + Math.sin(x / 20) * 10 + (i % 3)));
        const rec = recommendTrend(ys, xs);
        expect(rec.profile.n).toBe(51);
        expect(rec.methodId).not.toBe('whole');
    });

    it('returns a method that builds valid formulas', () => {
        const { xs, ys } = scattered(300, 20, 3);
        const rec = recommendTrend(ys, xs);
        expect(TREND_METHODS.map(m => m.id)).toContain(rec.methodId);
        const { trend, bands } = buildTrendFormulas(rec.methodId, '#1', rec.param, [1, -1]);
        expect(validateDerivedFormula(trend)).toBeNull();
        bands.forEach(b => expect(validateDerivedFormula(b.formula)).toBeNull());
    });
});
