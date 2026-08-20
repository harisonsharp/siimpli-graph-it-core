/**
 * @fileoverview Renders a unified table combining legend markers, series names, and recent/selected values.
 * Provides a consolidated view distinct from separate legends and data tables.
 *
 * The unified table is drawn below the graph and displays one row per data series. Each row
 * shows the series' visual marker (line swatch, scatter symbol, or bar rectangle), its label,
 * and the Y-value at the currently selected — or most recent — X position. When `dualUnits`
 * is enabled a second converted-value column is appended to the right.
 *
 * Categorical scatter series (those using a `filterColumn` for per-category symbol encoding)
 * are expanded into one sub-row per unique category value, each with its own D3 symbol and its
 * own independent value lookup scoped to the filtered data for that category.
 *
 * @author Harison Sharp
 * @since 0.4.0
 *
 * @module Unified Table Renderer
 * @type {Renderer}
 *
 * @requires d3
 * @requires ScaleFactory
 * @requires SymbolFactory
 *
 * @exports UnifiedTableRenderer
 */
import * as d3 from 'd3';
import { ScaleFactory } from './ScaleFactory.js';
import { SymbolFactory } from '../utils/SymbolFactory.js';
import { debugLog } from '../utils/debug.js';
import { CanvasSizer } from '../services/CanvasSizer.js';
import { parseColumnId} from '../utils/columnUtils.js';
import { getDistinctSeriesColors } from '../utils/colorUtils.js';
/**
 * Renders a unified table combining legend markers, series names, and values.
 * This provides a single cohesive table instead of separate legend and data table.
 *
 * All methods are static — this class is used as a pure rendering namespace and is never
 * instantiated. All state flows in through method arguments; nothing is mutated on the class.
 *
 * Rendered table structure:
 * ```
 * ┌──────────────────────────────────────────────────┐
 * │  Legend & Most Recent Values          Date: …    │
 * ├────────┬───────────────────┬───────────┬─────────┤
 * │        │ Series            │ Value     │[Converted]
 * ├────────┼───────────────────┼───────────┼─────────┤
 * │   ●    │ Copper            │ 4.25      │[…]      │
 * │   ──   │ Zinc trend        │ 2.10      │[…]      │
 * │   ■    │ Lead (bar)        │ 1.80      │[…]      │
 * └────────┴───────────────────┴───────────┴─────────┘
 * ```
 *
 * When one categorical series is expanded per category, its name is the same on every row,
 * so the Series column collapses into the category column and the categories take its place:
 * ```
 * ┌──────────────────────────────────────────────┐
 * │  Legend & Most Recent Values   Across: n=138 │
 * ├────────┬──────────────────────┬──────────────┤
 * │        │ DepositCode          │ Median, %    │
 * ├────────┼──────────────────────┼──────────────┤
 * │   ●    │ VMS                  │ 4.10         │
 * │   ▲    │ Epithermal vein      │ 5.35         │
 * │   ──   │ Model: 1.53 × head   │ 4.56         │
 * └────────┴──────────────────────┴──────────────┘
 * ```
 */
export class UnifiedTableRenderer {
    /**
     * Shared layout constants. Kept in one place so font-size, character-width estimate,
     * and column padding stay consistent between width-fitting and text truncation.
     */
    static LAYOUT = {
        /** Body text size, in px. Header labels use a smaller size set inline. */
        fontSizePx: 9,
        /**
         * Approximate rendered width of one character at {@link LAYOUT.fontSizePx} in the
         * sans-serif body font. Used by {@link UnifiedTableRenderer.fitToContent} to convert
         * character counts into pixel widths without measuring the DOM. ~0.6em is a good
         * average for proportional sans-serif.
         */
        charPx: 5,
        /** Horizontal breathing room added to every content-fitted column, in px. */
        columnPaddingPx: 12,
    };

    /**
     * Builds a content-fitted column width: the longest displayed string across the given rows,
     * in characters, converted to pixels and padded. Use this as a column's `width` (in place of
     * a fixed number) to make the column grow to fit its content.
     *
     * The result is clamped to `[min, max]` so a single very long value can't blow out the table
     * and an empty column still reserves a sensible minimum.
     *
     * @param {Array<Object>} rows - The row descriptors to measure (only `type === 'series'` rows count).
     * @param {(row: Object) => (string|number|null|undefined)} accessor - Extracts the cell text from a row.
     * @param {Object} [opts]
     * @param {number} [opts.min=40] - Minimum width in px.
     * @param {number} [opts.max=240] - Maximum width in px (longer text is truncated when rendered).
     * @param {string} [opts.header] - Optional header label to also factor into the width.
     * @returns {number} The resolved pixel width.
     */
    static fitToContent(rows, accessor, { min = 40, max = 240, header = '' } = {}) {
        const { charPx, columnPaddingPx } = UnifiedTableRenderer.LAYOUT;
        let longest = header ? header.length : 0;
        for (const row of rows) {
            if (row.type !== 'series') continue;
            const raw = accessor(row);
            const len = (raw === null || raw === undefined) ? 0 : String(raw).length;
            if (len > longest) longest = len;
        }
        const px = longest * charPx + columnPaddingPx;
        return Math.max(min, Math.min(max, px));
    }

