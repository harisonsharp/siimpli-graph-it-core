import * as d3 from 'd3';
import { generateContours } from '../utils/graphUtils.js';
import { parseNumber } from '../utils/dataUtils.js';
import { ScaleFactory } from '../rendering/ScaleFactory.js';
import { ChartRendererFactory } from '../rendering/ChartRenderers/ChartRendererFactory.js';
import { GraphCompositionRenderer } from '../rendering/GraphCompositionRenderer.js';
import { CanvasSizer } from './CanvasSizer.js';
import { debugLog, debugWarn } from '../utils/debug.js';
/**
 * @fileoverview Service class for D3.js-based graph rendering operations and data visualization logic.
 * Handles scale creation, data point rendering, contour generation, curve fitting display, and color management
 * for scientific graph visualization with multiple chart types and analysis features.
 *
 * @author Harison Sharp
 * @since 0.2.0
 *
 * @module Service Class
 * @type {Class}
 *
 * @requires d3 - Data visualization library for scales, rendering, and mathematical operations
 * @requires ./graphUtils.js - Utility functions (generateContours)
 *
 * @exports {Class} GraphService
 *
 * @example
 * const service = new GraphService(colorSchemes);
 * const scales = service.createScales(data, xAxis, yAxis, intercepts, width, height);
 * service.drawDataPoints(g, data, xScale, yScale, xAxisInfo, yAxisInfo, colorScale, colorInfo, config);
 *
 * @related GraphRenderer.jsx, graphUtils.js, dataUtils.js
 */

export class GraphService {
    constructor(colorSchemes) {
        this.colorSchemes = colorSchemes;
        /** @internal Renderer delegate for all D3 DOM operations */
        this._renderer = new GraphCompositionRenderer(colorSchemes);
    }


    createScales(validData, xAxisInfo, seriesInfo, width, height, graphConfig) {
        // Delegate to ScaleFactory for consistent scale creation
        return ScaleFactory.createScalesForGraph(
            validData,
            xAxisInfo,
            seriesInfo,
            width,
            height,
            graphConfig
        );
    }

    createColorScale(validData, colorInfo, graphConfig) {
        if (!graphConfig.colorGrading) return null;

        // Delegate to ScaleFactory for consistent color scale creation
        return ScaleFactory.createColorScale(validData, colorInfo, graphConfig.colorScheme);
    }

    /**
     * @deprecated Use GraphCompositionRenderer.drawDataSeries directly.
     * Delegates to internal renderer for backward compatibility.
     */
    drawDataSeries(g, validData, xScale, yScale, xAxisInfo, seriesInfo, colorScale, colorInfo, graphConfig, seriesColorScale) {
        return this._renderer.drawDataSeries(g, validData, xScale, yScale, xAxisInfo, seriesInfo, colorScale, colorInfo, graphConfig, seriesColorScale);
    }

    /**
     * @deprecated Use GraphCompositionRenderer.renderSeriesGroup directly.
     * @internal Delegates to internal renderer.
     */
    renderSeriesGroup(g, validData, xScale, yScale, xAxisInfo, seriesInfo, colorScale, colorInfo, graphConfig, seriesColorScale) {
        return this._renderer.renderSeriesGroup(g, validData, xScale, yScale, xAxisInfo, seriesInfo, colorScale, colorInfo, graphConfig, seriesColorScale);
    }

    /**
     * @deprecated Use GraphCompositionRenderer.drawDataPoints directly.
     */
    drawDataPoints(g, validData, xScale, yScale, xAxisInfo, yAxisInfo, colorScale, colorInfo, graphConfig) {
        return this._renderer.drawDataPoints(g, validData, xScale, yScale, xAxisInfo, yAxisInfo, colorScale, colorInfo, graphConfig);
    }

    // Chart rendering methods have been moved to dedicated renderer classes
    // See: rendering/ChartRenderers/ for scatter, line, bar, and histogram renderers

    /**
     * @deprecated Use GraphCompositionRenderer.drawContours directly.
     */
    drawContours(g, svg, validData, contourInfo, xAxisInfo, yAxisInfo, xScale, yScale, globalSettings) {
        return this._renderer.drawContours(g, svg, validData, contourInfo, xAxisInfo, yAxisInfo, xScale, yScale, globalSettings);
    }

