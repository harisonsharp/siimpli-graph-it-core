/**
 * Debug logging utility using Vite's build-time optimization.
 * In production builds, DEBUG is false and these blocks can be tree-shaken
 * or stripped by the build tool.
 */
export const DEBUG = (typeof import.meta !== 'undefined' && import.meta.env?.DEV) ?? (process.env.NODE_ENV !== 'production');

export const LOG_LEVELS = {
    TRACE: 0,
    DEBUG: 1,
    INFO: 2,
    WARN: 3,
    ERROR: 4,
    NONE: 5
};

// Cache the filter to avoid reading localStorage on every log
let activeFilter = null;
let activeLevel = LOG_LEVELS.DEBUG;

if (DEBUG && typeof window !== 'undefined') {
    try {
        const storedFilter = window.localStorage.getItem('DEBUG_FILTER');
        activeFilter = storedFilter ? new RegExp(storedFilter) : null;

        const storedLevel = window.localStorage.getItem('DEBUG_LEVEL');
        if (storedLevel && LOG_LEVELS[storedLevel] !== undefined) {
            activeLevel = LOG_LEVELS[storedLevel];
        }
    } catch (e) {
        // Ignore localStorage errors
    }
}

/**
 * Checks if a log should be emitted based on level and namespace filter
 * @param {number} level - The log level of the message
 * @param {string} [namespace] - Optional namespace
 * @returns {boolean}
 */
function shouldLog(level, namespace) {
    if (!DEBUG) return false;
    if (level < activeLevel) return false;
    if (activeFilter && namespace && !activeFilter.test(namespace)) return false;
    return true;
}

/**
 * Internal logger function
 * @param {number} level - Log level
 * @param {object|string|undefined} context - Context object (injected by plugin) or namespace
 * @param  {...any} args - Arguments to log
 */
function log(level, context, ...args) {
    if (!DEBUG) return;

    let namespace = '';
    let fileInfo = '';

    // Handle context if provided. The Vite plugin will inject an object: { __file: '...', __line: ... }
    // Users might also pass a string namespace manually.
    if (context && typeof context === 'object' && context.__file) {
        fileInfo = `${context.__file}:${context.__line}`;
        // If the user passed a namespace in the original call, it might be the first arg
        // But our plugin signature will be debugLog(context, ...args)
    } else if (typeof context === 'string') {
        namespace = context;
    }

    if (!shouldLog(level, namespace)) return;

    const prefixParts = [];
    if (namespace) prefixParts.push(`[${namespace}]`);
    if (fileInfo) prefixParts.push(`@ ${fileInfo}`);

    const prefix = prefixParts.length > 0 ? prefixParts.join(' ') : '';

    const consoleMethod = level >= LOG_LEVELS.WARN ? 'warn' :
        level >= LOG_LEVELS.ERROR ? 'error' : 'log';

    if (prefix) {
        // Use console formatting for style if needed, or just simple prefix
        console[consoleMethod](prefix, ...args);
    } else {
        console[consoleMethod](...args);
    }
}

/**
 * Conditional debug log
 * Can be called as:
 * debugLog("Message")
 * debugLog("Namespace", "Message") -- legacy support
 * debugLog({ __file: ... }, "Message") -- auto-injection support
 */
export function debugLog(arg1, ...args) {
    if (!DEBUG) return;
    // Heuristic: if arg1 is object with __file, it's context. 
    // If arg1 is string and there are more args, treat as namespace? 
    // Actually, to stay simple for now:
    // If the plugin injects context, it becomes the first argument.
    // If no plugin, usage is debugLog(...args).

    // We'll treat arg1 as context if it has __file property
    if (arg1 && typeof arg1 === 'object' && arg1.__file) {
        log(LOG_LEVELS.DEBUG, arg1, ...args);
    } else {
        log(LOG_LEVELS.DEBUG, null, arg1, ...args);
    }
}

/**
 * Conditional debug warn
 */
export function debugWarn(arg1, ...args) {
    if (!DEBUG) return;
    if (arg1 && typeof arg1 === 'object' && arg1.__file) {
        log(LOG_LEVELS.WARN, arg1, ...args);
    } else {
        log(LOG_LEVELS.WARN, null, arg1, ...args);
    }
}

/**
 * Factory to create a namespaced logger
 * @param {string} namespace 
 */
export function createLogger(namespace) {
    return {
        log: (...args) => log(LOG_LEVELS.DEBUG, namespace, ...args),
        warn: (...args) => log(LOG_LEVELS.WARN, namespace, ...args),
        error: (...args) => log(LOG_LEVELS.ERROR, namespace, ...args),
        trace: (...args) => log(LOG_LEVELS.TRACE, namespace, ...args)
    };
}
