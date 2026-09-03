/**
 * @fileoverview Pure function for orchestration of graph rendering.
 * Encapsulates graph generation business logic including data validation, scale creation,
 * axis calculation, series rendering, and legend generation without React dependencies.
 */

import * as d3 from 'd3';
import { GraphService } from '../services/GraphService.js';
import { FileService } from '../services/FileService.js';
import { parseColumnId } from '../utils/columnUtils.js';
import { drawAxes } from '../utils/axisUtils.js';
import { renderLogo } from '../rendering/LogoRenderer.js';
import { generateTitle } from '../utils/dataUtils.js';
import { ScaleFactory } from '../rendering/ScaleFactory.js';
import { groupSeriesByAxis, getAxisColor, getAxisLabel } from '../utils/dualAxisUtils.js';
import { debugLog, debugWarn } from '../utils/debug.js';
import { LegendRenderer } from '../rendering/LegendRenderer.js';
import { UnifiedTableRenderer } from '../rendering/UnifiedTableRenderer.js';
import { BiasTableRenderer } from '../rendering/BiasTableRenderer.js';
import { alignFooterTables } from '../rendering/tableLayout.js';
import { BaseChartRenderer } from '../rendering/ChartRenderers/BaseChartRenderer.js';

/**
 * Parses column identifiers from configuration.
 * @param {Object} config - Graph configuration
 * @returns {Object} Parsed column information
 */
function parseColumnInformation(config) {
    const graphType = (config?.graphType || 'scatter').toLowerCase();
    const xAxisInfo = parseColumnId(config.xAxis);
    const xAxis2Info = config.xAxis2 ? parseColumnId(config.xAxis2) : null;

    const baseSeries = Array.isArray(config.series) ? config.series : [];
    const seriesInfo = graphType === 'histogram'
        ? []
        : baseSeries
            .map(s => ({
                ...s,
                yAxisInfo: parseColumnId(s.yAxis)
            }))
            .filter(s => s.yAxisInfo.columnName);
    
    const colorInfo = parseColumnId(config.colorGrading);
    const contourInfo = graphType === 'histogram' ? null : parseColumnId(config.contouring);

    return { xAxisInfo, xAxis2Info, seriesInfo, colorInfo, contourInfo, graphType};
}

/**
 * Calculates layout dimensions based on global settings and graph content.
 * @param {Object} settings - Global settings with graphDimensions
 * @param {Object} columnInfo - Parsed column information for legend sizing
 * @param {Object} graphConfig - Graph configuration for axis checks
 * @returns {Object} Margin and calculated dimensions
 */
function calculateDimensions(settings, columnInfo, graphConfig) {
    let rightMargin = 60; // Base spacing

    // 'top-right' / 'bottom-right' legends (LegendRenderer.drawSeriesLegend) are
    // positioned relative to the raw canvas width, not inside this margin — only
    // the default 'bottom-left' legend actually renders inside the reserved strip.
    // Inflating margin.right by label length for a right-positioned legend just
    // squishes the plot for no benefit, since the legend doesn't use that space.
    const legendPosition = graphConfig.legendPosition || 'bottom-left';
    const legendUsesRightMargin = legendPosition === 'bottom-left';

    if (legendUsesRightMargin && columnInfo && columnInfo.seriesInfo) {
        const longestLabel = columnInfo.seriesInfo.reduce((max, series) => {
            const label = series.yAxisInfo.columnName || '';
            return label.length > max.length ? label : max;
        }, '');
        const estimatedLegendWidth = (longestLabel.length * 7) + 40;
        rightMargin += estimatedLegendWidth;
    }

    const hasSecondaryAxis = graphConfig.series && graphConfig.series.some(s => s.axisAssignment === 'secondary');
    if (hasSecondaryAxis) {
        rightMargin += 50;
    }

    if (settings.showStaticTable) {
        rightMargin += 60;
    }

    rightMargin = Math.max(120, Math.min(450, rightMargin));

    const hasProjectName = Boolean(graphConfig.projectName && String(graphConfig.projectName).trim());
    const hasSubtitle = Boolean(graphConfig.subtitle && String(graphConfig.subtitle).trim());
    const topMargin = hasProjectName && hasSubtitle ? 130 : (hasProjectName || hasSubtitle ? 110 : 80);

    const margin = { top: topMargin, right: rightMargin, bottom: 100, left: 100 };

    const widthMultiplier = graphConfig.widthMultiplier || 1.0;
    const heightMultiplier = graphConfig.heightMultiplier || 1.0;

    const baseWidth = settings.graphDimensions.width;
    const baseHeight = settings.graphDimensions.height;

    const width = (baseWidth * widthMultiplier) - margin.left - margin.right;
    const height = (baseHeight * heightMultiplier) - margin.top - margin.bottom;

    return { margin, width, height };
}

