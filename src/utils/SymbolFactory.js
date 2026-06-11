/**
 * @fileoverview Factory for generating D3 symbol mappings for categorical data.
 * Handles dynamic assignment of shapes to unique values and consistent rendering.
 *
 * @author Harison Sharp
 * @since 0.3.0
 *
 * @module SymbolFactory
 * @type {Factory}
 *
 * @requires d3
 *
 * @exports SymbolFactory
 */
import * as d3 from 'd3';
import { debugLog } from './debug.js';

export class SymbolFactory {
    /**
     * Standard symbol progression order
     * 1. Square
     * 2. Diamond
     * 3. Triangle
     * 4. Star
     * Fallback: Circle
     */
    static SYMBOL_ORDER = [
        d3.symbolCircle,
        d3.symbolSquare,
        d3.symbolDiamond,
        d3.symbolTriangle,
        d3.symbolStar,
        d3.symbolCross,
        d3.symbolWye,
    ];

    static FALLBACK_SYMBOL = d3.symbolCircle;

    /**
     * Reserved symbol for the missing-category group. Kept out of {@link SymbolFactory.SYMBOL_ORDER}
     * so it never competes for a rotation slot — the `(none)` group always renders as this distinct
     * glyph regardless of how many real categories exist. `symbolTimes` (an ✗) reads as "absent".
     */
    static MISSING_SYMBOL = d3.symbolTimes;

    /**
     * Sentinel category for data points whose filter/color value is missing
     * (null, undefined, or blank). Shared across the plot, legend, and unified table
     * so a "missing" group is treated as a first-class category everywhere rather than
     * silently folded into the series default. Displayed to users as `(none)`.
     */
    static MISSING_CATEGORY = '__missing__';

    /** Human-readable label for {@link SymbolFactory.MISSING_CATEGORY}. */
    static MISSING_LABEL = '(none)';

    /**
     * Neutral grey used to render the missing-category group, shared by the plot, legend,
     * and unified table so `(none)` looks consistent everywhere and distinct from both
     * graded categories and the series default color.
     */
    static MISSING_COLOR = '#9ca3af';

    /**
     * Normalize a raw category value: missing values (null/undefined/blank) map to the
     * shared {@link SymbolFactory.MISSING_CATEGORY} sentinel; everything else is returned as-is.
     * @param {*} value
     * @returns {string|number}
     */
    static normalizeCategory(value) {
        return (value === undefined || value === null || value === '')
            ? SymbolFactory.MISSING_CATEGORY
            : value;
    }

    // Default size for legend symbols
    static LEGEND_SHAPE_SIZE = 64; // px^2, approx 8px diameter

    /**
     * Generate a mapping of values to symbols
     * @param {Array<string|number>} uniqueValues - Array of unique values from the data
     * @returns {Map<string|number, Object>} Map of value -> d3 symbol object
     */
    static generateSymbolMap(uniqueValues) {
        const map = new Map();

        // The missing-category group gets its reserved symbol and does NOT consume a rotation
        // slot, so real categories always start at SYMBOL_ORDER[0] and the (none) glyph stays
        // distinct no matter how many categories there are.
        let symbolIndex = 0;

        uniqueValues.forEach(value => {
            if (value === SymbolFactory.MISSING_CATEGORY) {
                map.set(value, SymbolFactory.MISSING_SYMBOL);
            } else if (symbolIndex < this.SYMBOL_ORDER.length) {
                map.set(value, this.SYMBOL_ORDER[symbolIndex]);
                symbolIndex++;
            } else {
                map.set(value, this.FALLBACK_SYMBOL);
            }
        });

        return map;
    }

    /**
     * Get the symbol for a specific value
     * @param {string|number} value - The category value
     * @param {Map} symbolMap - The pre-generated symbol map
     * @returns {Object} D3 symbol type
     */
    static getSymbol(value, symbolMap) {
        if (!symbolMap || !symbolMap.has(value)) {
            return this.FALLBACK_SYMBOL;
        }
        return symbolMap.get(value);
    }

    /**
     * Collect the distinct category values for a column. Missing values (null/undefined/blank)
     * are collapsed into the single {@link SymbolFactory.MISSING_CATEGORY} sentinel rather than
     * dropped, so points with no value still receive their own symbol/legend entry.
     *
     * Callers that want to omit the missing group entirely (e.g. `excludeEmptyValues`) should
     * filter out `SymbolFactory.MISSING_CATEGORY` from the result.
     *
     * @param {Array<Object>} data
     * @param {string} filterColumn
     * @returns {Array<string|number>}
     */
    static getUniqueValues(data, filterColumn) {
        debugLog('[SymbolFactory.getUniqueValues] data, filterColumn', data, filterColumn);
        return [...new Set(data.map(d => SymbolFactory.normalizeCategory(d[filterColumn])))];
    }

    /**
     * Determine whether scatter unique symbol encoding should be active.
     * Supports legacy configs where filterType is omitted but filterColumn is provided.
     *
     * @param {Object} seriesConfig
     * @returns {boolean}
     */
    static shouldUseUniqueSymbolEncoding(seriesConfig) {
        if (!seriesConfig || !seriesConfig.filter || !seriesConfig.filterColumn) {
            return false;
        }

        if (seriesConfig.filterType === 'unique') {
            return true;
        }

        const hasFilterType = typeof seriesConfig.filterType === 'string' && seriesConfig.filterType.trim() !== '';
        const hasFilterValue =
            seriesConfig.filterValue !== undefined &&
            seriesConfig.filterValue !== null &&
            String(seriesConfig.filterValue).trim() !== '';

        // Backward compatibility: old configs used filter + filterColumn without filterType.
        return !hasFilterType && !hasFilterValue;
    }

    static getSymbolMap(uniqueValues) {
        return SymbolFactory.generateSymbolMap(uniqueValues);
    }

}
