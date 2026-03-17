import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FileService } from './FileService.js';

describe('FileService.loadFiles with ioProvider', () => {
    beforeEach(() => {
        global.window = {};
    });

    it('loads CSVs through injected ioProvider and returns files/data/columns', async () => {
        const ioProvider = {
            readFile: vi.fn().mockResolvedValue('x,y\n1,2\n3,4\n')
        };

        const files = [{ name: 'sample.csv', path: '/tmp/sample.csv' }];

        const result = await FileService.loadFiles(files, { ioProvider });

        expect(ioProvider.readFile).toHaveBeenCalledWith('/tmp/sample.csv');
        expect(result.newFiles).toEqual([{ name: 'sample.csv', headers: ['x', 'y'] }]);
        expect(result.newData).toHaveLength(2);
        expect(result.newData[0]._sourceFile).toBe('sample.csv');
        expect(result.allColumns).toEqual([
            { name: 'x', file: 'sample.csv', uniqueId: 'x::sample.csv' },
            { name: 'y', file: 'sample.csv', uniqueId: 'y::sample.csv' }
        ]);
    });
});