/**
 * Creates scales for x-axis, y-axis, colors, and series.
 * @param {Array} validData - Filtered valid data points
 * @param {Object} columnInfo - Parsed column information
 * @param {Object} dimensions - Layout dimensions
 * @param {Object} config - Graph configuration
 * @param {Object} settings - Global settings with colorScheme
 * @returns {Object} Created scales
 */
function createScales(validData, columnInfo, dimensions, config) {
    const { xAxisInfo, seriesInfo, colorInfo, graphType } = columnInfo;
    const { width, height } = dimensions;

    const { xScale, yScale } = ScaleFactory.createScalesForGraph(
        validData,
        xAxisInfo,
        seriesInfo,
        width,
        height,
        config
    );

    // Legacy global colorGrading scale — kept for histogram fallback, null in practice now
    const colorScale = colorInfo?.columnName
        ? ScaleFactory.createColorScale(validData, colorInfo)
        : null;

    const seriesNames = seriesInfo.map(s => s.yAxisInfo.columnName).filter(Boolean);
    const seriesColorScale = seriesNames.length > 0
        ? ScaleFactory.createSeriesColorScale(seriesNames, seriesInfo)
        : null;

    const seriesColorScales = ScaleFactory.createSeriesColorScales(validData, seriesInfo);

    return { xScale, yScale, colorScale, seriesColorScale, seriesColorScales };
}

/**
 * Renders the graph title.
 * @param {d3.Selection} svg - SVG element selection
 * @param {Object} config - Graph configuration
 * @param {Object} columnInfo - Parsed column information
 * @param {Object} settings - Global settings
 * @param {Object} dimensions - Layout dimensions
 */
function renderTitle(svg, config, columnInfo, settings, dimensions) {
    const { xAxisInfo, seriesInfo } = columnInfo;
    const title = config.title || generateTitle(
        config,
        seriesInfo.map(s => s.yAxisInfo),
        xAxisInfo
    );
    renderProjectName(svg, config, dimensions, title);
}

/**
 * Nudge a centred label back inside the canvas if it starts left of x=0.
 *
 * A label centred on the plot is drawn from `centerX - width/2`, so once it is wider than
 * twice `centerX` its left end goes NEGATIVE — and that part is simply gone. Nothing can
 * scroll left of the SVG origin, and CanvasSizer only ever grows the canvas right and down,
 * so unlike a right-hand overrun this loss is unrecoverable. Shifting the label right makes
 * it overrun to the right instead, which the canvas does expand to cover.
 *
 * Measured, not estimated, because a character-width guess is wrong by ~2x in either
 * direction depending on the face (see the headless getBoundingClientRect shim). Skipped
 * entirely where the platform cannot measure: no getBBox means no change, never a guess.
 *
 * @param {d3.Selection} textEl - The already-appended text element.
 * @param {number} [pad] - Minimum left margin to leave, in px.
 */
function keepInsideLeftEdge(textEl, pad = 10) {
    const node = typeof textEl.node === 'function' ? textEl.node() : null;
    if (!node || typeof node.getBBox !== 'function') return;
    let box;
    try { box = node.getBBox(); } catch { return; }
    if (!box || !box.width || box.x >= pad) return;
    const x = parseFloat(textEl.attr('x')) || 0;
    textEl.attr('x', x + (pad - box.x));
}

