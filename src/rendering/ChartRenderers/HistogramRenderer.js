/**
 * @fileoverview Histogram renderer for D3 visualizations.
 * Renders frequency distribution with automatic binning and outlier detection.
 *
 * @author Harison Sharp
 * @since 0.3.0
 *
 * @module Histogram Renderer
 * @type {Class}
 *
 * @requires d3 - Data visualization library
 * @requires BaseChartRenderer - Abstract base class
 * @requires generateCustomBins - Custom binning function
 *
 * @exports HistogramRenderer - Histogram rendering implementation
 *
 * @example
 * const renderer = new HistogramRenderer({ showOutliers: true });
 * renderer.render(g, data, scales, xAxisInfo, yAxisInfo, config);
 *
 * @relatedFiles BaseChartRenderer, histogram.js, GraphService
 */

import * as d3 from 'd3';
import { BaseChartRenderer } from './BaseChartRenderer.js';
import { generateCustomBins } from '../../utils/histogram.js';
import { debugLog, debugWarn } from '../../utils/debug.js';

export class HistogramRenderer extends BaseChartRenderer {
    /**
     * Create a histogram renderer
     * @param {Object} options - Rendering options
     * @param {boolean} options.showOutliers - Show outlier bin (default: true)
     * @param {string} options.color - Bar color (default: '#4682b4')
     * @param {string} options.outlierColor - Outlier bar color (default: '#888')
     * @param {number} options.opacity - Bar opacity (default: 0.8)
     */
    constructor(options = {}) {
        super();
        this.showOutliers = options.showOutliers !== undefined ? options.showOutliers : true;
        this.color = options.color || '#4682b4';
        this.outlierColor = options.outlierColor || '#888';
        this.opacity = options.opacity || 0.8;
    }

    /**
     * Get renderer type
     * @returns {string} 'histogram'
     */
    getType() {
        return 'histogram';
    }

    /**
     * Get minimum data points for histogram
     * @returns {number} 5 points minimum for meaningful distribution
     */
    getMinimumDataPoints() {
        return 5;
    }

    /**
     * Render histogram
     * @param {d3.Selection} g - D3 group selection
     * @param {Array<Object>} data - Data to render
     * @param {Object} scales - {xScale, yScale}
     * @param {Object} xAxisInfo - X-axis column info (data values)
     * @param {Object} yAxisInfo - Y-axis column info (not used, frequency is calculated)
     * @param {Object} config - Graph configuration
     */
    render(g, data, scales, xAxisInfo, yAxisInfo, config) {
        debugLog('[HistogramRenderer] render called with:', {
            dataLength: data ? data.length : 0,
            xAxisColumn: xAxisInfo ? xAxisInfo.columnName : 'N/A',
            yAxisColumn: yAxisInfo ? yAxisInfo.columnName : 'N/A'
        });

        this.validateRenderParams(g, data, scales);

        const { xScale, yScale } = scales;

        // Extract numeric values from the column
        const rawValues = data
            .map(d => {
                const val = +d[xAxisInfo.columnName];
                return val;
            })
            .filter(v => !isNaN(v) && isFinite(v));

        // For log X: filter out non-positive values and bin in log10 space so bars
        // are geometrically (not linearly) spaced. Bin boundaries are then back-transformed
        // to raw space so xScale (a log scale) maps them correctly to pixels.
        const logX = config?.logX;
        const values = logX
            ? rawValues.filter(v => v > 0).map(v => Math.log10(v))
            : rawValues;

        debugLog('[HistogramRenderer] Extracted values:', {
            totalValues: values.length,
            sample: values.slice(0, 5)
        });

        if (values.length < this.getMinimumDataPoints()) {
            debugWarn(`Insufficient data for histogram: need at least ${this.getMinimumDataPoints()}, got ${values.length}`);
            debugWarn('Data sample:', data.slice(0, 3));
            debugWarn('XAxisInfo:', xAxisInfo);
            return;
        }

        // Generate bins using custom binning algorithm (override if user specified numBins)
        const numBinsOverride = config?.numBins ? Number(config.numBins) : null;
        const staticX = config?.staticScales?.x;
        const skipOutliers = staticX?.enabled === true;
        const domainMin = skipOutliers ? Number(staticX.min) : null;
        const domainMax = skipOutliers ? Number(staticX.max) : null;
        let bins = generateCustomBins(values, numBinsOverride, skipOutliers, domainMin, domainMax);

        // For logX: store raw boundaries for display (labels/table) but keep min/max
        // in log₁₀ space so xScale (which has a log₁₀ domain) maps bars correctly.
        if (logX) {
            bins = bins.map(b => ({
                ...b,
                rawMin: 10 ** b.min,
                rawMax: 10 ** b.max,
            }));
        }

        const normalBins = bins.filter(b => !b.isOutlierBin);
        const outlierBins = bins.filter(b => b.isOutlierBin);

        // Render normal bins
        const logY = config?.logY;
        this.renderNormalBins(g, normalBins, xScale, yScale, logY);

        // Render outlier bin if present and enabled
        if (this.showOutliers && outlierBins.length > 0 && normalBins.length > 0) {
            this.renderOutlierBin(g, outlierBins[0], normalBins, xScale, yScale, logY);
        }

    }

