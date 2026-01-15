/**
 * @fileoverview Renders a unified table combining legend markers, series names, and recent/selected values.
 * Provides a consolidated view distinct from separate legends and data tables.
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
 * Table structure:
 * | Marker | Series Name | Value |
 * |--------|-------------|-------|
 * |  ●     | Copper      | 4.25  |
 * |  ■     | Zinc        | 2.10  |
 */
export class UnifiedTableRenderer {
    /**
     * Main entry point - draws the unified legend+value table.
     * 
     * @param {d3.Selection} svg - The root SVG element
     * @param {Array} validData - The data points
     * @param {Object} columnInfo - Parsed column information { xAxisInfo, seriesInfo }
     * @param {Object} scales - Scale objects { xScale, yScale, seriesColorScale }
     * @param {Object} graphConfig - Graph configuration
     * @param {Object} globalSettings - Global settings with showUnifiedTable, selectedXValue
     * @param {Object} dimensions - { width, height, margin }
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

        debugLog('[UnifiedTableRenderer] Drawing unified table', {
            selectedXValue,
            seriesCount: seriesInfo.length
        });

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

        // Remove any previous unified table
        svg.selectAll('.unified-table-group').remove();

        // Create table group
        const tableGroup = svg.append('g')
            .attr('class', 'unified-table-group')
            .attr('transform', `translate(${tableX}, ${tableY})`);

        // Draw the table
        this._drawTableContent(tableGroup, rowData, seriesInfo, seriesColorScale, graphConfig);
    }

    /**
     * Prepares row data for each series.
     * @private
     */
    static _prepareRowData(validData, seriesInfo, xAxisInfo, scales, selectedXValue, graphConfig) {
        const xCol = xAxisInfo.columnName;
        const { seriesColorScale, xScale } = scales;
        debugLog('[PrepareRowData] ',
            'validData: ', validData,
            'seriesInfo: ', seriesInfo,
            'xAxisInfo: ', xAxisInfo,
            'scales: ', scales,
            'selectedXValue: ', selectedXValue,
            'graphConfig: ', graphConfig);

        // Sort data for bisector
        const sortedData = [...validData].sort((a, b) => +a[xCol] - +b[xCol]);
        const bisectDate = d3.bisector(d => +d[xCol]).left;

        // Determine which X value to use
        let targetX = selectedXValue;
        if (targetX === null || targetX === undefined) {
            // Use the most recent (last) data point
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

            // Determine series color
            const seriesColor = ScaleFactory.resolveColor(series.color) ||
                (seriesColorScale ? seriesColorScale(yCol) : '#333');

            // Check for unique filter (categorical shapes)
            const filterColumn = series.filterColumn?.split('::')[0];
            let uniqueValues = filterColumn ? SymbolFactory.getUniqueValues(validData, filterColumn) : [];

            if (series.excludeEmptyValues) {
                uniqueValues = uniqueValues.filter(v => v !== undefined && v !== null && v !== '');
            }

            // Generate symbol map for categorical encoding
            const symbolMap = uniqueValues.length > 0 ? SymbolFactory.getSymbolMap(uniqueValues) : null;

            // Determine sub-items: expand unique values or single series row
            if (series.graphType === 'scatter' && uniqueValues.length > 0 && symbolMap) {
                // Create a row for each unique value
                uniqueValues.forEach(uniqueVal => {
                    // Filter data to only this unique value
                    const filteredData = sortedData.filter(d => d[filterColumn] === uniqueVal);

                    // Find value at or before targetX for this filtered subset
                    let foundVal = null;
                    if (targetX !== null && targetX !== undefined && filteredData.length > 0) {
                        const filteredBisect = d3.bisector(d => +d[xCol]).left;
                        const i = filteredBisect(filteredData, targetX, 1);
                        let scanIdx = Math.min(i, filteredData.length - 1);

                        // Ensure we aren't starting ahead of targetX
                        while (scanIdx >= 0 && +filteredData[scanIdx][xCol] > targetX) {
                            scanIdx--;
                        }

                        // Scan backwards for a non-null Y value
                        for (let k = scanIdx; k >= 0; k--) {
                            const d = filteredData[k];
                            if (d[yCol] !== undefined && d[yCol] !== null && !isNaN(+d[yCol])) {
                                foundVal = d[yCol];
                                break;
                            }
                        }
                    }

                    rows.push({
                        type: 'series',
                        label: `${series.titleName || yCol} - ${uniqueVal}`,
                        value: foundVal !== null ? foundVal : 'N/A',
                        color: seriesColor,
                        graphType: 'scatter',
                        lineStyle: series.lineStyle || 'solid',
                        strokeWidth: series.strokeWidth || 2,
                        symbolType: SymbolFactory.getSymbol(uniqueVal, symbolMap)
                    });
                });
            } else {
                // Standard single-row behavior
                let foundVal = null;

                // Find value at or before targetX
                if (targetX !== null && targetX !== undefined) {
                    const i = bisectDate(sortedData, targetX, 1);
                    let scanIdx = Math.min(i, sortedData.length - 1);

                    // Ensure we aren't starting ahead of targetX
                    while (scanIdx >= 0 && +sortedData[scanIdx][xCol] > targetX) {
                        scanIdx--;
                    }

                    // Scan backwards for a non-null Y value
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
                    value: foundVal !== null ? foundVal : 'N/A',
                    color: seriesColor,
                    graphType: series.graphType || 'scatter',
                    lineStyle: series.lineStyle || 'solid',
                    strokeWidth: series.strokeWidth || 2,
                    symbolType: series.graphType === 'scatter' ? d3.symbolCircle : null
                });
            }
        });

        return rows;
    }

    /**
     * Calculates table position (similar to DataTableRenderer).
     * @private
     */
    static _calculateTablePosition(dimensions, graphConfig, columnInfo) {
        const hasSecondaryAxis = graphConfig.series &&
            (graphConfig.series.some(s => s.axisAssignment === 'secondary') || graphConfig.dualUnits);

        const legendX = dimensions.margin.left + 20;
        const legendHeight = dimensions.margin.top + dimensions.height;
        const tableY = dimensions.margin.top + legendHeight + 40;

        return { x: legendX, y: tableY };
    }

    /**
     * Gets brightness of a hex color for contrast calculation.
     * @private
     */
    static _getBrightness(hexColor) {
        if (!hexColor || hexColor.length < 7) return 128;
        const r = parseInt(hexColor.substring(1, 3), 16);
        const g = parseInt(hexColor.substring(3, 5), 16);
        const b = parseInt(hexColor.substring(5, 7), 16);
        return (r + g + b) / 3;
    }

    /**
     * Draws the table content with marker, name, and value columns.
     * @private
     */
    static _drawTableContent(group, rowData, seriesInfo, seriesColorScale, graphConfig) {
        group.selectAll('*').remove();

        debugLog('[UnifiedTableRenderer] Drawing table content', rowData);

        // Column widths
        const markerColWidth = 25;
        const nameColWidth = 160;
        const valueColWidth = 90;
        let secondValueColWidth = 0;
        if (graphConfig.dualUnits) {
            secondValueColWidth = 90;
        }
        const totalWidth = markerColWidth + nameColWidth + valueColWidth + secondValueColWidth + 20; // +20 for padding

        // Background
        const bg = group.append('rect')
            .attr('rx', 4)
            .attr('ry', 4)
            .style('fill', 'rgba(255, 255, 255, 0.95)')
            .style('stroke', '#999')
            .style('stroke-width', '1px');

        let currentY = 10;

        // Title
        group.append('text')
            .attr('x', 10)
            .attr('y', 12)
            .style('font-family', 'sans-serif')
            .style('font-size', '11px')
            .style('font-weight', 'bold')
            .style('fill', '#666')
            .text('Legend & Most Recent Values');

        currentY += 18;

        // Column headers
        const headerY = currentY + 10;
        group.append('text')
            .attr('x', 10)
            .attr('y', headerY)
            .style('font-family', 'sans-serif')
            .style('font-size', '8px')
            .style('fill', '#999')
            .text('');  // Marker column - no header

        group.append('text')
            .attr('x', 10 + markerColWidth)
            .attr('y', headerY)
            .style('font-family', 'sans-serif')
            .style('font-size', '8px')
            .style('fill', '#999')
            .text('Series');
        const isLabelUnits = graphConfig.yAxisLabel.match(/\((.*?)\)/) ? true : false;
        const labelUnits = graphConfig.dualUnits ? `, ${graphConfig.fromUnits}` : isLabelUnits ? `, ${graphConfig.yAxisLabel.match(/\((.*?)\)/)?.[1]}` : '';
        group.append('text')
            .attr('x', 10 + markerColWidth + nameColWidth)
            .attr('y', headerY)
            .style('font-family', 'sans-serif')
            .style('font-size', '8px')
            .style('fill', '#999')
            .text(`Value${labelUnits}`);

        if (graphConfig.dualUnits) {
            group.append('text')
                .attr('x', 10 + markerColWidth + nameColWidth + valueColWidth)
                .attr('y', headerY)
                .style('font-family', 'sans-serif')
                .style('font-size', '8px')
                .style('fill', '#999')
                .text(`Value, ${graphConfig.toUnits}`);
        }


        currentY += 15;

        // Separator line
        group.append('line')
            .attr('x1', 10)
            .attr('x2', totalWidth - 10)
            .attr('y1', currentY)
            .attr('y2', currentY)
            .style('stroke', '#ddd')
            .style('stroke-width', '1px');

        currentY += 5;

        // Data rows
        rowData.forEach((row) => {
            const rowY = currentY + 12;

            if (row.type === 'header') {
                // X-axis value header row
                group.append('text')
                    .attr('x', 10 + markerColWidth + nameColWidth + (graphConfig.dualUnits ? valueColWidth : 0))
                    .attr('y', 12)
                    .style('font-family', 'sans-serif')
                    .style('font-size', '9px')
                    .style('font-weight', 'bold')
                    .style('fill', '#333')
                    .text(row.value instanceof Date ? `Date:` : `${row.label}:`);

                const xValueFormatted = row.value instanceof Date
                    ? `${row.value.getMonth() + 1}/${row.value.getDate()}/${row.value.getFullYear()}`
                    : (typeof row.value === 'number' ? row.value.toFixed(2) : row.value);

                group.append('text')
                    .attr('x', 10 + markerColWidth + nameColWidth + (graphConfig.dualUnits ? valueColWidth : valueColWidth / 2) + (graphConfig.dualUnits ? secondValueColWidth / 2 : 0))
                    .attr('y', 12)
                    .style('font-family', 'sans-serif')
                    .style('font-size', '9px')
                    .style('font-weight', 'bold')
                    .style('fill', '#333')
                    .text(xValueFormatted);


                return;
            }

            // Series row - draw marker
            const markerX = 10 + markerColWidth / 2;
            const markerY = rowY - 4;

            if (row.graphType === 'line') {
                let strokeDashArray = 'none';
                if (row.lineStyle === 'dashed') strokeDashArray = '5,3';
                else if (row.lineStyle === 'dotted') strokeDashArray = '2,2';
                else if (row.lineStyle === 'dash-dot') strokeDashArray = '5,2,2,2';

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
                group.append('rect')
                    .attr('x', markerX - 6)
                    .attr('y', markerY - 6)
                    .attr('width', 12)
                    .attr('height', 12)
                    .attr('fill', row.color);
            } else {
                // Scatter - use symbol
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

            // Series name
            // if the row label is longer than the name column width, wrap it to the next line
            // if (row.label.length > nameColWidth / 4) {
            //     let line = []
            //     let words = row.label.split(' ');
            //     for (let i = 0, let lineLength = nameColWidth / 4; i<length)
            // }
            group.append('text')
                .attr('x', 10 + markerColWidth)
                .attr('y', rowY)
                .style('font-family', 'sans-serif')
                .style('font-size', '9px')
                .style('fill', '#333')
                .text(row.label);

            // first value
            const valueFormatted = row.value === 'N/A'
                ? 'N/A'
                : (typeof row.value === 'number' ? row.value.toPrecision(4) : row.value);

            group.append('text')
                .attr('x', 10 + markerColWidth + nameColWidth)
                .attr('y', rowY)
                .style('font-family', 'sans-serif')
                .style('font-size', '9px')
                .style('font-weight', 'bold')
                .style('fill', '#333')
                .text(valueFormatted);

            // second value
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
            currentY += 18;
        });

        // Update background size
        bg.attr('width', totalWidth)
            .attr('height', currentY + 5);
    }

    /**
     * Truncates text to a maximum length.
     * @private
     */
    static _truncateText(text, maxLen) {
        if (!text) return '';
        if (text.length <= maxLen) return text;
        return text.substring(0, maxLen - 2) + '…';
    }
}
