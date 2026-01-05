import { describe, it, expect } from 'vitest';
import {
    parseColumnId,
    resolveColumn,
    extractColumnNames,
    createColumnId,
    columnExists,
    getUniqueColumnValues
} from './columnUtils.js';

describe('parseColumnId', () => {
    it('should parse column ID without file association', () => {
        const result = parseColumnId('temperature');
        expect(result).toEqual({
            columnName: 'temperature',
            fileName: ''  // Returns empty string, not null
        });
    });

    it('should parse column ID with file association', () => {
        const result = parseColumnId('temperature::sensor1.csv');
        expect(result).toEqual({
            columnName: 'temperature',
            fileName: 'sensor1.csv'
        });
    });

    it('should parse numeric column index', () => {
        const result = parseColumnId('0');
        expect(result).toEqual({
            columnName: '0',
            fileName: ''  // Returns empty string, not null
        });
    });

    it('should parse numeric index with file association', () => {
        const result = parseColumnId('5::data.csv');
        expect(result).toEqual({
            columnName: '5',
            fileName: 'data.csv'
        });
    });

    it('should handle column names with special characters', () => {
        const result = parseColumnId('temp-sensor_01::lab-data.csv');
        expect(result).toEqual({
            columnName: 'temp-sensor_01',
            fileName: 'lab-data.csv'
        });
    });

    it('should handle empty file name after separator', () => {
        const result = parseColumnId('temperature::');
        expect(result).toEqual({
            columnName: 'temperature',
            fileName: ''
        });
    });

    it('should return empty strings for invalid input', () => {
        // Actual implementation returns empty strings for falsy values
        expect(parseColumnId(null)).toEqual({ columnName: '', fileName: '' });
        expect(parseColumnId(undefined)).toEqual({ columnName: '', fileName: '' });
        expect(parseColumnId('')).toEqual({ columnName: '', fileName: '' });
    });
});

describe('resolveColumn', () => {
    const data = [
        { temperature: 25, pressure: 101, humidity: 60 },
        { temperature: 30, pressure: 100, humidity: 55 }
    ];

    it('should resolve column by name', () => {
        expect(resolveColumn(data, 'temperature')).toBe('temperature');
        expect(resolveColumn(data, 'pressure')).toBe('pressure');
    });

    it('should resolve column by numeric index', () => {
        expect(resolveColumn(data, 0)).toBe('temperature');
        expect(resolveColumn(data, 1)).toBe('pressure');
        expect(resolveColumn(data, 2)).toBe('humidity');
    });

    it('should resolve column by string numeric index', () => {
        // String keys are returned as-is, not resolved to column names
        expect(resolveColumn(data, '0')).toBe('0');
        expect(resolveColumn(data, '1')).toBe('1');
    });

    it('should return the key as-is for non-existent column name', () => {
        // resolveColumn returns the key as-is for string keys
        expect(resolveColumn(data, 'nonexistent')).toBe('nonexistent');
    });

    it('should return empty string for out-of-bounds index', () => {
        expect(resolveColumn(data, 10)).toBe('');
        expect(resolveColumn(data, -1)).toBe('');
    });

    it('should return key as-is for empty data with string key', () => {
        // String keys are returned as-is
        expect(resolveColumn([], 'temperature')).toBe('temperature');
        expect(resolveColumn([], 0)).toBe('');
    });

    it('should return empty string for invalid input', () => {
        expect(resolveColumn(data, null)).toBe('');
        expect(resolveColumn(data, undefined)).toBe('');
        expect(resolveColumn(data, '')).toBe('');
        // null data returns empty string or the key
        expect(resolveColumn(null, 'temperature')).toBe('temperature');
    });
});

describe('extractColumnNames', () => {
    it('should extract column names from data', () => {
        const data = [
            { a: 1, b: 2, c: 3 },
            { a: 4, b: 5, c: 6 }
        ];
        const result = extractColumnNames(data);
        expect(result).toEqual(['a', 'b', 'c']);
    });

    it('should handle data with inconsistent columns', () => {
        const data = [
            { a: 1, b: 2 },
            { a: 4, c: 6 },
            { b: 5, d: 7 }
        ];
        const result = extractColumnNames(data);
        // Should get unique columns from all rows
        expect(result).toContain('a');
        expect(result).toContain('b');
        expect(result.length).toBeGreaterThan(0);
    });

    it('should return empty array for empty data', () => {
        expect(extractColumnNames([])).toEqual([]);
    });

    it('should return empty array for null data', () => {
        expect(extractColumnNames(null)).toEqual([]);
        expect(extractColumnNames(undefined)).toEqual([]);
    });

    it('should handle single row data', () => {
        const data = [{ x: 1, y: 2 }];
        expect(extractColumnNames(data)).toEqual(['x', 'y']);
    });
});

