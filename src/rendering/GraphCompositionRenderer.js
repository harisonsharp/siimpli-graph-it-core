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
                const columnExistsInRow = Object.hasOwn(d, yAxisInfo.columnName);

                if (hasFileContext && !isSameFile && !columnExistsInRow) {
                    return false;
                }

                const yValue = d[yAxisInfo.columnName];
                return yValue !== undefined && yValue !== null && yValue !== '' && !Number.isNaN(parseNumber(yValue));
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

            const targetIndex = graphConfig.colorGradingTarget !== undefined ? parseInt(graphConfig.colorGradingTarget, 10) : 0;
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
    drawContours(g, _svg, validData, contourInfo, xAxisInfo, yAxisInfo, xScale, yScale, _globalSettings) {
        const contourData = validData.filter(d =>
            d[contourInfo.columnName] !== undefined && !Number.isNaN(+d[contourInfo.columnName])
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

        // Optimized: Use D3 data binding instead of forEach loop
        contourGroup.selectAll("path")
            .data(contours)
            .enter()
            .append("path")
            .attr("d", d => d3.geoPath()(d))
            .attr("fill", "none")
            .attr("stroke", (_d, i) => contourColorScale(i))
            .attr("stroke-width", 1.5)
            .attr("stroke-opacity", 0.7);

        return { thresholds, colorScale: contourColorScale, contourInfo };
    }

    /**
     * Render curve fit trend lines
     */
    drawCurveFits(g, curveFits, xScale, yScale, _width, seriesInfo = [], _axisInfo = {}, _dimensions = {}) {
        const isDualAxis = yScale && typeof yScale === 'object' && yScale.primary && yScale.secondary;
        const isMultiYScale = Array.isArray(yScale);
        const equationItems = [];

        // Add a clip path to prevent curve fit paths from escaping the plot area.
        // D3 linear/log scales produce valid pixel coordinates for out-of-domain values,
        // so without clipping a curve can extend far outside the chart bounds.
        const plotWidth = _dimensions.width || _width || 0;
        const plotHeight = _dimensions.height || 0;
        const clipId = `curve-fit-clip-${Math.random().toString(36).slice(2, 7)}`;
        const svgDefs = g.node()?.ownerSVGElement
            ? d3.select(g.node().ownerSVGElement).select('defs').empty()
                ? d3.select(g.node().ownerSVGElement).append('defs')
                : d3.select(g.node().ownerSVGElement).select('defs')
            : null;
        if (svgDefs && plotWidth > 0 && plotHeight > 0) {
            svgDefs.append('clipPath')
                .attr('id', clipId)
                .append('rect')
                .attr('x', 0).attr('y', 0)
                .attr('width', plotWidth).attr('height', plotHeight);
        }

        // Pre-compute rendering data for all curve fits
        const renderData = [];
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
                const numericXs = curveFit.result.curvePoints.map(p => +p.x).filter(v => !Number.isNaN(v));
                const domainFromPoints = numericXs.length > 0 ? [Math.min(...numericXs), Math.max(...numericXs)] : null;
                const xDomain = xScale.domain?.() ?? [];
                const numericDomain = xDomain.map(d => +d).filter(v => !Number.isNaN(v));
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
                    const rangeStart = xScale.range ? xScale.range()[0] : 0;
                    const rangeEnd = xScale.range ? xScale.range()[1] : curveFit.result.curvePoints.length - 1;
                    effectiveXScale = d3.scaleLinear().domain([0, curveFit.result.curvePoints.length - 1]).range([rangeStart, rangeEnd]);
                    debugWarn('Could not derive numeric x domain for band scale; using index-based mapping.');
                }
            }

            const line = d3.line()
                .curve(d3.curveBasis)
                .x(d => {
                    const xValue = effectiveXScale(d.x);
                    if (Number.isNaN(xValue)) debugWarn(`Invalid x value for curve fit ${index}:`, d.x);
                    return xValue;
                })
                .y(d => {
                    const yValue = thisYScale(d.y);
                    if (Number.isNaN(yValue)) debugWarn(`Invalid y value for curve fit ${index}:`, d.y);
                    return yValue;
                });

            // Clamp points to both axis domains so the curve never escapes the plot area.
            // D3 linear/log scales return valid (non-NaN) pixel values even for out-of-domain
            // inputs, so a NaN check alone is insufficient — we must also check domain bounds.
            const xDomainRaw = effectiveXScale.domain ? effectiveXScale.domain() : [];
            const yDomainRaw = thisYScale.domain ? thisYScale.domain() : [];
            const [xDomMin, xDomMax] = xDomainRaw.length === 2
                ? [Math.min(...xDomainRaw), Math.max(...xDomainRaw)]
                : [-Infinity, Infinity];
            const [yDomMin, yDomMax] = yDomainRaw.length === 2
                ? [Math.min(...yDomainRaw), Math.max(...yDomainRaw)]
                : [-Infinity, Infinity];

            const validPoints = curveFit.result.curvePoints.filter(d => {
                const xNum = +d.x;
                // Clamp to x domain only — curves may extend beyond the y data range
                // (e.g. with a static Y scale). Out-of-bounds y values are handled by
                // the clipPath applied to the rendered paths above.
                return Number.isFinite(xNum) &&
                    Number.isFinite(d.y) &&
                    !Number.isNaN(effectiveXScale(xNum)) &&
                    !Number.isNaN(thisYScale(d.y)) &&
                    xNum >= xDomMin && xNum <= xDomMax;
            });

            if (validPoints.length === 0) {
                debugWarn(`No valid points for curve fit ${index}. Skipping.`);
                return;
            }

            // Build confidence band area generators if bands exist
            const bandRenderData = [];
            const bands = curveFit.result.confidenceBands;
            if (Array.isArray(bands) && bands.length > 0) {
                bands.forEach((band, bandIdx) => {
                    if (!band.upperBandPoints?.length || !band.lowerBandPoints?.length) return;

                    // Pair upper/lower points by x-index for the area generator
                    const n = Math.min(band.upperBandPoints.length, band.lowerBandPoints.length);
                    const pairedPoints = Array.from({ length: n }, (_, i) => ({
                        x: band.upperBandPoints[i].x,
                        y1: band.upperBandPoints[i].y,
                        y0: band.lowerBandPoints[i].y
                    })).filter(p =>
                        !Number.isNaN(effectiveXScale(p.x)) &&
                        !Number.isNaN(thisYScale(p.y1)) &&
                        !Number.isNaN(thisYScale(p.y0)) &&
                        p.x >= xDomMin && p.x <= xDomMax &&
                        p.y1 >= yDomMin && p.y1 <= yDomMax &&
                        p.y0 >= yDomMin && p.y0 <= yDomMax
                    );

                    if (pairedPoints.length === 0) return;

                    const area = d3.area()
                        .curve(d3.curveBasis)
                        .x(d => effectiveXScale(d.x))
                        .y0(d => thisYScale(d.y0))
                        .y1(d => thisYScale(d.y1));

                    bandRenderData.push({
                        points: pairedPoints,
                        area,
                        color: band.color || curveFit.color,
                        bandIdx,
                        curveIndex: index
                    });
                });
            }

            renderData.push({
                points: validPoints,
                line,
                color: curveFit.color,
                index,
                equation: curveFit.result.equation,
                rSquared: curveFit.result.rSquared,
                seriesLabel,
                bandRenderData
            });

            debugLog(`Curve Fit ${index} Points:`, curveFit.result.curvePoints);
        });

        const clipAttr = svgDefs && plotWidth > 0 && plotHeight > 0 ? `url(#${clipId})` : null;

        // Render confidence bands first (underneath the curve lines)
        renderData.forEach(d => {
            if (!d.bandRenderData?.length) return;
            d.bandRenderData.forEach(band => {
                const path = g.append("path")
                    .attr("class", "curve-fit-band")
                    .attr("fill", band.color)
                    .attr("fill-opacity", 0.15)
                    .attr("stroke", band.color)
                    .attr("stroke-width", 1)
                    .attr("stroke-opacity", 0.4)
                    .attr("stroke-dasharray", "4,4")
                    .attr("d", band.area(band.points));
                if (clipAttr) path.attr("clip-path", clipAttr);
            });
        });

        // Optimized: Use D3 data binding to render all curve fits at once
        g.selectAll(".curve-fit-path")
            .data(renderData)
            .enter()
            .append("path")
            .attr("class", "curve-fit-path")
            .attr("fill", "none")
            .attr("stroke", d => d.color)
            .attr("stroke-width", 3)
            .attr("stroke-dasharray", d => d.index === 0 ? "none" : "5,5")
            .attr("d", d => d.line(d.points))
            .attr("clip-path", clipAttr ? clipAttr : null);

        // Build equation items from rendered data
        renderData.forEach(d => {
            if (d.equation) {
                equationItems.push({
                    text: d.equation,
                    r2: d.rSquared?.toFixed?.(4) ?? '',
                    color: d.color,
                    seriesLabel: d.seriesLabel
                });
            }
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

            let numericHeight = Number(svgEl.getAttribute('height')) || svgEl.getBoundingClientRect?.().height || 0;
            const numericWidth = Number(svgEl.getAttribute('width')) || svgEl.getBoundingClientRect?.().width || fallbackWidth;

            if (numericHeight && legendHeight + 10 > numericHeight) {
                try { svgSel.attr('height', Math.ceil(legendHeight + 10)); numericHeight = Math.ceil(legendHeight + 10); } catch { /* ignore */ }
            }

            const legendX = Math.max(10, (numericWidth - legendWidth) / 2);
            const marginBottom = dimensions.margin?.bottom ?? 40;
            const axisBaseline = (axisInfo && typeof axisInfo.xAxisY === 'number') ? axisInfo.xAxisY : (numericHeight - marginBottom);
            const legendY = axisBaseline + (axisInfo?.xAxisLabelOffset ?? 50) + 100;

            if (numericHeight && (legendY + legendHeight + 8) > numericHeight) {
                try { svgSel.attr('height', Math.ceil(legendY + legendHeight + 12)); } catch { /* ignore */ }
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

            // Optimized: Use D3 data binding for legend items
            const legendItemsGroup = legendGroup.selectAll('.legend-item')
                .data(legendItems)
                .enter()
                .append('g')
                .attr('class', 'legend-item')
                .attr('transform', (_d, i) => `translate(${legendX},${padding + legendY + headerHeight + (i * lineHeight)})`);

            legendItemsGroup.append('rect')
                .attr('x', padding).attr('y', 6 - swatchSize + 2)
                .attr('width', swatchSize).attr('height', swatchSize)
                .attr('fill', d => d.color || '#000').attr('rx', 2).attr('ry', 2);

            legendItemsGroup.append('text')
                .attr('x', padding + swatchSize + textGap).attr('y', 6)
                .attr('font-size', 12).attr('font-family', 'sans-serif').attr('fill', '#111')
                .text((d, i) => `Fit ${i + 1}${d.seriesLabel}: ${d.text} (R²=${d.r2})`)
                .append('title')
                .text((d, i) => `Fit ${i + 1}${d.seriesLabel}: ${d.text} (R²=${d.r2})`);
        } catch (e) {
            debugWarn('Failed to render curve fit legend', e);
        }
    }
}
