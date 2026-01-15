/**
 * @fileoverview Bar chart renderer for D3 visualizations.
 * Supports grouped and stacked bar charts with multiple series.
 *
 * @author Harison Sharp
 * @since 0.3.0
 *
 * @module Bar Chart Renderer
 * @type {Class}
 *
 * @requires d3 - Data visualization library
 * @requires BaseChartRenderer - Abstract base class
 *
 * @exports BarChartRenderer - Bar chart rendering implementation
 *
 * @example
 * const renderer = new BarChartRenderer({ mode: 'group', padding: 0.05 });
 * renderer.render(g, data, scales, xAxisInfo, seriesInfo, config, seriesColorScale);
 *
 * @relatedFiles BaseChartRenderer, GraphService
 */

import * as d3 from 'd3';
import { BaseChartRenderer } from './BaseChartRenderer.js';
import { debugLog, debugWarn } from '../../utils/debug.js';

export class BarChartRenderer extends BaseChartRenderer {
    /**
     * Create a bar chart renderer
     * @param {Object} options - Rendering options
     * @param {string} options.mode - 'group' or 'stack' (default: 'group')
     * @param {number} options.padding - Padding between bars (default: 0.05)
     * @param {number} options.opacity - Bar opacity (default: 0.8)
     */
    constructor(options = {}) {
        super();
        this.mode = options.mode || 'group';
        this.padding = options.padding || 0.5;
        this.opacity = options.opacity || 0.8;
    }

    /**
     * Get renderer type
     * @returns {string} 'bar'
     */
    getType() {
        return 'bar';
    }

    /**
     * Render bar chart (delegates to grouped or stacked)
     * @param {d3.Selection} g - D3 group selection
     * @param {Array<Object>} data - Data to render
     * @param {Object} scales - {xScale, yScale}
     * @param {Object} xAxisInfo - X-axis column info
     * @param {Array<Object>} seriesInfo - Array of series configurations
     * @param {Object} config - Graph configuration
     * @param {d3.Scale} seriesColorScale - Color scale for series
     */
    render(g, data, scales, xAxisInfo, seriesInfo, config, seriesColorScale) {
        this.validateRenderParams(g, data, scales);

        if (!Array.isArray(seriesInfo) || seriesInfo.length === 0) {
            throw new Error('Bar chart requires at least one series');
        }

        const mode = config.barMode || this.mode;

        if (mode === 'stack') {
            this.renderStackedBars(g, data, scales, xAxisInfo, seriesInfo, seriesColorScale);
        } else {
            this.renderGroupedBars(g, data, scales, xAxisInfo, seriesInfo, seriesColorScale);
        }
    }

    /**
     * Render grouped bar chart
     * @param {d3.Selection} g - D3 group selection
     * @param {Array<Object>} data - Data to render
     * @param {Object} scales - {xScale, yScale}
     * @param {Object} xAxisInfo - X-axis column info
     * @param {Array<Object>} seriesInfo - Series configurations
     * @param {d3.Scale} seriesColorScale - Color scale for series
     */
    renderGroupedBars(g, data, scales, xAxisInfo, seriesInfo, seriesColorScale) {
        const { xScale, yScale } = scales;

        // Determine bandwidth and positioning function
        let bandwidth, getX;
        if (typeof xScale.bandwidth === 'function') {
            bandwidth = xScale.bandwidth();
            getX = d => xScale(d[xAxisInfo.columnName]);
        } else {
            // Fallback for non-band scales (Linear/Time)
            // Calculate minimum difference between x-values to determine bar width
            const xValues = data.map(d => d[xAxisInfo.columnName]).filter(v => v !== null && v !== undefined);
            const uniqueX = [...new Set(xValues)].sort((a, b) => a - b);
            let minDiff = Infinity;
            if (uniqueX.length > 1) {
                for (let i = 1; i < uniqueX.length; i++) {
                    const diff = Math.abs(xScale(uniqueX[i]) - xScale(uniqueX[i - 1]));
                    if (diff < minDiff) minDiff = diff;
                }
            } else {
                minDiff = 100; // Default width if only one point
            }

            // Use 80% of the minimum difference as bandwidth
            bandwidth = Math.max(1, minDiff * 0.8);
            getX = d => xScale(d[xAxisInfo.columnName]) - bandwidth / 2;
        }

        // Create sub-scale for grouping bars within each x-axis category
        const xGroup = d3.scaleBand()
            .domain(seriesInfo.map(s => s.yAxisInfo.columnName))
            .range([0, bandwidth])
            .padding(this.padding);

        // Use the y-scale domain minimum as the baseline for bars
        const yDomain = yScale.domain();
        const yMin = Math.min(...yDomain);
        const yBaseValue = Math.max(0, yMin); // Use 0 if it's in range, otherwise use yMin
        const yBase = yScale(yBaseValue);

        // Create groups for each x-axis value
        const groups = g.append('g')
            .selectAll('g')
            .data(data)
            .join('g')
            .attr('transform', d => `translate(${getX(d)},0)`);

        // Add bars for each series within each group
        groups.selectAll('rect')
            .data(d => seriesInfo.map(s => {
                const rawValue = d[s.yAxisInfo.columnName];
                const hasValue = rawValue !== undefined && rawValue !== null && rawValue !== '' && !isNaN(Number(rawValue));
                return {
                    key: s.yAxisInfo.columnName,
                    value: hasValue ? Number(rawValue) : null,
                    hasValue: hasValue
                };
            }).filter(item => item.hasValue)) // Only render bars for valid values
            .join('rect')
            .attr('x', d => xGroup(d.key))
            .attr('y', d => Math.min(yScale(d.value), yBase))
            .attr('width', xGroup.bandwidth())
            .attr('height', d => Math.abs(yScale(d.value) - yBase))
            .attr('fill', d => seriesColorScale(d.key))
            .attr('opacity', this.opacity)
            .append('title')
            .text(d => `${d.key}: ${d.value}`);

        // Draw error bars if data contains CI information
        this.drawErrorBars(g, data, scales, xAxisInfo, seriesInfo, xGroup, getX);
    }

