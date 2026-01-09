/**
 * @fileoverview Base abstract class for all chart renderers.
 * Provides common functionality and interface for specialized chart rendering implementations.
 *
 * @author Harison Sharp
 * @since 0.3.0
 *
 * @module Base Chart Renderer
 * @type {Abstract Class}
 *
 * @exports BaseChartRenderer - Abstract base class for chart renderers
 *
 * @example
 * class MyChartRenderer extends BaseChartRenderer {
 *     render(g, data, scales, config) {
 *         this.validateRenderParams(g, data, scales);
 *         // Implement specific rendering logic
 *     }
 * }
 *
 * @relatedFiles ScatterChartRenderer, LineChartRenderer, BarChartRenderer, HistogramRenderer
 */

import { DataValidator } from '../../core/validation/DataValidator.js';
import { ScaleFactory } from '../ScaleFactory.js';
import { debugLog, debugWarn } from '../../utils/debug.js';
import { parseNumber } from '../../utils/dataUtils.js';

export class BaseChartRenderer {
    /**
     * Get renderer type identifier
     * @returns {string} Chart type
     */
    getType() {
        throw new Error('getType() must be implemented by subclass');
    }

    /**
     * Validate data for rendering
     * @param {Array<Object>} data - Data to validate
     * @throws {Error} If data is invalid
     * @returns {boolean} True if valid
     */
    validateData(data) {
        DataValidator.validateCSVData(data);
        DataValidator.validateSufficientData(data, 1);
        return true;
    }

    /**
     * Filter data to include only valid numeric points
     * @param {Array<Object>} data - Source data
     * @param {Object} xAxisInfo - X-axis column info
     * @param {Object} yAxisInfo - Y-axis column info
     * @returns {Array<Object>} Filtered valid data
     */
    filterValidData(data, xAxisInfo, yAxisInfo) {
        return data.filter(d => {
            // File matching: Only exclude when files differ AND column doesn't exist in row
            const hasFileContext = yAxisInfo.fileName && d._sourceFile;
            const isSameFile = !hasFileContext || d._sourceFile === yAxisInfo.fileName;
            const columnExistsInRow = d.hasOwnProperty(yAxisInfo.columnName);

            if (hasFileContext && !isSameFile && !columnExistsInRow) {
                return false;
            }

            const xValue = d[xAxisInfo.columnName];
            const yValue = d[yAxisInfo.columnName];

            // X-axis must always be valid
            const xValid = xValue !== undefined &&
                xValue !== null &&
                xValue !== '' &&
                !isNaN(parseNumber(xValue)) &&
                isFinite(parseNumber(xValue));

            if (!xValid) return false;

            // Y-axis validation - be lenient for bar charts
            // Allow undefined/null/empty values which will be handled by the renderer
            if (yValue === undefined || yValue === null || yValue === '') {
                return false; // Still filter out completely missing Y values for single series
            }

            return !isNaN(parseNumber(yValue)) && isFinite(parseNumber(yValue));
        });
    }

    /**
     * Validate render parameters
     * @param {d3.Selection} g - D3 group selection
     * @param {Array<Object>} data - Data to render
     * @param {Object} scales - Scale objects {xScale, yScale}
     * @throws {Error} If parameters are invalid
     * @returns {boolean} True if valid
     */
    validateRenderParams(g, data, scales) {
        if (!g) {
            throw new Error('SVG group element is required');
        }

        this.validateData(data);

        if (!scales || !scales.xScale || !scales.yScale) {
            throw new Error('Both xScale and yScale are required');
        }

        return true;
    }

    /**
     * Get default color for the chart
     * @returns {string} Default color
     */
    getDefaultColor() {
        return 'steelblue';
    }