function renderProjectName(svg, config, dimensions, title) {
    const centerX = dimensions.margin.left + dimensions.width / 2;
    const projectName = (config.projectName || '').trim();
    const subtitle = (config.subtitle || '').trim();
    const hasProjectName = projectName.length > 0;
    const hasSubtitle = subtitle.length > 0;

    if (hasProjectName) {
        keepInsideLeftEdge(svg.append('text')
            .attr('x', centerX)
            .attr('y', 30)
            .attr('text-anchor', 'middle')
            .attr('class', 'project-name')
            .style('font-family', 'sans-serif')
            .style('font-size', '28px')
            .style('font-weight', 'bold')
            .style('fill', '#333')
            .text(projectName));
    }

    if (hasSubtitle) {
        keepInsideLeftEdge(svg.append('text')
            .attr('x', centerX)
            .attr('y', hasProjectName ? 55 : 30)
            .attr('text-anchor', 'middle')
            .attr('class', 'graph-subtitle')
            .style('font-family', 'sans-serif')
            .style('font-size', '16px')
            .style('font-weight', 'normal')
            .style('fill', '#555')
            .text(subtitle));
    }

    const titleY = hasProjectName ? (hasSubtitle ? 78 : 55) : (hasSubtitle ? 55 : 30);

    keepInsideLeftEdge(svg.append('text')
        .attr('x', centerX)
        .attr('y', titleY)
        .attr('text-anchor', 'middle')
        .attr('class', 'graph-title')
        .style('font-family', 'sans-serif')
        .style('font-size', '20px')
        .style('font-weight', hasProjectName || hasSubtitle ? 'normal' : 'bold')
        .style('fill', hasProjectName || hasSubtitle ? '#444' : '#333')
        .text(title));
}

/**
 * Renders axes.
 */
function renderAxes(g, scales, columnInfo, dimensions, config, seriesColorScale, settings, validData) {
    const { xScale, yScale } = scales;
    const { xAxisInfo, seriesInfo, graphType } = columnInfo;
    const { width, height, margin } = dimensions;

    const { primary: primarySeries, secondary: secondarySeries } = groupSeriesByAxis(seriesInfo);
    const isDualAxis = secondarySeries.length > 0;

    const xAxisLabel = config.xAxisLabel || xAxisInfo.columnName;

    let yAxisLabel;
    let axisColors = null;

    if (isDualAxis) {
        const primaryLabel = config.yAxisLabel || getAxisLabel(primarySeries, 'Primary Y-Axis');
        const secondaryLabel = config.yAxisLabel2 || getAxisLabel(secondarySeries, 'Secondary Y-Axis');

        yAxisLabel = { primary: primaryLabel, secondary: secondaryLabel };

        const primaryColor = getAxisColor(primarySeries, seriesColorScale);
        const secondaryColor = getAxisColor(secondarySeries, seriesColorScale);

        axisColors = { primary: primaryColor, secondary: secondaryColor };
    } else {
        if (graphType === 'histogram') {
            yAxisLabel = config.yAxisLabel || 'Frequency';
        } else {
            yAxisLabel = config.yAxisLabel || getAxisLabel(primarySeries, 'Value');
        }
        axisColors = { primary: '#333' };
    }

    return drawAxes(
        g,
        xScale,
        yScale,
        height,
        width,
        margin,
        xAxisLabel,
        yAxisLabel,
        graphType,
        config,
        axisColors,
        seriesInfo,
        seriesColorScale,
        settings,
        validData,
        xAxisInfo
    );
}

/**
 * Renders data series.
 */
function renderDataSeries(g, validData, scales, columnInfo, config, graphService) {
    const { xScale, yScale, colorScale, seriesColorScale, seriesColorScales } = scales;
    const { xAxisInfo, seriesInfo, colorInfo } = columnInfo;

    graphService.drawDataSeries(
        g, validData, xScale, yScale, xAxisInfo, seriesInfo,
        colorScale, colorInfo, config, seriesColorScale, seriesColorScales
    );
}

/**
 * Enrich rows with configured informative field values for downstream interactions.
 * Stores values under row.__informative as { [columnName]: value }.
 */