    /**
     * Draw error bars for confidence intervals
     * @param {d3.Selection} g - D3 group selection
     * @param {Array<Object>} data - Data to render
     * @param {Object} scales - {xScale, yScale}
     * @param {Object} xAxisInfo - X-axis column info
     * @param {Array<Object>} seriesInfo - Series configurations
     * @param {d3.Scale} xGroup - Sub-scale for grouped bars (optional)
     * @param {Function} getX - Function to get X position of group (optional)
     */
    drawErrorBars(g, data, scales, xAxisInfo, seriesInfo, xGroup = null, getX = null) {
        const { xScale, yScale } = scales;

        // Helper to check if CI data exists
        const hasCIData = seriesInfo.some(s => {
            const col = s.yAxisInfo.columnName;
            return data.some(d => d[`${col}_ci_lower`] !== undefined && d[`${col}_ci_upper`] !== undefined);
        });

        if (!hasCIData) return;

        const capWidth = 10; // Width of the horizontal caps on error bars

        // Determine positioning logic
        let getBarX;
        if (xGroup && getX) {
            // Grouped bars
            getBarX = (d, seriesKey) => getX(d) + xGroup(seriesKey) + xGroup.bandwidth() / 2;
        } else {
            // Simple bars
            getBarX = (d) => {
                if (typeof xScale.bandwidth === 'function') {
                    return xScale(d[xAxisInfo.columnName]) + xScale.bandwidth() / 2;
                } else {
                    // Linear scale
                    // Re-calculate bar width or assume centered
                    // For simplicity, assume centered on point
                    return xScale(d[xAxisInfo.columnName]);
                }
            };
        }

        seriesInfo.forEach(s => {
            const col = s.yAxisInfo.columnName;

            // Filter data points that have CI info
            const validPoints = data.filter(d =>
                d[`${col}_ci_lower`] !== undefined &&
                d[`${col}_ci_upper`] !== undefined &&
                !isNaN(d[`${col}_ci_lower`]) &&
                !isNaN(d[`${col}_ci_upper`])
            );

            if (validPoints.length === 0) return;

            const errorGroup = g.append('g').attr('class', 'error-bars');

            validPoints.forEach(d => {
                const x = getBarX(d, col);
                const yTop = yScale(d[`${col}_ci_upper`]);
                const yBottom = yScale(d[`${col}_ci_lower`]);

                // Vertical line
                errorGroup.append('line')
                    .attr('x1', x)
                    .attr('x2', x)
                    .attr('y1', yTop)
                    .attr('y2', yBottom)
                    .attr('stroke', '#333')
                    .attr('stroke-width', 1.5);

                // Top cap
                errorGroup.append('line')
                    .attr('x1', x - capWidth / 2)
                    .attr('x2', x + capWidth / 2)
                    .attr('y1', yTop)
                    .attr('y2', yTop)
                    .attr('stroke', '#333')
                    .attr('stroke-width', 1.5);

                // Bottom cap
                errorGroup.append('line')
                    .attr('x1', x - capWidth / 2)
                    .attr('x2', x + capWidth / 2)
                    .attr('y1', yBottom)
                    .attr('y2', yBottom)
                    .attr('stroke', '#333')
                    .attr('stroke-width', 1.5);
            });
        });
    }

