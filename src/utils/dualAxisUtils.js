/**
 * @fileoverview Dual-axis utility functions for managing primary and secondary Y-axes.
 * Handles axis color logic, series grouping, and type conflict detection.
 *
 * @author Harison Sharp
 * @since 0.4.0
 *
 * @module Dual Axis Utilities
 * @type {Utility Library}
 *
 * @function groupSeriesByAxis - Group series by axis assignment
 * @function getAxisColor - Determine axis label and tick color based on series count
 * @function detectTypeConflict - Check if series types conflict between axes
 * @function resolveTypeConflict - Auto-resolve type conflicts with notification
 *
 * @exports groupSeriesByAxis, getAxisColor, detectTypeConflict, resolveTypeConflict
 *
 * @example
 * const { primary, secondary } = groupSeriesByAxis(series);
 * const color = getAxisColor(primarySeries, secondarySeries);
 *
 * @relatedFiles GraphConfiguration.jsx, GraphRenderer.jsx, axisUtils.js
 */

/**
 * Group series by their axis assignment
 * @param {Array} series - Array of series configurations
 * @returns {Object} {primary: Array, secondary: Array}
 */
export const groupSeriesByAxis = (series) => {
    if (!Array.isArray(series)) {
        return { primary: [], secondary: [] };
    }

    const primary = series.filter(s => s.axisAssignment !== 'secondary');
    const secondary = series.filter(s => s.axisAssignment === 'secondary');

    return { primary, secondary };
};

/**
 * Determine axis label and tick color based on series count and assignment
 * 
 * Rules:
 * - Single series: Use series color (from seriesColorScale)
 * - Multiple series: Use black (#333)
 * 
 * @param {Array} axisSeries - Series assigned to this axis
 * @param {Function} seriesColorScale - D3 color scale for series
 * @returns {string} Color hex code
 */
export const getAxisColor = (axisSeries, seriesColorScale) => {
    if (!Array.isArray(axisSeries) || axisSeries.length === 0) {
        return '#333'; // Default black
    }

    if (axisSeries.length === 1 && seriesColorScale) {
        // Single series: use the series color
        const seriesName = axisSeries[0].yAxisInfo?.columnName;
        if (seriesName) {
            return seriesColorScale(seriesName);
        }
    }

    // Multiple series or no color scale: use black
    return '#333';
};

/**
 * Get unique graph types used by series on an axis
 * @param {Array} axisSeries - Series assigned to this axis
 * @returns {Set} Set of graph types
 */
export const getAxisGraphTypes = (axisSeries) => {
    if (!Array.isArray(axisSeries)) {
        return new Set();
    }

    return new Set(axisSeries.map(s => s.graphType).filter(Boolean));
};

/**
 * Detect if there's a type conflict between primary and secondary axes
 * 
 * Conflict rules:
 * - If secondary axis has multiple series, all must use the same type
 * - That type becomes unavailable for primary axis
 * 
 * @param {Array} primarySeries - Series on primary axis
 * @param {Array} secondarySeries - Series on secondary axis
 * @returns {Object|null} Conflict info or null if no conflict
 *   {
 *     hasConflict: boolean,
 *     secondaryType: string,
 *     conflictingSeries: Array<{index: number, graphType: string}>
 *   }
 */
export const detectTypeConflict = (primarySeries, secondarySeries) => {
    // No conflict if secondary axis is empty or has only one series
    if (!Array.isArray(secondarySeries) || secondarySeries.length <= 1) {
        return null;
    }

    // Get unique types used by secondary axis
    const secondaryTypes = getAxisGraphTypes(secondarySeries);

    // If secondary has multiple series, they should all be the same type
    if (secondaryTypes.size > 1) {
        // This is an internal inconsistency, not a conflict with primary
        return {
            hasConflict: false,
            inconsistentSecondary: true,
            secondaryTypes: Array.from(secondaryTypes)
        };
    }

    // Get the single type used by secondary axis
    const secondaryType = Array.from(secondaryTypes)[0];

    // Check if any primary series uses the same type
    const conflictingSeries = primarySeries
        .map((s, index) => ({ index, graphType: s.graphType }))
        .filter(item => item.graphType === secondaryType);

    if (conflictingSeries.length > 0) {
        return {
            hasConflict: true,
            secondaryType,
            conflictingSeries
        };
    }

    return null;
};

/**
 * Resolve type conflicts by changing conflicting primary series types
 * 
 * @param {Array} allSeries - All series configurations
 * @param {Object} conflict - Conflict information from detectTypeConflict
 * @returns {Object} {updatedSeries: Array, changes: Array}
 */
export const resolveTypeConflict = (allSeries, conflict) => {
    if (!conflict || !conflict.hasConflict) {
        return { updatedSeries: allSeries, changes: [] };
    }

    const { secondaryType, conflictingSeries } = conflict;
    const changes = [];

    // Available types for reassignment
    const allTypes = ['scatter', 'line', 'bar', 'histogram'];
    const availableTypes = allTypes.filter(t => t !== secondaryType);

    // Find a suitable alternative type
    const alternativeType = availableTypes[0]; // Default to first available

    // Create updated series array
    const updatedSeries = allSeries.map((series, index) => {
        const conflicting = conflictingSeries.find(c => c.index === index && series.axisAssignment !== 'secondary');
        
        if (conflicting) {
            changes.push({
                seriesIndex: index,
                oldType: series.graphType,
                newType: alternativeType,
                reason: `Type conflict with secondary axis (using ${secondaryType})`
            });

            return {
                ...series,
                graphType: alternativeType
            };
        }

        return series;
    });

    return { updatedSeries, changes };
};

/**
 * Validate that secondary axis series all use the same type
 * @param {Array} secondarySeries - Series on secondary axis
 * @returns {Object} {isValid: boolean, message: string}
 */
export const validateSecondaryAxisTypes = (secondarySeries) => {
    if (!Array.isArray(secondarySeries) || secondarySeries.length <= 1) {
        return { isValid: true, message: '' };
    }

    const types = getAxisGraphTypes(secondarySeries);

    if (types.size > 1) {
        return {
            isValid: false,
            message: `Secondary axis series must all use the same visualization type. Found: ${Array.from(types).join(', ')}`
        };
    }

    return { isValid: true, message: '' };
};

/**
 * Get axis label based on series assignment
 * @param {Array} axisSeries - Series on this axis
 * @param {string} defaultLabel - Default label if multiple series
 * @returns {string} Axis label
 */
export const getAxisLabel = (axisSeries, defaultLabel = 'Value') => {
    if (!Array.isArray(axisSeries) || axisSeries.length === 0) {
        return defaultLabel;
    }

    if (axisSeries.length === 1) {
        return axisSeries[0].yAxisInfo?.columnName || defaultLabel;
    }

    // Multiple series: join their names
    return axisSeries
        .map(s => s.yAxisInfo?.columnName)
        .filter(Boolean)
        .join(' / ') || defaultLabel;
};
