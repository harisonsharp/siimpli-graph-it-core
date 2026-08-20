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
    /** Approximate rendered width of one character in the 9px body font, in px. */
    static CHAR_PX = 5.4;
    /** Horizontal breathing room added to every content-fitted column, in px. */
    static COL_PAD_PX = 10;
    /** Approximate character width in the 8.5px footer font, in px. */
    static NOTE_CHAR_PX = 4.4;

    /**
     * Main entry point - draws the bias table from CSV data.
     * 
     * @param {d3.Selection} svg - The root SVG element
     * @param {Array<Object>} csvData - Parsed CSV data as array of row objects
     * @param {Object} dimensions - { width, height, margin }
     * @param {Object} globalSettings - Global settings.
     * @param {boolean} globalSettings.showBiasTable - Feature flag; `false` suppresses the table.
     * @param {string} [globalSettings.biasTableTitle] - Heading above the table. Defaults to
     *   `'Bias Analysis'`.
     * @param {string|Array<string>} [globalSettings.biasTableNote] - Free text rendered as a
     *   footer inside the table's own box, wrapped to the table width. This is where a chart
     *   states what being above or below its advice line MEANS — a reading the numbers
     *   themselves cannot carry.
     * @param {'up-good'|'down-good'|'direction'|'neutral'} [globalSettings.biasTableSignColors]
     *   How the sign of a numeric cell is coloured. `'up-good'` (default) is green positive /
     *   red negative, which is only right when a bigger number IS better; `'down-good'`
     *   inverts it; `'neutral'` leaves the cell black. `'direction'` colours the two sides
     *   in hues that carry no verdict — for a mass pull, above the line is a dirtier
     *   concentrate and below is a cleaner one, which is information rather than a score,
     *   so it needs to be visible without being marked right or wrong.
     * @param {string} [globalSettings.biasTableSignColumn] - Header of the one column the
     *   sign colouring applies to. Without it every numeric column past the first is
     *   coloured, which is wrong the moment the table carries a plain measurement (a median
     *   is not a deviation and has no good or bad direction) beside a deviation.
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
        this._drawTableContent(tableGroup, headers, csvData, globalSettings);
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
    static _drawTableContent(group, headers, csvData, globalSettings = {}) {
        group.selectAll('*').remove();

        // Content-fitted widths. The previous fixed `[160, 40, 40, 40]` silently produced a
        // NaN x-offset for any fifth column, so the table's shape was pinned to exactly four
        // columns — and a label longer than 160px overprinted its neighbour. The first column
        // is the label column and gets the room; the rest fit their own longest cell.
        const colWidths = headers.map((header, i) => {
            let maxLen = String(header).length;
            for (const row of csvData) {
                const len = this._formatValue(row[header]).length;
                if (len > maxLen) maxLen = len;
            }
            const px = maxLen * BiasTableRenderer.CHAR_PX + BiasTableRenderer.COL_PAD_PX;
            return i === 0
                ? Math.min(220, Math.max(120, px))
                : Math.min(120, Math.max(40, px));
        });

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
            .text(globalSettings.biasTableTitle || 'Bias Analysis');

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

                // Color code numeric values by whichever sign this chart calls good, in the
                // one column that is actually a deviation.
                const signColors = globalSettings.biasTableSignColors || 'up-good';
                const signColumn = globalSettings.biasTableSignColumn;
                const isSignColumn = signColumn ? header === signColumn : header !== headers[0];
                let fillColor = '#333';
                if (isNumeric && isSignColumn && signColors !== 'neutral') {
                    if (signColors === 'direction') {
                        // Amber above, blue below. Deliberately not green/red: those read as
                        // a verdict, and on these charts neither side is one.
                        fillColor = numValue >= 0 ? '#B45309' : '#1D4ED8';
                    } else {
                        const good = signColors === 'down-good' ? numValue <= 0 : numValue >= 0;
                        fillColor = good ? '#2e7d32' : '#c62828';
                    }
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

        // ── Advice footer ─────────────────────────────────────────────────────────────
        // The numbers above say how far each category sits from the advice line; this says
        // what that distance means, which is the part a reader cannot infer. Wrapped to the
        // table's own width so it can be a real sentence rather than a truncated fragment,
        // and separated by a rule so it does not read as another data row.
        const noteLines = this._wrapNote(globalSettings.biasTableNote, totalWidth - 20);
        if (noteLines.length) {
            currentY += 4;
            group.append('line')
                .attr('x1', 10)
                .attr('x2', totalWidth - 10)
                .attr('y1', currentY)
                .attr('y2', currentY)
                .style('stroke', '#ddd')
                .style('stroke-width', '1px');
            currentY += 4;

            noteLines.forEach((line) => {
                group.append('text')
                    .attr('x', 10)
                    .attr('y', currentY + 10)
                    .style('font-family', 'sans-serif')
                    .style('font-size', '8.5px')
                    .style('fill', '#555')
                    .text(line);
                currentY += 11;
            });
            currentY += 2;
        }

        // Update background size
        bg.attr('width', totalWidth)
            .attr('height', currentY + 5);
    }

    /**
     * Splits the advice note into lines that fit `maxWidth` px at the footer's font size.
     *
     * Accepts a string or an array of strings; an array element is a hard line break (so a
     * caller can keep "above the line" and "below the line" on separate lines), and each
     * element is then wrapped on its own. Width is estimated from a per-character constant
     * rather than measured, because this renderer also runs under jsdom where text has no
     * measurable extent at all.
     *
     * @private
     * @param {string|Array<string>|null|undefined} note
     * @param {number} maxWidth - Available width in px.
     * @returns {Array<string>} Lines to draw, or `[]` when there is no note.
     */
    static _wrapNote(note, maxWidth) {
        const paragraphs = (Array.isArray(note) ? note : [note])
            .filter(t => typeof t === 'string' && t.trim() !== '');
        if (paragraphs.length === 0) return [];

        const maxChars = Math.max(12, Math.floor(maxWidth / BiasTableRenderer.NOTE_CHAR_PX));
        const lines = [];
        for (const paragraph of paragraphs) {
            let current = '';
            for (const word of paragraph.trim().split(/\s+/)) {
                const candidate = current ? `${current} ${word}` : word;
                if (candidate.length <= maxChars) {
                    current = candidate;
                } else {
                    if (current) lines.push(current);
                    current = word;
                }
            }
            if (current) lines.push(current);
        }
        return lines;
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
