/**
 * @fileoverview Mathematical utility functions for graph data processing and calculations.
 * Provides data range calculations, numeric conversions, and axis intercept logic.
 *
 * @author Harison Sharp
 * @since 0.5.0
 *
 * @module Math Utilities
 * @type {Utility Library}
 *
 * @function extent - Calculate min/max range from numeric array
 * @function toFiniteNumber - Safe numeric conversion with validation
 * @function safeScale - Safe scale ratio calculation with division protection
 * @function calculateAxisIntercepts - Calculate axis intercept points from config
 *
 * @exports extent, toFiniteNumber, safeScale, calculateAxisIntercepts
 *
 * @example
 * const [min, max] = extent([1, 2, 3, 4, 5]);  // [1, 5]
 * const num = toFiniteNumber('42.5');          // 42.5
 * const scale = safeScale(800, 10);            // 80
 * const intercepts = calculateAxisIntercepts([0, 100], [0, 50]);
 *
 * @relatedFiles columnUtils.js (column parsing), dataUtils.js (data processing)
 */

/**
 * Calculate the numeric extent (min/max) of an array of values
 * Filters out non-finite values (NaN, Infinity, etc.)
 *
 * @param {number[]} values - Array of numeric values
 * @returns {[number|undefined, number|undefined]} Tuple of [min, max], or [undefined, undefined] if empty
 *
 * @example
 * extent([10, 5, 20, 15])           // [5, 20]
 * extent([1, NaN, 3, Infinity])     // [1, 3]
 * extent([])                        // [undefined, undefined]
 */
export function extent(values) {
    if (!Array.isArray(values) || values.length === 0) {
        return [undefined, undefined];
    }

    let min = Infinity;
    let max = -Infinity;

    for (const value of values) {
        if (!Number.isFinite(value)) {
            continue;
        }

        if (value < min) {
            min = value;
        }

        if (value > max) {
            max = value;
        }
    }

    if (min === Infinity || max === -Infinity) {
        return [undefined, undefined];
    }

    return [min, max];
}

/**
 * Safe numeric conversion that returns null for non-finite values
 * Useful for form inputs and config values that may be strings or invalid
 *
 * @param {string|number|any} value - Value to convert to finite number
 * @returns {number|null} Parsed number if finite, null otherwise
 *
 * @example
 * toFiniteNumber('42.5')         // 42.5
 * toFiniteNumber(42)             // 42
 * toFiniteNumber('invalid')      // null
 * toFiniteNumber(NaN)            // null
 * toFiniteNumber(Infinity)       // null
 */
export function toFiniteNumber(value) {
    const num = Number.parseFloat(value);
    return Number.isFinite(num) ? num : null;
}

/**
 * Safe division for scale calculations
 * Protects against division by zero and non-finite values
 *
 * @param {number} rangeSize - Size of output range
 * @param {number} domainSize - Size of input domain
 * @returns {number} Scale ratio (rangeSize / domainSize), or 0 if calculation invalid
 *
 * @example
 * safeScale(800, 10)             // 80
 * safeScale(600, 20)             // 30
 * safeScale(100, 0)              // 0
 * safeScale(NaN, 10)             // 0
 */
export function safeScale(rangeSize, domainSize) {
    if (!Number.isFinite(rangeSize) || !Number.isFinite(domainSize) || domainSize === 0) {
        return 0;
    }

    return rangeSize / domainSize;
}


