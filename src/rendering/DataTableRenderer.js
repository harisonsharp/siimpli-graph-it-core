import * as d3 from 'd3';
import { ScaleFactory } from './ScaleFactory';
import { debugLog } from '../utils/debug.js';
import { CanvasSizer } from '../services/CanvasSizer.js';
/**
 * Renders data tables (hover and static) for graph visualization.
 */
export class DataTableRenderer {
    /**
     * Main entry point to render the interaction layer (overlay + tables).
     * 
     * @param {d3.Selection} g - The main SVG group element.
     * @param {d3.Selection} svg - The root SVG element.
     * @param {Array} validData - The data points.
     * @param {Object} scales - The d3 scales (xScale, yScale, seriesColorScale).
     * @param {Object} columnInfo - Parsed column information.
     * @param {Object} graphConfig - The graph configuration object.
     * @param {Object} globalSettings - Global settings (showDataTable, selectedXValue, etc.).
     * @param {Object} dimensions - Graph dimensions (width, height, margin).
     * @param {Object} callbacks - callbacks like { onXValueSelect }.
     * @param {boolean} isBatchMode - Whether we are in batch mode (non-interactive).
     */
    static renderInteractionLayer(
        g,
        svg,
        validData,
        scales,
        columnInfo,
        graphConfig,
        globalSettings,
        dimensions,
        callbacks = {},
        isBatchMode = false
    ) {
        const { showDataTable, showStaticTable, selectedXValue } = globalSettings;
        const xAxisLabel = graphConfig.xAxisLabel || columnInfo.xAxisInfo.columnName;

        // Cleanup previous interaction layers if any (though typically parent clears SVG)
        // Check if we should render anything
        if (!showDataTable && !showStaticTable) return;

        // 1. Setup Interaction Overlay
        const overlay = g.append("rect")
            .attr("class", "overlay")
            .attr("width", dimensions.width)
            .attr("height", dimensions.height)
            .style("fill", "none")
            .style("pointer-events", "all");

        // 2. Prepare Data (Sorted for Bisect)
        const xCol = columnInfo.xAxisInfo.columnName;
        // Optimization: Could memoize this if performance becomes an issue, 
        // but validData usually changes on re-render anyway.
        const sortedData = [...validData].sort((a, b) => +a[xCol] - +b[xCol]);
        const bisectDate = d3.bisector(d => +d[xCol]).left;

        // 3. Render Static Table
        if (showStaticTable) {
            this._renderStaticTable(
                svg,
                sortedData,
                bisectDate,
                selectedXValue,
                scales,
                columnInfo,
                graphConfig,
                dimensions,
                g // passed to draw marker line
            );
        }

        // 4. Setup Hover Table (Hidden by default)
        const hoverTableGroup = svg.append("g")
            .attr("class", "hover-table-group")
            .style("display", "none")
            .style("pointer-events", "none");

        // 5. Attach Event Listeners
        overlay
            .on("mousemove", (event) => {
                if (!showDataTable) return;

                const [mouseX] = d3.pointer(event);
                const x0 = scales.xScale.invert(mouseX);
                debugLog('mouseX', mouseX);
                debugLog('x0', x0);
                this._updateHoverTable(
                    hoverTableGroup,
                    x0,
                    sortedData,
                    bisectDate,
                    scales,
                    columnInfo,
                    graphConfig,
                    dimensions
                );
            })
            .on("mouseout", () => {
                hoverTableGroup.style("display", "none");
            })
            .on("click", (event) => {
                // Click Interaction for Static Table
                if (showStaticTable && !isBatchMode) {
                    const [mouseX] = d3.pointer(event);
                    const x0 = scales.xScale.invert(mouseX);

                    if (callbacks.onXValueSelect) {
                        callbacks.onXValueSelect(x0);
                    }
                }
            });
    }

