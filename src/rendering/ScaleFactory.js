/**
 * @fileoverview Centralized scale creation factory for D3 visualizations.
 * Creates and manages D3 scales for axes, colors, and data mappings with consistent configuration.
 *
 * @author Harison Sharp
 * @since 0.3.0
 *
 * @module Scale Factory
 * @type {Service Class}
 *
 * @requires d3 - Data visualization library for scale creation
 *
 * @exports ScaleFactory - Centralized scale creation service
 *
 * @example
 * const scales = ScaleFactory.createScalesForGraph(data, config, dimensions);
 * const colorScale = ScaleFactory.createColorScale(data, colorInfo, scheme);
 *
 * @relatedFiles GraphService.js, GraphRenderer.jsx (consolidates scale creation)
 */

import * as d3 from 'd3';
import { DataValidator } from '../core/validation/DataValidator.js';
import { generateCustomBins } from '../utils/histogram.js';
import { debugLog, debugWarn } from '../utils/debug.js';
import { parseColumnId } from '../utils/columnUtils.js';
export class ScaleFactory {
    /**
     * Color scheme interpolators
     */
    static COLOR_SCHEMES = {
        'warm-cool': d3.interpolateRdYlBu,
        'rainbow': d3.interpolateRainbow,
        'green-red': d3.interpolateRdYlGn
    };

    static COLOR_SCHEME_NAMES = ['warm-cool', 'rainbow', 'green-red'];

    /**
     * Create linear scale for continuous numeric data
     * @param {Array<number>} domain - [min, max] domain values
     * @param {Array<number>} range - [min, max] pixel range
     * @returns {d3.ScaleLinear} Linear scale
     */
    static createLinearScale(domain, range) {
        DataValidator.validateDataExtents(domain);

        return d3.scaleLinear()
            .domain(domain)
            .range(range)
        // .nice();
    }

    /**
     * Add padding to domain extent for better visual spacing
     * @param {number} min - Minimum value
     * @param {number} max - Maximum value
     * @param {number} topPadding - Top padding as percentage (default 0.15 = 15%)
     * @param {number} bottomPadding - Bottom padding as percentage (default 0.05 = 5%)
     * @returns {Array<number>} [min, max] with padding applied
     */
    static addDomainPadding(min, max, topPadding = 0.0, bottomPadding = 0.00) {
        const range = max - min;

        // Handle edge case where min === max
        if (range === 0) {
            return [min - 1, max + 1];
        }

        // Add padding to bottom and top
        const paddedMin = min - (range * bottomPadding);
        const paddedMax = max + (range * topPadding);

        return [paddedMin, paddedMax];
    }

    /**
     * Create band scale for categorical data (used in bar charts)
     * @param {Array} domain - Array of category values
     * @param {Array<number>} range - [min, max] pixel range
     * @param {number} paddingOuter - Padding between bands and axes (0-1)
     * @param {number} paddingInner - Padding between bands (0-1), higher number = narrower bars and more space between. Excel seems to default to 0.55
     * @returns {d3.ScaleBand} Band scale
     */
    static createBandScale(domain, range, paddingOuter = 0.5, paddingInner = 0.5) {
        if (!Array.isArray(domain) || domain.length === 0) {
            throw new Error('Band scale domain must be a non-empty array');
        }

        return d3.scaleBand()
            .domain(domain)
            .range(range)
            .padding(paddingOuter)
            .paddingInner(paddingInner);
    }

