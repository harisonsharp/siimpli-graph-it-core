/**
 * @fileoverview Axis rendering and calculation utilities for D3 visualizations.
 * Handles axis positioning, intercept calculations, and axis label rendering.
 *
 * @author Harison Sharp
 * @since 0.3.0
 *
 * @module Axis Utilities
 * @type {Utility Library}
 *
 * @requires d3 - Data visualization library for axis rendering
 *
 * @function calculateAxisIntercepts - Calculate axis intercept positions
 * @function drawAxes - Render graph axes with labels
 *
 * @exports calculateAxisIntercepts, drawAxes
 *
 * @example 
 * const intercepts = calculateAxisIntercepts([0, 100], [0, 50], config);
 * drawAxes(g, xScale, yScale, intercepts, labels, dimensions);
 *
 * @relatedFiles graphUtils.js (original)
 */

import * as d3 from 'd3';
import { debugLog } from './debug.js';
/**
 * Calculate axis intercept positions based on configuration
 * @param {Array<number>} xExtent - [min, max] for x-axis
 * @param {Array<number>} yExtent - [min, max] for y-axis
 * @param {Object} config - Graph configuration
 * @param {Object} globalSettings - Global settings (fallback)
 * @returns {Object} {x, y} intercept coordinates
 *
 * @example
 * calculateAxisIntercepts([0, 100], [-10, 50], {axisIntercept: 'origin'})
 * // Returns: {x: 0, y: 0}
 */
export const calculateAxisIntercepts = (xExtent, yExtent, config = {}, globalSettings = {}) => {
    const interceptType = config.axisIntercept || globalSettings.axisIntercept || 'origin';

    switch (interceptType) {
        case 'minimum':
            return { x: xExtent[0], y: yExtent[0] };

        case 'origin':
            return { x: 0, y: 0 };

        case 'custom':
            const customIntercept = config.customIntercept || globalSettings.customIntercept || { x: 0, y: 0 };
            return {
                x: Number.parseFloat(customIntercept.x) || 0,
                y: Number.parseFloat(customIntercept.y) || 0,
                y2: Number.parseFloat(customIntercept.y2) || 0
            };

        default:
            return { x: 0, y: 0 };
    }
};

/**
 * Draw graph axes with labels and proper positioning
 * @param {d3.Selection} g - D3 selection of graph group element
 * @param {d3.Scale} xScale - X-axis scale
 * @param {d3.Scale|Object} yScale - Y-axis scale (or {primary, secondary} object for dual-axis)
 * @param {number} height - Graph height
 * @param {number} width - Graph width
 * @param {Object} margin - Margin object {top, right, bottom, left}
 * @param {string} xAxisLabel - Label for x-axis
 * @param {string|Object} yAxisLabel - Label for y-axis (or {primary, secondary} object for dual-axis)
 * @param {string} graphType - Type of graph (for special handling)
 * @param {Object} config - Graph configuration for axis positioning
 * @param {Object} axisColors - Optional colors for axes {primary, secondary}
 * @param {Object} seriesInfo - Optional series information for determining colors
 * @param {Function} seriesColorScale - Optional color scale for single-series coloring
 * @param {Object} globalSettings - Global settings including showGuideLines
 *
 * @example
 * drawAxes(g, xScale, yScale, 400, 600, margins, 'Time', 'Temperature', 'scatter', config)
 */
import { generateCustomBins } from './histogram.js';

/**
 * Format number with scientific notation if it exceeds digit threshold
 * @param {number} value - Value to format
 * @param {number} thresholdDigits - Number of digits before switching to scientific notation
 * @returns {string} Formatted string
 */