    /**
     * Render normal histogram bins
     * @param {d3.Selection} g - D3 group selection
     * @param {Array} bins - Array of bin objects
     * @param {d3.Scale} xScale - X-axis scale
     * @param {d3.Scale} yScale - Y-axis scale
     */
    renderNormalBins(g, bins, xScale, yScale, logY = false) {
        // Anchor bar bottoms at y=0 in data space — matches where drawAxes places the x-axis.
        const chartBottom = yScale(0);

        g.selectAll('rect.histogram-bar')
            .data(bins)
            .enter()
            .append('rect')
            .attr('class', 'histogram-bar')
            .attr('x', d => xScale(d.min))
            .attr('y', d => {
                if (d.values.length === 0) return chartBottom;
                const mappedY = logY ? Math.log10(d.values.length) : d.values.length;
                return yScale(mappedY);
            })
            .attr('width', d => Math.max(0, xScale(d.max) - xScale(d.min) - 1)) 
            .attr('height', d => {
                if (d.values.length === 0) return 0;
                const mappedY = logY ? Math.log10(d.values.length) : d.values.length;
                return Math.max(0, chartBottom - yScale(mappedY));
            })
            .attr('fill', this.color)
            .attr('opacity', this.opacity)
            .attr('stroke', '#fff')
            .attr('stroke-width', 1)
   
    }

    /**
     * Render outlier bin
     * @param {d3.Selection} g - D3 group selection
     * @param {Object} outlierBin - Outlier bin object
     * @param {Array} normalBins - Array of normal bins
     * @param {d3.Scale} xScale - X-axis scale
     * @param {d3.Scale} yScale - Y-axis scale
     */
    renderOutlierBin(g, outlierBin, normalBins, xScale, yScale, logY = false) {
        const chartBottom = yScale(0);
        
        const lastBin = normalBins[normalBins.length - 1];
        const binWidth = xScale(lastBin.max) - xScale(lastBin.min);
        const outlierX = xScale(lastBin.max);
        
        let outlierY = chartBottom;
        let outlierHeight = 0;
        
        if (outlierBin.values.length > 0) {
            const mappedY = logY ? Math.log10(outlierBin.values.length) : outlierBin.values.length;
            outlierY = yScale(mappedY);
            outlierHeight = Math.max(0, chartBottom - outlierY);
        }
        // Draw outlier bar (half width, different color)
        g.append('rect')
            .attr('class', 'histogram-outlier-bar')
            .attr('x', outlierX)
            .attr('y', outlierY)
            .attr('width', binWidth / 2)
            .attr('height', outlierHeight)
            .attr('fill', this.outlierColor)
            .attr('opacity', this.opacity)
            .attr('stroke', '#fff')
            .attr('stroke-width', 1)
       

        // Add "Outliers" label (Deprecated)
        // g.append('text')
        //     .attr('class', 'histogram-outlier-label')
        //     .attr('x', outlierX + binWidth / 4)
        //     .attr('y', yScale(0) + 15)
        //     .attr('text-anchor', 'middle')
        //     .style('font-size', '12px')
        //     .style('font-family', 'sans-serif')
        //     .style('fill', this.outlierColor)
        //     .text('Outliers');
    }

