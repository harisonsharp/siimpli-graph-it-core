/**
 * @fileoverview Renders a bias/variance table from CSV data alongside the unified table.
 * Displays the CSV in a formatted table to the right of the unified legend table.
 *
 * @author Harison Sharp
 * @since 0.3.0
 *
 * @module BiasTableRenderer
 * @type {Renderer}
 *
 * @requires d3
 * @requires ../utils/debug.js
 * @requires ../services/CanvasSizer.js
 *
 * @function drawBiasTable - Main entry point to draw the bias table
 * @exports BiasTableRenderer
 *
 * @example
 * BiasTableRenderer.drawBiasTable(svg, data, dimensions, settings);
 */

import * as d3 from 'd3';
import { debugLog, debugWarn } from '../utils/debug.js';
import { CanvasSizer } from '../services/CanvasSizer.js';

/**
 * Renders a bias/variance table from CSV data alongside the unified table.
 * Displays the CSV in a formatted table to the right of the unified legend table.
 */
export class BiasTableRenderer {
    /**
     * Main entry point - draws the bias table from CSV data.
     * 
     * @param {d3.Selection} svg - The root SVG element
     * @param {Array<Object>} csvData - Parsed CSV data as array of row objects
     * @param {Object} dimensions - { width, height, margin }
     * @param {Object} globalSettings - Global settings with showBiasTable
     * @param {number} unifiedTableWidth - Width of the unified table to position relative to
     */
    static drawBiasTable(
        svg,
        csvData,
        dimensions,
        globalSettings,
        unifiedTableWidth = 300
    ) {
        if (!globalSettings.showBiasTable || !csvData || csvData.length === 0) {
            return;
        }

        debugLog('[BiasTableRenderer] Drawing bias table', {
            rowCount: csvData.length,
            unifiedTableWidth
        });

        // Get column headers from first row keys
        const headers = Object.keys(csvData[0]);

        // Calculate table position (to the right of unified table)
        const { x: tableX, y: tableY } = this._calculateTablePosition(
            dimensions,
            unifiedTableWidth
        );

        // Remove any previous bias table
        svg.selectAll('.bias-table-group').remove();

        // Create table group
        const tableGroup = svg.append('g')
            .attr('class', 'bias-table-group')
            .attr('transform', `translate(${tableX}, ${tableY})`);

        // Draw the table
        this._drawTableContent(tableGroup, headers, csvData);
    }

    /**
     * Calculates table position to the right of unified table.
     * @private
     */
    static _calculateTablePosition(dimensions, unifiedTableWidth) {
        // Position similarly to unified table but offset by its width + gap
        const legendX = dimensions.margin.left + 20;
        const gap = 20; // Gap between unified table and bias table
        const tableX = legendX + unifiedTableWidth + gap + 30;

        const legendHeight = dimensions.margin.top + dimensions.height;
        const tableY = dimensions.margin.top + legendHeight + 40;

        return { x: tableX, y: tableY };
    }

    /**
     * Draws the table content with all CSV columns and rows.
     * @private
     */
    static _drawTableContent(group, headers, csvData) {
        group.selectAll('*').remove();
        const colWidths = [160, 40, 40, 40];
        // Calculate column widths based on content
        // const colWidths = headers.map(header => {
        //     // Get max width needed for this column
        //     let maxLen = header.length;
        //     csvData.forEach(row => {
        //         const val = this._formatValue(row[header]);
        //         if (val.length > maxLen) maxLen = val.length;
        //     });
        //     // Approx 7px per character, min 60px, max 120px
        //     return Math.min(120, Math.max(60, maxLen * 7));
        // });

        const totalWidth = colWidths.reduce((sum, w) => sum + w, 0) + 20; // +20 padding
        const rowHeight = 18;

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
            .text('Bias Analysis');

        currentY += 18;

        // Column headers
        let xPos = 10;
        headers.forEach((header, i) => {
            group.append('text')
                .attr('x', xPos)
                .attr('y', currentY + 10)
                .style('font-family', 'sans-serif')
                .style('font-size', '8px')
                .style('font-weight', 'bold')
                .style('fill', '#333')
                .text(header);
            xPos += colWidths[i];
        });

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
        csvData.forEach((row) => {
            const rowY = currentY + 12;
            let xPos = 10;

            headers.forEach((header, i) => {
                const value = this._formatValue(row[header]);
                const isNumeric = !isNaN(parseFloat(row[header]));
                const numValue = parseFloat(row[header]);

                // Color code numeric values (green positive, red negative)
                let fillColor = '#333';
                if (isNumeric && header !== headers[0]) { // Skip first column (labels)
                    fillColor = numValue >= 0 ? '#2e7d32' : '#c62828';
                }

                group.append('text')
                    .attr('x', xPos)
                    .attr('y', rowY)
                    .style('font-family', 'sans-serif')
                    .style('font-size', '9px')
                    .style('font-weight', i === 0 ? 'normal' : 'bold')
                    .style('fill', fillColor)
                    .text(value);

                xPos += colWidths[i];
            });

            currentY += rowHeight;
        });

        // Update background size
        bg.attr('width', totalWidth)
            .attr('height', currentY + 5);
    }

    /**
     * Formats a value for display.
     * @private
     */
    static _formatValue(value) {
        if (value === null || value === undefined) return 'N/A';

        const num = parseFloat(value);
        if (!isNaN(num)) {
            // Format as percentage with 2 decimal places
            return num.toFixed(2) + '%';
        }
        return String(value);
    }

    /**
     * Truncates text to a maximum length.
     * @private
     */
    static _truncateText(text, maxLen) {
        if (!text) return '';
        if (text.length <= maxLen) return text;
        return text.substring(0, maxLen - 1) + '…';
    }
}
