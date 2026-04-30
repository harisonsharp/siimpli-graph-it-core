import { IOProvider } from '../../io/IOProvider.js';

/**
 * Discovers, loads, and parses graph configuration files from a directory.
 *
 * Parser-agnostic by design: the parsing strategy is injected at construction
 * time so the loader can work with any config format (KCSV, JSON, etc.) without
 * importing domain-specific logic. This also keeps format IP separate from the
 * orchestration mechanism.
 *
 * Uses Promise.allSettled internally so a single malformed or missing file
 * does not abort the entire batch — failures are collected in the returned
 * `errors` array rather than thrown.
 */
export class GraphConfigLoader {
    /**
     * @param {IOProvider} ioProvider
     * @param {function(string, string): Object|null} parserFn - (content, filename) => config | null
     * @param {{ extension?: string }} [options]
     */
    constructor(ioProvider, parserFn, options = {}) {
        if (!(ioProvider instanceof IOProvider)) {
            throw new Error('ioProvider must be an instance of IOProvider');
        }
        this.io = ioProvider;
        this.parse = parserFn;
        this.extension = (options.extension ?? '.csv').toLowerCase();
    }

    /**
     * Discover all files matching this.extension in the given directory,
     * then read and parse each one.
     *
     * @param {string} directory - Directory path (relative to IOProvider base, if set)
     * @returns {Promise<{
     *   configs: Array<{ filename: string, config: Object }>,
     *   errors:  Array<{ filename: string, reason: string }>
     * }>}
     */
    async discoverAndLoad(directory) {
        const allNames = await this.io.readDir(directory);
        const targetNames = allNames.filter(
            name => typeof name === 'string' && name.toLowerCase().endsWith(this.extension)
        );

        const results = await Promise.allSettled(
            targetNames.map(async (name) => {
                const content = await this.io.readFile(`${directory}/${name}`);
                return { filename: name, content };
            })
        );

        const configs = [];
        const errors = [];

        for (let i = 0; i < results.length; i++) {
            const result = results[i];
            const filename = targetNames[i];

            if (result.status === 'fulfilled') {
                const { content } = result.value;
                const parsed = this.parse(content, filename);
                if (parsed != null) {
                    configs.push({ filename, config: parsed });
                } else {
                    errors.push({ filename, reason: 'Parser returned null — check file format' });
                }
            } else {
                errors.push({
                    filename,
                    reason: result.reason?.message ?? String(result.reason)
                });
            }
        }

        return { configs, errors };
    }
}
