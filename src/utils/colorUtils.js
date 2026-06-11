/**
 * @fileoverview Column parsing and resolution utilities for data management.
 * Handles column identifier parsing, resolution by name or index, and column metadata extraction.
 *
 * @author Harison Sharp
 * @since 0.3.0
 *
 * @module Column Utilities
 * @type {Utility Library}
 *
 * @function parseColumnId - Parse column identifiers with optional file associations
 * @function resolveColumn - Resolve column references by name or index
 * @function extractColumnNames - Extract column names from data
 * @exports parseColumnId, resolveColumn, extractColumnNames, 
 *
 * @example
 * const columnInfo = parseColumnId('temperature::data.csv');
 * const columnName = resolveColumn(data, 0);
 * const columns = extractColumnNames(csvData);
 * @relatedFiles graphUtils.js (original), dataUtils.js
 */

import { symbolCircle } from 'd3';
import { parseColumnId } from "./columnUtils.js";
import { ScaleFactory } from "../rendering/ScaleFactory.js";
import { SymbolFactory } from "./SymbolFactory.js";

/**
 * Builds the (symbol × distinct-color) cross-product of rows for a single series.
 *
 * A series can carry two independent categorical encodings:
 *  - a **symbol** dimension, from `series.filterColumn` (e.g. material → square/diamond/triangle),
 *    supplied here as a pre-built `symbolMap` (Map<categoryValue, d3SymbolType>); and
 *  - a **color** dimension, from `series.colorGrading.column` in `'distinct'` mode
 *    (e.g. batch → red/blue/green).
 *
 * **The color set is derived per-symbol, not globally.** Each symbol category only produces
 * rows for the colors that actually occur among *its* data points. So if the "square" symbol's
 * rows are all blue while "diamond" has blue/orange/green, "square" yields one row and "diamond"
 * three — rather than every symbol getting the full color list.
 *
 * **Missing categories are first-class.** Data points whose filter or color value is null/blank
 * are grouped under {@link SymbolFactory.MISSING_CATEGORY} (shown to users as `(none)`) and get
 * their own symbol and/or color row, instead of silently using the series default.
 *
 * When the series has no symbol map, the symbol dimension collapses to a single (null) entry;
 * when color grading is not active, the color dimension collapses to the single series color.
 *
 * @param {Object} series - Series configuration (uses `filterColumn`, `colorGrading`, `color`/`seriesColor`).
 * @param {Array<Object>} filteredData - Data rows already scoped to this series (used to derive
 *   the per-symbol distinct color values and build the color scale).
 * @param {Map<string|number, Object>|null} symbolMap - Pre-built value→d3-symbol map for the
 *   filter/symbol dimension, or `null` when the series has no per-symbol encoding.
 * @returns {Array<{symbolValue: (string|number|null), symbolType: Object, colorValue: (string|number|null), colorColumn: string, color: string}>}
 *   One entry per (symbol, occurring-color) combination.
 */
export const getDistinctSeriesColors = (series, filteredData, symbolMap = null) => {
    const rows = [];
    const seriesColor = ScaleFactory.resolveColor(series.color || series.seriesColor) || '#333';

    // ── Symbol dimension ──────────────────────────────────────────────────────────────
    // Collapse to a single null entry when there is no symbol map, so the cross-product
    // below still runs once per color.
    const filterColumn = series.filterColumn ? parseColumnId(series.filterColumn).columnName : '';
    const symbolEntries = symbolMap
        ? [...symbolMap.entries()]
        : [[null, symbolCircle]];

    // ── Color dimension ───────────────────────────────────────────────────────────────
    // Build the color scale once over the whole series; the set of colors that actually
    // *occur* is then computed per-symbol inside the loop below.
    const grading = series.colorGrading;
    let colorColumn = '';
    let colorScale = null;
    if (grading?.enabled && grading.column) {
        const colorInfo = parseColumnId(grading.column);
        colorColumn = colorInfo.columnName || '';
        colorScale = ScaleFactory.createColorScale(
            filteredData,
            colorInfo,
            grading.scheme || 'warm-cool',
            grading.categoryColors || {}
        );
        if (!colorColumn) colorScale = null;
    }

    // ── Cross-product (color set derived per-symbol) ───────────────────────────────────
    for (const [symbolValue, symbolType] of symbolEntries) {
        // Scope to the rows carrying this symbol value so colors are derived from this
        // symbol's points only. `symbolValue === null` (no symbol encoding) keeps all rows.
        const symbolRows = (symbolValue === null || !filterColumn)
            ? filteredData
            : filteredData.filter(d => SymbolFactory.normalizeCategory(d[filterColumn]) === symbolValue);

        if (colorScale && colorColumn) {
            // Distinct colors occurring among THIS symbol's rows (missing → (none)).
            const occurringColors = [...new Set(
                symbolRows.map(d => SymbolFactory.normalizeCategory(d[colorColumn]))
            )];

            if (occurringColors.length > 0) {
                occurringColors.forEach(colorValue => {
                    rows.push({
                        symbolValue,
                        symbolType,
                        colorValue,
                        colorColumn,
                        // The missing-category sentinel has no scale entry — use the shared
                        // neutral "(none)" color so it matches the plot.
                        color: colorValue === SymbolFactory.MISSING_CATEGORY
                            ? SymbolFactory.MISSING_COLOR
                            : colorScale(colorValue)
                    });
                });
                continue;
            }
        }

        // No color grading (or this symbol has no rows) → single row, series color.
        rows.push({
            symbolValue,
            symbolType,
            colorValue: null,
            colorColumn: '',
            color: seriesColor
        });
    }

    return rows;
};