    /**
     * Create color scale for data visualization
     * @param {Array<Object>} data - Data array
     * @param {Object} colorInfo - {columnName, fileName} color column info
     * @param {string} colorScheme - Color scheme name (for continuous)
     * @param {Object} categoryColors - Optional overrides for distinct mode: { [categoryValue]: hexColor }
     * @returns {d3.Scale|null} Color scale or null if no color grading
     */
    static createColorScale(data, colorInfo, colorScheme = 'warm-cool', categoryColors = {}) {
        if (!colorInfo || !colorInfo.columnName) {
            return null;
        }

        const colorValues = data
            .map(d => d[colorInfo.columnName])
            .filter(v => v !== undefined && v !== null && v !== '');

        if (colorValues.length === 0) {
            return null;
        }

        // Categorical (string) color scale
        if (typeof colorValues[0] === 'string') {
            const uniqueValues = [...new Set(colorValues)];
            const colors = uniqueValues.map((val, i) =>
                (categoryColors && categoryColors[val]) || d3.schemeCategory10[i % 10]
            );
            return d3.scaleOrdinal()
                .domain(uniqueValues)
                .range(colors);
        }

        // Continuous (numeric) color scale
        const extent = d3.extent(colorValues);
        const interpolator = this.COLOR_SCHEMES[colorScheme] || this.COLOR_SCHEMES['warm-cool'];

        return d3.scaleSequential(interpolator)
            .domain(extent);
    }

    /**
     * Build per-series color grading scales from series configs.
     * Returns an array (indexed to seriesInfo) of { colorScale, colorInfo } or null for ungraded series.
     * @param {Array<Object>} validData - Filtered valid data
     * @param {Array<Object>} seriesInfo - Series configurations (each has .colorGrading)
     * @returns {Array<{colorScale: d3.Scale, colorInfo: Object}|null>}
     */
    static createSeriesColorScales(validData, seriesInfo) {
        if (!Array.isArray(seriesInfo)) return [];
        return seriesInfo.map(series => {
            const grading = series.colorGrading;
            if (!grading?.enabled || !grading.column) return null;

            const colorInfo = parseColumnId(grading.column);
            if (!colorInfo?.columnName) return null;

            const colorScale = ScaleFactory.createColorScale(
                validData,
                colorInfo,
                grading.scheme || 'warm-cool',
                grading.mode === 'distinct' ? (grading.categoryColors || {}) : {}
            );
            if (!colorScale) return null;

            return { colorScale, colorInfo, mode: grading.mode || 'continuous' };
        });
    }

    /**
     * Create ordinal color scale for series differentiation
     * @param {Array<string>} seriesNames - Array of series identifiers
     * @param {Array<Object>} seriesInfo - List of series configuration objects (optional)
     * @returns {d3.ScaleOrdinal} Ordinal color scale
     */
    static CUSTOM_COLOR_MAP = {
        'blue': '#3E68C6',
        'orange': '#ff7f0e',
        'green': '#2ca02c',
        'red': '#d62728',
        'purple': '#9467bd',
        'brown': '#8c564b'
    };

    /**
     * Resolve a color string to a hex code if it exists in the custom color map
     * @param {string} color - Color name or hex code
     * @returns {string} Resolved hex color or original string
     */
    static resolveColor(color) {
        if (!color) return color;
        const normalized = color.toLowerCase().trim();
        return ScaleFactory.CUSTOM_COLOR_MAP[normalized] || color;
    }

    /**
     * Create ordinal color scale for series differentiation
     * @param {Array<string>} seriesNames - Array of series identifiers
     * @param {Array<Object>} seriesInfo - List of series configuration objects (optional)
     * @returns {d3.ScaleOrdinal} Ordinal color scale
     */
    static createSeriesColorScale(seriesNames, seriesInfo = []) {
        // Create a mapping of series name to custom color
        const customColors = {};
        seriesInfo.forEach(s => {
            if (s.color && s.yAxisInfo && s.yAxisInfo.columnName) {
                const rawColor = s.color.toLowerCase().trim();
                if (rawColor !== 'none' && rawColor !== 'unknown') {
                    customColors[s.yAxisInfo.columnName] = ScaleFactory.CUSTOM_COLOR_MAP[rawColor] || s.color;
                }
            }
        });

        const colors = seriesNames.map((name, i) => {
            // Use custom color if available, otherwise fallback to scheme
            if (customColors[name]) {
                return customColors[name];
            }
            return d3.schemeCategory10[i % 10];
        });

        return d3.scaleOrdinal()
            .domain(seriesNames)
            .range(colors);
    }