    /**
     * Main entry point — draws the unified legend+value table onto the SVG.
     *
     * Orchestrates the full rendering pipeline:
     * 1. Guard-checks feature flags and required data; returns early if table is disabled.
     * 2. Calls `_prepareRowData` to resolve the Y-value for every series at the target X.
     * 3. Calls `_calculateTablePosition` to place the table below the graph area.
     * 4. Removes any existing `.unified-table-group` to prevent stacking on re-render.
     * 5. Appends a new group and delegates all visual rendering to `_drawTableContent`.
     *
     * @param {d3.Selection} svg - The root SVG element to draw into.
     * @param {Array<Object>} validData - Filtered, non-null data rows from the loaded dataset.
     * @param {Object} columnInfo - Parsed column descriptor.
     * @param {Object} columnInfo.xAxisInfo - X-axis metadata; must include `columnName`.
     * @param {Array<Object>} columnInfo.seriesInfo - One entry per Y-axis series to render.
     * @param {Object} scales - Active D3 scale instances.
     * @param {d3.Scale} scales.xScale - The X-axis scale (numeric or time).
     * @param {d3.Scale} scales.yScale - The primary Y-axis scale.
     * @param {d3.ScaleOrdinal} scales.seriesColorScale - Maps series column names to colours.
     * @param {Object} graphConfig - Full graph configuration object from ConfigContext.
     * @param {string} [graphConfig.xAxisLabel] - Display label for the X axis.
     * @param {string} [graphConfig.yAxisLabel] - Display label for the primary Y axis;
     *   parenthesised units (e.g. `"Price (USD)"`) are extracted for the column header.
     * @param {boolean} [graphConfig.dualUnits] - When `true`, a second converted-value column is shown.
     * @param {string} [graphConfig.fromUnits] - Unit label for the primary value column.
     * @param {string} [graphConfig.toUnits] - Unit label for the converted value column.
     * @param {number} [graphConfig.scaleFactor] - Divisor applied to convert primary → secondary units.
     * @param {'value'|'median'} [graphConfig.unifiedValueMode] - What the value column holds.
     *   `'value'` (default) is the Y at the selected/most-recent X; `'median'` is each row's own
     *   median over its data, which on a categorical scatter summarises the category instead of
     *   showing one arbitrary point from it. `selectedXValue` plays no part in `'median'` mode.
     * @param {boolean} [graphConfig.keepSeriesColumn] - Forces the Series column to render even
     *   when every categorical row repeats one series name (see the collapse in `_drawTableContent`).
     * @param {Object} globalSettings - Runtime interaction state.
     * @param {boolean} globalSettings.showUnifiedTable - Feature flag; `false` suppresses the table entirely.
     * @param {number|Date|null} globalSettings.selectedXValue - X position from a mouse hover/click event.
     *   When `null` or `undefined`, the table defaults to the most-recent data point.
     * @param {Object} dimensions - Layout measurements for the current render.
     * @param {number} dimensions.width - Inner chart width (excluding margins).
     * @param {number} dimensions.height - Inner chart height (excluding margins).
     * @param {Object} dimensions.margin - `{ top, right, bottom, left }` margin pixel values.
     * @returns {number} The table's rendered width in px (0 when the table is suppressed), for
     *   callers that place content to its right.
     */
    static drawUnifiedTable(
        svg,
        validData,
        columnInfo,
        scales,
        graphConfig,
        globalSettings,
        dimensions
    ) {
        const { selectedXValue, showUnifiedTable } = globalSettings;
        const { seriesInfo, xAxisInfo } = columnInfo;
        const { seriesColorScale } = scales;

        if (!showUnifiedTable || !seriesInfo || seriesInfo.length === 0) {
            return 0;
        }

        debugLog('[UnifiedTableRenderer.drawUnifiedTable] Start of method', 
            'svg: ',            svg,
            'validData: ',      validData,
            'columnInfo: ',     columnInfo,
            'scales: ',         scales,
            'graphConfig: ',    graphConfig,
            'globalSettings: ', globalSettings,
            'dimensions: ',     dimensions
        );

        // Prepare data for each series row
        const rowData = this._prepareRowData(
            validData,
            seriesInfo,
            xAxisInfo,
            scales,
            selectedXValue,
            graphConfig
        );

        // Calculate table position (below the graph, to the right)
        const { x: tableX, y: tableY } = this._calculateTablePosition(
            dimensions,
            graphConfig,
            columnInfo
        );

        // Tear down any previously rendered table so re-renders don't stack elements.
        svg.selectAll('.unified-table-group').remove();

        // Create the container group and position it within the SVG.
        const tableGroup = svg.append('g')
            .attr('class', 'unified-table-group')
            .attr('transform', `translate(${tableX}, ${tableY})`);

        // Draw the table, and hand back the width it actually came out at. Callers that
        // place something to the RIGHT of this table (BiasTableRenderer) otherwise have to
        // guess it — and a guess goes wrong the moment a column auto-fits differently or
        // the Series column collapses away.
        return this._drawTableContent(tableGroup, rowData, seriesInfo, seriesColorScale, graphConfig);
    }

