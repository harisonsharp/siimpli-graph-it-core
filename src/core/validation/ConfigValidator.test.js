import { describe, it, expect } from 'vitest';
import { ConfigValidator } from './ConfigValidator.js';
import { ValidationError } from './DataValidator.js';

describe('ConfigValidator.validateGraphConfig', () => {
    const baseConfig = {
        graphType: 'scatter',
        series: [{ graphType: 'scatter' }]
    };

    it('requires a configuration object', () => {
        expect(() => ConfigValidator.validateGraphConfig(null)).toThrow('Graph configuration must be an object');
    });

    it('requires series to be an array when provided', () => {
        expect(() => ConfigValidator.validateGraphConfig({ ...baseConfig, series: 'invalid' }))
            .toThrow('Series must be an array');
    });

    it('validates supplied graphType values', () => {
        expect(() => ConfigValidator.validateGraphConfig({ ...baseConfig, graphType: 'unknown' }))
            .toThrow('Invalid graph type: unknown. Must be one of: scatter, line, histogram, bar');
    });

    it('validates optional barMode and colorScheme', () => {
        expect(() => ConfigValidator.validateGraphConfig({ ...baseConfig, barMode: 'invalid' }))
            .toThrow('Invalid bar mode: invalid. Must be one of: group, stack');
        expect(() => ConfigValidator.validateGraphConfig({ ...baseConfig, colorScheme: 'solar' }))
            .toThrow('Invalid color scheme: solar. Must be one of: warm-cool, rainbow, green-red');
    });

    it('validates axis intercept selections', () => {
        expect(() => ConfigValidator.validateGraphConfig({ ...baseConfig, axisIntercept: 'random' }))
            .toThrow('Invalid axis intercept: random. Must be one of: minimum, origin, custom');
    });

    it('enforces custom intercept requirements', () => {
        expect(() => ConfigValidator.validateGraphConfig({ ...baseConfig, axisIntercept: 'custom', customIntercept: undefined }))
            .toThrow('Custom intercept must be an object with x and y properties');
    });

    it('requires yAxis2 when dual y-axis enabled', () => {
        expect(() => ConfigValidator.validateGraphConfig({ ...baseConfig, dualYAxis: true })).toThrow('Dual Y-axis enabled but yAxis2 not specified');
    });

    it('passes valid configurations', () => {
        const config = {
            graphType: 'histogram',
            series: [{ graphType: 'histogram' }],
            colorScheme: 'warm-cool',
            axisIntercept: 'origin'
        };
        expect(() => ConfigValidator.validateGraphConfig(config)).not.toThrow();
    });
});

describe('ConfigValidator.validateSeriesConfig', () => {
    it('requires a series object', () => {
        expect(() => ConfigValidator.validateSeriesConfig(null)).toThrow('Series 0 must be an object');
    });

    it('validates graph type per series', () => {
        expect(() => ConfigValidator.validateSeriesConfig({ graphType: 'unknown' }))
            .toThrow("Series 0: Invalid graph type 'unknown'");
    });

    it('accepts valid series definitions', () => {
        expect(() => ConfigValidator.validateSeriesConfig({ graphType: 'line' })).not.toThrow();
    });
});

describe('ConfigValidator.validateCurveFitConfig', () => {
    const baseFit = {
        fitType: 'polynomial',
        order: 2,
        xMin: 0,
        xMax: 10
    };

    it('requires an object', () => {
        expect(() => ConfigValidator.validateCurveFitConfig(null)).toThrow('Curve fit configuration must be an object');
    });

    it('validates fit type membership', () => {
        expect(() => ConfigValidator.validateCurveFitConfig({ ...baseFit, fitType: 'gaussian' }))
            .toThrow('Invalid fit type: gaussian. Must be one of: polynomial, power_law, best_fit');
    });

    it('validates polynomial order bounds', () => {
        expect(() => ConfigValidator.validateCurveFitConfig({ ...baseFit, order: 0 })).toThrow('Polynomial order must be an integer between 1 and 10');
        expect(() => ConfigValidator.validateCurveFitConfig({ ...baseFit, order: 11 })).toThrow('Polynomial order must be an integer between 1 and 10');
    });

    it('validates xMin/xMax ranges when provided', () => {
        expect(() => ConfigValidator.validateCurveFitConfig({ ...baseFit, xMin: 'min' })).toThrow('xMin and xMax must be valid numbers');
        expect(() => ConfigValidator.validateCurveFitConfig({ ...baseFit, xMin: 5, xMax: 5 })).toThrow('xMin (5) must be less than xMax (5)');
    });

    it('accepts optional color values', () => {
        expect(() => ConfigValidator.validateCurveFitConfig({ ...baseFit, color: '#fff' })).not.toThrow();
    });
});

