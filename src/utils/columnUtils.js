/**
 * @fileoverview Column parsing and resolution utilities for data management.
 * Handles column identifier parsing, resolution by name or index, and column metadata extraction.
 *
 * @author Harison Sharp
 * @since 0.3.0
 *
 * @module Column Utilities
 * @type {Utility Library}
 *
 * @function parseColumnId - Parse column identifiers with optional file associations
 * @function resolveColumn - Resolve column references by name or index
 * @function extractColumnNames - Extract column names from data
 *
 * @exports parseColumnId, resolveColumn, extractColumnNames
 *
 * @example
 * const columnInfo = parseColumnId('temperature::data.csv');
 * const columnName = resolveColumn(data, 0);
 * const columns = extractColumnNames(csvData);
 *
 * @relatedFiles graphUtils.js (original), dataUtils.js
 */

/**
 * Parse column identifier into column name and optional file name
 * @param {string} columnId - Column identifier, format: "columnName" or "columnName::fileName"
 * @returns {Object} Object with columnName and fileName properties
 *
 * @example
 * parseColumnId('temperature::sensor1.csv')
 * // Returns: { columnName: 'temperature', fileName: 'sensor1.csv' }
 *
 * parseColumnId('pressure')
 * // Returns: { columnName: 'pressure', fileName: '' }
 */
export const parseColumnId = (columnId) => {
    if (!columnId) return { columnName: '', fileName: '' };
    
    const parts = columnId.split('::');
    return {
        columnName: parts[0],
        fileName: parts[1] || ''
    };
};

/**
 * Resolve column reference by name or index
 * Handles both string column names and numeric indices
 *
 * @param {Array<Object>} csvData - CSV data array
 * @param {string|number} key - Column name (string) or index (number)
 * @returns {string} Resolved column name
 *
 * @example
 * resolveColumn(data, 0)  // Returns first column name
 * resolveColumn(data, 'temperature')  // Returns 'temperature'
 */
export const resolveColumn = (csvData, key) => {
    if (key === undefined || key === null || key === '') return '';
    
    if (typeof key === 'number') {
        const headers = Object.keys(csvData[0] || {});
        return headers[key] || '';
    }
    
    return key;
};

/**
 * Extract column names from CSV data
 * @param {Array<Object>} csvData - CSV data array
 * @returns {Array<string>} Array of column names
 *
 * @example
 * extractColumnNames([{temp: 20, pressure: 101}, {temp: 21, pressure: 102}])
 * // Returns: ['temp', 'pressure']
 */
export const extractColumnNames = (csvData) => {
    if (!Array.isArray(csvData) || csvData.length === 0) {
        return [];
    }
    
    return Object.keys(csvData[0]);
};

/**
 * Create unique column identifier with file association
 * @param {string} columnName - Column name
 * @param {string} fileName - File name
 * @returns {string} Unique column identifier
 *
 * @example
 * createColumnId('temperature', 'sensor1.csv')
 * // Returns: 'temperature::sensor1.csv'
 */
export const createColumnId = (columnName, fileName = '') => {
    if (!fileName) return columnName;
    return `${columnName}::${fileName}`;
};

/**
 * Check if column exists in data
 * @param {Array<Object>} csvData - CSV data array
 * @param {string} columnName - Column name to check
 * @returns {boolean} True if column exists
 */
export const columnExists = (csvData, columnName) => {
    if (!Array.isArray(csvData) || csvData.length === 0) {
        return false;
    }
    
    return columnName in csvData[0];
};

/**
 * Get unique values from a column
 * @param {Array<Object>} csvData - CSV data array
 * @param {string} columnName - Column name
 * @returns {Array} Array of unique values
 */
export const getUniqueColumnValues = (csvData, columnName) => {
    if (!Array.isArray(csvData) || csvData.length === 0) {
        return [];
    }
    
    const values = csvData
        .map(row => row[columnName])
        .filter(val => val !== undefined && val !== null && val !== '');
    
    return [...new Set(values)];
};