    /**
     * Resolves the display value for every series at the target X position and assembles
     * the ordered list of row descriptors consumed by `_drawTableContent`.
     *
     * **Value lookup algorithm:**
     * The dataset is sorted ascending by X, then a D3 bisector locates the insertion point for
     * `targetX`. From that index the code walks *backwards*, skipping `null`, `undefined`, and
     * `NaN` entries, returning the first valid Y it finds. This "most-recent non-null" strategy
     * handles sparse scientific datasets where instruments may stop reporting without closing
     * the series — showing the last known reading is more useful than showing a gap.
     *
     * **Categorical scatter expansion:**
     * When a series has a `filterColumn` and `SymbolFactory.shouldUseUniqueSymbolEncoding`
     * returns `true`, the series is expanded into one sub-row per unique category value. Each
     * sub-row gets its own D3 symbol and runs an independent value lookup against the subset of
     * rows filtered to that category.
     *
     * **Row types returned:**
     * - `'header'` — always index 0; carries the X-axis label and formatted X value.
     * - `'series'` — one per series (or one per category for categorical scatter series).
     *
     * @private
     * @param {Array<Object>} validData - All non-null dataset rows.
     * @param {Array<Object>} seriesInfo - Series descriptors from `columnInfo.seriesInfo`.
     * @param {Object} xAxisInfo - X-axis column descriptor; must include `columnName`.
     * @param {Object} scales - Active scale instances; `seriesColorScale` is used for fallback colours.
     * @param {number|Date|null} selectedXValue - Target X from hover/click state.
     *   `null` or `undefined` defaults to the last point in sorted order.
     * @param {Object} graphConfig - Graph configuration; used for axis label fallbacks.
     * @returns {Array<Object>} Ordered row descriptors:
     *   - Header: `{ type: 'header', label, value, color }`
     *   - Series: `{ type: 'series', label, value, color, graphType, lineStyle, strokeWidth, symbolType }`
     */
    static _prepareRowData(validData, seriesInfo, xAxisInfo, scales, selectedXValue, graphConfig) {
        const xCol = xAxisInfo.columnName;
        const { seriesColorScale, xScale } = scales;
        debugLog('UnifiedTableRenderer.prepareRowData - Start of method',
            'validData: ', validData,
            'seriesInfo: ', seriesInfo,
            'xAxisInfo: ', xAxisInfo,
            'scales: ', scales,
            'selectedXValue: ', selectedXValue,
            'graphConfig: ', graphConfig);

        // Sorting is required for D3's bisector to produce correct insertion indices.
        const sortedData = [...validData].sort((a, b) => +a[xCol] - +b[xCol]);

        // `bisector(...).left` returns the index at which `targetX` would be inserted to
        // maintain sorted order, i.e. the first element with value >= targetX.
        const bisectDate = d3.bisector(d => +d[xCol]).left;

        // Fall back to the last data point when no hover/selection is active.
        let targetX = selectedXValue;
        if (targetX === null || targetX === undefined) {
            if (sortedData.length > 0) {
                targetX = +sortedData[sortedData.length - 1][xCol];
                debugLog('[UnifiedTableRenderer] Using most recent X value', {
                    targetX,
                    sortedData: sortedData[sortedData.length - 1],
                    xCol: xCol
                });
            }
        }

        const rows = [];

        // `unifiedValueMode: 'median'` replaces the at-x lookup with a per-row median over
        // that row's own data (see _medianOf). The x position then plays no part in any
        // value shown, so the header states the sample the medians are taken over instead
        // of an x that no longer means anything.
        const useMedian = graphConfig.unifiedValueMode === 'median';

        // X values arrive as Dates on time axes, but targetX is coerced to a
        // number (epoch ms) for bisection — restore the Date so the header
        // formats as a date instead of e.g. "1756710000000.00".
        const xIsDate = sortedData.length > 0 &&
            sortedData[sortedData.length - 1][xCol] instanceof Date;

        // Header row with X value
        rows.push({
            type: 'header',
            label: useMedian ? 'Across' : (graphConfig.xAxisLabel || xCol),
            value: useMedian
                ? `all ${sortedData.length} reports`
                : (xIsDate && typeof targetX === 'number' && isFinite(targetX)
                    ? new Date(targetX)
                    : targetX),
            color: '#333'
        });
        
        // Series rows
        graphConfig.series.forEach((series, index) => {
            const columnFileObject = parseColumnId(series.yAxis);
            const yCol = columnFileObject.columnName;
            
            // Prefer color scale, fall back to single color
            const seriesColor = seriesColorScale 
                                ? seriesColorScale(yCol) 
                                : ScaleFactory.resolveColor(series.color);
            
            // Determine whether this series uses per-category symbol encoding.
            // `filterColumn` may carry axis-assignment metadata after '::' — strip that suffix.
            const filterColumnFileObject = parseColumnId(series.filterColumn);
            const filterColumn = filterColumnFileObject.columnName;            
            let uniqueValues = [];
            if (filterColumn && SymbolFactory.shouldUseUniqueSymbolEncoding(series)) {
                uniqueValues = SymbolFactory.getUniqueValues(validData, filterColumn);
            }

            // Optionally remove the missing-value group (getUniqueValues now folds
            // null/blank into the MISSING_CATEGORY sentinel rather than dropping them).
            if (series.excludeEmptyValues) {
                uniqueValues = uniqueValues.filter(v => v !== SymbolFactory.MISSING_CATEGORY);
            }

            // Build the category → D3-symbol mapping once, shared across all sub-rows.
            const symbolMap = uniqueValues.length > 0 ? SymbolFactory.getSymbolMap(uniqueValues) : null;
            
            const colorGrading = series.colorGrading?.enabled ? series.colorGrading : null;
            const isDistinctColor = colorGrading && colorGrading.mode === 'distinct';

            if (series.graphType === 'scatter' && isDistinctColor) {
                // ── Categorical scatter with distinct colour grading ──────────────────
                // Expand into the (symbol × distinct-colour) cross-product. Each combination
                // is an independent mini-series: data is scoped to rows matching BOTH the
                // symbol category and the colour category, then the backward-scan lookup runs
                // on that subset for the per-combination most-recent value.
                const colorColumnFileObject = parseColumnId(colorGrading.column);
                const colorColumn = colorColumnFileObject.columnName;

                const distinctRows = getDistinctSeriesColors(series, validData, symbolMap);
                distinctRows.forEach(({ symbolValue, symbolType, colorValue, color }) => {
                    // Match via normalized categories so the (none) sentinel lines up with
                    // the actual null/blank rows in the data.
                    const filteredData = sortedData.filter(d =>
                        (symbolValue === null ||
                            SymbolFactory.normalizeCategory(d[filterColumn]) === symbolValue) &&
                        (colorValue === null || !colorColumn ||
                            SymbolFactory.normalizeCategory(d[colorColumn]) === colorValue)
                    );
                    const row = this._newFunction(
                        targetX, filteredData, xCol, yCol, series,
                        this._categoryLabel(symbolValue), this._categoryLabel(colorValue), color, symbolType
                    );
                    if (useMedian) row.value = this._medianOf(filteredData, yCol);
                    rows.push(row);
                });
            } else if (series.graphType === 'scatter' && uniqueValues.length > 0 && symbolMap) {
                // ── Categorical scatter: one sub-row per unique filter value ──────────
                // Each category is treated as an independent mini-series: data is filtered
                // to only rows matching that category, then the backward-scan lookup is
                // applied to the filtered subset to get the per-category most-recent value.
                uniqueValues.forEach(uniqueVal => {
                    const filteredData = sortedData.filter(d =>
                        SymbolFactory.normalizeCategory(d[filterColumn]) === uniqueVal);
                    const row = this._newFunction(
                        targetX, filteredData, xCol, yCol, series,
                        this._categoryLabel(uniqueVal), null, seriesColor,
                        SymbolFactory.getSymbol(uniqueVal, symbolMap)
                    );
                    if (useMedian) row.value = this._medianOf(filteredData, yCol);
                    rows.push(row);
                });
            } else {
                // ── Standard series: single row, full-dataset value lookup ────────────
                let foundVal = null;

                if (targetX !== null && targetX !== undefined && !useMedian) {
                    const i = bisectDate(sortedData, targetX, 1);
                    let scanIdx = Math.min(i, sortedData.length - 1);

                    // Step back if the bisector overshot targetX.
                    while (scanIdx >= 0 && +sortedData[scanIdx][xCol] > targetX) {
                        scanIdx--;
                    }

                    // Walk backwards to find the most-recent non-null Y value.
                    for (let k = scanIdx; k >= 0; k--) {
                        const d = sortedData[k];
                        if (d[yCol] !== undefined && d[yCol] !== null && !isNaN(+d[yCol])) {
                            foundVal = d[yCol];
                            break;
                        }
                    }
                }

                rows.push({
                    type: 'series',
                    label: series.titleName || yCol,
                    value: useMedian
                        ? this._medianOf(sortedData, yCol)
                        : (foundVal !== null ? foundVal : 'N/A'),
                    color: seriesColor,
                    graphType: series.graphType || 'scatter',
                    lineStyle: series.lineStyle || 'solid',
                    strokeWidth: series.strokeWidth || 2,
                    // Non-scatter types don't need a symbol; use circle as the scatter default.
                    symbolType: series.graphType === 'scatter' ? d3.symbolCircle : null
                });
            }
        });

        return rows;
    }

