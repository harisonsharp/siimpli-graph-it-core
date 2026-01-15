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
        d3.symbolSquare,
        d3.symbolDiamond,
        d3.symbolTriangle,
    ];

    static FALLBACK_SYMBOL = d3.symbolCircle;

    // Default size for legend symbols
    static LEGEND_SHAPE_SIZE = 64; // px^2, approx 8px diameter

    /**
     * Generate a mapping of values to symbols
     * @param {Array<string|number>} uniqueValues - Array of unique values from the data
     * @returns {Map<string|number, Object>} Map of value -> d3 symbol object
     */
    static generateSymbolMap(uniqueValues) {
        const map = new Map();

        // Filter out empty/null/undefined for distinct shape mapping if needed, 
        // or just map them blindly. The renderer handles exclusion.
        // We'll map them in order of appearance.

        let symbolIndex = 0;

        uniqueValues.forEach(value => {
            if (symbolIndex < this.SYMBOL_ORDER.length) {
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

    static getUniqueValues(data, filterColumn) {
        debugLog('[SymbolFactory.getUniqueValues] data, filterColumn', data, filterColumn);
        return [...new Set(data.map(d => d[filterColumn]))].filter(v => v !== undefined && v !== null);
    }

    static getSymbolMap(uniqueValues) {
        return SymbolFactory.generateSymbolMap(uniqueValues);
    }

}