describe('ConfigValidator.validateCustomIntercept', () => {
    it('requires object with x/y', () => {
        expect(() => ConfigValidator.validateCustomIntercept(null)).toThrow('Custom intercept must be an object with x and y properties');
        expect(() => ConfigValidator.validateCustomIntercept({ x: 1 })).toThrow('Custom intercept must have x and y properties');
    });

    it('requires numeric finite values', () => {
        expect(() => ConfigValidator.validateCustomIntercept({ x: 'zero', y: 0 })).toThrow('Custom intercept x and y must be valid numbers');
        expect(() => ConfigValidator.validateCustomIntercept({ x: Infinity, y: 0 })).toThrow('Custom intercept x and y must be finite');
    });

    it('accepts valid intercepts', () => {
        expect(() => ConfigValidator.validateCustomIntercept({ x: 1, y: -2 })).not.toThrow();
    });
});

describe('ConfigValidator.validateGraphDimensions', () => {
    const dims = { width: 800, height: 600 };

    it('requires dimension object', () => {
        expect(() => ConfigValidator.validateGraphDimensions(null)).toThrow('Graph dimensions must be an object');
    });

    it('enforces presence of width/height', () => {
        expect(() => ConfigValidator.validateGraphDimensions({ width: 800 })).toThrow('Graph dimensions must have width and height properties');
    });

    it('validates numeric and positive constraints', () => {
        expect(() => ConfigValidator.validateGraphDimensions({ width: 'wide', height: 600 })).toThrow('Width and height must be valid numbers');
        expect(() => ConfigValidator.validateGraphDimensions({ width: 50, height: 600 })).toThrow('Width and height must be at least 100 pixels');
        expect(() => ConfigValidator.validateGraphDimensions({ width: 12000, height: 600 })).toThrow('Width and height must be at most 10000 pixels');
    });

    it('accepts valid dimensions', () => {
        expect(() => ConfigValidator.validateGraphDimensions(dims)).not.toThrow();
    });
});

describe('ConfigValidator.validateGlobalSettings', () => {
    it('requires an object', () => {
        expect(() => ConfigValidator.validateGlobalSettings(null)).toThrow('Global settings must be an object');
    });

    it('delegates to graph dimension validation', () => {
        expect(() => ConfigValidator.validateGlobalSettings({ graphDimensions: { width: 10 } }))
            .toThrow('Graph dimensions must have width and height properties');
    });

    it('validates color scheme and intercept', () => {
        expect(() => ConfigValidator.validateGlobalSettings({ colorScheme: 'invalid' }))
            .toThrow('Invalid color scheme in settings: invalid');
        expect(() => ConfigValidator.validateGlobalSettings({ axisIntercept: 'invalid' }))
            .toThrow('Invalid axis intercept in settings: invalid');
    });

    it('accepts empty settings or valid nested structures', () => {
        expect(() => ConfigValidator.validateGlobalSettings({})).not.toThrow();
        expect(() => ConfigValidator.validateGlobalSettings({
            colorScheme: 'rainbow',
            graphDimensions: { width: 800, height: 600 }
        })).not.toThrow();
    });
});

describe('ConfigValidator.validateColumnId', () => {
    it('rejects null or non-strings', () => {
        expect(() => ConfigValidator.validateColumnId(null)).toThrow('Column ID must be a non-empty string');
        expect(() => ConfigValidator.validateColumnId(123)).toThrow('Column ID must be a non-empty string');
    });

    it('allows trimmed-empty strings (optional column ids)', () => {
        expect(() => ConfigValidator.validateColumnId('   ')).not.toThrow();
    });

    it('passes through valid ids', () => {
        expect(() => ConfigValidator.validateColumnId('col::file.csv')).not.toThrow();
    });
});

describe('ConfigValidator.validateCurveFits', () => {
    it('requires an array of fits', () => {
        expect(() => ConfigValidator.validateCurveFits(null)).toThrow('Curve fits must be an array');
    });

    it('wraps validation errors with index context', () => {
        expect(() => ConfigValidator.validateCurveFits([{ fitType: 'invalid' }]))
            .toThrow('Curve fit 0: Invalid fit type: invalid. Must be one of: polynomial, power_law, best_fit');
    });

    it('accepts valid fit collections', () => {
        const fits = [{ fitType: 'power_law', xMin: 1, xMax: 10 }];
        expect(() => ConfigValidator.validateCurveFits(fits)).not.toThrow();
    });
});
