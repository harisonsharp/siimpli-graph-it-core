/**
 * @fileoverview Renders a unified table combining legend markers, series names, and recent/selected values.
 * Provides a consolidated view distinct from separate legends and data tables.
 *
 * The unified table is drawn below the graph and displays one row per data series. Each row
 * shows the series' visual marker (line swatch, scatter symbol, or bar rectangle), its label,
 * and the Y-value at the currently selected — or most recent — X position. When `dualUnits`
 * is enabled a second converted-value column is appended to the right.
 *
 * Categorical scatter series are expanded into sub-rows along two orthogonal axes:
 * per-category symbol encoding (`filterColumn` → distinct D3 symbols) and distinct color
 * grading (`colorGrading.mode === 'distinct'` → distinct fills from the same scale the
 * plotted points use). When both are active the table shows the cross-product of the two,
 * restricted to combinations present in the data; each sub-row runs an independent value
 * lookup scoped to its filtered subset.
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
 */
export class UnifiedTableRenderer {
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
     * @param {Object} globalSettings - Runtime interaction state.
     * @param {boolean} globalSettings.showUnifiedTable - Feature flag; `false` suppresses the table entirely.
     * @param {number|Date|null} globalSettings.selectedXValue - X position from a mouse hover/click event.
     *   When `null` or `undefined`, the table defaults to the most-recent data point.
     * @param {Object} dimensions - Layout measurements for the current render.
     * @param {number} dimensions.width - Inner chart width (excluding margins).
     * @param {number} dimensions.height - Inner chart height (excluding margins).
     * @param {Object} dimensions.margin - `{ top, right, bottom, left }` margin pixel values.
     * @returns {void}
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
            return;
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

        // Draw the table
        this._drawTableContent(tableGroup, rowData, seriesInfo, seriesColorScale, graphConfig);
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
     * A scatter series is expanded into sub-rows along two orthogonal axes:
     * - symbol encoding: `filterColumn` + `SymbolFactory.shouldUseUniqueSymbolEncoding` →
     *   one symbol per unique filter value;
     * - distinct color grading: `scales.seriesColorScales[i]` with `mode === 'distinct'` →
     *   one fill color per unique grading-column value.
     * With both active, one sub-row is emitted per (symbol × color) combination present in
     * the data, each running an independent value lookup against its filtered subset.
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

        // Header row with X value
        rows.push({
            type: 'header',
            label: graphConfig.xAxisLabel || xCol,
            value: targetX,
            color: '#333'
        });

