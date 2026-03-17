import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TauriIOProvider } from './TauriIOProvider.js';

const pluginFsMock = {
    readTextFile: vi.fn(),
    writeTextFile: vi.fn(),
    readDir: vi.fn(),
    exists: vi.fn(),
    mkdir: vi.fn()
};

vi.mock('@tauri-apps/plugin-fs', () => pluginFsMock);

describe('TauriIOProvider', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('proxies file operations to @tauri-apps/plugin-fs', async () => {
        pluginFsMock.readTextFile.mockResolvedValue('csv-data');
        pluginFsMock.readDir.mockResolvedValue([{ name: 'a.csv' }, { name: 'b.csv' }]);
        pluginFsMock.exists.mockResolvedValue(true);

        const io = new TauriIOProvider();

        await io.writeFile('/tmp/sample.txt', 'hello');
        const content = await io.readFile('/tmp/sample.txt');
        const dirEntries = await io.readDir('/tmp');
        const doesExist = await io.exists('/tmp/sample.txt');
        await io.mkdir('/tmp/a', { recursive: true });

        expect(content).toBe('csv-data');
        expect(dirEntries).toEqual(['a.csv', 'b.csv']);
        expect(doesExist).toBe(true);

        expect(pluginFsMock.writeTextFile).toHaveBeenCalledWith('/tmp/sample.txt', 'hello');
        expect(pluginFsMock.readTextFile).toHaveBeenCalledWith('/tmp/sample.txt');
        expect(pluginFsMock.readDir).toHaveBeenCalledWith('/tmp');
        expect(pluginFsMock.exists).toHaveBeenCalledWith('/tmp/sample.txt');
        expect(pluginFsMock.mkdir).toHaveBeenCalledWith('/tmp/a', { recursive: true });
    });
});
