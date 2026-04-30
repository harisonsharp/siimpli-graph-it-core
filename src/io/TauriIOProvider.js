import { IOProvider } from './IOProvider.js';

/**
 * Tauri `@tauri-apps/plugin-fs`-backed IOProvider.
 *
 * Lazy-imports the Tauri plugin at call time so the module can be loaded
 * in environments where the Tauri IPC is not available (e.g. unit tests
 * that mock the module).
 *
 * Pass `{ baseDir: BaseDirectory.AppData }` (or any BaseDirectory value) to
 * scope all operations to a Tauri-managed directory without constructing
 * absolute paths in calling code.
 */
export class TauriIOProvider extends IOProvider {
    /**
     * @param {{ baseDir?: number }} [options]
     */
    constructor(options = {}) {
        super();
        this._baseDir = options.baseDir ?? null;
    }

    _opts(extra = {}) {
        const opts = { ...extra };
        if (this._baseDir !== null) opts.baseDir = this._baseDir;
        return opts;
    }

    /**
     * Read a file and return its contents.
     * @param {string} filePath
     * @param {Object} [options]
     * @returns {Promise<string>}
     */
    async readFile(filePath, options = {}) {
        if (options.encoding === 'base64') {
            const { readFile } = await import('@tauri-apps/plugin-fs');
            const bytes = await readFile(filePath, this._opts());
            return Buffer.from(bytes).toString('base64');
        }
        const { readTextFile } = await import('@tauri-apps/plugin-fs');
        return readTextFile(filePath, this._opts());
    }

    /**
     * Write data to a file. Handles both text (string) and binary (Uint8Array / ArrayBuffer).
     * @param {string} filePath
     * @param {string|Uint8Array|ArrayBuffer} data
     * @returns {Promise<void>}
     */
    async writeFile(filePath, data) {
        if (ArrayBuffer.isView(data) || data instanceof ArrayBuffer) {
            const { writeFile } = await import('@tauri-apps/plugin-fs');
            const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
            await writeFile(filePath, bytes, this._opts());
        } else {
            const { writeTextFile } = await import('@tauri-apps/plugin-fs');
            await writeTextFile(filePath, data, this._opts());
        }
    }

    /**
     * Return the names of all direct children of a directory.
     * @param {string} dirPath
     * @returns {Promise<string[]>}
     */
    async readDir(dirPath) {
        const { readDir } = await import('@tauri-apps/plugin-fs');
        const entries = await readDir(dirPath, this._opts());
        return entries.map(e => e.name);
    }

    /**
     * Return true if the path exists (file or directory).
     * @param {string} targetPath
     * @returns {Promise<boolean>}
     */
    async exists(targetPath) {
        const { exists } = await import('@tauri-apps/plugin-fs');
        return exists(targetPath, this._opts());
    }

    /**
     * Create a directory, optionally creating parent directories.
     * @param {string} dirPath
     * @param {{ recursive?: boolean }} [options]
     * @returns {Promise<void>}
     */
    async mkdir(dirPath, options = {}) {
        const { mkdir } = await import('@tauri-apps/plugin-fs');
        await mkdir(dirPath, this._opts(options));
    }
}