        // Series rows
        seriesInfo.forEach((series, index) => {
            const yCol = series.yAxisInfo.columnName;

            // Prefer an explicit series colour; fall back to the ordinal colour scale.
            const seriesColor = ScaleFactory.resolveColor(series.color) ||
                (seriesColorScale ? seriesColorScale(yCol) : '#333');

            // ── Sub-group axes ─────────────────────────────────────────────────────
            // A scatter series can vary along two orthogonal axes, each expanding the
            // series into sub-rows:
            //   1. Symbol encoding — unique values of `filterColumn` → distinct symbols.
            //   2. Distinct color grading — unique values of the colorGrading column →
            //      distinct fills (same scale the scatter points use).
            // When both are active we emit the cross-product, restricted to
            // combinations actually present in the data (3 types × 3 colors → up to 9 rows).

            // `filterColumn` may carry axis-assignment metadata after '::' — strip that suffix.
            const filterColumn = series.filterColumn?.split('::')[0];
            let uniqueValues = [];
            if (series.graphType === 'scatter' && filterColumn && SymbolFactory.shouldUseUniqueSymbolEncoding(series)) {
                uniqueValues = SymbolFactory.getUniqueValues(validData, filterColumn);
            }

            // Optionally remove rows where the category value is blank or null.
            if (series.excludeEmptyValues) {
                uniqueValues = uniqueValues.filter(v => v !== undefined && v !== null && v !== '');
            }

            // Build the category → D3-symbol mapping once, shared across all sub-rows.
            const symbolMap = uniqueValues.length > 0 ? SymbolFactory.getSymbolMap(uniqueValues) : null;

            // Distinct color-grading categories (null unless this series has
            // colorGrading.mode === 'distinct' active).
            const grading = scales.seriesColorScales ? scales.seriesColorScales[index] : null;
            const categories = series.graphType === 'scatter'
                ? ScaleFactory.getDistinctGradingCategories(grading, validData)
                : null;

            const hasSymbols = symbolMap !== null;
            const hasCategories = categories !== null;

            if (!hasSymbols && !hasCategories) {
                // ── Standard series: single row, full-dataset value lookup ─────────
                const foundVal = this._findValueAtX(sortedData, xCol, yCol, targetX);
                rows.push({
                    type: 'series',
                    label: series.titleName || yCol,
                    value: foundVal !== null ? foundVal : 'N/A',
                    color: seriesColor,
                    graphType: series.graphType || 'scatter',
                    lineStyle: series.lineStyle || 'solid',
                    strokeWidth: series.strokeWidth || 2,
                    // Non-scatter types don't need a symbol; use circle as the scatter default.
                    symbolType: series.graphType === 'scatter' ? d3.symbolCircle : null
                });
                return;
            }

            // ── Sub-grouped scatter: one row per present (symbol × color) combination ──
            // Each combination is an independent mini-series: data is filtered to the
            // matching rows, then the backward-scan lookup runs on that subset.
            const symAxis = hasSymbols ? uniqueValues : [null];
            const colorAxis = hasCategories ? categories.values : [null];

            symAxis.forEach(symVal => {
                colorAxis.forEach(colVal => {
                    const filteredData = sortedData.filter(d =>
                        (symVal === null || d[filterColumn] === symVal) &&
                        (colVal === null || d[categories.columnName] === colVal)
                    );
                    // Skip combinations that never occur in the data.
                    if (filteredData.length === 0) return;

                    const foundVal = this._findValueAtX(filteredData, xCol, yCol, targetX);

                    const labelParts = [series.titleName || yCol];
                    if (symVal !== null) labelParts.push(String(symVal));
                    if (colVal !== null) labelParts.push(String(colVal));

                    rows.push({
                        type: 'series',
                        label: labelParts.join(' - '),
                        value: foundVal !== null ? foundVal : 'N/A',
                        color: colVal !== null ? categories.colorScale(colVal) : seriesColor,
                        graphType: 'scatter',
                        lineStyle: series.lineStyle || 'solid',
                        strokeWidth: series.strokeWidth || 2,
                        symbolType: symbolMap ? SymbolFactory.getSymbol(symVal, symbolMap) : d3.symbolCircle
                    });
                });
            });
        });