    /**
     * Builds a single expanded scatter sub-row: scopes the value lookup to `filteredData`
     * (already filtered to this symbol/colour combination by the caller) and assembles the
     * renderable row descriptor.
     *
     * @private
     * @param {number|Date|null} targetX - Target X for the most-recent-value lookup.
     * @param {Array<Object>} filteredData - Sorted data scoped to this symbol×colour combination.
     * @param {string} xCol - X-axis column name.
     * @param {string} yCol - Y-axis column name.
     * @param {Object} series - Owning series config (for label, lineStyle, strokeWidth).
     * @param {string|number|null} symbolValue - The filter/symbol category value (label suffix).
     * @param {string|number|null} colorValue - The distinct-colour category value (label suffix), or null.
     * @param {string} color - Pre-resolved colour for this row.
     * @param {Object} symbolType - Pre-resolved D3 symbol type for this row.
     * @returns {Object} A `'series'` row descriptor for `_drawTableContent`.
     */
    /**
     * Median of a column over the given rows, ignoring non-numeric cells.
     *
     * This is the value the table shows in `unifiedValueMode: 'median'`. The default mode
     * answers "what did the LAST report at or below the selected x say" — one raw data
     * point, which on a dense categorical scatter is noise rather than a summary. The
     * median answers "what does this category typically do", which is the number a reader
     * actually wants beside a category's own marker.
     *
     * Median rather than mean on purpose: these are metallurgical percentages with long
     * upper tails (a single 40% mass pull would drag a mean well off the body of the data).
     *
     * @private
     * @param {Array<Object>} rows - Rows already scoped to one category (or the full set).
     * @param {string} yCol - Column to summarise.
     * @returns {number|'N/A'} The median, or `'N/A'` when the column has no numeric values.
     */
    static _medianOf(rows, yCol) {
        const vals = [];
        for (const d of rows ?? []) {
            const v = d?.[yCol];
            if (v === null || v === undefined || v === '') continue;
            const n = +v;
            if (!isNaN(n)) vals.push(n);
        }
        if (vals.length === 0) return 'N/A';
        vals.sort((a, b) => a - b);
        const mid = vals.length >> 1;
        return vals.length % 2 ? vals[mid] : (vals[mid - 1] + vals[mid]) / 2;
    }

    /**
     * Maps a raw category value to its display label, rendering the shared missing-category
     * sentinel as the human-readable `(none)`. Returns `null`/`undefined` unchanged so callers
     * can still suppress absent dimensions.
     * @private
     * @param {string|number|null|undefined} value
     * @returns {string|number|null|undefined}
     */
    static _categoryLabel(value) {
        return value === SymbolFactory.MISSING_CATEGORY ? SymbolFactory.MISSING_LABEL : value;
    }

    /**
     * Resolves the full column id backing a category dimension, from the first series that
     * defines it. For the symbol dimension pass `'filterColumn'`; for the colour dimension pass
     * `'colorGrading'` (its `.column` sub-field is read).
     *
     * The id is returned unparsed — file suffix included — so two dimensions are only treated
     * as the same source when they name the same column of the same dataset (two datasets can
     * each carry a `DepositCode` that means something different).
     *
     * @private
     * @param {Object} graphConfig - Graph configuration with a `series` array.
     * @param {'filterColumn'|'colorGrading'} kind - Which dimension's column to resolve.
     * @returns {string|null} The raw column id, or null when no series defines that dimension.
     */
    static _firstColumnId(graphConfig, kind) {
        for (const series of (graphConfig.series || [])) {
            const raw = kind === 'colorGrading'
                ? (series.colorGrading?.enabled ? series.colorGrading.column : null)
                : series.filterColumn;
            if (raw && parseColumnId(raw).columnName) return raw;
        }
        return null;
    }

    /**
     * Resolves the display name for a category column header from the first series that defines it.
     * For the symbol dimension pass `'filterColumn'`; for the colour dimension pass `'colorGrading'`
     * (its `.column` sub-field is read). Returns `null` when no series defines that dimension.
     *
     * @private
     * @param {Object} graphConfig - Graph configuration with a `series` array.
     * @param {'filterColumn'|'colorGrading'} kind - Which dimension's column name to resolve.
     * @returns {string|null} The bare column name (file suffix stripped), or null.
     */
    static _firstColumnName(graphConfig, kind) {
        const raw = this._firstColumnId(graphConfig, kind);
        return raw ? parseColumnId(raw).columnName : null;
    }

