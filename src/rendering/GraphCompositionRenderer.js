/**
 * @fileoverview Rendering orchestration layer for graph composition.
 * Consolidates all visual rendering operations previously scattered across GraphService.
 * This is the canonical place for D3 DOM manipulation related to chart elements.
 *
 * @author Harison Sharp
 * @since 0.4.0
 *
 * @module GraphCompositionRenderer
 * @type {Class}
 *
 * @requires d3 - Data visualization library for rendering
 * @requires ../utils/graphUtils.js - generateContours for contour plotting
 * @requires ../utils/debug.js - debugLog, debugWarn for logging
 * @requires ./ChartRenderers/ChartRendererFactory.js - Factory for chart type renderers
 *
 * @function drawDataPoints - Render data points for a single series
 * @function drawDataSeries - Render multiple data series
 * @function drawContours - Render contour lines
 * @function drawCurveFits - Render trend lines with equations
 * @function renderCurveFitLegend - Render curve fit equation legend
 *
 * @exports GraphCompositionRenderer
 *
 * @example
 * const renderer = new GraphCompositionRenderer(colorSchemes);
 * renderer.drawDataSeries(g, validData, xScale, yScale, xAxisInfo, seriesInfo, colorScale, colorInfo, graphConfig, seriesColorScale);
 *
 * @relatedFiles GraphService.js (delegates here), LegendRenderer.js, ChartRendererFactory.js
 */

import * as d3 from 'd3';
import { generateContours } from '../utils/graphUtils.js';
import { parseNumber } from '../utils/dataUtils.js';
import { ChartRendererFactory } from './ChartRenderers/ChartRendererFactory.js';
import { debugLog, debugWarn } from '../utils/debug.js';

export class GraphCompositionRenderer {
    constructor(colorSchemes) {
        this.colorSchemes = colorSchemes;
    }

    /**
     * Render data series with support for multiple chart types and dual-axis
     *
     * @param {d3.Selection} g - SVG group element
     * @param {Array} validData - Validated data points
     * @param {d3.Scale} xScale - X-axis scale
     * @param {d3.Scale|Object} yScale - Y-axis scale (or {primary, secondary} for dual-axis)
     * @param {Object} xAxisInfo - X-axis column info
     * @param {Array} seriesInfo - Array of series configurations
     * @param {d3.Scale} colorScale - Color grading scale
     * @param {Object} colorInfo - Color column info
     * @param {Object} graphConfig - Graph configuration
     * @param {Function} seriesColorScale - Series color mapping function
     */
    drawDataSeries(g, validData, xScale, yScale, xAxisInfo, seriesInfo, colorScale, colorInfo, graphConfig, seriesColorScale) {
        const isDualAxis = yScale && typeof yScale === 'object' && yScale.primary && yScale.secondary;
        const graphType = (graphConfig?.graphType || 'scatter').toLowerCase();

        if (graphType === 'histogram') {
            const scales = { xScale, yScale: isDualAxis ? yScale.primary : yScale };
            const renderer = ChartRendererFactory.createRendererSafe('histogram');
            renderer.render(g, validData, scales, xAxisInfo, null, graphConfig, colorScale, colorInfo, seriesColorScale);
            return;
        }

        const primarySeries = seriesInfo.filter(s => s.axisAssignment !== 'secondary');
        const secondarySeries = seriesInfo.filter(s => s.axisAssignment === 'secondary');

        if (primarySeries.length > 0) {
            const primaryYScale = isDualAxis ? yScale.primary : yScale;
            this.renderSeriesGroup(g, validData, xScale, primaryYScale, xAxisInfo, primarySeries, colorScale, colorInfo, graphConfig, seriesColorScale);
        }

        if (isDualAxis && secondarySeries.length > 0) {
            this.renderSeriesGroup(g, validData, xScale, yScale.secondary, xAxisInfo, secondarySeries, colorScale, colorInfo, graphConfig, seriesColorScale);
        }
    }