    /**
     * Create complete set of scales for a graph
     * @param {Array<Object>} data - Valid data array
     * @param {Object} xAxisInfo - {columnName, fileName} x-axis info
     * @param {Array<Object>} seriesInfo - Array of series configurations
     * @param {number} width - Graph width in pixels
     * @param {number} height - Graph height in pixels
     * @param {Object} config - Graph configuration
     * @returns {Object} {xScale, yScale} scale objects (yScale may be {primary, secondary} for dual-axis)
     */
    static createScalesForGraph(data, xAxisInfo, seriesInfo, width, height, config) {
        DataValidator.validateSufficientData(data);

        if (!xAxisInfo || !xAxisInfo.columnName) {
            throw new Error('X-axis information is required');
        }

        const graphType = (config?.graphType || '').toLowerCase();
        if (graphType === 'histogram') {
            return this.createHistogramScales(data, xAxisInfo, width, height, config);
        }

        if (!Array.isArray(seriesInfo) || seriesInfo.length === 0) {
            throw new Error('At least one series is required');
        }

        // Separate series by axis assignment
        const primarySeries = seriesInfo.filter(s => s.axisAssignment !== 'secondary');
        const secondarySeries = seriesInfo.filter(s => s.axisAssignment === 'secondary' || config.dualUnits);
        const hasDualAxis = secondarySeries.length > 0;

        // Check if we need band scale for categorical data or bar charts
        const hasBarSeries = seriesInfo.some(s => s.graphType === 'bar');
        const xValues = data.map(d => d[xAxisInfo.columnName]).filter(v => v !== undefined && v !== null);
        debugLog('ScaleFactory.createScalesForGraph', 'xValues', xValues);
        // Determine if x-axis should be categorical (band scale)
        const isCategorical = hasBarSeries || this.shouldUseBandScale(xValues);

        let xScale;
        const scaleType = this.inferScaleType(xValues);
        const staticXScale = this.getStaticScaleConfig(config, 'x');
        debugLog('ScaleFactory.createScalesForGraph', 'scaleType', scaleType);
        if (scaleType === 'time') {
            // TODO: Support static scales for date-time axes.
            // Parse values to dates if they are strings
            const dateValues = xValues.map(v => v instanceof Date ? v : new Date(v))
                .filter(d => !isNaN(d.getTime())); // Filter invalid dates
            debugLog('ScaleFactory.createScalesForGraph', 'dateValues', dateValues);
            if (dateValues.length === 0) {
                // Fallback if parsing fails
                console.warn('Failed to parse date values for time scale, falling back to band scale');
                const uniqueXValues = [...new Set(xValues)];
                xScale = this.createBandScale(uniqueXValues, [0, width], 0.5);
            } else {
                const xExtent = d3.extent(dateValues);
                xScale = this.createTimeScale(xExtent, [0, width]);
            }
        } else if (scaleType === 'band' || isCategorical) {
            // TODO: Support static scales for categorical axes.
            // Create band scale for categorical/bar chart data
            const uniqueXValues = [...new Set(xValues)];
            xScale = this.createBandScale(uniqueXValues, [0, width], 0.5);
        } else {
            // Create linear (or log) scale for continuous data
            const xExtent = d3.extent(xValues, d => +d);
            if (staticXScale) {
                if (config.logX) {
                    const logMin = Math.log10(Math.max(staticXScale.min, 1e-10));
                    const logMax = Math.log10(Math.max(staticXScale.max, 1e-10));
                    xScale = this.createLinearScale([logMin, logMax], [0, width]);
                } else {
                    xScale = this.createLinearScale([staticXScale.min, staticXScale.max], [0, width]);
                }
            } else if (xExtent[0] === undefined || xExtent[1] === undefined || isNaN(xExtent[0]) || isNaN(xExtent[1])) {
                // Fallback to band if numeric fails
                const uniqueXValues = [...new Set(xValues)];
                xScale = this.createBandScale(uniqueXValues, [0, width], 0.5);
            } else {
                if (config.logX) {
                    const positiveXValues = xValues.filter(v => +v > 0);
                    const logExtent = d3.extent(positiveXValues, d => Math.log10(+d));
                    xScale = this.createLinearScale(logExtent, [0, width]);
                } else {
                    xScale = this.createLinearScale(xExtent, [0, width]);
                }
            }
        }

        // Create Y scale(s)
        debugLog('ScaleFactory.createScalesForGraph', 'config', config);

        if (hasDualAxis || config.dualUnits) {
            debugLog('ScaleFactory.createScalesForGraph', 'hasDualAxis', hasDualAxis);
            debugLog('ScaleFactory.createScalesForGraph', 'config.dualUnits', config.dualUnits);
            // Check for matching scale requirement
            if (config.secondaryYAxisScale === 'matching') {
                // Create a single scale for ALL series (union of domains)
                const unifiedYScale = this.createYScale('primary', data, seriesInfo, height, config, hasBarSeries, xAxisInfo);
                return {
                    xScale,
                    yScale: {
                        primary: unifiedYScale,
                        secondary: unifiedYScale // Same scale object
                    }
                };
            }

            // Create separate scales for primary and secondary axes
            const primaryYScale = this.createYScale('primary', data, primarySeries, height, config, hasBarSeries, xAxisInfo);
            const secondaryYScale = this.createYScale('secondary', data, secondarySeries, height, config, false, xAxisInfo);

            return {
                xScale,
                yScale: {
                    primary: primaryYScale,
                    secondary: secondaryYScale
                }
            };
        } else {
            // Single Y scale
            const yScale = this.createYScale('primary', data, primarySeries, height, config, hasBarSeries, xAxisInfo);
            return { xScale, yScale };
        }
    }