function attachInformativeFields(validData, graphConfig) {
    const informativeFieldIds = Array.isArray(graphConfig?.informativeFields)
        ? [...new Set(graphConfig.informativeFields.filter(Boolean))]
        : [];

    if (informativeFieldIds.length === 0) {
        validData.forEach((row) => {
            row.__informative = {};
        });
        return;
    }

    const informativeColumnInfo = informativeFieldIds.map((fieldId) => parseColumnId(fieldId));

    validData.forEach((row) => {
        const informative = {};

        informativeColumnInfo.forEach((info) => {
            const hasFileContext = info.fileName && row._sourceFile;
            const isMatchingFile = !hasFileContext || row._sourceFile === info.fileName;

            if (!isMatchingFile) {
                return;
            }

            informative[info.columnName] = row[info.columnName];
        });

        row.__informative = informative;
    });
}

/**
 * Renders contours if configured.
 */
function renderContours(g, svg, validData, scales, columnInfo, config, settings, graphService) {
    if (!config.contouring || validData.length === 0 || columnInfo.graphType === 'histogram') {
        return;
    }
    const { xScale, yScale } = scales;
    const { contourInfo, seriesInfo } = columnInfo;

    if (!contourInfo || !seriesInfo.length) return;

    const targetIndex = config.contouringTarget !== undefined ? parseInt(config.contouringTarget) : 0;
    const targetSeriesInfo = seriesInfo[targetIndex] || seriesInfo[0];

    return graphService.drawContours(
        g, svg, validData, contourInfo, columnInfo.xAxisInfo,
        targetSeriesInfo?.yAxisInfo, xScale, yScale, settings
    );
}

/**
 * Renders curve fits.
 */
function renderCurveFits(g, fits, scales, dimensions, columnInfo, graphService, axisInfo = {}, config = {}) {
    if (!fits || fits.length === 0) return;
    const { xScale, yScale } = scales;
    const { width } = dimensions;
    return graphService.drawCurveFits(g, fits, xScale, yScale, width, columnInfo.seriesInfo, axisInfo, dimensions, config);
}

/**
 * Renders a centered "NO DATA" placeholder in the plot area.
 * Used when the configured columns yield too few valid rows to plot (zero rows,
 * or a single point which cannot form a trend) so viewers see an explicit
 * message instead of a blank chart. Must be a *successful* render: the headless
 * BatchRunner throws on success:false, which turns a no-data graph into a 500 on
 * the /graph PNG endpoint. `message` overrides the default sub-caption;
 * `detailLines` renders extra caption lines below it (used to describe the
 * lone point in the 1-row case).
 */
function renderNoDataPlaceholder(svg, dimensions, message = 'No data is currently available for this chart', detailLines = []) {
    const { margin, width, height } = dimensions;
    const g = svg
        .append('g')
        .attr('class', 'no-data-placeholder')
        .attr('transform', `translate(${margin.left},${margin.top})`);

    g.append('rect')
        .attr('width', width)
        .attr('height', height)
        .attr('fill', 'none')
        .attr('stroke', '#ccc')
        .attr('stroke-dasharray', '6,4');

    g.append('text')
        .attr('x', width / 2)
        .attr('y', height / 2)
        .attr('text-anchor', 'middle')
        .attr('dy', '0.35em')
        .style('font-family', 'sans-serif')
        .style('font-size', '48px')
        .style('font-weight', 'bold')
        .style('letter-spacing', '0.15em')
        .style('fill', '#b0b0b0')
        .text('NO DATA');

    g.append('text')
        .attr('x', width / 2)
        .attr('y', height / 2 + 40)
        .attr('text-anchor', 'middle')
        .style('font-family', 'sans-serif')
        .style('font-size', '16px')
        .style('fill', '#999')
        .text(message);

    detailLines.forEach((line, i) => {
        g.append('text')
            .attr('x', width / 2)
            .attr('y', height / 2 + 72 + i * 22)
            .attr('text-anchor', 'middle')
            .style('font-family', 'sans-serif')
            .style('font-size', '14px')
            .style('fill', '#888')
            .text(line);
    });
}