        return rows;
    }

    /**
     * Finds the most-recent non-null Y value at or before `targetX` in a sorted dataset.
     *
     * A D3 bisector locates the insertion point for `targetX`, the scan steps back past
     * any overshoot, then walks backwards skipping `null`/`undefined`/`NaN` entries.
     * This "most-recent non-null" strategy handles sparse scientific datasets where
     * instruments may stop reporting without closing the series.
     *
     * @private
     * @param {Array<Object>} sortedRows - Rows sorted ascending by the X column.
     * @param {string} xCol - X column name.
     * @param {string} yCol - Y column name.
     * @param {number|Date|null} targetX - Target X position.
     * @returns {*|null} The found Y value, or null when none qualifies.
     */
    static _findValueAtX(sortedRows, xCol, yCol, targetX) {
        if (targetX === null || targetX === undefined || sortedRows.length === 0) {
            return null;
        }

        const bisect = d3.bisector(d => +d[xCol]).left;
        const i = bisect(sortedRows, targetX, 1);
        let scanIdx = Math.min(i, sortedRows.length - 1);

        // The bisector may land one position past targetX — step back if so.
        while (scanIdx >= 0 && +sortedRows[scanIdx][xCol] > targetX) {
            scanIdx--;
        }

        // Walk backwards to find the most-recent non-null Y.
        for (let k = scanIdx; k >= 0; k--) {
            const d = sortedRows[k];
            if (d[yCol] !== undefined && d[yCol] !== null && !isNaN(+d[yCol])) {
                return d[yCol];
            }
        }
        return null;
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
     * **Fixed-width column layout (pixel-based):**
     * ```
     * x=10
     *  │← 25px →│←────── 160px ──────→│← 90px →│[← 90px →]
     *  │ Marker  │ Series name          │ Value   │[Converted]
     * ```
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
     *   `toUnits`, `scaleFactor`, and `yAxisLabel`.
     * @returns {void}
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
        
        

        // ── Column width constants ────────────────────────────────────────────────────
        // These are fixed pixel widths. A future enhancement could measure rendered text
        // and derive `nameColWidth` dynamically to avoid label overflow.
        const markerColWidth = 25;
        const nameColWidth = 160;
        // values only shown if not ignored
        const valueColWidth = graphConfig.ignoreUnifiedValues ? 0 : 90;
        let secondValueColWidth = 0;
        if (graphConfig.dualUnits && !graphConfig.ignoreUnifiedValues) {
            secondValueColWidth = 90;
        }
        // +20 accounts for 10 px of internal padding on each horizontal side.
        const totalWidth = markerColWidth + nameColWidth + valueColWidth + secondValueColWidth + 20;

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

        // Marker column - no text needed for header
        group.append('text')
            .attr('x', 10)
            .attr('y', headerY)
            .style('font-family', 'sans-serif')
            .style('font-size', '8px')
            .style('fill', '#999')
            .text('');

        group.append('text')
            .attr('x', 10 + markerColWidth)
            .attr('y', headerY)
            .style('font-family', 'sans-serif')
            .style('font-size', '8px')
            .style('fill', '#999')
            .text('Series');

        

        if (!graphConfig.ignoreUnifiedValues){
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
                
            group.append('text') // Value, units
                .attr('x', 10 
                    + markerColWidth 
                    + nameColWidth
                )
                .attr('y', headerY)
                .style('font-family', 'sans-serif')
                .style('font-size', '8px')
                .style('fill', '#999')
                .text(`Value${labelUnits}`);
        

            // Converted-units header — only rendered when dual-unit mode is active.
            if (graphConfig.dualUnits) {
                group.append('text')
                    .attr('x', 10 
                        + markerColWidth 
                        + nameColWidth 
                        + valueColWidth
                    )
                    .attr('y', headerY)
                    .style('font-family', 'sans-serif')
                    .style('font-size', '8px')
                    .style('fill', '#999')
                    .text(`Value, ${graphConfig.toUnits}`);
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
                if(!graphConfig.ignoreUnifiedValues){
                    // The header row is rendered at y=12 (aligned with the title bar), not at
                    // `rowY`, so the X-axis label and value appear inline with the table title.
                    // The `return` at the end skips `currentY += 18`, so header rows consume
                    // no vertical space in the data area.
                
                    group.append('text')
                        .attr('x', 10 
                            + markerColWidth 
                            + nameColWidth + 
                            (graphConfig.dualUnits 
                                ? valueColWidth 
                                : 0
                            ))
                        .attr('y', 12)
                        .style('font-family', 'sans-serif')
                        .style('font-size', '9px')
                        .style('font-weight', 'bold')
                        .style('fill', '#333')
                        .text(row.value instanceof Date 
                            ? `Date:` 
                            : `${row.label}:`
                        );

                    const xValueFormatted = row.value instanceof Date
                        ? `${row.value.getMonth() + 1}/${row.value.getDate()}/${row.value.getFullYear()}`
                        : (typeof row.value === 'number' 
                            ? row.value.toFixed(2) 
                            : row.value
                        );

                    group.append('text')
                        .attr('x', 10 
                            + markerColWidth 
                            + nameColWidth 
                            + (graphConfig.dualUnits 
                                ? valueColWidth 
                                : valueColWidth / 2
                            ) 
                            + (graphConfig.dualUnits 
                                ? secondValueColWidth / 2 
                                : 0
                            ))
                        .attr('y', 12)
                        .style('font-family', 'sans-serif')
                        .style('font-size', '9px')
                        .style('font-weight', 'bold')
                        .style('fill', '#333')
                        .text(xValueFormatted);

                }
                return;
            }

            // ── Marker glyph (left column) ────────────────────────────────────────────
            const markerX = 10 + markerColWidth / 2;
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

            // ── Series label (middle column) ──────────────────────────────────────────
            // TODO: long labels overflow `nameColWidth`. A future improvement should use
            // `_truncateText` or SVG text wrapping here. The word-wrap stub was removed;
            // use _truncateText(row.label, ~28) as a quick fix until wrapping is implemented.
            group.append('text')
                .attr('x', 10 + markerColWidth)
                .attr('y', rowY)
                .style('font-family', 'sans-serif')
                .style('font-size', '9px')
                .style('fill', '#333')
                .text(row.label);

            // ── Primary value column ──────────────────────────────────────────────────
            if(!graphConfig.ignoreUnifiedValues){
                const valueFormatted = row.value === 'N/A'
                    ? 'N/A'
                    : (typeof row.value === 'number' ? (row.value).toFixed(2) : row.value);

                group.append('text')
                    .attr('x', 10 + markerColWidth + nameColWidth)
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
                        .attr('x', 10 + markerColWidth + nameColWidth + valueColWidth)
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