const formatNumber = (value, thresholdDigits) => {
    if (value === 0) return "0";
    if (value === undefined || value === null || isNaN(value)) return "";

    const absVal = Math.abs(value);
    // Check if number of digits (integer part) exceeds threshold
    const intPart = Math.floor(absVal).toString();

    // Also check for very small numbers (e.g. 0.00001) which take up space
    // But user specifically mentioned "long numbers" > 6 digits.
    if (intPart.length > thresholdDigits) {
        // Use 3 significant figures (e.g. 1.42e+5)
        return d3.format(".2e")(value);
    }

    // Apply comma grouping for numbers > 999
    if (absVal > 999) {
        const isInteger = Number.isInteger(value);
        return isInteger
            ? d3.format(",")(value)
            : d3.format(",~f")(value);
    }

    return value;
};

const getStaticScale = (config, axisKey) => {
    const axisScale = config?.staticScales?.[axisKey];
    if (!axisScale || axisScale.enabled !== true) {
        return null;
    }

    const min = Number.parseFloat(axisScale.min);
    const max = Number.parseFloat(axisScale.max);
    const step = Number.parseFloat(axisScale.step);

    if (!Number.isFinite(min) || !Number.isFinite(max) || !Number.isFinite(step) || max <= min || step <= 0) {
        return null;
    }

    return { min, max, step };
};

const buildTickValues = (min, max, step, maxTicks = 500) => {
    const ticks = [];
    let index = 0;
    let current = min;

    while (current <= max + (step * 1e-6) && index < maxTicks) {
        ticks.push(Number(current.toFixed(12)));
        index += 1;
        current = min + (index * step);
    }

    if (ticks.length > 0 && ticks[ticks.length - 1] !== max) {
        ticks.push(max);
    }

    return ticks;
};