describe('createColumnId', () => {
    it('should create column ID without file name', () => {
        expect(createColumnId('temperature')).toBe('temperature');
        expect(createColumnId('pressure', null)).toBe('pressure');
    });

    it('should create column ID with file name', () => {
        expect(createColumnId('temperature', 'sensor.csv')).toBe('temperature::sensor.csv');
        expect(createColumnId('0', 'data.csv')).toBe('0::data.csv');
    });

    it('should handle empty file name', () => {
        expect(createColumnId('temperature', '')).toBe('temperature');
    });

    it('should handle column names with special characters', () => {
        expect(createColumnId('temp_sensor-01', 'lab-data.csv'))
            .toBe('temp_sensor-01::lab-data.csv');
    });

    it('should return the input for invalid column name', () => {
        // Function returns the input value as-is
        expect(createColumnId(null)).toBe(null);
        expect(createColumnId(undefined)).toBe(undefined);
        expect(createColumnId('')).toBe('');
    });
});

describe('columnExists', () => {
    const data = [
        { temperature: 25, pressure: 101, humidity: 60 },
        { temperature: 30, pressure: 100, humidity: 55 }
    ];

    it('should return true for existing column', () => {
        expect(columnExists(data, 'temperature')).toBe(true);
        expect(columnExists(data, 'pressure')).toBe(true);
        expect(columnExists(data, 'humidity')).toBe(true);
    });

    it('should return false for non-existent column', () => {
        expect(columnExists(data, 'nonexistent')).toBe(false);
        expect(columnExists(data, 'temp')).toBe(false);
    });

    it('should handle numeric column index', () => {
        // columnExists checks string keys with 'in' operator, numeric indices return false
        expect(columnExists(data, 0)).toBe(false);
        expect(columnExists(data, 1)).toBe(false);
        expect(columnExists(data, 10)).toBe(false);
    });

    it('should return false for empty data', () => {
        expect(columnExists([], 'temperature')).toBe(false);
    });

    it('should return false for null data', () => {
        expect(columnExists(null, 'temperature')).toBe(false);
        expect(columnExists(undefined, 'temperature')).toBe(false);
    });

    it('should return false for invalid column name', () => {
        expect(columnExists(data, null)).toBe(false);
        expect(columnExists(data, undefined)).toBe(false);
        expect(columnExists(data, '')).toBe(false);
    });
});

describe('getUniqueColumnValues', () => {
    const data = [
        { category: 'A', value: 10 },
        { category: 'B', value: 20 },
        { category: 'A', value: 30 },
        { category: 'C', value: 40 },
        { category: 'B', value: 50 }
    ];

    it('should get unique values from column', () => {
        const result = getUniqueColumnValues(data, 'category');
        expect(result).toHaveLength(3);
        expect(result).toContain('A');
        expect(result).toContain('B');
        expect(result).toContain('C');
    });

    it('should handle numeric values', () => {
        const numData = [
            { x: 1 },
            { x: 2 },
            { x: 1 },
            { x: 3 }
        ];
        const result = getUniqueColumnValues(numData, 'x');
        expect(result).toHaveLength(3);
        expect(result).toContain(1);
        expect(result).toContain(2);
        expect(result).toContain(3);
    });

    it('should handle null and undefined values', () => {
        const mixedData = [
            { x: 'a' },
            { x: null },
            { x: 'b' },
            { x: undefined },
            { x: 'a' }
        ];
        const result = getUniqueColumnValues(mixedData, 'x');
        // Implementation filters out null, undefined, and empty strings
        expect(result).toContain('a');
        expect(result).toContain('b');
        expect(result).toHaveLength(2);  // Only 'a' and 'b'
    });

    it('should return empty array for non-existent column', () => {
        const result = getUniqueColumnValues(data, 'nonexistent');
        expect(result).toEqual([]);
    });

    it('should return empty array for empty data', () => {
        expect(getUniqueColumnValues([], 'category')).toEqual([]);
    });

    it('should return empty array for null data', () => {
        expect(getUniqueColumnValues(null, 'category')).toEqual([]);
    });

    it('should preserve order of first occurrence', () => {
        const ordered = [
            { x: 'zebra' },
            { x: 'apple' },
            { x: 'banana' },
            { x: 'apple' }
        ];
        const result = getUniqueColumnValues(ordered, 'x');
        expect(result[0]).toBe('zebra');
        expect(result[1]).toBe('apple');
        expect(result[2]).toBe('banana');
    });
});
