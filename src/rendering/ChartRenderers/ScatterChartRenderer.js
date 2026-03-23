/**
 * @fileoverview Scatter plot chart renderer for D3 visualizations.
 * Renders individual data points as circles with optional color grading.
 *
 * @author Harison Sharp
 * @since 0.3.0
 *
 * @module Scatter Chart Renderer
 * @type {Class}
 *
 * @requires d3 - Data visualization library
 * @requires BaseChartRenderer - Abstract base class
 *
 * @exports ScatterChartRenderer - Scatter plot rendering implementation
 *
 * @example
 * const renderer = new ScatterChartRenderer({ radius: 5, opacity: 0.9 });
 * renderer.render(g, data, scales, xAxisInfo, yAxisInfo, config, colorScale, colorInfo);
 *
 * @relatedFiles BaseChartRenderer, GraphService
 */

import * as d3 from 'd3';
import { BaseChartRenderer } from './BaseChartRenderer.js';
import { debugLog, debugWarn } from '../../utils/debug.js';
import { parseNumber } from '../../utils/dataUtils.js';
import { SymbolFactory } from '../../utils/SymbolFactory.js';

export class ScatterChartRenderer extends BaseChartRenderer {
    /**
     * Create a scatter chart renderer
     * @param {Object} options - Rendering options
     * @param {number} options.radius - Circle radius (default: 5)
     * @param {number} options.opacity - Circle opacity (default: 0.9)
     */
    constructor(options = {}) {
        super();
        this.radius = options.radius || 2;
        this.opacity = options.opacity || 0.9;
    }

    /**
     * Get renderer type
     * @returns {string} 'scatter'
     */
    getType() {
        return 'scatter';
    }
    
    /**
     * Render scatter plot
     * @param {d3.Selection} g - D3 group selection
     * @param {Array<Object>} data - Data to render
     * @param {Object} scales - {xScale, yScale}
     * @param {Object} xAxisInfo - X-axis column info
     * @param {Object} yAxisInfo - Y-axis column info
     * @param {Object} config - Graph configuration
     * @param {d3.Scale} colorScale - Optional color scale
     * @param {Object} colorInfo - Optional color column info
     * @param {string} seriesColor - Optional series color
     */
    render(g, data, scales, xAxisInfo, yAxisInfo, config, colorScale = null, colorInfo = null, seriesColor = null) {
        this.validateRenderParams(g, data, scales);
        const { xScale, yScale } = scales;
        let validData = this.filterValidData(data, xAxisInfo, yAxisInfo);

        if (validData.length === 0) {
            console.warn('No valid data points for scatter plot');
            return;
        }

        // Get series configuration for this specific series
        const currentSeriesConfig = config.series.find(s => {
            const split = s.yAxis.split('::');
            return split[0] === yAxisInfo.columnName && (split[1] === undefined || split[1] === yAxisInfo.fileName);
        });

        // Unique Filter / Symbol Encoding Logic
        let symbolMap = null;
        let filterColumn = null;

        const useUniqueSymbolEncoding = SymbolFactory.shouldUseUniqueSymbolEncoding(currentSeriesConfig);

        if (useUniqueSymbolEncoding) {
            const splitFilter = currentSeriesConfig.filterColumn.split('::');
            filterColumn = splitFilter[0]; // Assuming columnName is first part

            if (!currentSeriesConfig.filterType) {
                debugWarn('[ScatterChartRenderer.render] Legacy filter config detected (missing filterType). Applying unique symbol encoding fallback.');
            }

            // Filter out empty values if requested
            if (currentSeriesConfig.excludeEmptyValues) {
                validData = validData.filter(d => {
                    const val = d[filterColumn];
                    return val !== undefined && val !== null && val !== '';
                });
            }

            // Generate symbol map from remaining data
            debugLog('[ScatterChartRenderer.render] validData, filterColumn', validData, filterColumn);
            const uniqueValues = SymbolFactory.getUniqueValues(validData, filterColumn);
            symbolMap = SymbolFactory.getSymbolMap(uniqueValues);
        }

        // Handle both band and linear scales for x-axis
        const getXPosition = (d) => {
            const xValue = d[xAxisInfo.columnName];
            if (typeof xScale.bandwidth === 'function') {
                // Band scale - position at center of band
                return xScale(xValue) + xScale.bandwidth() / 2;
            } else {
                // Linear scale - direct mapping
                return xScale(parseNumber(xValue));
            }
        };

        let finalRadius = currentSeriesConfig ? currentSeriesConfig.strokeWidth : this.radius;
        // Calculate area from radius: Area = pi * r^2
        // D3 symbol size is area in square pixels
        const symbolArea = Math.PI * Math.pow(parseFloat(finalRadius || this.radius), 2);

        // Render points
        g.selectAll('.dot')
            .data(validData)
            .enter()
            .append('path') // Changed from circle to path
            .attr('class', 'dot')
            .attr('d', d3.symbol()
                .type(d => {
                    if (symbolMap && filterColumn) {
                        return SymbolFactory.getSymbol(d[filterColumn], symbolMap);
                    }
                    return d3.symbolCircle;
                })
                .size(symbolArea)
            )
            .attr('transform', d => `translate(${getXPosition(d)},${yScale(parseNumber(d[yAxisInfo.columnName]))})`)
            .style('fill', d => this.getPointColor(d, colorScale, colorInfo, config, seriesColor))
            .style('opacity', this.opacity)
            .style('stroke', '#000')
            .style('stroke-width', 0.5)
            .append('title') // Add tooltip
            .text(d => {
                let text = `${xAxisInfo.columnName}: ${d[xAxisInfo.columnName]}\n${yAxisInfo.columnName}: ${d[yAxisInfo.columnName]}`;
                if (filterColumn) {
                    text += `\n${filterColumn}: ${d[filterColumn]}`;
                }
                return text;
            });

        console.log('Scatter chart rendered successfully', g.selectAll('.dot').data().length);
    }

    /**
     * Set circle radius
     * @param {number} radius - New radius value
     */
    setRadius(radius) {
        if (radius > 0) {
            this.radius = radius;
        }
    }

    /**
     * Set circle opacity
     * @param {number} opacity - New opacity value (0-1)
     */
    setOpacity(opacity) {
        if (opacity >= 0 && opacity <= 1) {
            this.opacity = opacity;
        }
    }

    /**
     * Calculate extents for scatter plot with marker size
     * @param {Array<Object>} data - Data to analyze
     * @param {Object} scales - Scale objects
     * @param {Object} xAxisInfo - X-axis info
     * @param {Object} yAxisInfo - Y-axis info
     * @returns {Object} Extents including marker radius
     */
    calculateExtents(data, scales, xAxisInfo, yAxisInfo) {
        return super.calculateExtents(data, scales, xAxisInfo, yAxisInfo, {
            radius: this.radius,
            strokeWidth: 0.5 // Default stroke width for scatter
        });
    }

}