const drawXAxis = (g, xScale, xAxisY, xAxisLabelOffset, xAxisLabel, graphType, data, xAxisInfo, config = {}, color = '#333') => {
    // Create axis generator
    const axisGenerator = d3.axisBottom(xScale);
    const staticXScale = getStaticScale(config, 'x');

    // Histogram specific handling - Range Labels
    let histogramBinCount = 0;
    if (graphType === 'histogram' && data && xAxisInfo) {
        // Extract values to generate bins matching the renderer
        const rawValues = data
            .map(d => +d[xAxisInfo.columnName])
            .filter(v => !isNaN(v) && isFinite(v));

        if (rawValues.length > 0) {
            const logX = config?.logX;
            // When logX is on, bin in log space then back-transform to raw space (matches HistogramRenderer)
            const binValues = logX
                ? rawValues.filter(v => v > 0).map(v => Math.log10(v))
                : rawValues;

            const numBinsOverride = config?.numBins ? Number(config.numBins) : null;
            const staticX = config?.staticScales?.x;
            const skipOutliers = staticX?.enabled === true;
            const domainMin = skipOutliers ? Number(staticX.min) : null;
            const domainMax = skipOutliers ? Number(staticX.max) : null;
            let bins = generateCustomBins(binValues, numBinsOverride, skipOutliers, domainMin, domainMax);
            if (logX) {
                bins = bins.map(b => ({ ...b, rawMin: 10 ** b.min, rawMax: 10 ** b.max }));
            }
            const normalBins = bins.filter(b => !b.isOutlierBin);
            histogramBinCount = normalBins.length;

            const [rangeStart, rangeEnd] = xScale.range();
            const chartWidth = Math.abs(rangeEnd - rangeStart);
            const pixelsPerBin = normalBins.length > 0 ? chartWidth / normalBins.length : chartWidth;
            const MIN_LABEL_PX = 60;
            const skipAlternate = pixelsPerBin < MIN_LABEL_PX;

            const activeBins = skipAlternate
                ? normalBins.filter((_, i) => i % 2 === 0)
                : normalBins;

            // When bins are centered on whole numbers (fixed domain), tick at the
            // bin midpoint which equals the whole number. Label is just that integer.
            // Otherwise fall back to range labels ("4.5-5.5" style).
            const tickValues = activeBins.map(b => (b.min + b.max) / 2);

            axisGenerator.tickValues(tickValues)
                .tickFormat((_, i) => {
                    const bin = activeBins[i];
                    if (!bin) return '';
                    if (skipOutliers && !logX) {
                        // Bins are centered on whole numbers — label is just the integer
                        return String(Math.round((bin.min + bin.max) / 2));
                    }
                    const precision = logX ? 3 : 1;
                    const displayMin = bin.rawMin ?? bin.min;
                    const displayMax = bin.rawMax ?? bin.max;
                    return `${Number(displayMin.toFixed(precision))}-${Number(displayMax.toFixed(precision))}`;
                });
        }
    } else if (!xScale.bandwidth) {
        // Numeric or Time X-Axis
        const domain = xScale.domain();
        const isTimeScale = domain.length > 0 && domain[0] instanceof Date;

        if (isTimeScale) {
            const [domainMin, domainMax] = domain;
            const rangeYears = (domainMax - domainMin) / (1000 * 60 * 60 * 24 * 365);
            if (rangeYears > 10) {
                axisGenerator.tickFormat(d3.timeFormat("%Y/%m/%d"));
            } else {
                axisGenerator.tickFormat(d3.timeFormat("%Y/%m"));
            }
        } else {
            // Numeric X-Axis (Scatter, Line, etc.)
            if (staticXScale) {
                axisGenerator.tickValues(buildTickValues(staticXScale.min, staticXScale.max, staticXScale.step));
            }
            if (config?.logX) {
                // Tick values are log₁₀-transformed — display as the log value (e.g. 4 for 10000)
                axisGenerator.tickFormat(d => Number(d.toPrecision(4)).toString());
            } else {
                axisGenerator.tickFormat(d => formatNumber(d, 6));
            }
        }
    }

    // Intelligent tick skipping for band scales (categorical/discrete)
    // if (xScale.bandwidth) {
    //     const domain = xScale.domain();
    //     const width = xScale.range()[1] - xScale.range()[0];
    //     const labelWidth = 40; // Approx width of a year label "2025"
    //     const maxLabels = Math.floor(width / (labelWidth + 10)); // +10 padding

    //     if (domain.length > maxLabels) {
    //         const step = Math.ceil(domain.length / maxLabels);
    //         const tickValues = domain.filter((d, i) => i % step === 0);
    //         axisGenerator.tickValues(tickValues);
    //     }
    // }
    let xAxis = g.append('g')
        .attr('class', 'x-axis')
        .attr('transform', `translate(0,${xAxisY})`)
        .call(axisGenerator);


    xAxis.selectAll('text')
        .style('font-family', 'sans-serif')
        .style('font-size', '12px')
        .style('fill', color);
    xAxis.selectAll('line')
        .style('stroke', color);
    xAxis.select('.domain')
        .style('stroke', color);

    // Rotation Logic
    // User request: "Bar charts with x-axis ticks texts that are nominal, corresponding with a date, or other non-numeric value should be rotated 45 degrees"
    // We apply this to all band scales (nominal/categorical) and potentially time scales if we had them explicitly (but usually handled by d3.scaleTime).
    // Here we focus on band scales or if explicit rotation is needed.
    if (xScale.bandwidth) {
        // Rotate 45 degrees (actually -45 to read upwards-right)
        xAxis.selectAll('text')
            .style('text-anchor', 'end')
            .attr('dx', '-.8em')
            .attr('dy', '.15em')
            .attr('transform', 'rotate(-45)');
    } else {
        // Check for Time Scale rotation
        const domain = xScale.domain();
        const isTimeScale = domain.length > 0 && domain.some(d => d instanceof Date);

        if (isTimeScale) {
            xAxis.selectAll('text')
                .style('text-anchor', 'end')
                .attr('dx', '-.8em')
                .attr('dy', '.15em')
                .attr('transform', 'rotate(-45)');
        }
    }

    return xAxis;
};

