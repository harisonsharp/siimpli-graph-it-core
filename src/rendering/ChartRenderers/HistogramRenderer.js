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
        const values = data
            .map(d => {
                const val = +d[xAxisInfo.columnName];
                if (isNaN(val)) {
                    // debugLog('[HistogramRenderer] Invalid value for column', xAxisInfo.columnName, ':', d[xAxisInfo.columnName]);
                }
                return val;
            })
            .filter(v => !isNaN(v) && isFinite(v));

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

        // Generate bins using custom binning algorithm
        const bins = generateCustomBins(values);
        const normalBins = bins.filter(b => !b.isOutlierBin);
        const outlierBins = bins.filter(b => b.isOutlierBin);

        // Render normal bins
        this.renderNormalBins(g, normalBins, xScale, yScale);

        // Render outlier bin if present and enabled
        if (this.showOutliers && outlierBins.length > 0 && normalBins.length > 0) {
            this.renderOutlierBin(g, outlierBins[0], normalBins, xScale, yScale);
        }
    }

    /**
     * Render normal histogram bins
     * @param {d3.Selection} g - D3 group selection
     * @param {Array} bins - Array of bin objects
     * @param {d3.Scale} xScale - X-axis scale
     * @param {d3.Scale} yScale - Y-axis scale
     */
    renderNormalBins(g, bins, xScale, yScale) {
        g.selectAll('rect.histogram-bar')
            .data(bins)
            .enter()
            .append('rect')
            .attr('class', 'histogram-bar')
            .attr('x', d => xScale(d.min))
            .attr('y', d => yScale(d.values.length))
            .attr('width', d => Math.max(0, xScale(d.max) - xScale(d.min) - 1))
            .attr('height', d => Math.max(0, yScale(0) - yScale(d.values.length)))
            .attr('fill', this.color)
            .attr('opacity', this.opacity)
            .attr('stroke', '#fff')
            .attr('stroke-width', 1)
            .append('title')
            .text(d => `${d.min.toFixed(2)} - ${d.max.toFixed(2)}: ${d.values.length} values`);
    }

    /**
     * Render outlier bin
     * @param {d3.Selection} g - D3 group selection
     * @param {Object} outlierBin - Outlier bin object
     * @param {Array} normalBins - Array of normal bins
     * @param {d3.Scale} xScale - X-axis scale
     * @param {d3.Scale} yScale - Y-axis scale
     */
    renderOutlierBin(g, outlierBin, normalBins, xScale, yScale) {
        const lastBin = normalBins[normalBins.length - 1];
        const binWidth = xScale(lastBin.max) - xScale(lastBin.min);
        const outlierX = xScale(lastBin.max);
        const outlierY = yScale(outlierBin.values.length);
        const outlierHeight = Math.max(0, yScale(0) - outlierY);

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
            .append('title')
            .text(`Outliers (>${lastBin.max.toFixed(2)}): ${outlierBin.values.length} values`);

        // Add "Outliers" label
        g.append('text')
            .attr('class', 'histogram-outlier-label')
            .attr('x', outlierX + binWidth / 4)
            .attr('y', yScale(0) + 15)
            .attr('text-anchor', 'middle')
            .style('font-size', '12px')
            .style('font-family', 'sans-serif')
            .style('fill', this.outlierColor)
            .text('Outliers');
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
}
