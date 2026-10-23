import { describe, it, expect } from 'vitest';
import {
    lowessMean,
    lowessStd,
    nearestStat,
    neighbourCount,
    pointWindowStat,
    sampleStd,
    windowStat,
} from './rollingStats.js';

const xs = [1, 2, 3, 4, 5];
const ys = [1, 2, 3, 4, 10];

describe('sampleStd', () => {
    it('divides by n - 1', () => {
        expect(sampleStd([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.13809, 5);
        expect(sampleStd([5])).toBeNull();
    });
});

describe('windowStat', () => {
    it('trailing windows hold the point and everything less than w before it', () => {
        expect(windowStat(ys, xs, 3, 'trailing', 'mean')).toEqual([1, 1.5, 2, 3, 17 / 3]);
        expect(windowStat(ys, xs, 3, 'trailing', 'min')).toEqual([1, 1, 1, 2, 3]);
        expect(windowStat(ys, xs, 3, 'trailing', 'max')).toEqual([1, 2, 3, 4, 10]);
    });

    it('centred windows run w/2 either side and shrink at the ends', () => {
        expect(windowStat(ys, xs, 2, 'centred', 'mean')).toEqual([1.5, 2, 3, 17 / 3, 7]);
        expect(windowStat(ys, xs, 2, 'centred', 'median')).toEqual([1.5, 2, 3, 4, 7]);
    });

    it('std needs two points in the window', () => {
        const out = windowStat(ys, xs, 3, 'trailing', 'std');
        expect(out[0]).toBeNull();
        expect(out[3]).toBeCloseTo(1, 10);
    });

    it('skips gaps and leaves them as gaps', () => {
        expect(windowStat([1, null, 3, 5], [1, 2, 3, 4], 3, 'trailing', 'mean')).toEqual([1, null, 2, 4]);
    });

    it('works on unsorted input and shared x values', () => {
        const out = windowStat([4, 1, 2, 6], [2, 1, 2, 3], 1, 'trailing', 'mean');
        // x = 2 holds both points at x = 2, which average 3.
        expect(out).toEqual([3, 1, 3, 6]);
    });

    it('measures date windows in calendar years', () => {
        const dates = [];
        const values = [];
        for (let m = 0; m <= 36; m++) {
            dates.push(new Date(2020, m, 1));
            values.push(m + 1);
        }
        const out = windowStat(values, dates, 3, 'trailing', 'mean');
        // 2023-01 holds the 36 months from 2020-02, values 2 to 37.
        expect(out[36]).toBe(19.5);
        // A 1-year window over yearly points across a leap year holds one point.
        const yearly = windowStat([5, 7], [new Date(2020, 0, 1), new Date(2021, 0, 1)], 1, 'trailing', 'mean');
        expect(yearly).toEqual([5, 7]);
    });

    it('rejects x values that are neither numbers nor dates', () => {
        expect(() => windowStat([1, 2], ['a', 'b'], 1, 'trailing', 'mean')).toThrow(/numbers or dates/);
    });
});

describe('nearestStat', () => {
    const nx = [1, 2, 3, 10, 11];
    const ny = [1, 2, 3, 10, 11];

    it('averages the k nearest points, the point itself included', () => {
        expect(nearestStat(ny, nx, 3, 'mean')).toEqual([2, 2, 2, 8, 8]);
    });

    it('reads a k below 1 as a share of the points', () => {
        expect(neighbourCount(0.6, 5)).toBe(3);
        expect(nearestStat(ny, nx, 0.6, 'mean')).toEqual([2, 2, 2, 8, 8]);
    });

    it('caps k at the number of points', () => {
        expect(nearestStat([1, 3], [0, 1], 10, 'mean')).toEqual([2, 2]);
    });
});

describe('lowess', () => {
    it('follows a straight line exactly', () => {
        const lx = [0, 1, 2, 3, 4, 5, 6, 7];
        const ly = lx.map(x => 2 * x + 1);
        lowessMean(ly, lx, 0.5).forEach((v, i) => expect(v).toBeCloseTo(ly[i], 9));
        lowessStd(ly, lx, 0.5).forEach(v => expect(v).toBeCloseTo(0, 9));
    });

    it('gives a positive spread for scattered points', () => {
        const lx = [0, 1, 2, 3, 4, 5, 6, 7];
        const ly = [1, 3, 2, 4, 3, 5, 4, 6];
        const spread = lowessStd(ly, lx, 0.6);
        spread.forEach(v => expect(v).toBeGreaterThan(0));
    });
});

describe('pointWindowStat', () => {
    it('uses the last n values, partial at the start, like pandas rolling(n, min_periods=1)', () => {
        expect(pointWindowStat([1, 2, 3, 4, 10], 3, 'mean')).toEqual([1, 1.5, 2, 3, 17 / 3]);
        expect(pointWindowStat([5, null, 3, 4], 2, 'min')).toEqual([5, null, 3, 3]);
        expect(pointWindowStat([1, 3], 5, 'std')[0]).toBeNull();
    });
});