const drawPrimaryYAxis = (g, xScale, primaryYScale, yAxisX, primaryColor, config = {}) => {
    const axisGenerator = d3.axisLeft(primaryYScale)
        .tickSizeOuter(0)
        .tickFormat(d => config?.logY
            ? Number(d.toPrecision(4)).toString()
            : formatNumber(d, 8));

    const staticYScale = getStaticScale(config, 'y');
    if (staticYScale) {
        axisGenerator.tickValues(buildTickValues(staticYScale.min, staticYScale.max, staticYScale.step));
    }

    const primaryYAxis = g.append('g')
        .attr('class', 'y-axis y-axis-primary')
        .attr('transform', `translate(${typeof xScale.paddingOuter === 'function' ? 0 : yAxisX},0)`)
        .call(axisGenerator);

    primaryYAxis.selectAll('text')
        .style('font-family', 'sans-serif')
        .style('font-size', '12px')
        .style('fill', primaryColor);

    primaryYAxis.selectAll('line')
        .style('stroke', primaryColor);

    primaryYAxis.select('.domain')
        .style('stroke', primaryColor);

    return primaryYAxis;
};

const drawSecondaryYAxis = (g, secondaryYScale, width, secondaryColor, config = {}) => {
    const axisGenerator = d3.axisRight(secondaryYScale)
        .tickSizeOuter(0)
        .tickFormat(d => formatNumber(d, 8)); // 8 digits threshold for Y-axis

    const staticY2Scale = getStaticScale(config, 'y2');
    if (staticY2Scale) {
        axisGenerator.tickValues(buildTickValues(staticY2Scale.min, staticY2Scale.max, staticY2Scale.step));
    }

    const secondaryYAxis = g.append('g')
        .attr('class', 'y-axis y-axis-secondary')
        .attr('transform', `translate(${width},0)`)
        .call(axisGenerator);

    secondaryYAxis.selectAll('text')
        .style('font-family', 'sans-serif')
        .style('font-size', '12px')
        .style('fill', secondaryColor);

    secondaryYAxis.selectAll('line')
        .style('stroke', secondaryColor);

    secondaryYAxis.select('.domain')
        .style('stroke', secondaryColor);

    return secondaryYAxis;
};

const drawLabels = (g, height, width, margin, primaryLabel, secondaryLabel, xAxisLabel, xAxisY, xAxisLabelOffset, primaryColor, secondaryColor) => {
    // Primary Y axis label
    g.append('text')
        .attr('class', 'y-axis-label y-axis-label-primary')
        .attr('transform', 'rotate(-90)')
        .attr('y', 0 - margin.left + 15)
        .attr('x', 0 - (height / 2))
        .attr('dy', '1em')
        .style('text-anchor', 'middle')
        .style('font-family', 'sans-serif')
        .style('font-size', '14px')
        .style('font-weight', 'bold')
        .style('fill', primaryColor)
        .text(primaryLabel);

    // Secondary Y axis label
    if (secondaryLabel) {
        g.append('text')
            .attr('class', 'y-axis-label y-axis-label-secondary')
            .attr('transform', 'rotate(-90)')
            .attr('y', width + 65)
            .attr('x', 0 - (height / 2))
            .attr('dy', '1em')
            .style('text-anchor', 'middle')
            .style('font-family', 'sans-serif')
            .style('font-size', '14px')
            .style('font-weight', 'bold')
            .style('fill', secondaryColor)
            .text(secondaryLabel);
    }

    // X axis label
    g.append('text')
        .attr('class', 'x-axis-label')
        .attr('y', xAxisY + xAxisLabelOffset + 10) // Add a bit more padding for rotated labels
        .attr('x', width / 2)
        .style('text-anchor', 'middle')
        .style('font-family', 'sans-serif')
        .style('font-size', '14px')
        .style('font-weight', 'bold')
        .text(xAxisLabel);
};

