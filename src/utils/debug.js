/**
 * Debug logging utility using Vite's build-time optimization
 * In production builds, DEBUG is false and these blocks are tree-shaken out
 */

export const DEBUG = import.meta.env.DEV;

/**
 * Conditional debug log - eliminated in production builds
 * @param  {...any} args - Arguments to log
 */
export function debugLog(...args) {
    if (DEBUG) {
        console.log(...args);
    }
}

/**
 * Conditional debug warn - eliminated in production builds
 * @param  {...any} args - Arguments to warn
 */
export function debugWarn(...args) {
    if (DEBUG) {
        console.warn(...args);
    }
}
