/**
 * @fileoverview Custom React hook for graph rendering orchestration.
 * Encapsulates graph generation business logic including data validation, scale creation,
 * axis calculation, series rendering, and legend generation.
 *
 * @author Harison Sharp
 * @since 0.3.0
 *
 * @module useGraphRenderer
 * @requires react - useCallback hook for memoization
 * @requires d3 - Data visualization library
 * @requires @siimpli/graph-it-core - SiimpliGraphIt core library
 *
 * @exports useGraphRenderer
 *
 * @example
 * const { generateGraph } = useGraphRenderer({
 *   csvData,
 *   graphConfig,
 *   curveFits,
 *   globalSettings,
 *   logoImage,
 *   logoReady,
 *   getAxisIntercepts,
 *   colorSchemes
 * });
 *
 * generateGraph(svgRef, onSuccess, onError);
 */

import { useCallback } from 'react';
import * as d3 from 'd3';
import {
    GraphService,
    FileService,
    parseColumnId,
    drawAxes,
    renderLogo,
    generateTitle,
    ScaleFactory,
    CanvasSizer,
    groupSeriesByAxis,
    getAxisColor,
    getAxisLabel,

    aggregateData,
    debugLog,
    debugWarn,
    DataTableRenderer,
    LegendRenderer,
    UnifiedTableRenderer,
    BiasTableRenderer
} from '../index.js';


/**
 * Custom hook for graph rendering logic
 * 
 * @param {Object} config - Hook configuration
 * @param {Array} config.csvData - Processed CSV data for visualization
 * @param {Object} config.graphConfig - Graph configuration and settings
 * @param {Array} config.curveFits - Curve fitting results
 * @param {Object} config.globalSettings - Application-wide settings
 * @param {Image} config.logoImage - Logo image for branding
 * @param {boolean} config.logoReady - Logo loading state
 * @param {Function} config.getAxisIntercepts - Axis intercept calculator
 * @param {Object} config.colorSchemes - Available color schemes
 * @returns {Object} Hook interface with generateGraph function
 */