    /**
     * Render a group of series on the same axis
     */
    renderSeriesGroup(g, validData, xScale, yScale, xAxisInfo, seriesInfo, colorScale, colorInfo, graphConfig, seriesColorScale) {
        const scales = { xScale, yScale };
        const graphType = (graphConfig?.graphType || 'scatter').toLowerCase();

        const barSeries = seriesInfo.filter(s => (s.graphType || graphType) === 'bar');
        const otherSeries = seriesInfo.filter(s => (s.graphType || graphType) !== 'bar');

        if (barSeries.length > 0) {
            const barRenderer = ChartRendererFactory.createRenderer('bar', { mode: graphConfig.barMode || 'group' });
            barRenderer.render(g, validData, scales, xAxisInfo, barSeries, graphConfig, seriesColorScale);
        }

        otherSeries.forEach((series, i) => {
            const yAxisInfo = series.yAxisInfo;
            debugLog(`[GraphCompositionRenderer] Series ${i} (${series.graphType}) data_points:`, { yAxisInfo, validData });

            const seriesValidData = validData.filter((d) => {
                if (series.graphType === 'histogram') return true;
                const hasFileContext = yAxisInfo.fileName && d._sourceFile;
                const isSameFile = !hasFileContext || d._sourceFile === yAxisInfo.fileName;
                const columnExistsInRow = d.hasOwnProperty(yAxisInfo.columnName);

                if (hasFileContext && !isSameFile && !columnExistsInRow) {
                    return false;
                }

                const yValue = d[yAxisInfo.columnName];
                return yValue !== undefined && yValue !== null && yValue !== '' && !isNaN(parseNumber(yValue));
            });

            if (seriesValidData.length === 0) {
                if (validData.length > 0) {
                    const samples = validData.slice(0, 3);
                    debugLog(`[GraphCompositionRenderer] FILTERING DEBUG for Series ${i} (${series.yAxisInfo.columnName}):`);
                    samples.forEach((d, idx) => {
                        const val = d[yAxisInfo.columnName];
                        const parsed = parseNumber(val);
                        const fileMatch = (!yAxisInfo.fileName || !d._sourceFile || d._sourceFile === yAxisInfo.fileName);
                        debugLog(`[GraphCompositionRenderer] Sample ${idx}:`, { rawVal: val, parsed, sourceFile: d._sourceFile, targetFile: yAxisInfo.fileName, fileMatch });
                    });
                }
                debugLog(`[GraphCompositionRenderer] Series ${i} (${series.yAxisInfo.columnName}) has no valid data points. Skipping.`);
                return;
            }

            debugLog(`[GraphCompositionRenderer] Series ${i} (${series.graphType}):`, { totalValidData: validData.length, seriesValidData: seriesValidData.length, yAxisColumn: yAxisInfo.columnName });

            const seriesGraphType = series.graphType || 'scatter';
            const renderer = ChartRendererFactory.createRendererSafe(seriesGraphType);
            const seriesColor = seriesColorScale ? seriesColorScale(yAxisInfo.columnName) : null;

            const targetIndex = graphConfig.colorGradingTarget !== undefined ? parseInt(graphConfig.colorGradingTarget) : 0;
            const globalIndex = graphConfig.series.findIndex(s => s.yAxis === series.yAxis && s.axisAssignment === series.axisAssignment);

            const useColorScale = (globalIndex === targetIndex) ? colorScale : null;
            const useColorInfo = (globalIndex === targetIndex) ? colorInfo : null;

            const seriesGroup = g.append('g').attr('class', `series-group-${i}`);

            renderer.render(seriesGroup, seriesValidData, scales, xAxisInfo, yAxisInfo, graphConfig, useColorScale, useColorInfo, seriesColor, series);
        });
    }

    /**
     * Render data points for a single series (simplified API)
     */
    drawDataPoints(g, validData, xScale, yScale, xAxisInfo, yAxisInfo, colorScale, colorInfo, graphConfig) {
        const scales = { xScale, yScale };
        const graphType = graphConfig.graphType || 'scatter';
        const renderer = ChartRendererFactory.createRendererSafe(graphType);

        if (graphType === 'bar') {
            const barRenderer = ChartRendererFactory.createRenderer('bar');
            barRenderer.renderSimpleBars(g, validData, scales, xAxisInfo, yAxisInfo, graphConfig, colorScale, colorInfo);
        } else {
            renderer.render(g, validData, scales, xAxisInfo, yAxisInfo, graphConfig, colorScale, colorInfo);
        }
    }

    /**
     * Render contour lines from 3D data
     */
    drawContours(g, svg, validData, contourInfo, xAxisInfo, yAxisInfo, xScale, yScale, globalSettings) {
        const contourData = validData.filter(d =>
            d[contourInfo.columnName] !== undefined && !isNaN(+d[contourInfo.columnName])
        );

        if (contourData.length === 0) return;

        const { contours, thresholds } = generateContours(
            contourData,
            xAxisInfo.columnName,
            yAxisInfo.columnName,
            contourInfo.columnName,
            xScale,
            yScale
        );

        const contourGroup = g.append("g").attr("class", "contours");
        const contourColorScale = d3.scaleSequential(d3.interpolateViridis).domain([0, thresholds.length - 1]);

        contours.forEach((contour, i) => {
            const contourPath = d3.geoPath();
            contourGroup.append("path")
                .datum(contour)
                .attr("d", contourPath)
                .attr("fill", "none")
                .attr("stroke", contourColorScale(i))
                .attr("stroke-width", 1.5)
                .attr("stroke-opacity", 0.7);
        });

        return { thresholds, colorScale: contourColorScale, contourInfo };
    }