    /**
     * Create Y scale for a set of series
     * @param {Array<Object>} data - Data array
     * @param {Array<Object>} seriesInfo - Series to include in this scale
     * @param {number} height - Graph height
     * @param {Object} config - Graph configuration
     * @param {boolean} hasBarSeries - Whether any series is a bar chart
     * @returns {d3.Scale} Y scale
     */
    static createYScale(axis, data, seriesInfo, height, config, hasBarSeries, xAxisInfo) {
        if (seriesInfo.length === 0) {
            // No series, create default scale
            return this.createLinearScale([0, 100], [height, 0]);
        }

        let yMin = Infinity;
        let yMax = -Infinity;

        const isStack = config.barMode === 'stack' && hasBarSeries;
        const isStackProportional = config.barMode === 'stack-proportional' && hasBarSeries;
        if (isStack) {
            // For stacked bar charts, calculate stacked totals
            const stackKeys = seriesInfo.filter(s => s.graphType === 'bar').map(s => s.yAxisInfo.columnName);
            if (stackKeys.length > 0) {
                const stackedData = d3.stack().keys(stackKeys)(data);
                yMin = d3.min(stackedData, series => d3.min(series, d => d[0]));
                yMax = d3.max(stackedData, series => d3.max(series, d => d[1]));
            }
        } else if (isStackProportional) {
            const isOtherSeries = seriesInfo.filter(s => s.graphType !== 'bar').length > 0;
            if (isOtherSeries) {
                const stackKeys = seriesInfo.filter(s => s.graphType === 'bar').map(s => s.yAxisInfo.columnName);
                if (stackKeys.length > 0) {
                    const stackedData = d3.stack().keys(stackKeys)(data);
                    yMin = d3.min(stackedData, series => d3.min(series, d => d[0]));
                    yMax = d3.max(stackedData, series => d3.max(series, d => d[1]));
                }
            } else {
                yMin = 0;
                yMax = 100;
            }

        }
        debugLog('[createYScale] series info, size, type: ', seriesInfo, seriesInfo.length, typeof seriesInfo);
        if (!isStack && !isStackProportional || config.graphType !== 'bar') {
            // For non-stacked charts, find min/max across all series
            seriesInfo.forEach(s => {
                if (s.graphType === 'histogram') {
                    if (xAxisInfo && xAxisInfo.columnName) {
                        const xValues = data.map(d => +d[xAxisInfo.columnName]).filter(v => !isNaN(v) && isFinite(v));
                        const numBinsOverride = config?.numBins ? Number(config.numBins) : null;
                        const bins = generateCustomBins(xValues, numBinsOverride);
                        const maxCount = bins.length > 0 ? d3.max(bins, bin => bin.values.length) : 0;
                        yMin = Math.min(yMin, 0);
                        yMax = Math.max(yMax, maxCount);
                    }
                } else if (config.dualUnits && axis === 'secondary') {
                    const yValues = data.map(d => +d[s.yAxisInfo.columnName] / config.scaleFactor).filter(v => !isNaN(v) && isFinite(v));
                    if (yValues.length > 0) {
                        const yExtent = d3.extent(yValues);
                        yMin = Math.min(yMin, yExtent[0]);
                        yMax = Math.max(yMax, yExtent[1]);
                    }
                } else {
                    const yValues = data.map(d => +d[s.yAxisInfo.columnName]).filter(v => !isNaN(v) && isFinite(v));
                    if (yValues.length > 0) {
                        const yExtent = d3.extent(yValues);
                        yMin = Math.min(yMin, yExtent[0]);
                        yMax = Math.max(yMax, yExtent[1]);
                    }
                }
            });
        }

        // Ensure we have valid y-axis range
        if (!isFinite(yMin) || !isFinite(yMax) || yMin === yMax) {
            if (yMin === yMax) {
                yMin = yMin - 1;
                yMax = yMax + 1;
            } else {
                yMin = 0;
                yMax = 100;
            }
        }

        const axisStaticScale = this.getStaticScaleConfig(config, axis === 'secondary' ? 'y2' : 'y');

        if (axisStaticScale) {
            if (config.logY) {
                const logMin = Math.log10(Math.max(axisStaticScale.min, 1e-10));
                const logMax = Math.log10(Math.max(axisStaticScale.max, 1e-10));
                return this.createLinearScale([logMin, logMax], [height, 0]);
            }
            return this.createLinearScale([axisStaticScale.min, axisStaticScale.max], [height, 0]);
        }

        // Add visual padding to create space at top and bottom of chart
        // This provides better visual spacing and prevents data from touching edges
        // For bar charts or when minimum is non-negative, don't pad below 0
        const shouldStartAtZero = hasBarSeries;
        const bottomPad = shouldStartAtZero ? 0 : 0.05;
        const topPad = shouldStartAtZero ? 0 : 0.05;
        const finalMin = shouldStartAtZero ? Math.min(0, yMin) : yMin;

        if (config.logY) {
            const positiveMin = Math.max(finalMin, 1e-10);
            const positiveMax = Math.max(yMax, positiveMin * 10);
            const [paddedLogMin, paddedLogMax] = this.addDomainPadding(Math.log10(positiveMin), Math.log10(positiveMax), topPad, bottomPad);
            return this.createLinearScale([paddedLogMin, paddedLogMax], [height, 0]);
        }

        const [paddedMin, paddedMax] = this.addDomainPadding(finalMin, yMax, topPad, bottomPad);
        return this.createLinearScale([paddedMin, paddedMax], [height, 0]);
    }