export const drawAxes = (
    g,
    xScale,
    yScale,
    height,
    width,
    margin,
    xAxisLabel,
    yAxisLabel,
    graphType,
    config = {},
    axisColors = null,
    seriesInfo = null,
    seriesColorScale = null,
    globalSettings = {},
    data = null, // Added data param
    xAxisInfo = null // Added xAxisInfo param
) => {
    debugLog('[drawAxes] g, xScale, yScale, height, width, margin, xAxisLabel, yAxisLabel, graphType, config, axisColors, seriesInfo, seriesColorScale, globalSettings, data, xAxisInfo', g, xScale, yScale, height, width, margin, xAxisLabel, yAxisLabel, graphType, config, axisColors, seriesInfo, seriesColorScale, globalSettings, data, xAxisInfo);
    // Check if dual-axis mode (yScale is an object with primary/secondary)
    debugLog('[drawAxes] yScale', yScale);
    const isDualAxis = yScale && typeof yScale === 'object' && yScale.primary && yScale.secondary;
    debugLog('[drawAxes] isDualAxis', isDualAxis);
    const primaryYScale = isDualAxis ? yScale.primary : yScale;
    const secondaryYScale = isDualAxis ? yScale.secondary : null;
    debugLog('[drawAxes] primaryYScale, secondaryYScale', primaryYScale, secondaryYScale);

    // Check if labels are also dual
    const isDualUnits = config.dualUnits;
    const isDualLabel = yAxisLabel && typeof yAxisLabel === 'object' && yAxisLabel.primary;
    const primaryLabel = isDualUnits ? `${yAxisLabel} (${config.fromUnits})` : isDualLabel ? yAxisLabel.primary : yAxisLabel;
    const secondaryLabel = isDualUnits ? `${yAxisLabel} (${config.toUnits})` : isDualLabel ? yAxisLabel.secondary : null;

    // Override y-axis label for histogram
    let finalPrimaryLabel = primaryLabel;
    if (graphType === 'histogram') {
        finalPrimaryLabel = 'Frequency';
    }

    // Calculate axis positioning
    const xAxisPosition = height;
    const yAxisPosition = 0;

    // Handle axis intercepts if configured
    let xAxisY = xAxisPosition;
    let yAxisX = yAxisPosition;
    if (typeof xScale.paddingOuter === 'function') {
        yAxisX = xScale.paddingOuter() * xScale.bandwidth() * 2;
    }
    else if (config.axisIntercept === 'origin') {
        const xDomain = xScale.domain();
        const yDomain = primaryYScale.domain();

        if (xDomain[0] <= 0 && xDomain[1] >= 0) {
            // For histograms with a centered-bin domain (e.g. [-0.5, 20.5]),
            // xScale(0) lands slightly right of the left edge. Pin to pixel 0
            // so the y-axis always sits flush against the left margin.
            const isHistogram = config.graphType === 'histogram' ||
                config.series?.some(s => s.graphType === 'histogram');
            yAxisX = isHistogram ? 0 : Math.max(0, Math.min(width, xScale(0)));
        }
        if (yDomain[0] <= 0 && yDomain[1] >= 0) {
            xAxisY = Math.max(0, Math.min(height, primaryYScale(0)));
        }
    } else if (config.axisIntercept === 'custom' && config.customIntercept) {
        const customX = Number.parseFloat(config.customIntercept.x) || 0;
        const customY = Number.parseFloat(config.customIntercept.y) || 0;

        const xDomain = xScale.domain();
        const yDomain = primaryYScale.domain();

        if (customX >= xDomain[0] && customX <= xDomain[1]) {
            yAxisX = xScale(customX);
        }
        if (customY >= yDomain[0] && customY <= yDomain[1]) {
            xAxisY = primaryYScale(customY);
        }
    }

    // Ensure axes are within bounds
    xAxisY = Math.max(0, Math.min(height, xAxisY));
    yAxisX = Math.max(0, Math.min(width, yAxisX));

    // Determine axis colors
    const primaryColor = axisColors?.primary || '#333';
    const secondaryColor = axisColors?.secondary || '#333';

    const finalXLabel = config?.logX ? `${xAxisLabel} (log\u2081\u2080)` : xAxisLabel;
    const finalYLabelWithLog = config?.logY ? `${finalPrimaryLabel} (log\u2081\u2080)` : finalPrimaryLabel;

    drawXAxis(g, xScale, xAxisY, 50, finalXLabel, graphType, data, xAxisInfo, config, primaryColor);
    drawPrimaryYAxis(g, xScale, primaryYScale, yAxisX, primaryColor, config);
    debugLog('[drawAxes] Secondary Y Scale and isDualAxis: ', secondaryYScale, isDualAxis);
    if (isDualAxis && secondaryYScale) {
        drawSecondaryYAxis(g, secondaryYScale, width, secondaryColor, config);
    }

    drawLabels(g, height, width, margin, finalYLabelWithLog, secondaryLabel, finalXLabel, xAxisY, 50, primaryColor, secondaryColor);

    // Draw guide lines if enabled
    if (globalSettings.showGuideLines) {
        drawGuideLines(g, xScale, primaryYScale, width, height);
    }

    return { xAxisY, xAxisLabelOffset: 50 };
};

