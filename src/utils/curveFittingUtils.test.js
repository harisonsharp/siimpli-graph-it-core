import { describe, it, expect } from 'vitest';
import * as curveFittingUtils from './curveFittingUtils.js';

describe('curveFittingUtils', () => {
    it('should export functions', () => {
        expect(curveFittingUtils).toBeDefined();
    });
});

// fitPolynomial used to read conditionEstimate outside the block that declared it,
// so every polynomial fit threw and performCurveFitting returned result: null.
describe('fitPolynomial', () => {
    it('fits a straight line and reports the condition estimate', () => {
        const data = [1, 2, 3, 4, 5].map(x => ({ x, y: 3 * x + 2 }));
        const fit = curveFittingUtils.fitPolynomial(data, 1);
        expect(fit.coefficients[0]).toBeCloseTo(2, 8);
        expect(fit.coefficients[1]).toBeCloseTo(3, 8);
        expect(fit.rSquared).toBeCloseTo(1, 8);
        expect(Number.isFinite(fit.conditionNumber)).toBe(true);
    });

    it('fits a quadratic', () => {
        const data = [-2, -1, 0, 1, 2, 3].map(x => ({ x, y: x * x - 4 * x + 1 }));
        const fit = curveFittingUtils.fitPolynomial(data, 2);
        expect(fit.coefficients.map(c => Number(c.toFixed(6)))).toEqual([1, -4, 1]);
    });

    it('returns a result through performCurveFitting', () => {
        const csvData = [1, 2, 3, 4].map(x => ({ x, y: 2 * x }));
        const config = { xAxis: 'x', series: [{ yAxis: 'y' }] };
        const [fit] = curveFittingUtils.performCurveFitting(csvData, config, [{ enabled: true, seriesIndex: 0, fitType: 'polynomial', order: 1 }]);
        expect(fit.result).not.toBeNull();
        expect(fit.result.coefficients[1]).toBeCloseTo(2, 8);
    });
});