    /**
     * Create scales specifically for histogram rendering.
     * @param {Array<Object>} data - Valid data array
     * @param {Object} xAxisInfo - Histogram x-axis info
     * @param {number} width - Graph width
     * @param {number} height - Graph height
     * @returns {Object} { xScale, yScale }
     */
    static createHistogramScales(data, xAxisInfo, width, height, config = {}) {
        const rawValues = data
            .map(d => +d[xAxisInfo.columnName])
            .filter(v => !isNaN(v) && isFinite(v));

        if (rawValues.length === 0) {
            throw new Error(`Histogram requires numeric data for column ${xAxisInfo.columnName}`);
        }

        // For log X: bin in log space so bars are geometrically spaced
        const values = config.logX
            ? rawValues.filter(v => v > 0).map(v => Math.log10(v))
            : rawValues;

        // For log X, the xScale domain is in log₁₀ space (values already log-transformed above)
        const staticXScale = this.getStaticScaleConfig(config, 'x');
        let xDomain;
        if (staticXScale) {
            // Extend 0.5 either side so the centered half-bins at the edges
            // are fully visible and not clipped at the axis boundary.
            const half = config.logX ? 0 : 0.5;
            xDomain = config.logX
                ? [Math.log10(Math.max(staticXScale.min, 1e-10)), Math.log10(Math.max(staticXScale.max, 1e-10))]
                : [staticXScale.min - half, staticXScale.max + half];
        } else {
            xDomain = d3.extent(values); // already log-transformed when logX
        }
        const xScale = this.createLinearScale(xDomain, [0, width]);

        const numBinsOverride = config?.numBins ? Number(config.numBins) : null;
        const skipOutliers = staticXScale !== null;
        const domainMin = staticXScale ? Number(staticXScale.min) : null;
        const domainMax = staticXScale ? Number(staticXScale.max) : null;
        const bins = generateCustomBins(values, numBinsOverride, skipOutliers, domainMin, domainMax);
        const normalBins = bins.filter(b => !b.isOutlierBin);
        const maxCount = normalBins.length > 0 ? d3.max(normalBins, bin => bin.values.length) : 1;

        const staticYScale = this.getStaticScaleConfig(config, 'y');
        let yDomain;
        if (staticYScale) {
            yDomain = config.logY
                ? [Math.log10(Math.max(staticYScale.min, 1e-10)), Math.log10(Math.max(staticYScale.max, 1e-10))]
                : [staticYScale.min, staticYScale.max];
        } else if (config.logY) {
            // Clamp to at least log10(2) so log10(maxCount=1)=0 never creates a zero-range
            // domain (which triggers the [-1,1] fallback and misaligns bars with the x-axis).
            const logMax = Math.max(Math.log10(Math.max(maxCount, 1)), Math.log10(2));
            yDomain = [0, logMax * 1.05];
        } else {
            // 5% top headroom; keep min at exactly 0 so bars always sit on the x-axis.
            yDomain = [0, maxCount * 1.05];
        }
        const yScale = this.createLinearScale(yDomain, [height, 0]);

        return { xScale, yScale };
    }