export function useGraphRenderer({
    csvData,
    graphConfig,
    curveFits = [],
    globalSettings,
    logoImage = null,
    logoReady = true,
    getAxisIntercepts,
    colorSchemes,
    isBatchMode = false,
    onXValueSelect
}) {
    /**
     * Parse column identifiers from configuration
     * 
     * @param {Object} config - Graph configuration
     * @returns {Object} Parsed column information
     */
    const parseColumnInformation = useCallback((config) => {
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
    }, []);

    /**
     * Calculate layout dimensions based on global settings
     * 
     * @param {Object} settings - Global settings with graphDimensions
     * @returns {Object} Margin and calculated dimensions
     */
    /**
     * Calculate layout dimensions based on global settings and graph content
     * 
     * @param {Object} settings - Global settings with graphDimensions
     * @param {Object} columnInfo - Parsed column information for legend sizing
     * @param {Object} graphConfig - Graph configuration for axis checks
     * @returns {Object} Margin and calculated dimensions
     */
    const calculateDimensions = useCallback((settings, columnInfo, graphConfig) => {
        // Calculate dynamic right margin based on legend content
        let rightMargin = 60; // Base spacing

        // 1. Calculate Legend Width
        if (columnInfo && columnInfo.seriesInfo) {
            const longestLabel = columnInfo.seriesInfo.reduce((max, series) => {
                const label = series.yAxisInfo.columnName || '';
                return label.length > max.length ? label : max;
            }, '');

            // Approx 7px per character for 12px font + 40px for swatch and padding
            const estimatedLegendWidth = (longestLabel.length * 7) + 40;
            rightMargin += estimatedLegendWidth;
        }

        // 2. Add space for Secondary Axis Label if needed
        const hasSecondaryAxis = graphConfig.series && graphConfig.series.some(s => s.axisAssignment === 'secondary');
        if (hasSecondaryAxis) {
            rightMargin += 50; // Space for axis ticks and label
        }

        // 3. Add extra width for Static Table values if enabled
        if (settings.showStaticTable) {
            rightMargin += 60; // Extra space for values "123.45"
        }

        // Clamp margin to reasonable bounds (min 120, max 450)
        rightMargin = Math.max(120, Math.min(450, rightMargin));

        // Adjust top margin for Project Name
        const topMargin = graphConfig.projectName ? 110 : 80;

        const margin = { top: topMargin, right: rightMargin, bottom: 100, left: 100 };

        // Apply multipliers to the base dimensions
        const widthMultiplier = graphConfig.widthMultiplier || 1.0;
        const heightMultiplier = graphConfig.heightMultiplier || 1.0;

        const baseWidth = settings.graphDimensions.width;
        const baseHeight = settings.graphDimensions.height;

        const width = (baseWidth * widthMultiplier) - margin.left - margin.right;
        const height = (baseHeight * heightMultiplier) - margin.top - margin.bottom;

        return { margin, width, height };
    }, []);

    /**
     * Create scales for x-axis, y-axis, colors, and series
     * 
     * @param {Array} validData - Filtered valid data points
     * @param {Object} columnInfo - Parsed column information
     * @param {Object} dimensions - Layout dimensions
     * @param {Object} config - Graph configuration
     * @param {Object} settings - Global settings with colorScheme
     * @returns {Object} Created scales
     */
    const createScales = useCallback((validData, columnInfo, dimensions, config, settings) => {
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
        debugLog('[useGraphRenderer] Creating scales:', xScale, ' yscale: ', yScale);
        debugLog('[useGraphRenderer] Creating color scale with scheme:', settings.colorScheme);
        const colorScale = ScaleFactory.createColorScale(
            validData,
            colorInfo,
            settings.colorScheme
        );

        // Use yAxisInfo.columnName for series color scale
        const seriesNames = seriesInfo.map(s => s.yAxisInfo.columnName).filter(Boolean);
        debugLog('[useGraphRenderer] Creating series color scale for:', seriesNames);
        const seriesColorScale = seriesNames.length > 0
            ? ScaleFactory.createSeriesColorScale(seriesNames, seriesInfo)
            : null;

        return { xScale, yScale, colorScale, seriesColorScale };
    }, []);

    /**
     * Render graph title
     * 
     * @param {d3.Selection} svg - SVG element selection
     * @param {Object} config - Graph configuration
     * @param {Object} columnInfo - Parsed column information
     * @param {Object} settings - Global settings
     */
    const renderTitle = useCallback((svg, config, columnInfo, settings, dimensions) => {
        const { xAxisInfo, seriesInfo } = columnInfo;
        const title = config.title || generateTitle(
            config,
            seriesInfo.map(s => s.yAxisInfo),
            xAxisInfo
        );
        debugLog('[useGraphRenderer] Rendering title:', title, ' with settings: ', settings);
        // Render Project Name (Primary Title)
        if (config.projectName) {
            svg.append("text")
                .attr("x", dimensions.margin.left + dimensions.width / 2)
                .attr("y", 30)
                .attr("text-anchor", "middle")
                .attr("class", "project-name")
                .style("font-family", "sans-serif")
                .style("font-size", "28px")
                .style("font-weight", "bold")
                .style("fill", "#333")
                .text(config.projectName);

            // Render Graph Title (Secondary Title)
            svg.append("text")
                .attr("x", dimensions.margin.left + dimensions.width / 2)
                .attr("y", 55)
                .attr("text-anchor", "middle")
                .attr("class", "graph-title")
                .style("font-family", "sans-serif")
                .style("font-size", "20px")
                .style("font-weight", "normal")
                .style("fill", "#444")
                .text(title);
        } else {
            // Render Graph Title (Primary Title)
            svg.append("text")
                .attr("x", dimensions.margin.left + dimensions.width / 2)
                .attr("y", 30)
                .attr("text-anchor", "middle")
                .attr("class", "graph-title")
                .style("font-family", "sans-serif")
                .style("font-size", "20px")
                .style("font-weight", "bold")
                .style("fill", "#333")
                .text(title);
        }
    }, []);

    /**
     * Render axes with proper positioning
     * 
     * @param {d3.Selection} g - Main group element
     * @param {Object} scales - Created scales
     * @param {Object} columnInfo - Parsed column information
     * @param {Object} dimensions - Layout dimensions
     * @param {Object} config - Graph configuration
     * @param {Function} seriesColorScale - Color scale for series
     * @param {Object} settings - Global settings
     */
    const renderAxes = useCallback((g, scales, columnInfo, dimensions, config, seriesColorScale, settings, validData) => {
        const { xScale, yScale } = scales;
        const { xAxisInfo, seriesInfo, graphType } = columnInfo;
        const { width, height, margin } = dimensions;

        // Separate series by axis
        const { primary: primarySeries, secondary: secondarySeries } = groupSeriesByAxis(seriesInfo);
        const isDualAxis = secondarySeries.length > 0;

        // Generate axis labels - use custom labels if provided, otherwise auto-generate
        const xAxisLabel = config.xAxisLabel || xAxisInfo.columnName;

        let yAxisLabel;
        let axisColors = null;

        if (isDualAxis) {
            // Dual-axis mode: Apply intelligent coloring
            const primaryLabel = config.yAxisLabel || getAxisLabel(primarySeries, 'Primary Y-Axis');
            const secondaryLabel = config.yAxisLabel2 || getAxisLabel(secondarySeries, 'Secondary Y-Axis');

            yAxisLabel = {
                primary: primaryLabel,
                secondary: secondaryLabel
            };

            // Determine colors for each axis (colored if single series, black if multiple)
            const primaryColor = getAxisColor(primarySeries, seriesColorScale);
            const secondaryColor = getAxisColor(secondarySeries, seriesColorScale);

            axisColors = {
                primary: primaryColor,
                secondary: secondaryColor
            };
        } else {
            // Single axis mode: Always use black
            if (graphType === 'histogram') {
                yAxisLabel = config.yAxisLabel || 'Frequency';
            } else {
                yAxisLabel = config.yAxisLabel || getAxisLabel(primarySeries, 'Value');
            }

            // Single axis always uses black color
            axisColors = {
                primary: '#333'
            };
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
            validData, // Pass validData
            xAxisInfo  // Pass xAxisInfo
        );
    }, []);

    /**
     * Render logo image
     * 
     * @param {d3.Selection} svg - SVG element selection
     * @param {Image} logo - Logo image
     * @param {Object} dimensions - Layout dimensions
     */
    /**
     * Render data series using GraphService
     * 
     * @param {d3.Selection} g - Main group element
     * @param {Array} validData - Filtered valid data
     * @param {Object} scales - Created scales
     * @param {Object} columnInfo - Parsed column information
     * @param {Object} config - Graph configuration
     * @param {GraphService} graphService - Graph rendering service
     */
    const renderDataSeries = useCallback((g, validData, scales, columnInfo, config, graphService) => {
        const { xScale, yScale, colorScale, seriesColorScale } = scales;
        const { xAxisInfo, seriesInfo, colorInfo } = columnInfo;

        // Pass all required color parameters
        graphService.drawDataSeries(
            g,
            validData,
            xScale,
            yScale,
            xAxisInfo,
            seriesInfo,
            colorScale,
            colorInfo,
            config,
            seriesColorScale
        );
    }, []);

    /**
     * Render contours if configured
     * 
     * @param {d3.Selection} g - Main group element
     * @param {d3.Selection} svg - SVG element selection
     * @param {Array} validData - Filtered valid data
     * @param {Object} scales - Created scales
     * @param {Object} columnInfo - Parsed column information
     * @param {Object} config - Graph configuration
     * @param {Object} settings - Global settings
     * @param {GraphService} graphService - Graph rendering service
     */
    const renderContours = useCallback((g, svg, validData, scales, columnInfo, config, settings, graphService) => {
        if (!config.contouring || validData.length === 0 || columnInfo.graphType === 'histogram') {
            return;
        }

        const { xScale, yScale } = scales;
        const { contourInfo, seriesInfo } = columnInfo;

        if (!contourInfo || !seriesInfo.length) {
            return;
        }

        const targetIndex = config.contouringTarget !== undefined ? parseInt(config.contouringTarget) : 0;
        // Find the series info that matches the target index in the global config
        // Note: seriesInfo here is the parsed list. We need to map back to global index or assume order is preserved.
        // The parseColumnInformation function maps config.series to seriesInfo in order.
        const targetSeriesInfo = seriesInfo[targetIndex] || seriesInfo[0];

        return graphService.drawContours(
            g,
            svg,
            validData,
            contourInfo,
            columnInfo.xAxisInfo,
            targetSeriesInfo?.yAxisInfo,
            xScale,
            yScale,
            settings
        );
    }, []);

    /**
     * Render curve fits
     * 
     * @param {d3.Selection} g - Main group element
     * @param {Array} fits - Curve fitting results
     * @param {Object} scales - Created scales
     * @param {Object} dimensions - Layout dimensions
     * @param {Object} columnInfo - Parsed column information with seriesInfo
     * @param {GraphService} graphService - Graph rendering service
     */
    const renderCurveFits = useCallback((g, fits, scales, dimensions, columnInfo, graphService, axisInfo = {}) => {
        if (!fits || fits.length === 0) {
            return;
        }

        const { xScale, yScale } = scales;
        const { width } = dimensions;

        return graphService.drawCurveFits(g, fits, xScale, yScale, width, columnInfo.seriesInfo, axisInfo, dimensions);
    }, []);

    /**
     * Render legends (color and series)
     * 
     * @param {d3.Selection} svg - SVG element selection
     * @param {Array} validData - Filtered valid data
     * @param {Object} scales - Created scales
     * @param {Object} columnInfo - Parsed column information
     * @param {Object} config - Graph configuration
     * @param {Object} dimensions - Layout dimensions
     * @param {Object} settings - Global settings
     */
    const renderLegends = useCallback((
        svg,
        validData,
        scales,
        columnInfo,
        config,
        dimensions,
        settings,
        graphService,
        legendArtifacts = {}
    ) => {
        const { seriesColorScale, colorScale } = scales;
        const { seriesInfo, graphType, colorInfo } = columnInfo;
        const { margin = { top: 0, right: 0, bottom: 0, left: 0 } } = dimensions;
        const {
            contour = null,
            curve = null,
            axisInfo = {}
        } = legendArtifacts;

        if (colorScale && colorInfo?.columnName) {
            const colorValues = validData
                .map(d => d[colorInfo.columnName])
                .filter(v => v !== undefined && v !== null);

            if (colorValues.length > 0) {
                LegendRenderer.drawColorLegend(
                    svg,
                    colorScale,
                    colorValues,
                    colorInfo,
                    margin,
                    settings.graphDimensions,
                    config.colorScheme || settings.colorScheme
                );
            }
        }

        if (graphType !== 'histogram' && seriesInfo.length > 1 && seriesColorScale) {
            // Calculate legend offset based on dual axis presence
            const hasSecondaryAxis = config.series && (config.series.some(s => s.axisAssignment === 'secondary') || config.dualUnits);
            const legendOffset = hasSecondaryAxis ? 140 : 60; // Push legend further right if dual axis

            LegendRenderer.drawSeriesLegend(
                config,
                svg,
                validData,
                seriesInfo,
                seriesColorScale,
                settings.graphDimensions,
                margin,
                legendOffset
            );
        }

        if (contour && contour.thresholds?.length) {
            LegendRenderer.drawContourLegend(
                svg,
                contour.contourInfo,
                contour.thresholds,
                contour.colorScale,
                settings.graphDimensions
            );
        }

        if (curve && Array.isArray(curve.legendItems) && curve.legendItems.length > 0) {
            const fallbackWidth = (dimensions.width || 0) + (margin.left + margin.right);
            graphService?.renderCurveFitLegend?.(
                svg,
                curve.legendItems,
                axisInfo,
                dimensions,
                fallbackWidth
            );
        }
    }, []);

    /**
     * Main graph generation function
     * 
     * @param {React.RefObject} svgRef - Reference to SVG element
     * @param {Function} onSuccess - Success callback
     * @param {Function} onError - Error callback
     * @returns {boolean} Success status
     */
    const generateGraph = useCallback((svgRef, onSuccess, onError, overrides = {}) => {
        try {
            let targetGraphConfig = overrides.graphConfig || graphConfig;
            const targetCsvData = overrides.csvData || csvData;
            const targetGlobalSettings = overrides.globalSettings || globalSettings;
            const targetColorSchemes = overrides.colorSchemes || colorSchemes;
            const targetLogoImage = overrides.hasOwnProperty('logoImage') ? overrides.logoImage : logoImage;
            const targetLogoReady = overrides.hasOwnProperty('logoReady') ? overrides.logoReady : logoReady;
            const targetCurveFits = overrides.curveFits ?? curveFits;
            const targetIsBatchMode = overrides.hasOwnProperty('isBatchMode') ? overrides.isBatchMode : isBatchMode;

            const graphType = (targetGraphConfig?.graphType || 'scatter').toLowerCase();

            // Validate required data
            if (!targetGraphConfig.xAxis || targetCsvData.length === 0) {
                console.warn('Missing required data for graph generation');
                if (onError) onError(new Error('Missing required data'));
                return false;
            }

            if (graphType !== 'histogram' && !targetGraphConfig.series?.some(s => s.yAxis)) {
                console.warn('No series configured for non-histogram graph');
                if (onError) onError(new Error('No series configured'));
                return false;
            }

            // Validate logo only for interactive mode
            if (!targetIsBatchMode && !targetLogoReady) {
                console.warn('Logo not ready yet, delaying graph generation');
                if (onError) onError(new Error('Logo not ready'));
                return false;
            }

            // Initialize SVG
            const svg = d3.select(svgRef.current);
            svg.selectAll("*").remove();

            // Parse column information first to enable dimension calculation
            const columnInfo = parseColumnInformation(targetGraphConfig);
            if (columnInfo.graphType !== 'histogram' && columnInfo.seriesInfo.length === 0) {
                console.warn('No valid series configured');
                if (onError) onError(new Error('No valid series'));
                return false;
            }

            debugLog('[useGraphRenderer] generateGraph called with config:', targetGraphConfig);
            debugLog('[useGraphRenderer] Processed series info:', columnInfo.seriesInfo);

            // Calculate dimensions with scaling
            const dimensions = calculateDimensions(targetGlobalSettings, columnInfo, targetGraphConfig);
            const totalWidth = dimensions.width + dimensions.margin.left + dimensions.margin.right;
            const totalHeight = dimensions.height + dimensions.margin.top + dimensions.margin.bottom;

            // Set initial dimensions (scaled) and RESET viewBox
            svg.attr('width', totalWidth);
            svg.attr('height', totalHeight);
            svg.attr('viewBox', null);

            // Handle X-Axis Joining
            // Handle X-Axis Joining
            // Determine additional columns to join
            let additionalJoinCols = targetGraphConfig.joinColumns || [];
            if (additionalJoinCols.length === 0 && targetGraphConfig.xAxis2) {
                additionalJoinCols = [targetGraphConfig.xAxis2];
            }
            // Filter out empty selections
            additionalJoinCols = additionalJoinCols.filter(c => c);

            if (targetGlobalSettings.joinXAxis && additionalJoinCols.length > 0) {
                // Determine unified column name
                const unifiedColName = '__unified_x__';
                const xPrimaryInfo = parseColumnId(targetGraphConfig.xAxis);

                // Parse all join columns
                const joinInfos = additionalJoinCols.map(colId => parseColumnId(colId));

                // data-processing candidates: Primary first, then join columns in order
                const candidateInfos = [xPrimaryInfo, ...joinInfos];

                // Create a working copy of config to point to unified column
                targetGraphConfig = { ...targetGraphConfig, xAxis: unifiedColName };

                // Preserve label if missing, to avoid showing internal variable name
                if (!targetGraphConfig.xAxisLabel) {
                    targetGraphConfig.xAxisLabel = xPrimaryInfo.columnName;
                }

                // Populate unified column in data (safe to mutate row objects as they are essentially data records)
                targetCsvData.forEach(row => {
                    let finalVal = null;

                    // Iterate through candidates to find first valid value
                    for (const info of candidateInfos) {
                        const val = row[info.columnName];
                        if (val !== undefined && val !== null && val !== '') {
                            finalVal = val;
                            break; // Found a value, stop looking
                        }
                    }

                    row[unifiedColName] = finalVal;
                });

                debugLog('[useGraphRenderer] Joined X-Axes:', {
                    primary: xPrimaryInfo.columnName,
                    joined: joinInfos.map(i => i.columnName)
                });

                // CRITICAL: Update columnInfo.xAxisInfo to use unified column
                // This ensures downstream renderers use __unified_x__ instead of the original column
                columnInfo.xAxisInfo = { columnName: unifiedColName, fileName: '' };
            }

            // (Dimensions calculation moved up)
            // Filter valid data

            // Filter valid data
            let validData = FileService.filterValidData(
                targetCsvData,
                parseColumnId(targetGraphConfig.xAxis),
                columnInfo.seriesInfo.map(s => s.yAxisInfo)
            );

            if (validData.length === 0) {
                console.warn('No valid data points found');
                if (onError) onError(new Error('No valid data points'));
                return false;
            }

            // Create scales
            const scales = createScales(validData, columnInfo, dimensions, targetGraphConfig, targetGlobalSettings);

            // Create main group
            const g = svg
                .append("g")
                .attr("transform", `translate(${dimensions.margin.left},${dimensions.margin.top})`);

            // Initialize graph service
            const graphService = new GraphService(targetColorSchemes);

            // Render all components
            renderTitle(svg, targetGraphConfig, columnInfo, targetGlobalSettings, dimensions);
            // Draw axes and capture axis layout info for downstream positioning
            const axisInfo = renderAxes(g, scales, columnInfo, dimensions, targetGraphConfig, scales.seriesColorScale, targetGlobalSettings, validData) || {};
            renderLogo(svg, targetLogoImage, dimensions);
            renderDataSeries(g, validData, scales, columnInfo, targetGraphConfig, graphService);
            const contourLegend = renderContours(g, svg, validData, scales, columnInfo, targetGraphConfig, targetGlobalSettings, graphService) || null;
            const curveLegend = renderCurveFits(g, targetCurveFits, scales, dimensions, columnInfo, graphService, axisInfo) || { legendItems: [] };

            // -------------------------------------------------------------------------
            // Render Legends OR Unified Table (mutually exclusive when unified is enabled)
            // -------------------------------------------------------------------------
            if (targetGlobalSettings.showUnifiedTable && targetGlobalSettings.showStaticTable) {
                // Unified table mode: combines legend markers, names, and values
                UnifiedTableRenderer.drawUnifiedTable(
                    svg,
                    validData,
                    columnInfo,
                    scales,
                    targetGraphConfig,
                    targetGlobalSettings,
                    dimensions
                );

                // Render Bias Table if enabled (positioned to the right of unified table)
                if (targetGlobalSettings.showBiasTable && targetGlobalSettings.biasTableData) {
                    const unifiedTableWidth = 365; // Approximate width of unified table
                    BiasTableRenderer.drawBiasTable(
                        svg,
                        targetGlobalSettings.biasTableData,
                        dimensions,
                        targetGlobalSettings,
                        unifiedTableWidth
                    );
                }
            } else {
                // Standard mode: separate legend and data table
                renderLegends(
                    svg,
                    validData,
                    scales,
                    columnInfo,
                    targetGraphConfig,
                    dimensions,
                    targetGlobalSettings,
                    graphService,
                    {
                        contour: contourLegend,
                        curve: curveLegend,
                        axisInfo
                    }
                );
            }

            // -------------------------------------------------------------------------
            // Interaction Layer: ALWAYS render for click-to-select functionality
            // This provides the overlay that captures clicks to update selectedXValue
            // -------------------------------------------------------------------------
            if (targetGlobalSettings.showDataTable || targetGlobalSettings.showStaticTable) {
                DataTableRenderer.renderInteractionLayer(
                    g,
                    svg,
                    validData,
                    scales,
                    columnInfo,
                    targetGraphConfig,
                    // Keep showStaticTable true for click handling; suppress visual via flag
                    {
                        ...targetGlobalSettings,
                        // When unified table is active, suppress the DataTableRenderer's static table visual
                        // but keep the interaction layer for click handling
                        hideStaticTableVisual: targetGlobalSettings.showUnifiedTable === true
                    },
                    dimensions,
                    { onXValueSelect },
                    targetIsBatchMode
                );
            }
            // -------------------------------------------------------------------------
            // -------------------------------------------------------------------------

            // Skip expensive CanvasSizer in batch mode - use fixed dimensions
            if (targetIsBatchMode) {
                if (onSuccess) onSuccess({ success: true, margin: dimensions.margin });
                return true;
            }

            let finalDimensions = { width: dimensions.width, height: dimensions.height };

            // Dynamic canvas sizing (ensure all content fits) - only for interactive mode
            try {
                // Calculate scaled total dimensions for sizer constraints
                const totalScaledWidth = dimensions.width + dimensions.margin.left + dimensions.margin.right;
                const totalScaledHeight = dimensions.height + dimensions.margin.top + dimensions.margin.bottom;

                // Initialize sizer with minimal margins since we're measuring the entire SVG content
                const canvasSizer = new CanvasSizer(svgRef.current, {
                    margins: { top: 10, right: 10, bottom: 10, left: 10 },
                    minWidth: 400,
                    minHeight: 300,
                    maxWidth: Math.max(8192, totalScaledWidth * 1.5),
                    maxHeight: Math.max(8192, totalScaledHeight * 1.5),
                    expandMode: 'scale',
                    dpiMultiplier: 1, // Default, can be adjusted for export
                    debounceMs: 0
                });

                // Always use DOM measurement of the ROOT SVG to capture legends, titles, and axes
                // This ensures "dynamic components" outside the main plot area are included
                canvasSizer.updateFromDOMSync(svgRef.current);
                const fitResult = canvasSizer.ensureFit();
                finalDimensions = { width: fitResult.width, height: fitResult.height };

                // Clean up sizer (we don't need continuous monitoring)
                canvasSizer.teardown();
            } catch (sizingError) {
                debugWarn('[useGraphRenderer] Canvas sizing failed, using default dimensions:', sizingError);
            }

            if (onSuccess) onSuccess({ success: true, margin: dimensions.margin, finalDimensions });
            return true;
        } catch (error) {
            debugWarn('Failed to generate graph:', error);
            if (onError) onError(error);
            return false;
        }
    }, [
        csvData,
        graphConfig,
        curveFits,
        globalSettings,
        logoImage,
        logoReady,
        getAxisIntercepts,
        colorSchemes,
        parseColumnInformation,
        calculateDimensions,
        createScales,
        renderTitle,
        renderAxes,
        renderLogo,
        renderDataSeries,
        renderContours,
        renderCurveFits,
        renderLegends,
        renderCurveFits,
        renderLegends,
        isBatchMode,
        onXValueSelect
    ]);

    return { generateGraph };
}