/**
 * Builds "label: value" caption lines describing the single valid row, for the
 * 1-point placeholder: x value, each series' y value, then any configured
 * informative fields. Empty cells are skipped; long values are truncated so
 * they stay inside the plot area.
 */
function buildSinglePointDetails(row, columnInfo, graphConfig) {
    const fmt = (v) => {
        const s = String(v);
        return s.length > 60 ? s.slice(0, 57) + '…' : s;
    };

    const pairs = [];
    const xName = columnInfo.xAxisInfo.columnName;
    pairs.push([graphConfig.xAxisLabel || xName, row[xName]]);
    columnInfo.seriesInfo.forEach((s) => {
        pairs.push([s.yAxisInfo.columnName, row[s.yAxisInfo.columnName]]);
    });
    Object.entries(row.__informative || {}).forEach(([name, value]) => {
        pairs.push([name, value]);
    });

    const lines = pairs
        .filter(([, v]) => v !== undefined && v !== null && String(v).trim() !== '')
        .slice(0, 8)
        .map(([name, v]) => `${name}: ${fmt(v)}`);

    if (lines.length > 0) {
        lines.unshift('The available point:');
    }
    return lines;
}

/**
 * Renders legends.
 */
function renderLegends(svg, validData, scales, columnInfo, config, dimensions, settings, graphService, legendArtifacts = {}) {
    const { seriesColorScale, colorScale } = scales;
    const { seriesInfo, graphType, colorInfo } = columnInfo;
    const { margin = { top: 0, right: 0, bottom: 0, left: 0 } } = dimensions;
    const { contour = null, curve = null, axisInfo = {} } = legendArtifacts;

    if (colorScale && colorInfo?.columnName) {
        const colorValues = validData.map(d => d[colorInfo.columnName]).filter(v => v !== undefined && v !== null);
        if (colorValues.length > 0) {
            LegendRenderer.drawColorLegend(
                svg, colorScale, colorValues, colorInfo, margin,
                settings.graphDimensions, config.colorScheme || settings.colorScheme
            );
        }
    }

    if (graphType !== 'histogram' && seriesInfo.length > 1 && seriesColorScale) {
        const hasSecondaryAxis = config.series && (config.series.some(s => s.axisAssignment === 'secondary') || config.dualUnits);
        const legendOffset = hasSecondaryAxis ? 140 : 60;
        LegendRenderer.drawSeriesLegend(
            config, svg, validData, seriesInfo, seriesColorScale,
            settings.graphDimensions, margin, legendOffset
        );
    }

    if (contour && contour.thresholds?.length) {
        LegendRenderer.drawContourLegend(
            svg, contour.contourInfo, contour.thresholds, contour.colorScale, settings.graphDimensions
        );
    }

    // Per-series colour grading legends (floating panels in right margin)
    if (scales.seriesColorScales) {
        LegendRenderer.drawColorGradingLegends(
            svg, seriesInfo, scales.seriesColorScales, validData, dimensions
        );
    }
}

/**
 * Orchestrates the rendering of a complete graph onto a given SVG element.
 * Completely decoupled from React and Tauri.
 * 
 * @param {Object} options - Graph rendering options
 * @param {SVGSVGElement} options.svg - Raw DOM SVGElement to render into
 * @param {Array<Object>} options.csvData - Parsed CSV data array
 * @param {Object} options.graphConfig - Configuration matching graph-config.schema.json
 * @param {Object} options.globalSettings - Global layout/styling settings
 * @param {Array} [options.curveFits=[]] - Already computed curve fitting data
 * @param {string} [options.logoDataUri=null] - Base64 data URI of the logo to embed
 * @param {Object} options.colorSchemes - Map of color schemes
 * @param {boolean} [options.isBatchMode=false] - Whether rendering in headless batch mode
 * @returns {{success: boolean, error?: string, margin?: Object}} Result status
 */