    /**
     * Determine if x-axis values should use band scale
     * @param {Array} xValues - X-axis values
     * @returns {boolean} True if should use band scale
     */
    static shouldUseBandScale(xValues) {
        if (xValues.length === 0) return false;

        // If all values are strings, use band scale
        const allStrings = xValues.every(v => typeof v === 'string');
        if (allStrings) return true;

        // If values are numeric but represent categories (small number of discrete values)
        const numericValues = xValues.map(v => +v).filter(v => !isNaN(v));
        if (numericValues.length !== xValues.length) return true; // Mixed types

        const uniqueValues = new Set(numericValues);
        const isDiscrete = uniqueValues.size <= Math.min(20, xValues.length / 2); // Heuristic for categorical

        return isDiscrete && uniqueValues.size < xValues.length * 0.1; // Less than 10% unique values
    }

    /**
     * Create contour color scale
     * @param {number} numLevels - Number of contour levels
     * @returns {d3.ScaleSequential} Sequential color scale
     */
    static createContourColorScale(numLevels) {
        return d3.scaleSequential(d3.interpolateViridis)
            .domain([0, numLevels - 1]);
    }

    /**
     * Extend scale domain to include specific value
     * @param {d3.Scale} scale - D3 scale to extend
     * @param {number} value - Value to include in domain
     * @returns {d3.Scale} Extended scale
     */
    static extendScaleDomain(scale, value) {
        const currentDomain = scale.domain();
        const newDomain = [
            Math.min(currentDomain[0], value),
            Math.max(currentDomain[1], value)
        ];
        return scale.domain(newDomain);
    }

