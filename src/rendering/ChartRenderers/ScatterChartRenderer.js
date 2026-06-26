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
     * @param {Object} colorInfo - Optional color column info. In the case where color grading is distinct, this object has the columnName and the fileName the grading is based on.
     * @param {string} seriesColor - Optional series color
     * @param {Object} seriesConfig - The specific series configuration object for this render call
     */
    render(g, data, scales, xAxisInfo, yAxisInfo, config, colorScale = null, colorInfo = null, seriesColor = null, seriesConfig = null) {
        debugLog('ScatterChartRenderer.render - Start of Method', {
            g, data, scales, xAxisInfo, yAxisInfo, config, colorScale, colorInfo, seriesColor, seriesConfig
        });

        this.validateRenderParams(g, data, scales);
        const { xScale, yScale } = scales;
        let validData = this.filterValidData(data, xAxisInfo, yAxisInfo);

        if (validData.length === 0) {
            console.warn('No valid data points for scatter plot');
            return; 
        }

        // Use the directly-passed series config when available; fall back to a find() only for
        // legacy callers that do not supply the argument.
        const currentSeriesConfig = seriesConfig ?? config.series.find(s => {
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
                // Linear scale - pre-transform to log space if logX is active
                const raw = parseNumber(xValue);
                const mapped = config?.logX ? Math.log10(raw) : raw;
                return xScale(mapped);
            }
        };

        let finalRadius = currentSeriesConfig ? currentSeriesConfig.strokeWidth : this.radius;
        // Per-series opacity override (e.g. semi-transparent dots for dense overlays so an
        // underlying line stays visible). Falls back to the renderer default when unset.
        const finalOpacity = (currentSeriesConfig && currentSeriesConfig.opacity != null)
            ? currentSeriesConfig.opacity
            : this.opacity;
        // Calculate area from radius: Area = pi * r^2
        // D3 symbol size is area in square pixels
        const symbolArea = Math.PI * Math.pow(parseFloat(finalRadius || this.radius), 2);

        // Pre-compute per-point values into parallel arrays.
        // This moves all parseNumber / scale / color calls out of D3's attribute phase,
        // where they would be called inside closures that D3 invokes one-at-a-time with
        // repeated property lookups. A single typed pass is faster and more cache-friendly.
        const isBatchMode = config._isBatchMode === true;
        const yColName = yAxisInfo.columnName;
        const validDataLen = validData.length;
        const transforms = new Array(validDataLen);
        const fills = new Array(validDataLen);
        const symbolPaths = new Array(validDataLen);

        // Hoist d3.symbol generator — creating it once avoids N object allocations
        const symbolGen = d3.symbol().size(symbolArea);

        // When grading is active, each point needs its own colour; otherwise resolve once for the series.
        const hasColorGrading = colorScale && colorInfo?.columnName;
        const resolvedFill = hasColorGrading
            ? null
            : this.getPointColor(validData[0], colorScale, colorInfo, config, seriesColor);

        for (let i = 0; i < validDataLen; i++) {
            const d = validData[i];
            // Normalize so points with a missing filter value resolve to the shared
            // MISSING_CATEGORY symbol (its own glyph) rather than the fallback circle.
            const symType = (symbolMap && filterColumn)
                ? SymbolFactory.getSymbol(SymbolFactory.normalizeCategory(d[filterColumn]), symbolMap)
                : d3.symbolCircle;
            symbolPaths[i] = symbolGen.type(symType)();
            const rawY = parseNumber(d[yColName]);
            const mappedY = config?.logY ? Math.log10(rawY) : rawY;
            transforms[i] = `translate(${getXPosition(d)},${yScale(mappedY)})`;
            fills[i] = hasColorGrading
                ? this.getPointColor(d, colorScale, colorInfo, config, seriesColor)
                : resolvedFill;
        }

        // Render points — attribute callbacks now just index into pre-computed arrays
        const dots = g.selectAll('.dot')
            .data(validData)
            .enter()
            .append('path')
            .attr('class', 'dot')
            .attr('d', (_d, i) => symbolPaths[i])
            .attr('transform', (_d, i) => transforms[i])
            .style('fill', (_d, i) => fills[i])
            .style('opacity', finalOpacity)
            // Remember each point's base fill + opacity so hover highlighting can grey out the
            // others and later restore them to their original (possibly per-series) appearance.
            .attr('data-base-opacity', finalOpacity)
            .attr('data-base-fill', (_d, i) => fills[i])
            // Smoothly cross-fade colour/opacity when hover highlighting greys out the others.
            .style('transition', 'fill 120ms ease-out, opacity 120ms ease-out')
            .style('stroke', '#000')
            .style('stroke-width', 0.5);

        dots
            .on('mouseenter', (event, d) => {
                this.cancelPointHoverHide(g);
                this.highlightPoint(g, event.currentTarget);
                this.showPointHoverModal(g, event, d, { seriesName: yColName, graphConfig: config });
            })
            .on('mousemove', () => {
                this.cancelPointHoverHide(g);
            })
            .on('mouseleave', (event) => {
                this.clearPointHighlight(g);
                if (event.relatedTarget?.closest?.(`.${BaseChartRenderer.HOVER_MODAL_CLASS}`)) {
                    return;
                }
                this.schedulePointHoverHide(g, 500);
            })
            .on('click', (_event, d) => {
                void this.openLinkedResourceForPoint(d, config);
            });

       
        console.log('Scatter chart rendered successfully', validDataLen);
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
