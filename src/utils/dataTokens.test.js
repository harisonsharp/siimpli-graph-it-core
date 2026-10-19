import { describe, it, expect } from 'vitest';
import { fillDataTokens } from './dataTokens.js';

describe('fillDataTokens', () => {
    const rows = [
        { bin: '0.05-0.10', assumed: '', total: '' },
        { bin: '0.10-0.15', assumed: 5, total: '170' }
    ];

    it('fills a token with the first non-blank value of its column', () => {
        expect(fillDataTokens('assumed for {assumed} of {total} reports', rows))
            .toBe('assumed for 5 of 170 reports');
    });

    it('leaves a token as written when no row has a value for it', () => {
        expect(fillDataTokens('{missing} and {bin}', rows)).toBe('{missing} and 0.05-0.10');
        expect(fillDataTokens('{assumed}', [{ assumed: null }, { assumed: '  ' }])).toBe('{assumed}');
    });

    it('passes through text without tokens, non-strings and missing rows', () => {
        expect(fillDataTokens('Powder Factor (kg/t)', rows)).toBe('Powder Factor (kg/t)');
        expect(fillDataTokens(undefined, rows)).toBeUndefined();
        expect(fillDataTokens('{total}', undefined)).toBe('{total}');
    });
});
