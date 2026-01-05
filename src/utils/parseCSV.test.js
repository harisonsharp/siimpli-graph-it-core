import { describe, it, expect } from 'vitest';
import { parseCSV } from './parseCSV';

describe('parseCSV', () => {
    it('should parse basic numeric CSV', () => {
        const csv = 'a,b\n1,2\n3,4.5';
        const { headers, data } = parseCSV(csv);
        expect(headers).toEqual(['a', 'b']);
        expect(data).toHaveLength(2);
        expect(data[0]).toEqual({ a: 1, b: 2 });
        expect(data[1]).toEqual({ a: 3, b: 4.5 });
    });

    it('should parse booleans (case insensitive)', () => {
        const csv = 'bool1,bool2,bool3\ntrue,FALSE,True\nFalse,TRUE,true';
        const { data } = parseCSV(csv);
        expect(data[0]).toEqual({ bool1: true, bool2: false, bool3: true });
        expect(data[1]).toEqual({ bool1: false, bool2: true, bool3: true });
    });

    it('should parse null values', () => {
        const csv = 'v1,v2,v3,v4,v5\nnull,NULL,NA,N/A,nan';
        const { data } = parseCSV(csv);
        expect(data[0]).toEqual({ v1: null, v2: null, v3: null, v4: null, v5: null });
    });

    it('should handle empty strings as empty strings (or null if desired, but current spec implies explicit nulls)', () => {
        // If the requirement is to keep empty strings as empty strings unless they match specific null keywords
        const csv = 'v1,v2\n"",';
        const { data } = parseCSV(csv);
        // Based on current implementation it might be empty string or 0 if parsed as number? 
        // Let's stick to the plan: explicit nulls. Empty fields usually become empty strings or 0 in some parsers.
        // Let's assume empty field ,, is empty string or null. 
        // In the current implementation: "const value = values[index] || '';" -> empty string.
        expect(data[0].v1).toBe('');
    });

    it('should parse dates in various formats', () => {
        const csv = `d1,d2,d3,d4,d5
2023-01-01,01/02/2023,02-01-2023,01-Jan-2023,01_01_2023`;

        const { data } = parseCSV(csv);
        const row = data[0];

        // ISO
        expect(row.d1).toBeInstanceOf(Date);
        expect(row.d1.getFullYear()).toBe(2023);
        expect(row.d1.getMonth()).toBe(0); // Jan
        expect(row.d1.getDate()).toBe(1);

        // US MM/DD/YYYY
        expect(row.d2).toBeInstanceOf(Date);
        expect(row.d2.getMonth()).toBe(0); // Jan (01)
        expect(row.d2.getDate()).toBe(2); // 02

        // DD-MM-YYYY (Ambiguous with MM-DD, usually assume US unless > 12, but strict ISO is YYYY-MM-DD)
        // If we implement robust parsing, we might need heuristics. 
        // For this test let's assume 02-01-2023 is Feb 1st (US) or Jan 2nd (EU). 
        // Let's use an unambiguous date for test: 31-01-2023
    });

    it('should parse unambiguous dates correctly', () => {
        const csv = `iso,us,eu,named
2023-01-31,01/31/2023,31-01-2023,31-Jan-2023`;
        const { data } = parseCSV(csv);
        const row = data[0];

        expect(row.iso.getDate()).toBe(31);
        expect(row.us.getDate()).toBe(31);
        expect(row.eu.getDate()).toBe(31);
        expect(row.named.getDate()).toBe(31);

        expect(row.iso.getMonth()).toBe(0);
        expect(row.us.getMonth()).toBe(0);
        expect(row.eu.getMonth()).toBe(0);
        expect(row.named.getMonth()).toBe(0);
    });

    it('should fallback to string for mixed/unknown types', () => {
        const csv = 'mix\n123\nabc';
        const { data } = parseCSV(csv);
        expect(data[0].mix).toBe(123);
        expect(data[1].mix).toBe('abc');
    });
});
