/**
 * @fileoverview Factory for creating appropriate chart renderer instances.
 * Provides centralized creation and management of chart renderers based on type.
 *
 * @author Harison Sharp
 * @since 0.3.0
 *
 * @module Chart Renderer Factory
 * @type {Class}
 *
 * @exports ChartRendererFactory - Factory for chart renderer instantiation
 *
 * @example
 * const renderer = ChartRendererFactory.createRenderer('scatter', { radius: 6 });
 * renderer.render(g, data, scales, xAxisInfo, yAxisInfo, config);
 *
 * @relatedFiles All chart renderers, GraphService
 */

import { ScatterChartRenderer } from './ScatterChartRenderer.js';
import { LineChartRenderer } from './LineChartRenderer.js';
import { BarChartRenderer } from './BarChartRenderer.js';
import { HistogramRenderer } from './HistogramRenderer.js';
import { debugLog, debugWarn } from '../../utils/debug.js';

export class ChartRendererFactory {
    /**
     * Registry of available renderer classes
     */
    static RENDERERS = {
        'scatter': ScatterChartRenderer,
        'line': LineChartRenderer,
        'bar': BarChartRenderer,
        'histogram': HistogramRenderer
    };

    /**
     * Create a chart renderer instance
     * @param {string} type - Chart type ('scatter', 'line', 'bar', 'histogram')
     * @param {Object} options - Renderer-specific options
     * @returns {BaseChartRenderer} Renderer instance
     * @throws {Error} If chart type is not supported
     *
     * @example
     * const scatterRenderer = ChartRendererFactory.createRenderer('scatter', { radius: 5 });
     * const lineRenderer = ChartRendererFactory.createRenderer('line', { strokeWidth: 2 });
     */
    static createRenderer(type, options = {}) {
        const RendererClass = this.RENDERERS[type];

        if (!RendererClass) {
            throw new Error(
                `Unknown chart type: ${type}. Supported types: ${Object.keys(this.RENDERERS).join(', ')}`
            );
        }

        return new RendererClass(options);
    }

    /**
     * Create multiple renderers for series
     * @param {Array<Object>} seriesInfo - Array of series configurations
     * @returns {Map<string, BaseChartRenderer>} Map of series ID to renderer
     *
     * @example
     * const renderers = ChartRendererFactory.createRenderersForSeries([
     *     { id: 'series1', graphType: 'scatter' },
     *     { id: 'series2', graphType: 'line' }
     * ]);
     */
    static createRenderersForSeries(seriesInfo) {
        const renderers = new Map();

        seriesInfo.forEach((series, index) => {
            const id = series.id || `series-${index}`;
            const type = series.graphType || 'scatter';
            const options = series.rendererOptions || {};

            try {
                renderers.set(id, this.createRenderer(type, options));
            } catch (error) {
                console.error(`Failed to create renderer for series ${id}:`, error);
                // Fall back to scatter renderer
                renderers.set(id, this.createRenderer('scatter', options));
            }
        });

        return renderers;
    }

    /**
     * Register a custom renderer class
     * @param {string} type - Chart type identifier
     * @param {Class} RendererClass - Renderer class (must extend BaseChartRenderer)
     *
     * @example
     * ChartRendererFactory.registerRenderer('custom', CustomChartRenderer);
     */
    static registerRenderer(type, RendererClass) {
        if (!type || typeof type !== 'string') {
            throw new Error('Renderer type must be a non-empty string');
        }

        if (!RendererClass || typeof RendererClass !== 'function') {
            throw new Error('RendererClass must be a constructor function');
        }

        this.RENDERERS[type] = RendererClass;
    }

    /**
     * Check if a renderer type is supported
     * @param {string} type - Chart type
     * @returns {boolean} True if supported
     */
    static isSupported(type) {
        return type in this.RENDERERS;
    }

    /**
     * Get list of supported chart types
     * @returns {Array<string>} Array of supported types
     */
    static getSupportedTypes() {
        return Object.keys(this.RENDERERS);
    }

    /**
     * Get default renderer for unknown types
     * @param {Object} options - Renderer options
     * @returns {BaseChartRenderer} Default scatter renderer
     */
    static getDefaultRenderer(options = {}) {
        return new ScatterChartRenderer(options);
    }

    /**
     * Create renderer with fallback
     * @param {string} type - Chart type
     * @param {Object} options - Renderer options
     * @returns {BaseChartRenderer} Renderer instance
     */
    static createRendererSafe(type, options = {}) {
        try {
            return this.createRenderer(type, options);
        } catch (error) {
            console.warn(`Failed to create ${type} renderer, using default:`, error.message);
            return this.getDefaultRenderer(options);
        }
    }
}