    /**
     * Renders the persistent static table.
     * @private
     */
    static _renderStaticTable(
        svg,
        sortedData,
        bisectDate,
        selectedX,
        scales,
        columnInfo,
        graphConfig,
        dimensions,
        g
    ) {
        if (selectedX === null || selectedX === undefined) return;

        const rowData = this._findValuesAtX(selectedX, sortedData, bisectDate, columnInfo, scales);

        // Calculate Position
        const { x: tableX, y: tableY } = this._calculateTablePosition(dimensions, graphConfig, columnInfo);

        // Draw Table Group
        const staticTableGroup = svg.append("g")
            .attr("class", "static-table-group")
            .attr("transform", `translate(${tableX}, ${tableY})`);

        this._drawTableContent(staticTableGroup, "Selected Values:", rowData, graphConfig.xAxisLabel);

        // Draw Vertical Marker on Graph
        g.append("line")
            .attr("x1", scales.xScale(selectedX))
            .attr("x2", scales.xScale(selectedX))
            .attr("y1", 0)
            .attr("y2", dimensions.height)
            .style("stroke", "#666")
            .style("stroke-width", "1px")
            .style("stroke-dasharray", "4 4")
            .style("pointer-events", "none");
    }

    /**
     * Updates the transient hover table.
     * @private
     */
    static _updateHoverTable(
        group,
        xValue,
        sortedData,
        bisectDate,
        scales,
        columnInfo,
        graphConfig,
        dimensions
    ) {
        const rowData = this._findValuesAtX(xValue, sortedData, bisectDate, columnInfo, scales);

        // Calculate Position
        // Note: We currently use the same position logic (under legend).
        const { x: tableX, y: tableY } = this._calculateTablePosition(dimensions, graphConfig, columnInfo);

        group.style("display", null)
            .attr("transform", `translate(${tableX}, ${tableY})`);

        this._drawTableContent(group, "Cursor Values:", rowData, graphConfig.xAxisLabel);
    }

    /**
     * Core logic to find data values at a specific X.
     * Handles the "last known value" lookback logic.
     * @private
     */
    static _findValuesAtX(targetX, sortedData, bisectDate, columnInfo, scales) {
        const xCol = columnInfo.xAxisInfo.columnName;
        const i = bisectDate(sortedData, targetX, 1);

        const rowData = [];
        // Header
        rowData.push({
            label: xCol,
            value: targetX,
            color: '#333',
            isHeader: true
        });

        columnInfo.seriesInfo.forEach(series => {
            const yCol = series.yAxisInfo.columnName;
            let foundVal = null;

            // Logic: Find last valid value <= targetX
            // Start scan backwards from insertion point i
            let scanIdx = Math.min(i, sortedData.length - 1);

            // 1. Ensure we aren't starting ahead of targetX (in case i is after)
            while (scanIdx >= 0 && +sortedData[scanIdx][xCol] > targetX) {
                scanIdx--;
            }

            // 2. Scan backwards for a non-null Y value
            for (let k = scanIdx; k >= 0; k--) {
                const d = sortedData[k];
                if (d[yCol] !== undefined && d[yCol] !== null && !isNaN(+d[yCol])) {
                    foundVal = d[yCol];
                    break;
                }
            }

            const seriesColor = ScaleFactory.resolveColor(series.color) ||
                (scales.seriesColorScale ? scales.seriesColorScale(yCol) : '#333');

            rowData.push({
                label: series.titleName || yCol,
                value: foundVal !== null ? foundVal : "N/A",
                color: seriesColor
            });
        });

        return rowData;
    }