    /**
     * Render curve fit trend lines
     */
    drawCurveFits(g, curveFits, xScale, yScale, width, seriesInfo = [], axisInfo = {}, dimensions = {}) {
        const isDualAxis = yScale && typeof yScale === 'object' && yScale.primary && yScale.secondary;
        const isMultiYScale = Array.isArray(yScale);
        const equationItems = [];

        curveFits.forEach((curveFit, index) => {
            if (!curveFit.enabled || !curveFit.result || !curveFit.result.curvePoints) return;

            let thisYScale = isDualAxis ? yScale.primary : yScale;
            let seriesLabel = '';

            if (seriesInfo.length > 0) {
                const seriesIndex = curveFit.seriesIndex ?? 0;
                const targetSeries = seriesInfo[seriesIndex];
                const targetCol = targetSeries?.yAxisInfo?.columnName;

                if (targetCol) {
                    seriesLabel = ` (Series: ${targetCol})`;
                    if (isDualAxis && targetSeries?.axisAssignment === 'secondary') {
                        thisYScale = yScale.secondary;
                    }
                }
            }

            if (isMultiYScale && !isDualAxis && seriesInfo.length > 0) {
                const seriesIndex = curveFit.seriesIndex ?? 0;
                const targetCol = seriesInfo[seriesIndex]?.yAxisInfo?.columnName;
                if (targetCol) {
                    const foundIdx = seriesInfo.findIndex(s => s.yAxisInfo?.columnName === targetCol);
                    if (foundIdx !== -1 && yScale[foundIdx]) {
                        thisYScale = yScale[foundIdx];
                    }
                }
            }

            let effectiveXScale = xScale;
            const isBandScale = typeof xScale.bandwidth === 'function';
            if (isBandScale) {
                const numericXs = curveFit.result.curvePoints.map(p => +p.x).filter(v => !isNaN(v));
                const domainFromPoints = numericXs.length > 0 ? [Math.min(...numericXs), Math.max(...numericXs)] : null;
                const xDomain = (xScale.domain && xScale.domain()) || [];
                const numericDomain = xDomain.map(d => +d).filter(v => !isNaN(v));
                const domainToUse = domainFromPoints || (numericDomain.length > 0 ? [Math.min(...numericDomain), Math.max(...numericDomain)] : null);

                if (domainToUse) {
                    let rangeStart = xScale.range ? xScale.range()[0] : 0;
                    let rangeEnd = xScale.range ? xScale.range()[1] : 0;
                    if (xDomain.length > 0 && typeof xScale.bandwidth === 'function') {
                        try {
                            rangeStart = xScale(xDomain[0]) + xScale.bandwidth() / 2;
                            rangeEnd = xScale(xDomain[xDomain.length - 1]) + xScale.bandwidth() / 2;
                        } catch (e) {
                            debugWarn('Could not compute band centers for effectiveXScale', e);
                        }
                    }
                    effectiveXScale = d3.scaleLinear().domain(domainToUse).range([rangeStart, rangeEnd]);
                } else {
                    let rangeStart = xScale.range ? xScale.range()[0] : 0;
                    let rangeEnd = xScale.range ? xScale.range()[1] : curveFit.result.curvePoints.length - 1;
                    effectiveXScale = d3.scaleLinear().domain([0, curveFit.result.curvePoints.length - 1]).range([rangeStart, rangeEnd]);
                    debugWarn('Could not derive numeric x domain for band scale; using index-based mapping.');
                }
            }

            const line = d3.line()
                .curve(d3.curveBasis)
                .x(d => {
                    const xValue = effectiveXScale(d.x);
                    if (isNaN(xValue)) debugWarn(`Invalid x value for curve fit ${index}:`, d.x);
                    return xValue;
                })
                .y(d => {
                    const yValue = thisYScale(d.y);
                    if (isNaN(yValue)) debugWarn(`Invalid y value for curve fit ${index}:`, d.y);
                    return yValue;
                });

            const validPoints = curveFit.result.curvePoints.filter(d => {
                const xNum = +d.x;
                return !isNaN(effectiveXScale(xNum)) && !isNaN(thisYScale(d.y));
            });

            if (validPoints.length === 0) {
                debugWarn(`No valid points for curve fit ${index}. Skipping.`);
                return;
            }

            g.append("path")
                .datum(validPoints)
                .attr("fill", "none")
                .attr("stroke", curveFit.color)
                .attr("stroke-width", 3)
                .attr("stroke-dasharray", index === 0 ? "none" : "5,5")
                .attr("d", line);

            if (curveFit.result.equation) {
                equationItems.push({
                    text: curveFit.result.equation,
                    r2: curveFit.result.rSquared?.toFixed?.(4) ?? '',
                    color: curveFit.color,
                    seriesLabel
                });
            }

            debugLog(`Curve Fit ${index} Points:`, curveFit.result.curvePoints);
        });

        return { legendItems: equationItems };
    }