    /**
     * Create logarithmic scale for log-transformed axes.
     * Clamps domain to positive values — zero/negative inputs are shifted to a small positive floor.
     * @param {Array<number>} domain - [min, max] domain values
     * @param {Array<number>} range - [min, max] pixel range
     * @returns {d3.ScaleLog} Logarithmic scale
     */
    static createLogScale(domain, range) {
        const safeMin = Math.max(domain[0], 1e-10);
        const safeMax = Math.max(domain[1], safeMin * 10);
        return d3.scaleLog()
            .domain([safeMin, safeMax])
            .range(range)
            .clamp(true);
    }

    /**
     * Create time scale for temporal data
     * @param {Array<Date>} domain - [minDate, maxDate] domain values
     * @param {Array<number>} range - [min, max] pixel range
     * @returns {d3.ScaleTime} Time scale
     */
    static createTimeScale(domain, range) {
        return d3.scaleTime()
            .domain(domain)
            .range(range)
            .nice();
    }

    /**
     * Get appropriate scale type for data
     * @param {Array} values - Sample values from column
     * @returns {string} Scale type: 'linear', 'band', 'time', 'log'
     */
    static inferScaleType(values) {

        if (values.length === 0) return 'linear';

        const firstValue = values[0];

        // Check if temporal
        if (firstValue instanceof Date) return 'time';

        // Check if boolean
        if (typeof firstValue === 'boolean') return 'band';

        // Check if categorical (string)
        if (typeof firstValue === 'string') {
            // Check if string looks like a date
            const dateValue = new Date(firstValue);

            if (!isNaN(dateValue.getTime()) && firstValue.length > 4) {
                // Basic heuristic: parsable as date and not just a short number-like string (e.g. "2020")
                // Check multiple values to be sure, avoiding false positives like "1.2" (which new Date() might handle weirdly depending on locale?)
                // Actually new Date("1.2") is usually Invalid Date. new Date("2020") is valid.
                // Let's iterate a few values to confirm
                const looksLikeDate = values.slice(0, 5).every(v => !isNaN(new Date(v).getTime()));
                if (looksLikeDate) return 'time';
            }
            return 'band';
        }

        // Check if numeric
        if (typeof firstValue === 'number' && isFinite(firstValue)) {
            // Check if all values are positive (could use log scale)
            const allPositive = values.every(v => v > 0);
            return 'linear'; // Can extend to return 'log' as option
        }

        return 'linear';
    }

    /**
     * Parse static numeric scale settings for a specific axis.
     * Returns null when disabled or invalid.
     */
    static getStaticScaleConfig(config, axisKey) {
        const axisScale = config?.staticScales?.[axisKey];
        if (!axisScale || axisScale.enabled !== true) {
            return null;
        }

        const min = Number.parseFloat(axisScale.min);
        const max = Number.parseFloat(axisScale.max);
        const step = Number.parseFloat(axisScale.step);

        if (!Number.isFinite(min) || !Number.isFinite(max) || !Number.isFinite(step)) {
            return null;
        }

        if (max <= min || step <= 0) {
            return null;
        }

        return { min, max, step };
    }
}