    /**
     * Render stacked bar chart
     * @param {d3.Selection} g - D3 group selection
     * @param {Array<Object>} data - Data to render
     * @param {Object} scales - {xScale, yScale}
     * @param {Object} xAxisInfo - X-axis column info
     * @param {Array<Object>} seriesInfo - Series configurations
     * @param {d3.Scale} seriesColorScale - Color scale for series
     */
    renderStackedBars(g, data, scales, xAxisInfo, seriesInfo, seriesColorScale) {
        const { xScale, yScale } = scales;

        // Determine bandwidth
        let bandwidth;
        if (typeof xScale.bandwidth === 'function') {
            bandwidth = xScale.bandwidth();
        } else {
            // Fallback for non-band scales (Linear/Time)
            const xValues = data.map(d => d[xAxisInfo.columnName]).filter(v => v !== null && v !== undefined);
            const uniqueX = [...new Set(xValues)].sort((a, b) => a - b);
            let minDiff = Infinity;
            if (uniqueX.length > 1) {
                for (let i = 1; i < uniqueX.length; i++) {
                    const diff = Math.abs(xScale(uniqueX[i]) - xScale(uniqueX[i - 1]));
                    if (diff < minDiff) minDiff = diff;
                }
            } else {
                minDiff = 100; // Default width if only one point
            }
            bandwidth = Math.max(1, minDiff * 0.8);
        }

        // Prepare data with null handling for d3.stack
        const cleanedData = data.map(d => {
            const cleaned = { ...d };
            seriesInfo.forEach(s => {
                const columnName = s.yAxisInfo.columnName;
                const rawValue = d[columnName];
                // Convert nulls/empty to 0 for stacking, or use actual numeric value
                const hasValue = rawValue !== undefined && rawValue !== null && rawValue !== '' && !isNaN(Number(rawValue));
                cleaned[columnName] = hasValue ? Number(rawValue) : 0;
            });
            return cleaned;
        });

        // Create stack generator
        const stack = d3.stack()
            .keys(seriesInfo.map(s => s.yAxisInfo.columnName));

        const stackedData = stack(cleanedData);

        // Render each series as a layer
        // In D3 stack: d[0] = start value (cumulative from previous series)
        //              d[1] = end value (cumulative including this series)
        g.selectAll('.stack')
            .data(stackedData)
            .enter()
            .append('g')
            .attr('class', 'stack')
            .attr('fill', d => seriesColorScale(d.key))
            .attr('opacity', this.opacity)
            .selectAll('rect')
            .data(d => d)
            .enter()
            .append('rect')
            .attr('x', d => {
                if (typeof xScale.bandwidth === 'function') {
                    return xScale(d.data[xAxisInfo.columnName]);
                }
                // For linear/time scales, center the bar
                // We need to recalculate bandwidth here or pass it down. 
                // Re-calculating for safety/simplicity in this context:
                const xVal = d.data[xAxisInfo.columnName];
                // Note: This is expensive to do per-bar. Ideally we calculate once.
                // But for now, let's assume we can get it from the first bar logic or pass it.
                // Simplified: assume same bandwidth as calculated in renderGroupedBars logic if we could share it.
                // Instead, let's just calculate it once at top of function.
                return xScale(xVal) - (bandwidth / 2);
            })
            .attr('y', d => yScale(d[1]))  // Top of this segment
            .attr('height', d => {
                const height = yScale(d[0]) - yScale(d[1]);
                // Only render if there's a meaningful height (original value wasn't 0/null)
                return height > 0 ? height : 0;
            })
            .attr('width', bandwidth)
            .each(function (d) {
                // Store reference to parent group to get series name
                const stackGroup = this.parentNode;
                const seriesName = d3.select(stackGroup).datum().key;
                const actualValue = d[1] - d[0];
                if (actualValue > 0) {
                    d3.select(this)
                        .append('title')
                        .text(`${seriesName}: ${actualValue}`);
                }
            });
    }