    /**
     * @deprecated Use GraphCompositionRenderer.drawCurveFits directly.
     */
    drawCurveFits(g, curveFits, xScale, yScale, width, seriesInfo = [], axisInfo = {}, dimensions = {}) {
        return this._renderer.drawCurveFits(g, curveFits, xScale, yScale, width, seriesInfo, axisInfo, dimensions);
    }

    /**
     * @deprecated Use GraphCompositionRenderer.renderCurveFitLegend directly.
     */
    renderCurveFitLegend(svgSelection, legendItems = [], axisInfo = {}, dimensions = {}, fallbackWidth = 0) {
        return this._renderer.renderCurveFitLegend(svgSelection, legendItems, axisInfo, dimensions, fallbackWidth);
    }


    /**
     * Calculate combined extents for all rendered series
     * Used for dynamic canvas sizing via CanvasSizer
     * 
     * @param {Array<Object>} validData - Validated data points
     * @param {Object} scales - Scale objects {xScale, yScale}
     * @param {Object} xAxisInfo - X-axis column information
     * @param {Array<Object>} seriesInfo - Series configurations
     * @param {Object} graphConfig - Graph configuration
     * @returns {Object|null} Combined extents or null if no valid data
     */
    calculateSeriesExtents(validData, scales, xAxisInfo, seriesInfo, graphConfig) {
        if (!validData || validData.length === 0 || !seriesInfo || seriesInfo.length === 0) {
            return null;
        }

        const graphType = (graphConfig?.graphType || 'scatter').toLowerCase();
        let combinedExtents = null;

        // Helper to merge extents
        const mergeExtents = (existing, newExtents) => {
            if (!newExtents) return existing;
            if (!existing) return newExtents;

            return {
                xMin: Math.min(existing.xMin, newExtents.xMin),
                xMax: Math.max(existing.xMax, newExtents.xMax),
                yMin: Math.min(existing.yMin, newExtents.yMin),
                yMax: Math.max(existing.yMax, newExtents.yMax),
                radius: Math.max(existing.radius || 0, newExtents.radius || 0),
                strokeWidth: Math.max(existing.strokeWidth || 0, newExtents.strokeWidth || 0),
                labelPadding: Math.max(existing.labelPadding || 0, newExtents.labelPadding || 0)
            };
        };

        // Calculate extents for each series
        seriesInfo.forEach(series => {
            const yAxisInfo = series.yAxisInfo;
            const seriesValidData = validData.filter(d =>
                d[yAxisInfo.columnName] !== undefined &&
                !isNaN(+d[yAxisInfo.columnName])
            );

            if (seriesValidData.length === 0) return;

            const seriesGraphType = series.graphType || graphType;
            const renderer = ChartRendererFactory.createRendererSafe(seriesGraphType);

            // Determine correct yScale for this series
            // Determine correct yScale for this series
            const isDualAxis = scales.yScale && typeof scales.yScale === 'object' && scales.yScale.primary;
            let seriesYScale;
            if (isDualAxis) {
                seriesYScale = series.axisAssignment === 'secondary' ? scales.yScale.secondary : scales.yScale.primary;
            } else {
                seriesYScale = scales.yScale;
            }

            // Create series-specific scales object
            const seriesScales = {
                xScale: scales.xScale,
                yScale: seriesYScale
            };

            // Calculate extents for this series
            const extents = renderer.calculateExtents(
                seriesValidData,
                seriesScales,
                xAxisInfo,
                yAxisInfo
            );

            combinedExtents = mergeExtents(combinedExtents, extents);
        });

        return combinedExtents;
    }

    /**
     * Create and configure a CanvasSizer for an SVG element
     * 
     * @param {SVGElement} svgElement - SVG root element
     * @param {Object} options - CanvasSizer options
     * @returns {CanvasSizer} Configured canvas sizer instance
     */
    createCanvasSizer(svgElement, options = {}) {
        return new CanvasSizer(svgElement, options);
    }
}