    static _newFunction(targetX, filteredData, xCol, yCol, series, symbolValue, colorValue, color, symbolType) {
            debugLog('UnifiedTableRenderer.newFunction - Start of method', {
                targetX, filteredData, xCol, yCol, series, symbolValue, colorValue, color, symbolType
            });

            let foundVal = null;
            if (targetX !== null && targetX !== undefined && filteredData.length > 0) {
                // A fresh bisector scoped to the filtered subset.
                const filteredBisect = d3.bisector(d => +d[xCol]).left;
                const i = filteredBisect(filteredData, targetX, 1);
                let scanIdx = Math.min(i, filteredData.length - 1);

                // The bisector may land one position past targetX — step back if so.
                while (scanIdx >= 0 && +filteredData[scanIdx][xCol] > targetX) {
                    scanIdx--;
                }

                // Walk backwards to find the most-recent non-null Y for this category.
                for (let k = scanIdx; k >= 0; k--) {
                    const d = filteredData[k];
                    if (d[yCol] !== undefined && d[yCol] !== null && !isNaN(+d[yCol])) {
                        foundVal = d[yCol];
                        break;
                    }
                }
            }

        // The series name stays in its own column; the symbol/colour categories are surfaced
        // in dedicated Filter/Color columns by _drawTableContent.
        const toText = v => (v === null || v === undefined || v === '') ? '' : String(v);

        return {
            type: 'series',
            label: series.titleName || yCol,
            filterLabel: toText(symbolValue),
            colorLabel: toText(colorValue),
            value: foundVal !== null ? foundVal : 'N/A',
            color,
            graphType: 'scatter',
            lineStyle: series.lineStyle || 'solid',
            strokeWidth: series.strokeWidth || 2,
            symbolType: symbolType || d3.symbolCircle
        };
    }

    /**
     * Calculates the top-left pixel position of the table within the SVG coordinate space.
     *
     * The table is placed below the main chart area, inset 20 px from the left margin.
     * Vertical position accounts for the top margin plus the full chart height, then adds a
     * fixed 40 px gap to clear the bottom axis ticks and their labels.
     *
     * Note: `hasSecondaryAxis` is computed but currently unused in the returned coordinates.
     * It is retained as a hook for future layout logic that may push the table rightward
     * when a secondary Y-axis label is present and increases the right-margin width.
     *
     * @private
     * @param {Object} dimensions - SVG layout measurements.
     * @param {number} dimensions.width - Inner chart width.
     * @param {number} dimensions.height - Inner chart height.
     * @param {Object} dimensions.margin - `{ top, right, bottom, left }` margin pixel values.
     * @param {Object} graphConfig - Graph configuration; inspected for `series` and `dualUnits`.
     * @param {Object} columnInfo - Column descriptor (reserved for future use).
     * @returns {{ x: number, y: number }} Pixel coordinates for the table's top-left corner,
     *   relative to the SVG origin.
     */
    static _calculateTablePosition(dimensions, graphConfig, columnInfo) {
        // Reserved for future horizontal offset logic when a secondary axis label is present.
        debugLog('UnifiedTableRenderer.calculateTablePosition - Start of method', {
            dimensions,
            graphConfig,
            columnInfo
        });

        const hasSecondaryAxis = graphConfig.series &&
            (graphConfig.series.some(s => s.axisAssignment === 'secondary') || graphConfig.dualUnits);

        const legendX = dimensions.margin.left + 20;

        // Place the table below the chart area with a 40 px clearance gap.
        const legendHeight = dimensions.margin.top + dimensions.height;
        const tableY = dimensions.margin.top + legendHeight + 40;

        return { x: legendX, y: tableY };
    }

    /**
     * Computes the perceptual brightness of a hex colour string using a simple RGB average.
     *
     * This is an intentional approximation — it does not apply gamma correction or use the
     * WCAG relative-luminance formula — but it is sufficient for a binary light/dark background
     * decision in small table cells. Values above ~128 are "light" backgrounds (use dark text);
     * values below are "dark" (use light text).
     *
     * @private
     * @param {string} hexColor - A 7-character hex colour string (e.g. `'#2563eb'`).
     *   Strings shorter than 7 characters (e.g. 3-digit shorthand `'#abc'`) return a neutral 128
     *   rather than throwing, to avoid crashes on malformed colour values.
     * @returns {number} An integer in [0, 255]: 0 = black, 255 = white.
     */
    static _getBrightness(hexColor) {
        if (!hexColor || hexColor.length < 7) return 128;
        const r = parseInt(hexColor.substring(1, 3), 16);
        const g = parseInt(hexColor.substring(3, 5), 16);
        const b = parseInt(hexColor.substring(5, 7), 16);
        return (r + g + b) / 3;
    }

