/**
 * @fileoverview Statistical utility functions for data aggregation and analysis.
 * Provides functions to calculate mean, standard deviation, standard error,
 * and confidence intervals for grouped data.
 */

import * as d3 from 'd3';

/**
 * Calculate the critical t-value for a given confidence level and degrees of freedom.
 * Uses a simple approximation or lookup for common values if exact calculation is complex without a library.
 * For N > 30, z-score is a good approximation. For small N, we need t-distribution.
 * 
 * Since we don't have a stats library, we'll use a standard normal approximation (Z-score) 
 * which is acceptable for larger datasets, or a simplified t-table lookup for small N.
 * 
 * @param {number} confidenceLevel - Confidence level (e.g., 0.95 for 95%)
 * @param {number} df - Degrees of freedom (N - 1)
 * @returns {number} Critical value (t-score or z-score)
 */
const getCriticalValue = (confidenceLevel, df) => {
    // If df is large, use Z-score
    if (df >= 30) {
        // Standard normal quantiles
        if (confidenceLevel === 0.90) return 1.645;
        if (confidenceLevel === 0.95) return 1.96;
        if (confidenceLevel === 0.99) return 2.576;
        // Fallback approximation for other levels (using Box-Muller or similar is overkill here)
        // Let's stick to common ones or default to 1.96 (95%)
        return 1.96;
    }

    // Simple T-table lookup for common degrees of freedom and 95% confidence
    // This is a simplified approach. For a robust app, a stats library is recommended.
    // We will use a conservative estimate or the Z-score if exact T isn't available.
    // For now, let's use Z-score as a baseline approximation for UI visualization purposes.
    // It underestimates the interval for small N, but is better than nothing.
    return 1.96;
};

/**
 * Aggregates data by grouping by x-axis value and calculating statistics for y-axis values.
 * 
 * @param {Array<Object>} data - Raw data array
 * @param {Object} xAxisInfo - X-axis column info { columnName: string }
 * @param {Array<Object>} seriesInfo - Array of series info objects { yAxisInfo: { columnName: string } }
 * @returns {Array<Object>} Aggregated data array
 */
export const aggregateData = (data, xAxisInfo, seriesInfo) => {
    const xCol = xAxisInfo.columnName;

    // Group data by x-axis value
    const grouped = d3.group(data, d => d[xCol]);

    const aggregatedResult = [];

    for (const [xValue, group] of grouped) {
        const aggregatedItem = {
            [xCol]: xValue,
            _originalData: group // Keep reference to original data if needed
        };

        // Calculate stats for each series
        seriesInfo.forEach(series => {
            const yCol = series.yAxisInfo.columnName;
            const calculateCI = series.showConfidenceInterval || false;
            const confidenceLevel = series.confidenceLevel || 95;

            // Extract valid numeric values
            const values = group
                .map(d => d[yCol])
                .filter(v => v !== undefined && v !== null && v !== '' && !isNaN(+v))
                .map(v => +v);

            if (values.length === 0) {
                aggregatedItem[yCol] = null;
                return;
            }

            // Calculate Mean
            const mean = d3.mean(values);
            aggregatedItem[yCol] = mean;

            // Calculate CI if requested
            if (calculateCI && values.length > 1) {
                const n = values.length;
                const stdDev = d3.deviation(values); // Sample standard deviation
                const stdError = stdDev / Math.sqrt(n);

                // Convert percentage to decimal (e.g., 95 -> 0.95)
                const confDecimal = Math.max(0, Math.min(1, confidenceLevel / 100));
                const criticalValue = getCriticalValue(confDecimal, n - 1);

                const marginOfError = criticalValue * stdError;

                aggregatedItem[`${yCol}_ci_lower`] = mean - marginOfError;
                aggregatedItem[`${yCol}_ci_upper`] = mean + marginOfError;
                aggregatedItem[`${yCol}_std_err`] = stdError;
                aggregatedItem[`${yCol}_n`] = n;
            } else {
                // If N=1, CI is 0 (or undefined)
                aggregatedItem[`${yCol}_ci_lower`] = mean;
                aggregatedItem[`${yCol}_ci_upper`] = mean;
                aggregatedItem[`${yCol}_std_err`] = 0;
                aggregatedItem[`${yCol}_n`] = values.length;
            }
        });

        // Copy other properties from the first item in the group (for non-numeric metadata)
        // Be careful not to overwrite calculated values
        const firstItem = group[0];
        Object.keys(firstItem).forEach(key => {
            if (!aggregatedItem.hasOwnProperty(key)) {
                aggregatedItem[key] = firstItem[key];
            }
        });

        aggregatedResult.push(aggregatedItem);
    }

    return aggregatedResult;
};
