import * as d3 from 'd3';
import { generateContours } from '../utils/graphUtils.js';
import { parseNumber } from '../utils/dataUtils.js';
import { ScaleFactory } from '../rendering/ScaleFactory.js';
import { ChartRendererFactory } from '../rendering/ChartRenderers/ChartRendererFactory.js';
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

    drawDataSeries(g, validData, xScale, yScale, xAxisInfo, seriesInfo, colorScale, colorInfo, graphConfig, seriesColorScale) {
        // Check if dual-axis mode
        const isDualAxis = yScale && typeof yScale === 'object' && yScale.primary && yScale.secondary;

        const graphType = (graphConfig?.graphType || 'scatter').toLowerCase();

        if (graphType === 'histogram') {
            const scales = { xScale, yScale: isDualAxis ? yScale.primary : yScale };
            const renderer = ChartRendererFactory.createRendererSafe('histogram');
            renderer.render(
                g,
                validData,
                scales,
                xAxisInfo,
                null,
                graphConfig,
                colorScale,
                colorInfo,
                seriesColorScale
            );
            return;
        }

        // Separate series by axis assignment
        const primarySeries = seriesInfo.filter(s => s.axisAssignment !== 'secondary');
        const secondarySeries = seriesInfo.filter(s => s.axisAssignment === 'secondary');

        // Render primary axis series
        if (primarySeries.length > 0) {
            const primaryYScale = isDualAxis ? yScale.primary : yScale;
            this.renderSeriesGroup(
                g,
                validData,
                xScale,
                primaryYScale,
                xAxisInfo,
                primarySeries,
                colorScale,
                colorInfo,
                graphConfig,
                seriesColorScale
            );
        }

        // Render secondary axis series
        if (isDualAxis && secondarySeries.length > 0) {
            this.renderSeriesGroup(
                g,
                validData,
                xScale,
                yScale.secondary,
                xAxisInfo,
                secondarySeries,
                colorScale,
                colorInfo,
                graphConfig,
                seriesColorScale
            );
        }
    }

    /**
     * Render a group of series on the same axis
     * @param {d3.Selection} g - SVG group
     * @param {Array} validData - Valid data points
     * @param {d3.Scale} xScale - X scale
     * @param {d3.Scale} yScale - Y scale for this group
     * @param {Object} xAxisInfo - X axis info
     * @param {Array} seriesInfo - Series to render
     * @param {d3.Scale} colorScale - Color scale
     * @param {Object} colorInfo - Color column info
     * @param {Object} graphConfig - Graph configuration
     * @param {Function} seriesColorScale - Series color scale
     */
    renderSeriesGroup(g, validData, xScale, yScale, xAxisInfo, seriesInfo, colorScale, colorInfo, graphConfig, seriesColorScale) {
        const scales = { xScale, yScale };
        const graphType = (graphConfig?.graphType || 'scatter').toLowerCase();

        const barSeries = seriesInfo.filter(s => (s.graphType || graphType) === 'bar');
        const otherSeries = seriesInfo.filter(s => (s.graphType || graphType) !== 'bar');

        // Render bar series (grouped or stacked)
        if (barSeries.length > 0) {
            const barRenderer = ChartRendererFactory.createRenderer('bar', {
                mode: graphConfig.barMode || 'group'
            });
            barRenderer.render(g, validData, scales, xAxisInfo, barSeries, graphConfig, seriesColorScale);
        }

        // Render other series types
        otherSeries.forEach((series, i) => {
            const yAxisInfo = series.yAxisInfo;
            // For non-bar charts, filter to only include rows with valid Y values for this specific series
            // For non-bar charts, filter to only include rows with valid Y values for this specific series
            debugLog(`[GraphService] Series ${i} (${series.graphType}) data_points:`, {
                yAxisInfo: yAxisInfo,
                validData: validData,
            });
            const seriesValidData = validData.filter((d, index) => {
                if (series.graphType === 'histogram') return true;
                // File matching: Only exclude rows when BOTH file context exists AND column is absent
                // This preserves column collision protection while supporting joined datasets
                const hasFileContext = yAxisInfo.fileName && d._sourceFile;
                const isSameFile = !hasFileContext || d._sourceFile === yAxisInfo.fileName;
                const columnExistsInRow = d.hasOwnProperty(yAxisInfo.columnName);

                // If files don't match, only include if column actually exists in this row
                if (hasFileContext && !isSameFile && !columnExistsInRow) {
                    return false;
                }

                const yValue = d[yAxisInfo.columnName];

                return yValue !== undefined &&
                    yValue !== null &&
                    yValue !== '' &&
                    !isNaN(parseNumber(yValue));
            });

            if (seriesValidData.length === 0) {
                // Skip this series if no valid data points exist (avoids DataValidator error)
                // This allows "partial data" scenarios where other series might have data,
                // or where this series is just empty/placeholder.
                // Detailed debug for skipped series
                if (validData.length > 0) {
                    const sampleSize = Math.min(validData.length, 3);
                    const samples = validData.slice(0, sampleSize);
                    debugLog(`[GraphService] FILTERING DEBUG for Series ${i} (${series.yAxisInfo.columnName}):`);
                    debugLog(`[GraphService] yAxisInfo:`, yAxisInfo);
                    samples.forEach((d, idx) => {
                        const val = d[yAxisInfo.columnName];
                        const parsed = parseNumber(val);
                        const fileMatch = (!yAxisInfo.fileName || !d._sourceFile || d._sourceFile === yAxisInfo.fileName);
                        debugLog(`[GraphService] Sample ${idx}:`, {
                            rawVal: val,
                            parsed: parsed,
                            sourceFile: d._sourceFile,
                            targetFile: yAxisInfo.fileName,
                            fileMatch: fileMatch,
                            colName: yAxisInfo.columnName,
                            rowKeys: Object.keys(d)
                        });
                    });
                }
                debugLog(`[GraphService] Series ${i} (${series.yAxisInfo.columnName}) has no valid data points. Skipping rendering.`);
                return;
            }

            debugLog(`[GraphService] Series ${i} (${series.graphType}):`, {
                totalValidData: validData.length,
                seriesValidData: seriesValidData.length,
                yAxisColumn: yAxisInfo.columnName
            });

            const graphType = series.graphType || 'scatter';
            const renderer = ChartRendererFactory.createRendererSafe(graphType);
            // Use yAxisInfo.columnName for series color mapping
            const seriesColor = seriesColorScale ? seriesColorScale(yAxisInfo.columnName) : null;

            // Determine if this series should receive color grading
            const targetIndex = graphConfig.colorGradingTarget !== undefined ? parseInt(graphConfig.colorGradingTarget) : 0;
            const globalIndex = graphConfig.series.findIndex(s => s.yAxis === series.yAxis && s.axisAssignment === series.axisAssignment);

            const useColorScale = (globalIndex === targetIndex) ? colorScale : null;
            const useColorInfo = (globalIndex === targetIndex) ? colorInfo : null;

            // Create a dedicated group for this series to prevent selector collisions
            const seriesGroup = g.append('g').attr('class', `series-group-${i}`);

            renderer.render(
                seriesGroup,
                seriesValidData,
                scales,
                xAxisInfo,
                yAxisInfo,
                graphConfig,
                useColorScale,
                useColorInfo,
                seriesColor,
                series // Pass the full series config object
            );
        });
    }

    drawDataPoints(g, validData, xScale, yScale, xAxisInfo, yAxisInfo, colorScale, colorInfo, graphConfig) {
        const scales = { xScale, yScale };
        const graphType = graphConfig.graphType || 'scatter';

        // Use renderer factory to create appropriate renderer
        const renderer = ChartRendererFactory.createRendererSafe(graphType);

        // For bar charts with single series, use simpler rendering method
        if (graphType === 'bar') {
            const barRenderer = ChartRendererFactory.createRenderer('bar');
            barRenderer.renderSimpleBars(g, validData, scales, xAxisInfo, yAxisInfo, graphConfig, colorScale, colorInfo);
        } else {
            renderer.render(g, validData, scales, xAxisInfo, yAxisInfo, graphConfig, colorScale, colorInfo);
        }
    }

    // Chart rendering methods have been moved to dedicated renderer classes
    // See: rendering/ChartRenderers/ for scatter, line, bar, and histogram renderers

    drawContours(g, svg, validData, contourInfo, xAxisInfo, yAxisInfo, xScale, yScale, globalSettings) {
        const contourData = validData.filter(d =>
            d[contourInfo.columnName] !== undefined &&
            !isNaN(+d[contourInfo.columnName])
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
        const contourColorScale = d3.scaleSequential(d3.interpolateViridis)
            .domain([0, thresholds.length - 1]);

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

        return {
            thresholds,
            colorScale: contourColorScale,
            contourInfo
        };
    }

    drawCurveFits(g, curveFits, xScale, yScale, width, seriesInfo = [], axisInfo = {}, dimensions = {}) {
        // Check if dual-axis mode (yScale is {primary, secondary})
        const isDualAxis = yScale && typeof yScale === 'object' && yScale.primary && yScale.secondary;

        // If yScale is an array, find the correct one by matching series yAxis column name
        const isMultiYScale = Array.isArray(yScale);
        // Collect equation items to render in a single, compact panel (reduces clutter)
        const equationItems = [];
        curveFits.forEach((curveFit, index) => {
            if (curveFit.enabled && curveFit.result && curveFit.result.curvePoints) {
                let thisYScale = isDualAxis ? yScale.primary : yScale;
                let seriesLabel = '';

                // Determine which Y scale to use based on series axis assignment
                if (seriesInfo.length > 0) {
                    const seriesIndex = curveFit.seriesIndex ?? 0;
                    const targetSeries = seriesInfo[seriesIndex];
                    const targetCol = targetSeries?.yAxisInfo?.columnName;

                    if (targetCol) {
                        seriesLabel = ` (Series: ${targetCol})`;

                        // Check if this series is assigned to secondary axis
                        if (isDualAxis && targetSeries?.axisAssignment === 'secondary') {
                            thisYScale = yScale.secondary;
                        }
                    }
                }

                if (isMultiYScale && !isDualAxis && seriesInfo.length > 0) {
                    const seriesIndex = curveFit.seriesIndex ?? 0;
                    const targetCol = seriesInfo[seriesIndex]?.yAxisInfo?.columnName;
                    // Find the yScale whose domain matches the series' yAxis column
                    // Assume yScale[i] corresponds to seriesInfo[i]
                    if (targetCol) {
                        // Try to find the matching yScale by domain
                        const foundIdx = seriesInfo.findIndex(s => s.yAxisInfo?.columnName === targetCol);
                        if (foundIdx !== -1 && yScale[foundIdx]) {
                            thisYScale = yScale[foundIdx];
                        }
                    }
                }
                // If xScale is a band/ordinal scale (bars), create a continuous linear scale
                // so curve fits (which are continuous) render correctly aligned with scatter points.
                let effectiveXScale = xScale;
                const isBandScale = typeof xScale.bandwidth === 'function';
                if (isBandScale) {
                    // Determine numeric domain from curve points if possible, otherwise fall back to xScale.domain().
                    const numericXs = curveFit.result.curvePoints.map(p => +p.x).filter(v => !isNaN(v));
                    const domainFromPoints = numericXs.length > 0 ? [Math.min(...numericXs), Math.max(...numericXs)] : null;
                    // If xScale.domain() is categorical (array of categories), we attempt to coerce if they are numbers.
                    const xDomain = (xScale.domain && xScale.domain()) || [];
                    const numericDomain = xDomain.map(d => +d).filter(v => !isNaN(v));
                    const domainToUse = domainFromPoints || (numericDomain.length > 0 ? [Math.min(...numericDomain), Math.max(...numericDomain)] : null);
                    if (domainToUse) {
                        // Map to the centers of the first and last category bands so the line aligns with category centers
                        let rangeStart = xScale.range ? xScale.range()[0] : 0;
                        let rangeEnd = xScale.range ? xScale.range()[1] : 0;
                        let firstCenter = null;
                        let lastCenter = null;
                        if (xDomain.length > 0 && typeof xScale.bandwidth === 'function') {
                            try {
                                firstCenter = xScale(xDomain[0]) + xScale.bandwidth() / 2;
                                lastCenter = xScale(xDomain[xDomain.length - 1]) + xScale.bandwidth() / 2;
                                // Use centers as the mapping range
                                rangeStart = firstCenter;
                                rangeEnd = lastCenter;
                                debugLog(`Band scale centers for curve fit: first=${firstCenter}, last=${lastCenter}`);
                            } catch (e) {
                                debugWarn('Could not compute band centers for effectiveXScale, falling back to range()', e);
                            }
                        }

                        effectiveXScale = d3.scaleLinear()
                            .domain(domainToUse)
                            .range([rangeStart, rangeEnd]);
                        debugLog(`Created linear effectiveXScale for curve fits with domain:`, domainToUse, "and range:", [rangeStart, rangeEnd]);
                    } else {
                        // Fallback: map using index positions across the band domain; try to use centers if available
                        let rangeStart = xScale.range ? xScale.range()[0] : 0;
                        let rangeEnd = xScale.range ? xScale.range()[1] : curveFit.result.curvePoints.length - 1;
                        if (xDomain.length > 0 && typeof xScale.bandwidth === 'function') {
                            try {
                                rangeStart = xScale(xDomain[0]) + xScale.bandwidth() / 2;
                                rangeEnd = xScale(xDomain[xDomain.length - 1]) + xScale.bandwidth() / 2;
                            } catch (e) {
                                // ignore and use default range
                            }
                        }
                        effectiveXScale = d3.scaleLinear()
                            .domain([0, curveFit.result.curvePoints.length - 1])
                            .range([rangeStart, rangeEnd]);
                        debugWarn('Could not derive numeric x domain for band scale; using index-based linear mapping for curve fit.');
                    }
                }

                const line = d3.line()
                    .curve(d3.curveBasis) // Apply smoothing to the line
                    .x(d => {
                        const xValue = effectiveXScale(d.x);
                        if (isNaN(xValue)) {
                            debugWarn(`Invalid x value for curve fit ${index}:`, d.x);
                        }
                        return xValue;
                    })
                    .y(d => {
                        const yValue = thisYScale(d.y);
                        if (isNaN(yValue)) {
                            debugWarn(`Invalid y value for curve fit ${index}:`, d.y);
                        }
                        return yValue;
                    });

                const validPoints = curveFit.result.curvePoints.filter((d, i) => {
                    const xNum = +d.x;
                    const xValid = !isNaN(effectiveXScale(xNum));
                    const yValid = !isNaN(thisYScale(d.y));
                    return xValid && yValid;
                });

                if (validPoints.length === 0) {
                    debugWarn(`No valid points for curve fit ${index}. Skipping rendering.`);
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
                    // Store the equation text and metadata to render after all curves are drawn
                    equationItems.push({
                        text: curveFit.result.equation,
                        r2: curveFit.result.rSquared?.toFixed?.(4) ?? '',
                        color: curveFit.color,
                        seriesLabel
                    });
                }

                // Detailed logging to help debug alignment issues
                try {
                    const sampleXs = curveFit.result.curvePoints.slice(0, 5).map(p => p.x);
                    debugLog(`CurveFit ${index} sample raw x values:`, sampleXs);
                    if (isBandScale) {
                        debugLog(`Original xScale domain (categorical):`, xScale.domain());
                        debugLog(`effectiveXScale domain/range:`, effectiveXScale.domain ? effectiveXScale.domain() : null, effectiveXScale.range ? effectiveXScale.range() : null);
                    } else {
                        debugLog(`Using provided xScale with domain/range:`, xScale.domain(), xScale.range());
                    }
                } catch (e) {
                    debugWarn('Error logging scale info for curve fit', e);
                }

                debugLog(`Curve Fit ${index} Points:`, curveFit.result.curvePoints);
                debugLog(`xScale Domain:`, xScale.domain());
                debugLog(`yScale Domain:`, thisYScale.domain());
            }
        });

        return { legendItems: equationItems };
    }

    renderCurveFitLegend(svgSelection, legendItems = [], axisInfo = {}, dimensions = {}, fallbackWidth = 0) {
        if (!svgSelection || typeof svgSelection.append !== 'function' || !legendItems.length) {
            return;
        }

        try {
            const svgEl = svgSelection.node ? svgSelection.node() : null;
            if (!svgEl) {
                return;
            }

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

            const currentHeight = svgEl.viewBox && svgEl.viewBox.baseVal && svgEl.viewBox.baseVal.height ? svgEl.viewBox.baseVal.height : svgEl.getAttribute('height');
            let numericHeight = Number(currentHeight) || 0;
            if (!numericHeight) {
                try { numericHeight = svgEl.getBoundingClientRect().height; } catch (e) { numericHeight = 0; }
            }

            if (numericHeight && legendHeight + 10 > numericHeight) {
                const newHeight = Math.ceil(legendHeight + 10);
                try {
                    svgSel.attr('height', newHeight);
                    numericHeight = newHeight;
                } catch (e) {
                    // ignore if cannot set
                }
            }

            const svgWidth = svgEl.viewBox && svgEl.viewBox.baseVal && svgEl.viewBox.baseVal.width ? svgEl.viewBox.baseVal.width : svgEl.getAttribute('width');
            let numericWidth = Number(svgWidth) || 0;
            if (!numericWidth) {
                try { numericWidth = svgEl.getBoundingClientRect().width; } catch (e) { numericWidth = fallbackWidth; }
            }

            const legendX = Math.max(10, (numericWidth - legendWidth) / 2);
            const marginBottom = (dimensions.margin && dimensions.margin.bottom) || 40;
            const axisBaseline = (axisInfo && typeof axisInfo.xAxisY === 'number') ? axisInfo.xAxisY : (numericHeight - marginBottom);
            const legendY = axisBaseline + ((axisInfo && axisInfo.xAxisLabelOffset) || 50) + 8;

            if (numericHeight && (legendY + legendHeight + 8) > numericHeight) {
                const newHeight = Math.ceil(legendY + legendHeight + 12);
                try { svgSel.attr('height', newHeight); numericHeight = newHeight; } catch (e) { /* ignore */ }
            }

            const legendGroup = svgSel.append('g').attr('class', 'curve-fit-legend');

            legendGroup.append('rect')
                .attr('x', legendX)
                .attr('y', legendY)
                .attr('width', legendWidth)
                .attr('height', legendHeight)
                .attr('rx', 6)
                .attr('ry', 6)
                .attr('fill', '#ffffff')
                .attr('fill-opacity', 0.95)
                .attr('stroke', '#ccc')
                .attr('stroke-width', 1);

            legendGroup.append('text')
                .attr('x', legendX + padding)
                .attr('y', legendY + padding + headerHeight / 1.5)
                .attr('font-weight', 600)
                .attr('font-size', 12)
                .attr('font-family', 'sans-serif')
                .text('Curve Fit Legend')
                .attr('fill', '#222');

            legendItems.forEach((it, i) => {
                const itemY = legendY + padding + headerHeight + (i * lineHeight) + 6;

                legendGroup.append('rect')
                    .attr('x', legendX + padding)
                    .attr('y', itemY - swatchSize + 2)
                    .attr('width', swatchSize)
                    .attr('height', swatchSize)
                    .attr('fill', it.color || '#000')
                    .attr('rx', 2)
                    .attr('ry', 2);

                const fullLbl = `Fit ${i + 1}${it.seriesLabel}: ${it.text} (R²=${it.r2})`;
                const textEl = legendGroup.append('text')
                    .attr('x', legendX + padding + swatchSize + textGap)
                    .attr('y', itemY)
                    .attr('font-size', 12)
                    .attr('font-family', 'sans-serif')
                    .attr('fill', '#111')
                    .text(fullLbl);

                textEl.append('title').text(fullLbl);
            });
        } catch (e) {
            debugWarn('Failed to render curve fit legend', e);
        }
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