    /**
     * Renders all visual elements of the table into the provided SVG group.
     *
     * **Column layout (pixel-based, built from a declarative column model):**
     * ```
     * x=10
     *  │←25px→│←─ 160px ─→│[← 90px →]│[← 90px →]│← 90px →│[← 90px →]
     *  │Marker│ Series     │[Filter] │[Color]   │ Value   │[Converted]
     * ```
     * The Filter (symbol) and Color columns are present only when some row carries that
     * dimension; the Value/Converted columns only when values are shown. X-positions are
     * accumulated once from the visible columns so absent columns close up the gap.
     * The background `<rect>` is appended *first* so it sits behind all text, but it is
     * sized *last* — after all rows have been drawn and `currentY` is final. D3 selections
     * are live references, so mutating `bg` after appending updates the already-existing DOM element.
     *
     * **Marker rendering by graph type:**
     * - `'line'` — a short 16 px horizontal `<line>` with the series dash pattern applied.
     *   `strokeWidth` is capped at 3 px so thick series lines don't overwhelm the marker cell.
     * - `'bar'` / `'histogram'` — a filled 12×12 `<rect>` colour swatch.
     * - All others (scatter default) — a D3 `<path>` using the series' assigned symbol type at size 64
     *   (roughly an 8×8 px bounding box).
     *
     * **Value formatting:**
     * - Numeric primary values: `toFixed(2)`.
     * - Numeric converted values: `toPrecision(4)` — appropriate because the converted magnitude
     *   may differ significantly from the primary, making a fixed decimal count misleading.
     * - Date X-values in the header row: formatted as `M/D/YYYY`.
     * - Missing values: displayed as the string `'N/A'`.
     *
     * **Dual-units column:**
     * When `graphConfig.dualUnits` is truthy, a second value column is rendered to the right of
     * the primary column. The converted value is `value / graphConfig.scaleFactor`.
     *
     * @private
     * @param {d3.Selection} group - The `<g>` element to render into (already translated to final position).
     * @param {Array<Object>} rowData - Ordered row descriptors from `_prepareRowData`.
     * @param {Array<Object>} seriesInfo - Raw series descriptors (unused here; retained for API symmetry).
     * @param {d3.ScaleOrdinal} seriesColorScale - Ordinal colour scale (unused here; colours are
     *   pre-resolved in `_prepareRowData` and stored on each row descriptor).
     * @param {Object} graphConfig - Graph configuration; inspected for `dualUnits`, `fromUnits`,
     *   `toUnits`, `scaleFactor`, `yAxisLabel`, `unifiedValueMode` and `keepSeriesColumn`.
     * @returns {number} The table's total rendered width in px.
     */
    static _drawTableContent(group, rowData, seriesInfo, seriesColorScale, graphConfig) {
        group.selectAll('*').remove();
        debugLog('UnifiedTableRenderer.drawTableContent - Start of method', {
            group,
            rowData,
            seriesInfo,
            seriesColorScale,
            graphConfig
        });
        
        

        // ── Column model ──────────────────────────────────────────────────────────────
        // Columns are described declaratively, then x-positions are accumulated once.
        // Everything downstream references colX(key) / colW(key) instead of hand-summing
        // offsets, so adding/removing columns can't drift the layout.
        //
        // A column's `width` may be either:
        //   • a number               → fixed pixel width, or
        //   • (rows) => number       → computed width; use `fitToContent(...)` to size the
        //                              column to its longest entry (+ padding, clamped).
        const showValues = !graphConfig.ignoreUnifiedValues;

        // The Filter (symbol) and Color columns appear only when at least one data row actually
        // carries that dimension — ordinary series shouldn't show two empty columns.
        const hasFilterCol = rowData.some(r => r.type === 'series' && r.filterLabel);

        // A template may drive BOTH dimensions from one column — e.g. DepositCode giving each
        // deposit type its own symbol AND its own colour — which is a legitimate encoding, not a
        // mistake to correct in the template. But the two columns then print the same category
        // twice side by side (getDistinctSeriesColors derives colours per symbol group, so the
        // rows pair up one-to-one). Collapse them into the single Filter column when they resolve
        // to the same source; the colour itself is still shown, by the row's marker.
        const symbolColumnId = this._firstColumnId(graphConfig, 'filterColumn');
        const colorColumnId = this._firstColumnId(graphConfig, 'colorGrading');
        const sameCategoryColumn = !!symbolColumnId && symbolColumnId === colorColumnId;
        const hasColorCol = rowData.some(r => r.type === 'series' && r.colorLabel)
            && !(sameCategoryColumn && hasFilterCol);

        // Header text for the two category columns: the underlying column names from the first
        // series that defines them, falling back to generic labels.
        const filterHeader = this._firstColumnName(graphConfig, 'filterColumn') || 'Filter';
        const colorHeader = this._firstColumnName(graphConfig, 'colorGrading') || 'Color';

        // Same argument as the Filter/Colour collapse above, one column further left. On a
        // chart whose only categorical series is expanded per category, EVERY category row
        // repeats the one series name — "PbFlotStMP" printed once per deposit type — beside
        // the column carrying the actual information. That name is already the y-axis label,
        // so the column is pure repetition and the categories move into its place. Rows that
        // carry no category (a plotted advice line, a trend series) keep their own label
        // there, so nothing ends up unlabelled. Only collapses when the repetition is real:
        // two differently-named series put their names back in their own column.
        // `keepSeriesColumn: true` on the graph config opts out.
        const categoryRowLabels = new Set(
            rowData.filter(r => r.type === 'series' && r.filterLabel).map(r => r.label)
        );
        const collapseNameColumn = hasFilterCol && categoryRowLabels.size === 1
            && !graphConfig.keepSeriesColumn;
        // What the (possibly merged) category column actually prints for a row.
        const categoryText = row => (collapseNameColumn ? (row.filterLabel || row.label) : row.filterLabel);

        const fit = (accessor, opts) => rows => this.fitToContent(rows, accessor, opts);

        const columns = [
            { key: 'marker', width: 25, show: true },
            // Auto-fit the text columns to their content (header included), clamped so a long
            // value can't blow out the table. Swap any of these back to a fixed number if a
            // stable column width is preferred.
            { key: 'name',   width: fit(r => r.label,      { min: 80, max: 220, header: 'Series' }),      show: !collapseNameColumn },
            { key: 'filter', width: fit(categoryText,      { min: 60, max: 200, header: filterHeader }),  show: hasFilterCol },
            { key: 'color',  width: fit(r => r.colorLabel, { min: 60, max: 200, header: colorHeader }),   show: hasColorCol },
            { key: 'value',  width: 90, show: showValues },
            { key: 'value2', width: 90, show: showValues && !!graphConfig.dualUnits },
        ].filter(c => c.show);

        // Accumulate left edges (inside the 10 px left padding), resolving each width spec.
        const colMeta = {};
        let acc = 10;
        for (const c of columns) {
            const width = typeof c.width === 'function' ? c.width(rowData) : c.width;
            colMeta[c.key] = { x: acc, width };
            acc += width;
        }
        const colX = key => (colMeta[key]?.x ?? acc);
        const colW = key => (colMeta[key]?.width ?? 0);

        // Max characters that fit in a column's text area, derived from its resolved pixel width
        // so truncation always matches the actual column (no hand-tuned magic numbers).
        const colChars = key => Math.max(
            1,
            Math.floor((colW(key) - UnifiedTableRenderer.LAYOUT.columnPaddingPx) / UnifiedTableRenderer.LAYOUT.charPx)
        );

        // +10 trailing padding to mirror the 10 px leading padding.
        const totalWidth = acc + 10;

        // ── Background rect ───────────────────────────────────────────────────────────
        // Appended first so it renders behind all text, but sized at the end once the
        // final `currentY` is known (D3 selections are live references).
        const bg = group.append('rect')
            .attr('rx', 4)
            .attr('ry', 4)
            .style('fill', 'rgba(255, 255, 255, 0.95)')
            .style('stroke', '#999')
            .style('stroke-width', '1px');

        // `currentY` is the running vertical cursor — incremented as rows are drawn.
        let currentY = 10;

        // ── Table title ───────────────────────────────────────────────────────────────
        group.append('text')
            .attr('x', 10)
            .attr('y', 12)
            .style('font-family', 'sans-serif')
            .style('font-size', '11px')
            .style('font-weight', 'bold')
            .style('fill', '#666')
            .text(`Legend`, 
                graphConfig.ignoreUnifiedValues 
                    ? `` 
                    : `& Most Recent Values`
                ); 
                // if we ignore values, we aren't interested in the most recent values!

        currentY += 18;

        // ── Column header row ─────────────────────────────────────────────────────────
        const headerY = currentY + 10;

        // Small helper for the 8px grey column-header labels. `truncate` is on for content-fitted
        // columns (so a long column name can't overflow its clamped width); the value columns
        // are fixed-width with intentionally short headers, so they opt out.
        const headerText = (key, txt, truncate = true) => group.append('text')
            .attr('x', colX(key))
            .attr('y', headerY)
            .style('font-family', 'sans-serif')
            .style('font-size', '8px')
            .style('fill', '#999')
            .text(truncate ? this._truncateText(txt, colChars(key)) : txt);

        // Marker column header is intentionally blank.
        if (!collapseNameColumn) headerText('name', 'Series');
        if (hasFilterCol) headerText('filter', filterHeader);
        if (hasColorCol)  headerText('color', colorHeader);

        if (showValues){
            // Extract parenthesised units from the Y-axis label, e.g. "Gold Price (USD/oz)" → "USD/oz".
            const isLabelUnits = graphConfig.yAxisLabel.match(/\((.*?)\)/)
                ? true
                : false;
            const labelUnits = graphConfig.dualUnits
                ? `, ${graphConfig.fromUnits}`
                : isLabelUnits
                    ? `, ${graphConfig.yAxisLabel.match(/\((.*?)\)/)?.[1]}`
                    : ''
                ;

            // In median mode the column is no longer "the value at the selected x" — say so,
            // or a reader has no way to tell the two apart.
            const valueHeading = graphConfig.unifiedValueMode === 'median' ? 'Median' : 'Value';
            headerText('value', `${valueHeading}${labelUnits}`, false);

            // Converted-units header — only rendered when dual-unit mode is active.
            if (graphConfig.dualUnits) {
                headerText('value2', `Value, ${graphConfig.toUnits}`, false);
            }
        }

        currentY += 15;

        // ── Separator line between column headers and data rows ───────────────────────
        group.append('line')
            .attr('x1', 10)
            .attr('x2', totalWidth - 10)
            .attr('y1', currentY)
            .attr('y2', currentY)
            .style('stroke', '#ddd')
            .style('stroke-width', '1px');

        currentY += 5;

        // ── Data rows ─────────────────────────────────────────────────────────────────
        rowData.forEach((row) => {
            const rowY = currentY + 12;
            // Header row for the value column (missing if we ignore it)
            if ( row.type === 'header' ) {
                if(showValues){
                    // The header row is rendered at y=12 (aligned with the title bar), not at
                    // `rowY`, so the X-axis label and value appear inline with the table title.
                    // The `return` at the end skips `currentY += 18`, so header rows consume
                    // no vertical space in the data area. Anchored to the value column so it
                    // sits above the values regardless of which category columns are present.

                    const headerLabel = row.value instanceof Date
                        ? `Date:`
                        : `${row.label}:`;

                    const xValueFormatted = row.value instanceof Date
                        ? `${row.value.getMonth() + 1}/${row.value.getDate()}/${row.value.getFullYear()}`
                        : (typeof row.value === 'number'
                            ? row.value.toFixed(2)
                            : row.value
                        );

                    // The value is right-aligned at the end of the value column and the label
                    // ends just left of it, growing leftward into the empty strip between the
                    // table title and the value column. Truncation only kicks in if the label
                    // would reach back into the title, so a long x-axis label (e.g.
                    // "Gold Grade in Concentrate (g/t):") can't overprint the value or title.
                    const { charPx } = UnifiedTableRenderer.LAYOUT;
                    const valueEndX = colX('value') + colW('value') - 2;
                    const labelEndX = valueEndX - String(xValueFormatted).length * charPx - 8;
                    const titleClearanceX = 60; // right edge of the bold "Legend" title, plus a gap
                    const labelChars = Math.max(
                        1,
                        Math.floor((labelEndX - titleClearanceX) / charPx)
                    );

                    group.append('text')
                        .attr('x', labelEndX)
                        .attr('y', 12)
                        .attr('text-anchor', 'end')
                        .style('font-family', 'sans-serif')
                        .style('font-size', '9px')
                        .style('font-weight', 'bold')
                        .style('fill', '#333')
                        .text(this._truncateText(headerLabel, labelChars));

                    group.append('text')
                        .attr('x', valueEndX)
                        .attr('y', 12)
                        .attr('text-anchor', 'end')
                        .style('font-family', 'sans-serif')
                        .style('font-size', '9px')
                        .style('font-weight', 'bold')
                        .style('fill', '#333')
                        .text(xValueFormatted);

                }
                return;
            }

            // ── Marker glyph (left column) ────────────────────────────────────────────
            const markerX = colX('marker') + colW('marker') / 2;
            const markerY = rowY - 4;

            if (row.graphType === 'line') {
                // Map the series' lineStyle token to its SVG stroke-dasharray equivalent.
                let strokeDashArray = 'none';
                if (row.lineStyle === 'dashed') strokeDashArray = '5,3';
                else if (row.lineStyle === 'dotted') strokeDashArray = '2,2';
                else if (row.lineStyle === 'dash-dot') strokeDashArray = '5,2,2,2';

                // Cap stroke-width at 3 so very thick series lines don't overwhelm the marker cell.
                group.append('line')
                    .attr('x1', markerX - 8)
                    .attr('y1', markerY)
                    .attr('x2', markerX + 8)
                    .attr('y2', markerY)
                    .attr('stroke', row.color)
                    .attr('stroke-width', Math.min(row.strokeWidth, 3))
                    .attr('stroke-linecap', 'round')
                    .attr('stroke-dasharray', strokeDashArray);

            } else if (row.graphType === 'bar' || row.graphType === 'histogram') {
                // Solid filled rectangle acts as a colour swatch for bar/histogram series.
                group.append('rect')
                    .attr('x', markerX - 6)
                    .attr('y', markerY - 6)
                    .attr('width', 12)
                    .attr('height', 12)
                    .attr('fill', row.color);

            } else {
                // Scatter default: render the D3 symbol path.
                // Size 64 ≈ 8×8 px bounding box for most D3 symbol types.
                const symbolFn = d3.symbol()
                    .type(row.symbolType || d3.symbolCircle)
                    .size(64);

                group.append('path')
                    .attr('d', symbolFn)
                    .attr('transform', `translate(${markerX}, ${markerY})`)
                    .attr('fill', row.color)
                    .attr('stroke', '#0a0808ff')
                    .attr('stroke-width', 1);
            }

            // ── Series label (name column) ────────────────────────────────────────────
            // Truncation length is derived from the resolved column width, so it adapts when
            // the column auto-fits to content. Absent entirely when the column collapsed into
            // the category column — the label is drawn there instead, by categoryCell.
            if (!collapseNameColumn) {
                group.append('text')
                    .attr('x', colX('name'))
                    .attr('y', rowY)
                    .style('font-family', 'sans-serif')
                    .style('font-size', '9px')
                    .style('fill', '#333')
                    .text(this._truncateText(row.label, colChars('name')));
            }

            // ── Filter / Color category columns ───────────────────────────────────────
            // The (none) group is rendered in muted italic to read as "absent".
            const categoryCell = (key, text) => {
                if (!text) return;
                const isNone = text === SymbolFactory.MISSING_LABEL;
                group.append('text')
                    .attr('x', colX(key))
                    .attr('y', rowY)
                    .style('font-family', 'sans-serif')
                    .style('font-size', '9px')
                    .style('font-style', isNone ? 'italic' : 'normal')
                    .style('fill', isNone ? '#94a3b8' : '#475569')
                    .text(this._truncateText(text, colChars(key)));
            };
            if (hasFilterCol) categoryCell('filter', categoryText(row));
            if (hasColorCol)  categoryCell('color', row.colorLabel);

            // ── Primary value column ──────────────────────────────────────────────────
            if(showValues){
                const valueFormatted = row.value === 'N/A'
                    ? 'N/A'
                    : (typeof row.value === 'number' ? (row.value).toFixed(2) : row.value);

                group.append('text')
                    .attr('x', colX('value'))
                    .attr('y', rowY)
                    .style('font-family', 'sans-serif')
                    .style('font-size', '9px')
                    .style('font-weight', 'bold')
                    .style('fill', '#333')
                    .text(valueFormatted);

                // ── Converted value column (dual-units mode only) ─────────────────────────
                // `toPrecision(4)` rather than `toFixed(2)`: the converted magnitude may differ
                // significantly from the primary (e.g. CAD/USD rates vs. gold prices in oz),
                // making a fixed decimal place count inappropriate.
                const valueFormattedConverted = row.value === 'N/A'
                    ? 'N/A'
                    : (typeof row.value === 'number' ? (row.value / graphConfig.scaleFactor).toPrecision(4) : row.value);
                if (graphConfig.dualUnits) {
                    group.append('text')
                        .attr('x', colX('value2'))
                        .attr('y', rowY)
                        .style('font-family', 'sans-serif')
                        .style('font-size', '9px')
                        .style('font-weight', 'bold')
                        .style('fill', '#333')
                        .text(valueFormattedConverted);
                }
            }
            currentY += 18;
        });

        // Now that all rows have been drawn and `currentY` is final, size the background rect.
        bg.attr('width', totalWidth)
            .attr('height', currentY + 5);

        return totalWidth;
    }

    /**
     * Truncates a string to `maxLen` characters, appending an ellipsis (`…`) if shortened.
     *
     * Intended for clipping series labels that overflow the fixed-width name column in
     * `_drawTableContent`. Currently not called — available as a drop-in for the TODO noted
     * above once text-overflow handling is implemented.
     *
     * @private
     * @param {string} text - The input string to potentially truncate.
     * @param {number} maxLen - Maximum allowed character count, including the ellipsis character.
     * @returns {string} The original string if it fits within `maxLen`, otherwise a truncated
     *   version ending in `…` (U+2026, a single Unicode character occupying one of the `maxLen` slots).
     */
    static _truncateText(text, maxLen) {
        if (!text) return '';
        if (text.length <= maxLen) return text;
        return text.substring(0, maxLen - 2) + '…';
    }
}
