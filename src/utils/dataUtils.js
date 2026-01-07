/**
 * @fileoverview Comprehensive data processing utilities for CSV parsing, graph configuration, and data validation.
 * Provides functions for CSV import, automatic graph type detection, configuration file parsing, and data analysis.
 *
 * @author Harison Sharp
 * @since 0.2.0
 *
 * @module Data Processing Utilities
 * @type {Utility Library}
 *
 * @function parseCSV - Parse CSV text into headers and data objects with type conversion
 * @function determineGraphType - Automatically detect appropriate graph type based on column count
 * @function resolveColumn - Resolve column references by name or index
 * @function parseConfigFile - Parse configuration files for graph settings
 * @function generateTitle - Auto-generate graph titles from column names
 *
 * @exports parseCSV, determineGraphType, resolveColumn, parseConfigFile, generateTitle
 *
 * @example
 * const {headers, data} = parseCSV(csvText);
 * const config = determineGraphType(headers);
 * const title = generateTitle(graphConfig);
 *
 * @relatedFiles FileService.js, Batch.jsx - Core data processing for file handling and batch operations
 */

import { color } from "d3";
import { debugLog, debugWarn } from './debug.js';

/**
 * Parse a value into a number, handling comma-separated thousands
 * @param {string|number} value - Value to parse
 * @returns {number} Parsed number
 */
export const parseNumber = (value) => {
    if (typeof value === 'number') return value;
    if (value instanceof Date) return value.getTime();
    if (typeof value === 'string') {
        // Remove commas and trim
        const clean = value.replace(/,/g, '').trim();
        if (clean === '') return NaN;

        // Try strict numeric parsing first
        const num = Number(clean);
        if (!isNaN(num)) return num;

        // Try date parsing for date strings
        const dateTs = Date.parse(clean);
        if (!isNaN(dateTs)) return dateTs;
    }
    return NaN;
};

export const determineGraphType = (headers) => {
    /** Called in Batch mode
     * Automatically determine graph type based on number of columns
     * Invoked when graph type is not explicit in json or batch set-up
     * 
     * Heuristic:
     * 1 column: Y-axis only (e.g., histogram)
     * 2 columns: X and Y axes (e.g., scatter plot)
     * 3 columns: X, Y, and color grading (e.g., colored scatter)
     * 4 columns: X, Y, color grading, and contouring (e.g., contour plot)
     * More than 4 columns: Use first four for axes and color, others ignored
     *
     * @param {Array} headers - Array of column header names from CSV
     * @returns {Object|null} Graph configuration object or null if no columns
     */

    const numColumns = headers.length;


    if (numColumns < 1) return null;
    else if (numColumns === 1) {
        return {
            xAxis: '',
            yAxis: headers[0],
            colorGrading: '',
            contouring: '',
            graphType: 'scatter'
        }
    }
    else if (numColumns === 2) {
        return {
            xAxis: headers[0],
            yAxis: headers[1],
            colorGrading: '',
            contouring: '',
            graphType: 'scatter'
        };
    } else if (numColumns === 3) {
        return {
            xAxis: headers[0],
            yAxis: headers[1],
            colorGrading: headers[2],
            contouring: '',
            graphType: 'scatter'
        };
    } else {
        // 4 or more columns: use first 4 for axes/color/contour
        return {
            xAxis: headers[0],
            yAxis: headers[1],
            colorGrading: headers[2],
            contouring: headers[3],
            graphType: 'scatter'
        };
    }
};

// resolveColumn moved to columnUtils.js

export const parseConfigFile = (configText) => {
    /** Parse configuration file text into graph configuration object
     * Called in Batch mode
     * 
     * 
     * 
     */
    const config = {
        xAxis: '',
        yAxis: '',
        colorGrading: '',
        contouring: '',
        graphType: 'scatter',
        title: '',
        axisIntercept: 'origin',
        customIntercept: { x: 0, y: 0 },
        colorScheme: 'warm-cool',
        dualYAxis: false,
        yAxis2: '',
    };

    const lines = configText.split('\n').filter(line => line.trim());
    lines.forEach(line => {
        const [key, value] = line.split(':').map(s => s.trim());
        switch (key) {
            case 'xAxis':
                config.xAxis = value;
                break;
            case 'yAxis':
                config.yAxis = value;
                break;
            case 'colorGrading':
                config.colorGrading = value;
                debugLog(config.colorGrading);
                break;
            case 'contouring':
                config.contouring = value;
                break;
            case 'graphType':
                config.graphType = value;
                break;
            case 'title':
                config.title = value;
                break;
            case 'axisIntercept':
                config.axisIntercept = value;
                break;
            case 'customIntercept':
                const coords = value.replace(/[\[\]]/g, '').split(',').map(n => parseFloat(n.trim()));
                config.customIntercept = { x: coords[0] || 0, y: coords[1] || 0 };
                break;
            case 'colorScheme':
                config.colorScheme = value;
                break;
            case 'dualYAxis':
                config.dualYAxis = value.toLowerCase() === 'true';
                break;
            case 'yAxis2':
                config.yAxis2 = value;
                break;
        }
    });

    return config;
};

export const generateTitle = (graphConfig, yAxisInfos, xAxisInfo) => {
    if (graphConfig.title) return graphConfig.title;

    const yTitles = yAxisInfos.map(info => info.columnName).join(', ');
    if (!xAxisInfo || !xAxisInfo.columnName) {
        return yTitles || 'Data Visualization';
    }

    return `${yTitles} vs ${xAxisInfo.columnName}`;
};
