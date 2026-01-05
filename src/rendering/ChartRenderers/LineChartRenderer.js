/**
 * @fileoverview Line chart renderer for D3 visualizations.
 * Renders data as connected line segments, sorting data by x-value.
 *
 * @author Harison Sharp
 * @since 0.3.0
 *
 * @module Line Chart Renderer
 * @type {Class}
 *
 * @requires d3 - Data visualization library
 * @requires BaseChartRenderer - Abstract base class
 *
 * @exports LineChartRenderer - Line chart rendering implementation
 *
 * @example
 * const renderer = new LineChartRenderer({ strokeWidth: 3, smooth: false });
 * renderer.render(g, data, scales, xAxisInfo, yAxisInfo, config, null, null, 'blue');
 *
 * @relatedFiles BaseChartRenderer, GraphService
 */

import * as d3 from 'd3';
import { BaseChartRenderer } from './BaseChartRenderer.js';

export class LineChartRenderer extends BaseChartRenderer {
    /**
     * Create a line chart renderer
     * @param {Object} options - Rendering options
     * @param {number} options.strokeWidth - Line width (default: 3)
     * @param {boolean} options.smooth - Use curve interpolation (default: false)
     * @param {string} options.curveType - D3 curve type if smooth (default: 'curveMonotoneX')
     */
    constructor(options = {}) {
        super();
        this.strokeWidth = options.strokeWidth || 4;
        this.smooth = options.smooth || false;
        this.curveType = options.curveType || 'curveMonotoneX';
    }

    /**
     * Get renderer type
     * @returns {string} 'line'
     */
    getType() {
        return 'line';
    }

    /**
     * Get minimum data points for line chart
     * @returns {number} 2 points minimum
     */
    getMinimumDataPoints() {
        return 2;
    }

    /**
     * Render line chart
     * @param {d3.Selection} g - D3 group selection
     * @param {Array<Object>} data - Data to render
     * @param {Object} scales - {xScale, yScale}
     * @param {Object} xAxisInfo - X-axis column info
     * @param {Object} yAxisInfo - Y-axis column info
     * @param {Object} config - Graph configuration
     * @param {d3.Scale} colorScale - Optional color scale (not typically used for lines)
     * @param {Object} colorInfo - Optional color column info
     * @param {string} seriesColor - Line color
     */
    render(g, data, scales, xAxisInfo, yAxisInfo, config, colorScale = null, colorInfo = null, seriesColor = null, seriesConfig = {}) {
        this.validateRenderParams(g, data, scales);

        const { xScale, yScale } = scales;
        const validData = this.filterValidData(data, xAxisInfo, yAxisInfo);

        if (validData.length < this.getMinimumDataPoints()) {
            console.warn(`Insufficient data points for line chart: need at least ${this.getMinimumDataPoints()}, got ${validData.length}`);
            return;
        }

        // Sort data by x-value for proper line connection
        const sortedData = validData.sort((a, b) => {
            const aVal = a[xAxisInfo.columnName];
            const bVal = b[xAxisInfo.columnName];

            // Handle both numeric and string comparisons
            if (typeof aVal === 'string' || typeof bVal === 'string') {
                return String(aVal).localeCompare(String(bVal));
            }
            return +aVal - +bVal;
        });

        // Handle both band and linear scales for x-axis
        const getXPosition = (d) => {
            const xValue = d[xAxisInfo.columnName];
            if (typeof xScale.bandwidth === 'function') {
                // Band scale - position at center of band
                return xScale(xValue) + xScale.bandwidth() / 2;
            } else {
                // Linear scale - direct mapping
                return xScale(+xValue);
            }
        };

        // Determine curve type from series config or default
        const curveType = seriesConfig.curveType || this.curveType || 'curveMonotoneX';

        // Create line generator
        const lineGenerator = d3.line()
            .x(getXPosition)
            .y(d => yScale(+d[yAxisInfo.columnName]));

        // Apply curve interpolation
        if (d3[curveType]) {
            lineGenerator.curve(d3[curveType]);
        } else {
            console.warn(`Invalid curve type: ${curveType}, falling back to linear`);
            lineGenerator.curve(d3.curveLinear);
        }

        // Determine line style (dash array)
        let strokeDashArray = 'none';
        const lineStyle = seriesConfig.lineStyle || 'solid';
        if (lineStyle === 'dashed') strokeDashArray = '10,5';
        else if (lineStyle === 'dotted') strokeDashArray = '2,4';
        else if (lineStyle === 'dash-dot') strokeDashArray = '10,5,2,5';

        const finalColor = seriesColor || this.getDefaultColor();

        // Draw the line
        g.append('path')
            .datum(sortedData)
            .attr('class', 'line-chart')
            .attr('fill', 'none')
            .attr('stroke', finalColor)
            .attr('stroke-width', this.strokeWidth)
            .attr('stroke-linejoin', 'round')
            .attr('stroke-linecap', 'round')
            .attr('stroke-dasharray', strokeDashArray)
            .attr('d', lineGenerator);

        // Draw points if enabled
        if (seriesConfig.showPoints) {
            g.selectAll('.line-point')
                .data(sortedData)
                .enter()
                .append('circle')
                .attr('class', 'line-point')
                .attr('cx', getXPosition)
                .attr('cy', d => yScale(+d[yAxisInfo.columnName]))
                .attr('r', (this.strokeWidth || 3) + 1) // Slightly larger than line width
                .attr('fill', finalColor)
                .attr('stroke', '#fff')
                .attr('stroke-width', 1);
        }
    }

    /**
     * Set line stroke width
     * @param {number} width - New stroke width
     */
    setStrokeWidth(width) {
        if (width > 0) {
            this.strokeWidth = width;
        }
    }

    /**
     * Enable or disable smooth curves
     * @param {boolean} smooth - Whether to use smooth curves
     */
    setSmooth(smooth) {
        this.smooth = smooth;
    }

    /**
     * Set curve type for smooth lines
     * @param {string} curveType - D3 curve type name
     */
    setCurveType(curveType) {
        if (d3[curveType]) {
            this.curveType = curveType;
        }
    }

    /**
     * Calculate extents for line chart with stroke width
     * @param {Array<Object>} data - Data to analyze
     * @param {Object} scales - Scale objects
     * @param {Object} xAxisInfo - X-axis info
     * @param {Object} yAxisInfo - Y-axis info
     * @returns {Object} Extents including stroke width
     */
    calculateExtents(data, scales, xAxisInfo, yAxisInfo) {
        return super.calculateExtents(data, scales, xAxisInfo, yAxisInfo, {
            strokeWidth: this.strokeWidth
        });
    }
}