/**
 * Calculate axis position in pixels based on scale and intercept
 * @param {d3.Scale} scale - D3 scale
 * @param {number} intercept - Intercept value in data coordinates
 * @returns {number} Position in pixels
 */
export const calculateAxisPosition = (scale, intercept) => {
    return scale(intercept);
};

/**
 * Validate axis configuration
 * @param {Object} axisConfig - Axis configuration
 * @returns {boolean} True if valid
 * @throws {Error} If configuration is invalid
 */
export const validateAxisConfig = (axisConfig) => {
    if (!axisConfig) {
        throw new Error('Axis configuration is required');
    }

    if (!axisConfig.columnName || typeof axisConfig.columnName !== 'string') {
        throw new Error('Axis configuration must have a valid columnName');
    }

    return true;
};

/**
 * Draw faint guide lines (grid) on the graph
 * @param {d3.Selection} g - D3 selection of graph group element
 * @param {d3.Scale} xScale - X-axis scale
 * @param {d3.Scale} yScale - Y-axis scale
 * @param {number} width - Graph width
 * @param {number} height - Graph height
 */
export const drawGuideLines = (g, xScale, yScale, width, height) => {
    // Create a group for guide lines (behind data)
    const guideGroup = g.insert('g', ':first-child')
        .attr('class', 'guide-lines')
        .style('opacity', 0.15);

    // Horizontal guide lines (based on Y-axis ticks)
    const yTicks = yScale.ticks ? yScale.ticks() : yScale.domain();
    yTicks.forEach(tick => {
        guideGroup.append('line')
            .attr('x1', 0)
            .attr('x2', width)
            .attr('y1', yScale(tick))
            .attr('y2', yScale(tick))
            .style('stroke', '#999')
            .style('stroke-width', 1)
            .style('stroke-dasharray', '2,3');
    });

    // Vertical guide lines (based on X-axis ticks)
    // Handle both linear and band scales
    if (xScale.ticks) {
        // Linear scale
        const xTicks = xScale.ticks();
        xTicks.forEach(tick => {
            guideGroup.append('line')
                .attr('x1', xScale(tick))
                .attr('x2', xScale(tick))
                .attr('y1', 0)
                .attr('y2', height)
                .style('stroke', '#999')
                .style('stroke-width', 1)
                .style('stroke-dasharray', '2,3');
        });
    } else if (xScale.domain) {
        // Band scale or other categorical scale
        const xValues = xScale.domain();
        // Only draw guide lines for reasonable number of categories
        if (xValues.length <= 50) {
            xValues.forEach(value => {
                const xPos = xScale(value) + (xScale.bandwidth ? xScale.bandwidth() / 2 : 0);
                guideGroup.append('line')
                    .attr('x1', xPos)
                    .attr('x2', xPos)
                    .attr('y1', 0)
                    .attr('y2', height)
                    .style('stroke', '#999')
                    .style('stroke-width', 1)
                    .style('stroke-dasharray', '2,3');
            });
        }
    }
};