    /**
     * Determine fill color for a data point
     * @param {Object} dataPoint - Individual data point
     * @param {d3.Scale} colorScale - Color scale (optional)
     * @param {Object} colorInfo - Color column info (optional)
     * @param {Object} config - Graph configuration
     * @param {string} fallbackColor - Fallback color if no scale
     * @returns {string} Color value
     */
    getPointColor(dataPoint, colorScale, colorInfo, config, fallbackColor) {
        const series = config.series.filter(s => s.yAxis.split('::')[1] === dataPoint._sourceFile && Array.from(Object.keys(dataPoint)).includes(s.yAxis.split('::')[0]));
        if (series.length === 0) {
            debugWarn('[BASE_CHART_RENDERER - getPointColor] No series found for data point when getting color', dataPoint);
            return fallbackColor || this.getDefaultColor();
        } else {
            return ScaleFactory.resolveColor(series[0].color);
        }
        // if (config.colorGrading || colorScale || colorInfo) {
        //     const value = dataPoint[colorInfo.columnName];
        //     if (value !== undefined && value !== null) {
        //         return colorScale(value);
        //     }
        // }
        // return fallbackColor || this.getDefaultColor();
    }

    /**
     * Main render method - must be implemented by subclasses
     * @param {d3.Selection} g - D3 group selection for drawing
     * @param {Array<Object>} data - Data to render
     * @param {Object} scales - Scale objects {xScale, yScale}
     * @param {Object} xAxisInfo - X-axis column information
     * @param {Object} yAxisInfo - Y-axis column information
     * @param {Object} config - Rendering configuration
     * @param {d3.Scale} colorScale - Optional color scale
     * @param {Object} colorInfo - Optional color column info
     * @param {string} seriesColor - Optional series color
     * @param {Object} seriesConfig - Optional series configuration (points, curve type, etc.)
     * @throws {Error} If not implemented by subclass
     */
    render(g, data, scales, xAxisInfo, yAxisInfo, config, colorScale = null, colorInfo = null, seriesColor = null, seriesConfig = {}) {
        throw new Error('render() must be implemented by subclass');
    }

    /**
     * Clean up any resources (optional override)
     */
    dispose() {
        // Override if cleanup needed
    }

    /**
     * Get recommended minimum data points for this chart type
     * @returns {number} Minimum recommended data points
     */
    getMinimumDataPoints() {
        return 1;
    }

    /**
     * Check if this renderer supports the given configuration
     * @param {Object} config - Graph configuration
     * @returns {boolean} True if configuration is supported
     */
    supportsConfig(config) {
        return true; // Override if specific requirements
    }

    /**
     * Calculate data extents for canvas sizing (fast path)
     * Override this method in subclasses to provide accurate extent calculation
     * 
     * @param {Array<Object>} data - Data to analyze
     * @param {Object} scales - Scale objects {xScale, yScale}
     * @param {Object} xAxisInfo - X-axis column information
     * @param {Object} yAxisInfo - Y-axis column information
     * @param {Object} options - Renderer-specific options (radius, strokeWidth, etc.)
     * @returns {Object} Extents {xMin, xMax, yMin, yMax, radius, strokeWidth, labelPadding}
     */
    calculateExtents(data, scales, xAxisInfo, yAxisInfo, options = {}) {
        if (!data || data.length === 0) {
            return null;
        }

        const validData = this.filterValidData(data, xAxisInfo, yAxisInfo);
        if (validData.length === 0) {
            return null;
        }

        const { xScale, yScale } = scales;

        // Calculate x positions (handle both band and linear scales)
        const xPositions = validData.map(d => {
            const xValue = d[xAxisInfo.columnName];
            if (typeof xScale.bandwidth === 'function') {
                // Band scale - center of band
                return xScale(xValue) + xScale.bandwidth() / 2;
            } else {
                // Linear scale
                return xScale(parseNumber(xValue));
            }
        });

        // Calculate y positions
        const yPositions = validData.map(d => yScale(parseNumber(d[yAxisInfo.columnName])));

        return {
            xMin: Math.min(...xPositions),
            xMax: Math.max(...xPositions),
            yMin: Math.min(...yPositions),
            yMax: Math.max(...yPositions),
            radius: options.radius || 0,
            strokeWidth: options.strokeWidth || 0,
            labelPadding: options.labelPadding || 0
        };
    }
}
