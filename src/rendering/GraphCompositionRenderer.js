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
 * @function drawCurveBounds - Render partitions for curve fits
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
import { parseColumnId } from '../utils/columnUtils.js';
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
    drawDataSeries(g, validData, xScale, yScale, xAxisInfo, seriesInfo, colorScale, colorInfo, graphConfig, seriesColorScale, seriesColorScales = null) {
        const isDualAxis = yScale && typeof yScale === 'object' && yScale.primary && yScale.secondary;
        const graphType = (graphConfig?.graphType || 'scatter').toLowerCase();

        if (graphType === 'histogram') {
            const scales = { xScale, yScale: isDualAxis ? yScale.primary : yScale };
            const renderer = ChartRendererFactory.createRendererSafe('histogram');
            renderer.render(g, validData, scales, xAxisInfo, null, graphConfig, colorScale, colorInfo, seriesColorScale);
            // Stacked histograms need a group-color legend; normal histograms skip this
            if (graphConfig.stackBy) {
                this.renderStackedHistogramLegend(g, validData, graphConfig, xScale);
            }
            return;
        }

        const primarySeries = seriesInfo.filter(s => s.axisAssignment !== 'secondary');
        const secondarySeries = seriesInfo.filter(s => s.axisAssignment === 'secondary');

        if (primarySeries.length > 0) {
            const primaryYScale = isDualAxis ? yScale.primary : yScale;
            this.renderSeriesGroup(g, validData, xScale, primaryYScale, xAxisInfo, primarySeries, graphConfig, seriesColorScale, seriesColorScales);
        }

        if (isDualAxis && secondarySeries.length > 0) {
            this.renderSeriesGroup(g, validData, xScale, yScale.secondary, xAxisInfo, secondarySeries, graphConfig, seriesColorScale, seriesColorScales);
        }
    }

    /**
     * Render a group of series on the same axis
     */
    renderSeriesGroup(g, validData, xScale, yScale, xAxisInfo, seriesInfo, graphConfig, seriesColorScale, seriesColorScales = null) {
        const scales = { xScale, yScale };
        const graphType = (graphConfig?.graphType || 'scatter').toLowerCase();

        const barSeries = seriesInfo.filter(s => (s.graphType || graphType) === 'bar');
        const otherSeries = seriesInfo.filter(s => (s.graphType || graphType) !== 'bar');

        if (barSeries.length > 0) {
            // Build a gradingMap for bar series: Map<columnName, { colorScale, colorInfo }>
            const gradingMap = new Map();
            barSeries.forEach(s => {
                const globalIdx = graphConfig.series.findIndex(
                    cfg => cfg.yAxis === s.yAxis && cfg.axisAssignment === s.axisAssignment
                );
                const grading = seriesColorScales?.[globalIdx] ?? null;
                if (grading) gradingMap.set(s.yAxisInfo.columnName, grading);
            });
            const barRenderer = ChartRendererFactory.createRenderer('bar', { mode: graphConfig.barMode || 'group' });
            barRenderer.render(g, validData, scales, xAxisInfo, barSeries, graphConfig, seriesColorScale, gradingMap.size > 0 ? gradingMap : null);
        }

        otherSeries.forEach((series, i) => {
            const yAxisInfo = series.yAxisInfo;
            debugLog(`[GraphCompositionRenderer] Series ${i} (${series.graphType}) data_points:`, { yAxisInfo, validData });

            const seriesValidData = validData.filter((d) => {
                if (series.graphType === 'histogram') return true;
                // For file-qualified series, only include rows from that source file.
                // Rows without _sourceFile are kept for backwards compatibility.
                if (yAxisInfo.fileName && d._sourceFile && d._sourceFile !== yAxisInfo.fileName) {
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

            const globalIndex = graphConfig.series.findIndex(s => s.yAxis === series.yAxis && s.axisAssignment === series.axisAssignment);
            const seriesGrading = seriesColorScales?.[globalIndex] ?? null;
            const useColorScale = seriesGrading?.colorScale ?? null;
            const useColorInfo = seriesGrading?.colorInfo ?? null;

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
    drawCurveFits(g, curveFits, xScale, yScale, _width, seriesInfo = [], _axisInfo = {}, _dimensions = {}, _config = {}) {
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
        const formatBoundLabel = d3.format(',.4r');
        let nextBoundNumber = 0;
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

            const SAFE_LIMIT = 5000;
            // X uses a much tighter clamp than SAFE_LIMIT: getBBox() ignores the clipPath,
            // so path geometry far past the plot edge inflates CanvasSizer's DOM measurement
            // and with it the popup window / export canvas. ~150px keeps enough off-plot
            // control points to preserve the spline's exit slope, and control-point x values
            // are monotone, so the clamped tail cannot swing back into the plot area. When
            // there is no plot frame (plotWidth 0) there is also no clipPath — keep the old
            // wide clamp so unclipped curves are not squashed.
            const X_CLIP_PAD = plotWidth > 0 ? 150 : SAFE_LIMIT;
            // Log-axis scales have log10-transformed domains and expect pre-transformed inputs,
            // matching the pattern used by ScatterChartRenderer and LineChartRenderer.
            const mapX = (v) => _config?.logX && v > 0 ? Math.log10(v) : v;
            const mapY = (v) => _config?.logY && v > 0 ? Math.log10(v) : v;

            const line = d3.line()
                .curve(d3.curveBasis)
                .x(d => {
                    const xValue = effectiveXScale(mapX(d.x));
                    if (Number.isNaN(xValue)) return 0;
                    return Math.max(-X_CLIP_PAD, Math.min(plotWidth + X_CLIP_PAD, xValue));
                })
                .y(d => {
                    const yValue = thisYScale(mapY(d.y));
                    if (Number.isNaN(yValue)) return 0;
                    return Math.max(-SAFE_LIMIT, Math.min(plotHeight + SAFE_LIMIT, yValue));
                });

            // Clamp points to the union of the scale domain and the curve fit's own x range.
            // D3 linear/log scales return valid (non-NaN) pixel values even for out-of-domain
            // inputs, so a NaN check alone is insufficient — we must also check domain bounds.
            // However, the user may intentionally set xMin below the data minimum, so we must
            // allow those points through. The clipPath handles visual containment.
            const xDomainRaw = effectiveXScale.domain ? effectiveXScale.domain() : [];
            const [xScaleDomMin, xScaleDomMax] = xDomainRaw.length === 2
                ? [Math.min(...xDomainRaw), Math.max(...xDomainRaw)]
                : [-Infinity, Infinity];

            // Union the scale domain with the curve fit's declared drawing range so that
            // user-specified extensions beyond the data extent are rendered correctly.
            // result.xMin/xMax are the authoritative numeric values set by performCurveFitting
            // (already clamped to ε for power law / custom fits with xMin ≤ 0).
            // result.xMin/xMax are raw data-space values; convert to scale space for comparison
            // against xScaleDomMin/Max which are already log10-transformed when logX is active.
            const fitXMin = Number.isFinite(curveFit.result.xMin) ? mapX(curveFit.result.xMin) : xScaleDomMin;
            const fitXMax = Number.isFinite(curveFit.result.xMax) ? mapX(curveFit.result.xMax) : xScaleDomMax;
            const xDomMin = Math.min(xScaleDomMin, fitXMin);
            const xDomMax = Math.max(xScaleDomMax, fitXMax);
            const validPoints = curveFit.result.curvePoints.filter(d => {
                const xNum = +d.x;
                const mx = mapX(xNum);

                // Clamp to x domain only — curves may extend beyond the y data range
                // (e.g. with a static Y scale). Out-of-bounds y values are handled by
                // the clipPath applied to the rendered paths above.
                return Number.isFinite(xNum) &&
                    Number.isFinite(d.y) &&
                    !Number.isNaN(effectiveXScale(mx)) &&
                    !Number.isNaN(thisYScale(mapY(d.y))) &&
                    mx >= xDomMin && mx <= xDomMax;
            });

            if (validPoints.length === 0) {
                debugWarn(`No valid points for curve fit ${index}. Skipping.`);
                return;
            }

            const boundXs = validPoints.map(p => +p.x).filter(v => Number.isFinite(v));
            const lowerBoundX = boundXs.length ? Math.min(...boundXs) : null;
            const upperBoundX = boundXs.length ? Math.max(...boundXs) : null;
            console.log("HELP: lower x bound: ", lowerBoundX);
            // Build confidence band area generators if bands exist
            const bandRenderData = [];
            const bands = curveFit.result.confidenceBands;
            if (Array.isArray(bands) && bands.length > 0) {
                bands.forEach((band, bandIdx) => {
                    if (!band.upperBandPoints?.length || !band.lowerBandPoints?.length) return;

                    // Pair upper/lower points by x-index for the area generator
                    const n = Math.min(band.upperBandPoints.length, band.lowerBandPoints.length);
                    const pairedPoints = Array.from({ length: n }, (_, i) => {
                        const p = {
                            x: band.upperBandPoints[i].x,
                            y1: band.upperBandPoints[i].y,
                            y0: band.lowerBandPoints[i].y
                        };
                        return p;
                    }).filter(p => {
                        // Only clamp to x domain (unioned with fit range) — band points outside
                        // the y domain are still rendered (clipped by the clipPath). Filtering on
                        // y would drop the leftmost band points when the band extends above/below
                        // the visible y range, creating a false vertical edge at the band start.
                        const mx = mapX(p.x);
                        return !Number.isNaN(effectiveXScale(mx)) &&
                            !Number.isNaN(thisYScale(mapY(p.y1))) &&
                            !Number.isNaN(thisYScale(mapY(p.y0))) &&
                            mx >= xDomMin && mx <= xDomMax;
                    });

                    if (pairedPoints.length === 0) return;

                    const area = d3.area()
                        .curve(d3.curveBasis)
                        .defined(d => {
                            // Lift the pen for points where either band edge is above the plot top
                            // (very negative pixel value on SVG's inverted y axis). Without this,
                            // curveBasis arcs back into the visible viewport between two clamped
                            // off-screen points, producing a spurious vertical line at the left edge.
                            const y0px = thisYScale(mapY(d.y0));
                            const y1px = thisYScale(mapY(d.y1));
                            return y0px > -SAFE_LIMIT && y1px > -SAFE_LIMIT;
                        })
                        .x(d => {
                            const xVal = effectiveXScale(mapX(d.x));
                            return Number.isNaN(xVal) ? 0 : Math.max(-X_CLIP_PAD, Math.min(plotWidth + X_CLIP_PAD, xVal));
                        })
                        .y0(d => {
                            const yVal = thisYScale(mapY(d.y0));
                            return Number.isNaN(yVal) ? 0 : Math.max(-SAFE_LIMIT, Math.min(plotHeight + SAFE_LIMIT, yVal));
                        })
                        .y1(d => {
                            const yVal = thisYScale(mapY(d.y1));
                            return Number.isNaN(yVal) ? 0 : Math.max(-SAFE_LIMIT, Math.min(plotHeight + SAFE_LIMIT, yVal));
                        });

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
                strokeWidth: curveFit.strokeWidth || 2,
                lineStyle: curveFit.lineStyle || 'solid',
                index,
                equation: curveFit.result.equation,
                rSquared: curveFit.result.rSquared,
                seriesLabel,
                bandRenderData,
                effectiveXScale,
                lowerBoundX,
                upperBoundX
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
            .attr("stroke-width", d => d.strokeWidth)
            .attr("stroke-dasharray", d => {
                if (d.lineStyle === 'dashed') return '10,5';
                if (d.lineStyle === 'dotted') return '2,4';
                if (d.lineStyle === 'dash-dot') return '10,5,2,5';
                return 'none';
            })
            .attr("d", d => d.line(d.points))
            .attr("clip-path", clipAttr);

        // DRAW BOUND LINES HERE
        // this.drawCurveBounds(plotHeight, renderData, _config, nextBoundNumber, formatBoundLabel, g, clipAttr);

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

    drawCurveBounds(plotHeight, renderData, config, nextBoundNumber, formatBoundLabel, g, clipAttr) {
        if (plotHeight > 0) {
            const boundMarkers = renderData.flatMap((d) => {
                const markers = [];
                const pushMarker = (boundType, rawValue) => {
                    if (!Number.isFinite(rawValue)) return;
                    const mappedX = config?.logX && rawValue > 0 ? Math.log10(rawValue) : rawValue;
                    const x = d.effectiveXScale?.(mappedX);
                    if (!Number.isFinite(x)) return;
                    markers.push({
                        boundNumber: nextBoundNumber++,
                        curveIndex: d.index,
                        color: d.color,
                        x,
                        rawValue,
                        boundType,
                        label: formatBoundLabel(rawValue)
                    });
                };

                pushMarker('lower', d.lowerBoundX);
                if (d.upperBoundX !== d.lowerBoundX) {
                    pushMarker('upper', d.upperBoundX);
                }
                return markers;
            });

            const boundsGroup = g.append('g').attr('class', 'curve-fit-bounds');

            const boundGroups = boundsGroup.selectAll('.curve-fit-bound')
                .data(boundMarkers)
                .enter()
                .append('g')
                .attr('class', d => `curve-fit-bound curve-fit-bound-${d.boundType}`);
            console.log('boundGroups', boundGroups);
            const boundLines = boundGroups.append('line')
                .attr('x1', d => d.x)
                .attr('x2', d => d.x)
                .attr('y1', 0)
                .attr('y2', plotHeight)
                .attr('stroke', d => d.color)
                .attr('stroke-width', 1)
                .attr('stroke-opacity', 0.6)
                .attr('stroke-dasharray', '3,3');
            if (clipAttr) boundLines.attr('clip-path', clipAttr);
            // instead of using boundType to decide the x attribute, we should look at the length of the label and ensure it's within the plot
            const boundLabels = boundGroups.append('text')
                .attr('x', d => d.boundType === 'lower' || d.x - d.label.length < 100 ? d.x + 4 : d.x - 4)
                .attr('y', d => 12 + (14 * d.boundNumber))
                .attr('text-anchor', d => d.boundType === 'lower' || d.x - d.label.length < 100 ? 'start' : 'end')
                .attr('font-size', 10)
                .attr('font-family', 'sans-serif')
                .attr('fill', d => d.color)
                .text(d => d.label);
            if (clipAttr) boundLabels.attr('clip-path', clipAttr);
        }
        
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

        /**
     * Render a color legend for stacked histograms, positioned top-right of the plot area.
     *
     * Groups are listed in the same alphabetical order used by generateStackedBins so the
     * colors here always match the bar segments. The palette mirrors HistogramRenderer.STACKED_PALETTE.
     *
     * @param {d3.Selection} g       - D3 group selection (chart coordinate space, after margins)
     * @param {Array}        data    - Full row-object data (used to discover group names)
     * @param {Object}       config  - Graph config (reads stackBy and optional stackColors overrides)
     * @param {d3.Scale}     xScale  - X-axis scale (used to right-align the legend box)
     */
    renderStackedHistogramLegend(g, data, config, xScale) {
        // Must mirror HistogramRenderer.STACKED_PALETTE exactly so bar colors = legend colors
        const PALETTE = ['#f59e0b', '#ef4444', '#0ea5e9', '#9ca3af'];

        // Parse "commodity_group::file.csv" → "commodity_group"
        const stackByColumn = parseColumnId(config.stackBy)?.columnName
            ?? config.stackBy.split('::')[0];

        // Discover group names in alphabetical order (same sort used by generateStackedBins)
        const groupSet = new Set();
        for (const row of data) {
            const grp = row[stackByColumn];
            if (grp != null && grp !== '') groupSet.add(String(grp));
        }
        const groupNames = [...groupSet].sort();
        if (groupNames.length === 0) return;

        const entries = groupNames.map((name, i) => ({
            name,
            // Per-group color override from config, otherwise fall back to palette
            color: config.stackColors?.[name] ?? PALETTE[i % PALETTE.length],
        }));

        // Layout constants
        const swatchSize   = 12;
        const textGap      = 6;
        const rowHeight    = swatchSize + 6;
        const padX         = 10;
        const padY         = 8;
        const headerHeight = 20;
        const approxCharW  = 7; // px per character at 11px sans-serif
        const maxLabelLen  = Math.max(...groupNames.map(n => n.length));
        const boxW         = padX * 2 + swatchSize + textGap + maxLabelLen * approxCharW;
        const boxH         = padY * 2 + headerHeight + entries.length * rowHeight;

        // Top-right of the plot area
        const plotWidth = xScale.range()[1];
        const legendX   = plotWidth - boxW - 12;
        const legendY   = 12;

        const legendGroup = g.append('g')
            .attr('class', 'stacked-histogram-legend')
            .attr('transform', `translate(${legendX}, ${legendY})`);

        // Background box
        legendGroup.append('rect')
            .attr('width', boxW).attr('height', boxH)
            .attr('rx', 6).attr('ry', 6)
            .attr('fill', '#ffffff').attr('fill-opacity', 0.92)
            .attr('stroke', '#e2e8f0').attr('stroke-width', 1);

        // Header text
        legendGroup.append('text')
            .attr('x', padX).attr('y', padY + 13)
            .attr('font-weight', 600).attr('font-size', 12)
            .attr('font-family', 'Inter, sans-serif').attr('fill', '#374151')
            .text('Commodity Group');

        // One swatch + label row per group
        entries.forEach((entry, i) => {
            const rowY = padY + headerHeight + i * rowHeight;
            const row  = legendGroup.append('g').attr('transform', `translate(${padX}, ${rowY})`);

            row.append('rect')
                .attr('width', swatchSize).attr('height', swatchSize)
                .attr('rx', 2).attr('fill', entry.color).attr('opacity', 0.85);

            row.append('text')
                .attr('x', swatchSize + textGap).attr('y', swatchSize - 1)
                .attr('font-size', 11).attr('font-family', 'Inter, sans-serif')
                .attr('fill', '#374151').text(entry.name);
        });
    }

}