    /**
     * Calculates where to place the table.
     * Currently places it underneath the legend.
     * @private
     */
    static _calculateTablePosition(dimensions, graphConfig, columnInfo) {
        debugLog('[DataTableRenderer._calculateTablePosition] dimensions, graphConfig, columnInfo', dimensions, graphConfig, columnInfo);
        const hasSecondaryAxis = graphConfig.series && (graphConfig.series.some(s => s.axisAssignment === 'secondary') || graphConfig.dualUnits);
        const legendXOffset = hasSecondaryAxis ? 140 : 60;
        // const legendX = dimensions.margin.left + dimensions.width + legendXOffset;
        const legendX = CanvasSizer.DEFAULT_CONFIG.maxLineWidthLegend * 5 + dimensions.margin.left;
        // Estimate legend height based on series count (25px per item)
        // TODO: Pass actual legend height if available? For now, estimation is consistent with previous code.
        // const legendHeight = (columnInfo.seriesInfo.length + 3) * 2;
        const legendHeight = dimensions.margin.top + dimensions.height;

        const tableY = dimensions.margin.top + legendHeight + 40; // 20px padding (original code had +20, then +40 for static)

        // Let's settle on +30 or keep the previous logic.
        // Previous static table: +40. Previous hover: +20. 
        // If both are active, they will overlap if we don't offset them. 
        // Requirement was to "enable both". Overlap is messy. 
        // But the user didn't ask to fix overlap yet, just "extract".
        // I will stick to +40 to match the most recent "Static" logic which felt more polished.

        return { x: legendX, y: tableY };
    }
    static getBrightness(hexColor) {
        let r = parseInt(hexColor.substring(1, 3), 16);
        let g = parseInt(hexColor.substring(3, 5), 16);
        let b = parseInt(hexColor.substring(5, 7), 16);
        return (r + g + b) / 3; // Average of RGB values
    }
    /**
     * Draws the table background and text rows into the provided group.
     * @private
     */
    static _drawTableContent(group, title, rowData, xAxisLabel) {
        group.selectAll("*").remove();
        console.log('DataTableRenderer._drawTableContent', group, title, rowData);
        // Background (styled later after measuring)
        const bg = group.append("rect")
            .attr("rx", 4)
            .attr("ry", 4)
            .style("fill", "rgba(255, 255, 255, 0.95)")
            .style("stroke", "#999") // Static used #999, Hover used #ccc. Standardizing on #999.
            .style("stroke-width", "1px");

        let maxWidth = CanvasSizer.DEFAULT_CONFIG.maxLineWidthLegend;
        let currentY = 10;

        // Title
        const titleText = group.append("text")
            .attr("x", 10)
            .attr("y", 12) // text vertical alignment
            .style("font-family", "sans-serif")
            .style("font-size", "11px")
            .style("font-weight", "bold")
            .style("fill", "#666")
            .text(title);

        maxWidth = Math.max(maxWidth, titleText.node().getBBox().width);
        currentY += 15;

        rowData.forEach((row) => {
            debugLog('DataTableRenderer._drawTableContent', 'row', row);
            const textRow = group.append("g")
                .attr("transform", `translate(10, ${currentY + 12})`);
            const brightness = this.getBrightness(row.color || "#333");
            let labelText;
            if (brightness > 200) {
                labelText = textRow.append("text")
                    .text(row.label === '__unified_x__' ? xAxisLabel : `${row.label}:`)
                    .style("font-family", "sans-serif")
                    .style("font-size", "9px")
                    .style("font-weight", row.isHeader ? "bold" : "normal")
                    .style("fill", "#333")

            } else {
                labelText = textRow.append("text")
                    .text(row.label === '__unified_x__' ? xAxisLabel : `${row.label}:`)
                    .style("font-family", "sans-serif")
                    .style("font-size", "9px")
                    .style("font-weight", row.isHeader ? "bold" : "normal")
                    .style("fill", "#333")

            }

            debugLog('DataTableRenderer._drawTableContent before', 'row.value', row.value instanceof Date);
            let rowValue = row.value instanceof Date ? `${row.value.getMonth() + 1}/${row.value.getDate()}/${row.value.getFullYear()}` : row.value;
            debugLog('DataTableRenderer._drawTableContent after', 'rowValue', rowValue);
            const valueText = textRow.append("text")
                .text(typeof rowValue === 'number' ? rowValue.toFixed(2) : rowValue)
                .style("font-family", "sans-serif")
                .style("font-size", "9px")
                .style("font-weight", "bold")
                .style("fill", "#333");

            const dimsLabel = labelText.node().getBBox();
            const dimsValue = valueText.node().getBBox();

            // Position value to the right of label
            valueText.attr("x", dimsLabel.width + 5);

            maxWidth = Math.max(maxWidth, dimsLabel.width + 5 + dimsValue.width);
            currentY += 18;
        });

        bg.attr("width", maxWidth + 20)
            .attr("height", currentY + 5);
    }
}
