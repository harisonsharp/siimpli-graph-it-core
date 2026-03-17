/**
 * @interface IOProvider
 */
export class IOProvider {
    /**
     * @param {string} filePath
     * @param {Object} [options] Optional configuration for read operation
     * @returns {Promise<string|Uint8Array>}
     */
    async readFile(filePath, options = {}) {
        throw new Error('Not implemented');
    }

    /**
     * @param {string} filePath
     * @param {string|Buffer|Uint8Array} data
     * @returns {Promise<void>}
     */
    async writeFile(filePath, data) {
        throw new Error('Not implemented');
    }

    /**
     * @param {string} dirPath
     * @returns {Promise<string[]>}
     */
    async readDir(dirPath) {
        throw new Error('Not implemented');
    }

    /**
     * @param {string} targetPath
     * @returns {Promise<boolean>}
     */
    async exists(targetPath) {
        throw new Error('Not implemented');
    }

    /**
     * @param {string} dirPath
     * @param {{ recursive?: boolean }} [options]
     * @returns {Promise<void>}
     */
    async mkdir(dirPath, options = {}) {
        throw new Error('Not implemented');
    }
}
