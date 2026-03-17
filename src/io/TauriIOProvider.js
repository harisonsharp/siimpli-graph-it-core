import { IOProvider } from './IOProvider.js';

/**
 * Tauri `@tauri-apps/plugin-fs`-backed IOProvider.
 *
 * Lazy-imports the Tauri plugin at call time so the module can be loaded
 * in environments where the Tauri IPC is not available (e.g. unit tests
 * that mock the module).
 */
export class TauriIOProvider extends IOProvider {
    /**
     * Read a file and return its contents.
     * @param {string} filePath
     * @param {Object} [options]
     * @returns {Promise<string>}
     */
    async readFile(filePath, options = {}) {
        if (options.encoding === 'base64') {
            const { readFile } = await import('@tauri-apps/plugin-fs');
            const bytes = await readFile(filePath);
            return Buffer.from(bytes).toString('base64');
        }
        const { readTextFile } = await import('@tauri-apps/plugin-fs');
        return readTextFile(filePath);
    }

    /**
     * Write string data to a file via Tauri.
     * @param {string} filePath
     * @param {string|Buffer|Uint8Array} data
     * @returns {Promise<void>}
     */
    async writeFile(filePath, data) {
        const { writeTextFile } = await import('@tauri-apps/plugin-fs');
        await writeTextFile(filePath, data);
    }

    /**
     * Return the names of all direct children of a directory.
     * @param {string} dirPath
     * @returns {Promise<string[]>}
     */
    async readDir(dirPath) {
        const { readDir } = await import('@tauri-apps/plugin-fs');
        const entries = await readDir(dirPath);
        return entries.map(e => e.name);
    }

    /**
     * Return true if the path exists (file or directory).
     * @param {string} targetPath
     * @returns {Promise<boolean>}
     */
    async exists(targetPath) {
        const { exists } = await import('@tauri-apps/plugin-fs');
        return exists(targetPath);
    }

    /**
     * Create a directory, optionally creating parent directories.
     * @param {string} dirPath
     * @param {{ recursive?: boolean }} [options]
     * @returns {Promise<void>}
     */
    async mkdir(dirPath, options = {}) {
        const { mkdir } = await import('@tauri-apps/plugin-fs');
        await mkdir(dirPath, options);
    }
}