    /**
     * Render single series bar chart (for simple bar charts)
     * @param {d3.Selection} g - D3 group selection
     * @param {Array<Object>} data - Data to render
     * @param {Object} scales - {xScale, yScale}
     * @param {Object} xAxisInfo - X-axis column info
     * @param {Object} yAxisInfo - Y-axis column info
     * @param {Object} config - Graph configuration
     * @param {d3.Scale} colorScale - Optional color scale
     * @param {Object} colorInfo - Optional color column info
     */
    renderSimpleBars(g, data, scales, xAxisInfo, yAxisInfo, config, colorScale = null, colorInfo = null) {
        const { xScale, yScale } = scales;
        const validData = this.filterValidData(data, xAxisInfo, yAxisInfo);

        if (validData.length === 0) {
            console.warn('No valid data for bar chart');
            return;
        }

        // Calculate bar width and position
        let barWidth = 20;
        const getBarPosition = (d) => {
            const xValue = d[xAxisInfo.columnName];
            if (typeof xScale.bandwidth === 'function') {
                // Band scale
                barWidth = xScale.bandwidth();
                return xScale(xValue);
            } else {
                // Linear scale - calculate bar width based on data spacing
                const xValues = validData.map(d => +d[xAxisInfo.columnName]).sort((a, b) => a - b);
                if (xValues.length > 1) {
                    const minDiff = Math.min(...xValues.slice(1).map((v, i) => v - xValues[i]));
                    barWidth = Math.max(1, xScale(xValues[0] + minDiff) - xScale(xValues[0]) - 2);
                }
                return xScale(+xValue) - barWidth / 2;
            }
        };

        // Ensure y-scale has a baseline (0)
        const yBaseline = Math.max(0, Math.min(yScale.range()[0], yScale(0)));

        g.selectAll('rect.bar')
            .data(validData)
            .enter()
            .append('rect')
            .attr('class', 'bar')
            .attr('x', getBarPosition)
            .attr('y', d => {
                const yValue = +d[yAxisInfo.columnName];
                return yValue >= 0 ? yScale(yValue) : yBaseline;
            })
            .attr('width', barWidth)
            .attr('height', d => {
                const yValue = +d[yAxisInfo.columnName];
                return Math.abs(yScale(yValue) - yBaseline);
            })
            .attr('fill', d => this.getPointColor(d, colorScale, colorInfo, config, '#4682b4'))
            .attr('opacity', this.opacity)
            .style('stroke', '#fff')
            .style('stroke-width', 0.5)
            .append('title')
            .text(d => `${xAxisInfo.columnName}: ${d[xAxisInfo.columnName]}\n${yAxisInfo.columnName}: ${d[yAxisInfo.columnName]}`);

        // Draw error bars if data contains CI information
        // For simple bars, we treat it as a single series
        const seriesInfo = [{ yAxisInfo }];
        this.drawErrorBars(g, validData, scales, xAxisInfo, seriesInfo);
    }

    /**
     * Set bar rendering mode
     * @param {string} mode - 'group' or 'stack'
     */
    setMode(mode) {
        if (mode === 'group' || mode === 'stack') {
            this.mode = mode;
        }
    }

    /**
     * Set bar padding
     * @param {number} padding - Padding value (0-1)
     */
    setPadding(padding) {
        if (padding >= 0 && padding <= 1) {
            this.padding = padding;
        }
    }

    /**
     * Calculate extents for bar chart
     * Bars extend to full band width and from 0 to value
     * @param {Array<Object>} data - Data to analyze
     * @param {Object} scales - Scale objects
     * @param {Object} xAxisInfo - X-axis info
     * @param {Object} yAxisInfo - Y-axis info or seriesInfo array
     * @returns {Object} Extents including bar width
     */
    calculateExtents(data, scales, xAxisInfo, yAxisInfo) {
        if (!data || data.length === 0) {
            return null;
        }

        const { xScale, yScale } = scales;

        // For band scales, extent is the full range plus bandwidth
        const xMin = xScale.range()[0];
        const xMax = xScale.range()[1];

        // For bars, y extent goes from 0 (or min) to data values
        const yDomain = yScale.domain();
        const yMin = Math.min(0, ...yDomain);
        const yMax = Math.max(0, ...yDomain);

        return {
            xMin,
            xMax,
            yMin: yScale(yMax),
            yMax: yScale(yMin),
            strokeWidth: 0.5
        };
    }
}
