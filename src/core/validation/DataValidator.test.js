import { describe, it, expect } from 'vitest';
import { DataValidator, ValidationError } from './DataValidator.js';

describe('ValidationError', () => {
    it('preserves message and metadata', () => {
        const error = new ValidationError('Test error', 'field');
        expect(error).toBeInstanceOf(ValidationError);
        expect(error.message).toBe('Test error');
        expect(error.field).toBe('field');
    });
});

describe('DataValidator.validateCSVData', () => {
    const validRows = [
        { x: 1, y: 2 },
        { x: 3, y: 4 }
    ];

    it('accepts well-formed data arrays', () => {
        expect(() => DataValidator.validateCSVData(validRows)).not.toThrow();
    });

    it('rejects non-array inputs', () => {
        expect(() => DataValidator.validateCSVData(null)).toThrow('CSV data must be an array');
        expect(() => DataValidator.validateCSVData('nope')).toThrow('CSV data must be an array');
    });

    it('rejects empty datasets', () => {
        expect(() => DataValidator.validateCSVData([])).toThrow('CSV data cannot be empty');
    });

    it('rejects rows that are not objects', () => {
        const malformed = [{ x: 1 }, null];
        expect(() => DataValidator.validateCSVData(malformed)).toThrow('Row 1 is not a valid object');
    });
});

describe('DataValidator.validateNumericColumn', () => {
    const dataset = [
        { grade: 10, ratio: 'n/a' },
        { grade: 20, ratio: 0.5 },
        { grade: 30, ratio: 'oops' }
    ];

    it('requires a non-empty column name', () => {
        expect(() => DataValidator.validateNumericColumn(dataset, '')).toThrow('Column name must be a non-empty string');
    });

    it('throws when the column is missing', () => {
        expect(() => DataValidator.validateNumericColumn(dataset, 'missing')).toThrow("Column 'missing' not found in data");
    });

    it('throws when no numeric values are present', () => {
        expect(() => DataValidator.validateNumericColumn(dataset, 'ratio')).toThrow("Column 'ratio' contains non-numeric values (e.g., 'n/a')");
    });

    it('accepts valid numeric columns', () => {
        expect(() => DataValidator.validateNumericColumn(dataset, 'grade')).not.toThrow();
    });
});

describe('DataValidator.validateDataExtents', () => {
    it('accepts valid min/max values', () => {
        expect(() => DataValidator.validateDataExtents([0, 10])).not.toThrow();
    });

    it('rejects malformed input', () => {
        expect(() => DataValidator.validateDataExtents(null)).toThrow('Extents must be an array of [min, max]');
        expect(() => DataValidator.validateDataExtents([0])).toThrow('Extents must be an array of [min, max]');
    });

    it('requires finite numbers', () => {
        expect(() => DataValidator.validateDataExtents([0, Infinity])).toThrow('Extents must be finite numbers');
    });

    it('requires min < max and unique', () => {
        expect(() => DataValidator.validateDataExtents([10, 0])).toThrow('Invalid extents: min (10) is greater than max (0)');
        expect(() => DataValidator.validateDataExtents([5, 5])).toThrow('Invalid extents: min and max are equal (5)');
    });
});

describe('DataValidator.validateSufficientData', () => {
    const sample = [{}, {}, {}];

    it('uses CSV validation under the hood', () => {
        expect(() => DataValidator.validateSufficientData([])).toThrow('CSV data cannot be empty');
    });

    it('ensures minimum point count', () => {
        expect(() => DataValidator.validateSufficientData(sample, 5)).toThrow('Insufficient data points: need at least 5, got 3');
        expect(() => DataValidator.validateSufficientData(sample, 3)).not.toThrow();
    });
});

describe('DataValidator.filterValidData', () => {
    const data = [
        { a: 1, b: 2 },
        { a: null, b: 3 },
        { a: 4, b: 'bad' },
        { a: 5, b: 6 }
    ];

    it('requires a non-empty list of columns', () => {
        expect(() => DataValidator.filterValidData(data, [])).toThrow('Column names must be a non-empty array');
    });

    it('filters rows that contain finite values for all requested columns', () => {
        const filtered = DataValidator.filterValidData(data, ['a', 'b']);
        expect(filtered).toEqual([{ a: 1, b: 2 }, { a: 5, b: 6 }]);
    });
});

describe('DataValidator.validateDataPoint', () => {
    it('requires an object input', () => {
        expect(() => DataValidator.validateDataPoint(null)).toThrow('Data point must be an object');
    });

    it('checks for missing required fields', () => {
        expect(() => DataValidator.validateDataPoint({ value: null }, ['value'])).toThrow("Field 'value' is empty");
    });

    it('passes valid objects through', () => {
        expect(() => DataValidator.validateDataPoint({ value: 42 }, ['value'])).not.toThrow();
    });
});

describe('DataValidator.validateRange', () => {
    it('accepts valid numeric ranges', () => {
        expect(() => DataValidator.validateRange(0, 100)).not.toThrow();
    });

    it('rejects non-finite values', () => {
        expect(() => DataValidator.validateRange(NaN, 5)).toThrow('Range values must be finite numbers');
    });

    it('requires min < max', () => {
        expect(() => DataValidator.validateRange(5, 5)).toThrow('Range: minimum (5) must be less than maximum (5)');
        expect(() => DataValidator.validateRange(10, 0)).toThrow('Range: minimum (10) must be less than maximum (0)');
    });
});

describe('DataValidator.validatePositiveValues', () => {
    const data = [
        { value: 5 },
        { value: -1 },
        { value: 10 }
    ];

    it('validates numeric column before filtering', () => {
        expect(() => DataValidator.validatePositiveValues(data, '')).toThrow('Column name must be a non-empty string');
    });

    it('returns rows with strictly positive values', () => {
        const positives = DataValidator.validatePositiveValues(data, 'value');
        expect(positives).toEqual([{ value: 5 }, { value: 10 }]);
    });

    it('throws when no positive values remain', () => {
        const nonPositive = [{ value: -1 }];
        expect(() => DataValidator.validatePositiveValues(nonPositive, 'value')).toThrow("Column 'value' contains no positive values");
    });
});

describe('DataValidator.validateColumnsExist', () => {
    const rows = [
        { x: 1, y: 2 },
        { x: 3, y: 4 }
    ];

    it('requires a column list', () => {
        expect(() => DataValidator.validateColumnsExist(rows, [])).toThrow('Column names must be a non-empty array');
    });

    it('reports missing columns', () => {
        expect(() => DataValidator.validateColumnsExist(rows, ['x', 'z'])).toThrow('Missing columns: z');
    });

    it('passes when all columns exist', () => {
        expect(() => DataValidator.validateColumnsExist(rows, ['x', 'y'])).not.toThrow();
    });
});