    /**
     * Enable or disable outlier display
     * @param {boolean} show - Whether to show outliers
     */
    setShowOutliers(show) {
        this.showOutliers = show;
    }

    /**
     * Set histogram bar color
     * @param {string} color - Color value
     */
    setColor(color) {
        this.color = color;
    }

    /**
     * Set outlier bar color
     * @param {string} color - Color value
     */
    setOutlierColor(color) {
        this.outlierColor = color;
    }

    /**
     * Render a small stats table below the histogram plot area.
     * @param {d3.Selection} g - D3 group selection (same coordinate space as chart)
     * @param {d3.Scale} yScale - Y-axis scale (used to locate the bottom of the plot)
     * @param {number} binWidth - Width of each bin (in data units)
     * @param {number} outlierCount - Number of outlier data points
     */
    renderStatsTable(g, yScale, binWidth, outlierCount, logY = false) {
        const chartBottom = yScale(0);
        
        const tableY = chartBottom + 36;
        const tableX = 0;
        const rowH = 22;
        const colW = 180;
        const padX = 10;
        const padY = 5;

        const rows = [
            { label: 'Bin Width', value: binWidth > 0 ? Number(binWidth.toPrecision(4)).toString() : 'N/A' },
            { label: 'Outliers', value: outlierCount.toString() },
        ];

        const tableWidth = colW * 2;
        const tableHeight = rowH * rows.length + rowH; // header + rows

        const tableGroup = g.append('g')
            .attr('class', 'histogram-stats-table')
            .attr('transform', `translate(${tableX},${tableY})`);

        // Table background
        tableGroup.append('rect')
            .attr('x', 0).attr('y', 0)
            .attr('width', tableWidth).attr('height', tableHeight)
            .attr('fill', '#f8fafc')
            .attr('stroke', '#e2e8f0')
            .attr('stroke-width', 1)
            .attr('rx', 6);

        // Header row background
        tableGroup.append('rect')
            .attr('x', 0).attr('y', 0)
            .attr('width', tableWidth).attr('height', rowH)
            .attr('fill', '#e2e8f0')
            .attr('rx', 6);
        // Square off bottom corners of header
        tableGroup.append('rect')
            .attr('x', 0).attr('y', rowH / 2)
            .attr('width', tableWidth).attr('height', rowH / 2)
            .attr('fill', '#e2e8f0');

        // Header text
        tableGroup.append('text')
            .attr('x', padX).attr('y', rowH - padY)
            .style('font-size', '11px').style('font-weight', '600')
            .style('font-family', 'Inter, sans-serif').style('fill', '#475569')
            .text('Histogram Table');

        // Divider between columns in header
        tableGroup.append('line')
            .attr('x1', colW).attr('y1', 0).attr('x2', colW).attr('y2', tableHeight)
            .attr('stroke', '#e2e8f0').attr('stroke-width', 1);

        // Data rows
        rows.forEach((row, i) => {
            const rowY = rowH + i * rowH;

            // Row divider
            if (i > 0) {
                tableGroup.append('line')
                    .attr('x1', 0).attr('y1', rowY).attr('x2', tableWidth).attr('y2', rowY)
                    .attr('stroke', '#e2e8f0').attr('stroke-width', 1);
            }

            // Label cell
            tableGroup.append('text')
                .attr('x', padX).attr('y', rowY + rowH - padY)
                .style('font-size', '11px').style('font-family', 'Inter, sans-serif')
                .style('fill', '#64748b')
                .text(row.label);

            // Value cell
            tableGroup.append('text')
                .attr('x', colW + padX).attr('y', rowY + rowH - padY)
                .style('font-size', '11px').style('font-family', 'Inter, sans-serif')
                .style('fill', '#1e293b').style('font-weight', '500')
                .text(row.value);
        });
    }
}
