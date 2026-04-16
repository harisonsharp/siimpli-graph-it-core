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

    return { xAxisInfo, xAxis2Info, seriesInfo, colorInfo, contourInfo, graphType };
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

    if (columnInfo && columnInfo.seriesInfo) {
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

function renderProjectName(svg, config, dimensions, title) {
    const centerX = dimensions.margin.left + dimensions.width / 2;
    const projectName = (config.projectName || '').trim();
    const subtitle = (config.subtitle || '').trim();
    const hasProjectName = projectName.length > 0;
    const hasSubtitle = subtitle.length > 0;

    if (hasProjectName) {
        svg.append('text')
            .attr('x', centerX)
            .attr('y', 30)
            .attr('text-anchor', 'middle')
            .attr('class', 'project-name')
            .style('font-family', 'sans-serif')
            .style('font-size', '28px')
            .style('font-weight', 'bold')
            .style('fill', '#333')
            .text(projectName);
    }

    if (hasSubtitle) {
        svg.append('text')
            .attr('x', centerX)
            .attr('y', hasProjectName ? 55 : 30)
            .attr('text-anchor', 'middle')
            .attr('class', 'graph-subtitle')
            .style('font-family', 'sans-serif')
            .style('font-size', '16px')
            .style('font-weight', 'normal')
            .style('fill', '#555')
            .text(subtitle);
    }

    const titleY = hasProjectName ? (hasSubtitle ? 78 : 55) : (hasSubtitle ? 55 : 30);

    svg.append('text')
        .attr('x', centerX)
        .attr('y', titleY)
        .attr('text-anchor', 'middle')
        .attr('class', 'graph-title')
        .style('font-family', 'sans-serif')
        .style('font-size', '20px')
        .style('font-weight', hasProjectName || hasSubtitle ? 'normal' : 'bold')
        .style('fill', hasProjectName || hasSubtitle ? '#444' : '#333')
        .text(title);
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

        if (!graphConfig.xAxis || !csvData || csvData.length === 0) {
            debugWarn('Missing required data for graph generation');
            return { success: false, error: 'Missing required data' };
        }

        if (graphType !== 'histogram' && !graphConfig.series?.some(s => s.yAxis)) {
            debugWarn('No series configured for non-histogram graph');
            return { success: false, error: 'No series configured' };
        }

        const svg = d3.select(svgNode);
        svg.selectAll('*').remove();

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

        if (validData.length === 0) {
            debugWarn('No valid data points found');
            return { success: false, error: 'No valid data points' };
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
            const { width } = dimensions;
            svg.append('image')
                .attr('href', logoDataUri)
                .attr('x', dimensions.margin.left / 2 - 20)
                .attr('y', dimensions.height + dimensions.margin.top - 50)
                .attr('width', 60)
                .attr('height', 60);
        }

        if (globalSettings.showUnifiedTable && globalSettings.showStaticTable) {
            UnifiedTableRenderer.drawUnifiedTable(
                svg, validData, columnInfo, scales, targetGraphConfig, globalSettings, dimensions
            );

            if (globalSettings.showBiasTable && globalSettings.biasTableData) {
                BiasTableRenderer.drawBiasTable(
                    svg, globalSettings.biasTableData, dimensions, globalSettings, 365
                );
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