// TODO: columnInfo.seriesInfo has one difference from graphConfig.series: yAxisInfo. Find a solution s.t. we can simplify the data object, hopefully by just using graphConfig.
export function renderGraph({
    svg: svgNode,
    csvData,
    graphConfig,
    globalSettings,
    curveFits = [],
    logoDataUri = null,
    colorSchemes,
    isBatchMode = false
}) {
    try {
        const graphType = (graphConfig?.graphType || 'scatter').toLowerCase();

        // Empty csvData is NOT an error here: it falls through to the
        // validData check below, which renders a "NO DATA" placeholder.
        if (!graphConfig.xAxis || !csvData) {
            debugWarn('Missing required data for graph generation');
            return { success: false, error: 'Missing required data' };
        }

        if (graphType !== 'histogram' && !graphConfig.series?.some(s => s.yAxis)) {
            debugWarn('No series configured for non-histogram graph');
            return { success: false, error: 'No series configured' };
        }

        const svg = d3.select(svgNode);
        svg.selectAll('*').remove();
        // The hover-dim class sits on the SVG root, so clearing children doesn't reset it.
        // Drop it here or a re-render that interrupts an active hover draws every dot dimmed.
        svg.classed(BaseChartRenderer.HOVER_DIM_CLASS, false);

        const columnInfo = parseColumnInformation(graphConfig);
        if (columnInfo.graphType !== 'histogram' && columnInfo.seriesInfo.length === 0) {
            debugWarn('No valid series configured');
            return { success: false, error: 'No valid series' };
        }

        const dimensions = calculateDimensions(globalSettings, columnInfo, graphConfig);
        const totalWidth = dimensions.width + dimensions.margin.left + dimensions.margin.right;
        const totalHeight = dimensions.height + dimensions.margin.top + dimensions.margin.bottom;

        svg.attr('width', totalWidth);
        svg.attr('height', totalHeight);
        svg.attr('viewBox', null);

        let targetGraphConfig = { ...graphConfig, _isBatchMode: isBatchMode };
        let additionalJoinCols = targetGraphConfig.joinColumns || [];
        if (additionalJoinCols.length === 0 && targetGraphConfig.xAxis2) {
            additionalJoinCols = [targetGraphConfig.xAxis2];
        }
        additionalJoinCols = additionalJoinCols.filter(c => c);

        if (globalSettings.joinXAxis && additionalJoinCols.length > 0) {
            const unifiedColName = '__unified_x__';
            const xPrimaryInfo = parseColumnId(targetGraphConfig.xAxis);
            const joinInfos = additionalJoinCols.map(colId => parseColumnId(colId));
            const candidateInfos = [xPrimaryInfo, ...joinInfos];

            targetGraphConfig.xAxis = unifiedColName;
            if (!targetGraphConfig.xAxisLabel) {
                targetGraphConfig.xAxisLabel = xPrimaryInfo.columnName;
            }

            csvData.forEach(row => {
                let finalVal = null;
                for (const info of candidateInfos) {
                    const val = row[info.columnName];
                    if (val !== undefined && val !== null && val !== '') {
                        finalVal = val;
                        break;
                    }
                }
                row[unifiedColName] = finalVal;
            });

            columnInfo.xAxisInfo = { columnName: unifiedColName, fileName: '' };
        }

        let validData = FileService.filterValidData(
            csvData,
            parseColumnId(targetGraphConfig.xAxis),
            columnInfo.seriesInfo.map(s => s.yAxisInfo)
        );

        // A single point cannot form a plot/trend, so treat 1 valid row the same
        // as 0 — show the placeholder with a message explaining why, rather than a
        // lone dot floating in the middle of the chart. (Zero rows keep the
        // generic NO DATA caption.)
        if (validData.length < 2) {
            const onePoint = validData.length === 1;
            debugWarn(onePoint
                ? 'Only 1 valid data point — need 2+ to plot; rendering placeholder'
                : 'No valid data points found — rendering NO DATA placeholder');
            renderTitle(svg, targetGraphConfig, columnInfo, globalSettings, dimensions);
            let detailLines = [];
            if (onePoint) {
                attachInformativeFields(validData, targetGraphConfig);
                detailLines = buildSinglePointDetails(validData[0], columnInfo, targetGraphConfig);
            }
            renderNoDataPlaceholder(
                svg,
                dimensions,
                onePoint
                    ? 'Only 1 data point available — 2 or more are needed to plot'
                    : undefined,
                detailLines
            );
            if (logoDataUri) {
                svg.append('image')
                    .attr('href', logoDataUri)
                    .attr('x', 6)
                    .attr('y', dimensions.height + dimensions.margin.top + 18)
                    .attr('width', 52)
                    .attr('height', 52);
            }
            // No scales/g in the result: consumers (e.g. the popup's zoom
            // setup) already guard on result.scales before attaching behaviour.
            return {
                success: true,
                noData: true,
                margin: dimensions.margin,
                svg,
                validData,
                columnInfo,
                dimensions,
                targetGraphConfig
            };
        }

        attachInformativeFields(validData, targetGraphConfig);

        const scales = createScales(validData, columnInfo, dimensions, targetGraphConfig);

        const g = svg
            .append('g')
            .attr('transform', `translate(${dimensions.margin.left},${dimensions.margin.top})`);

        const graphService = new GraphService(colorSchemes);

        renderTitle(svg, targetGraphConfig, columnInfo, globalSettings, dimensions);
        const axisInfo = renderAxes(g, scales, columnInfo, dimensions, targetGraphConfig, scales.seriesColorScale, globalSettings, validData) || {};
        
       
        renderDataSeries(g, validData, scales, columnInfo, targetGraphConfig, graphService);
        const contourLegend = renderContours(g, svg, validData, scales, columnInfo, targetGraphConfig, globalSettings, graphService) || null;
        const curveLegend = renderCurveFits(g, curveFits, scales, dimensions, columnInfo, graphService, axisInfo, targetGraphConfig) || { legendItems: [] };
         if (logoDataUri) {
            // Bottom-left of the figure, below the x-axis ticks (CanvasSizer expands the
            // SVG to include it, so a position in the bottom margin is not clipped).
            svg.append('image')
                .attr('href', logoDataUri)
                .attr('x', 6)
                .attr('y', dimensions.height + dimensions.margin.top + 18)
                .attr('width', 52)
                .attr('height', 52);
        }

        if (globalSettings.showUnifiedTable && globalSettings.showStaticTable) {
            // The legend table auto-fits its text columns, so its width is only known after
            // it draws — hence the measurement rather than the 365px constant this used to
            // pass, which overlapped the bias table by ~15px on charts carrying 10+
            // categories and left a gap on charts carrying few.
            const unifiedTableWidth = UnifiedTableRenderer.drawUnifiedTable(
                svg, validData, columnInfo, scales, targetGraphConfig, globalSettings, dimensions
            );

            if (globalSettings.showBiasTable && globalSettings.biasTableData) {
                BiasTableRenderer.drawBiasTable(
                    svg, globalSettings.biasTableData, dimensions, globalSettings,
                    unifiedTableWidth > 0 ? unifiedTableWidth : 365
                );

                // Both tables are drawn from the same top edge but hold different amounts
                // of content, so they finish on different lines — a ragged bottom that
                // reads as a misalignment rather than as two panels of one footer. Sit
                // them on a shared baseline instead: the tallest keeps the top it was
                // drawn at (so nothing moves up into the axis title) and the shorter one
                // drops to meet it, which leaves the pair's overall extent unchanged for
                // the canvas sizing that runs after this.
                alignFooterTables(typeof svg.node === 'function' ? svg.node() : svg);
            }
        } else {
            renderLegends(
                svg, validData, scales, columnInfo, targetGraphConfig,
                dimensions, globalSettings, graphService,
                { contour: contourLegend, curve: curveLegend, axisInfo }
            );
        }

        return { 
            success: true, 
            margin: dimensions.margin,
            g,
            svg,
            validData,
            scales,
            columnInfo,
            dimensions,
            targetGraphConfig
        };
    } catch (error) {
        debugWarn('Failed to render graph:', error);
        return { success: false, error: error.message || String(error) };
    }
}