    /**
     * Render curve fit legend panel
     */
    renderCurveFitLegend(svgSelection, legendItems = [], axisInfo = {}, dimensions = {}, fallbackWidth = 0) {
        if (!svgSelection || typeof svgSelection.append !== 'function' || !legendItems.length) return;

        try {
            const svgEl = svgSelection.node ? svgSelection.node() : null;
            if (!svgEl) return;

            const svgSel = svgSelection;
            const padding = 8;
            const swatchSize = 10;
            const textGap = 6;
            const lineHeight = Math.max(swatchSize, 16) + 6;
            const headerHeight = 20;

            const ctx = document.createElement('canvas').getContext('2d');
            ctx.font = '12px sans-serif';
            const maxTextWidth = legendItems.reduce((max, it, i) => {
                const lbl = `Fit ${i + 1}${it.seriesLabel}: ${it.text} (R²=${it.r2})`;
                return Math.max(max, ctx.measureText(lbl).width);
            }, 0);

            const legendWidth = Math.ceil(maxTextWidth + padding * 2 + swatchSize + textGap);
            const legendHeight = headerHeight + (legendItems.length * lineHeight) + padding * 2;

            let numericHeight = Number(svgEl.getAttribute('height')) || svgEl.getBoundingClientRect?.()?.height || 0;
            let numericWidth = Number(svgEl.getAttribute('width')) || svgEl.getBoundingClientRect?.()?.width || fallbackWidth;

            if (numericHeight && legendHeight + 10 > numericHeight) {
                try { svgSel.attr('height', Math.ceil(legendHeight + 10)); numericHeight = Math.ceil(legendHeight + 10); } catch (e) { /* ignore */ }
            }

            const legendX = Math.max(10, (numericWidth - legendWidth) / 2);
            const marginBottom = (dimensions.margin && dimensions.margin.bottom) || 40;
            const axisBaseline = (axisInfo && typeof axisInfo.xAxisY === 'number') ? axisInfo.xAxisY : (numericHeight - marginBottom);
            const legendY = axisBaseline + ((axisInfo && axisInfo.xAxisLabelOffset) || 50) + 8;

            if (numericHeight && (legendY + legendHeight + 8) > numericHeight) {
                try { svgSel.attr('height', Math.ceil(legendY + legendHeight + 12)); } catch (e) { /* ignore */ }
            }

            const legendGroup = svgSel.append('g').attr('class', 'curve-fit-legend');

            legendGroup.append('rect')
                .attr('x', legendX).attr('y', legendY)
                .attr('width', legendWidth).attr('height', legendHeight)
                .attr('rx', 6).attr('ry', 6)
                .attr('fill', '#ffffff').attr('fill-opacity', 0.95)
                .attr('stroke', '#ccc').attr('stroke-width', 1);

            legendGroup.append('text')
                .attr('x', legendX + padding).attr('y', legendY + padding + headerHeight / 1.5)
                .attr('font-weight', 600).attr('font-size', 12).attr('font-family', 'sans-serif')
                .attr('fill', '#222').text('Curve Fit Legend');

            legendItems.forEach((it, i) => {
                const itemY = legendY + padding + headerHeight + (i * lineHeight) + 6;

                legendGroup.append('rect')
                    .attr('x', legendX + padding).attr('y', itemY - swatchSize + 2)
                    .attr('width', swatchSize).attr('height', swatchSize)
                    .attr('fill', it.color || '#000').attr('rx', 2).attr('ry', 2);

                const fullLbl = `Fit ${i + 1}${it.seriesLabel}: ${it.text} (R²=${it.r2})`;
                const textEl = legendGroup.append('text')
                    .attr('x', legendX + padding + swatchSize + textGap).attr('y', itemY)
                    .attr('font-size', 12).attr('font-family', 'sans-serif').attr('fill', '#111')
                    .text(fullLbl);

                textEl.append('title').text(fullLbl);
            });
        } catch (e) {
            debugWarn('Failed to render curve fit legend', e);
        }
    }
}
