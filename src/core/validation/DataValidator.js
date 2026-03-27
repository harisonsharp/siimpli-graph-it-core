/**
 * @fileoverview Data validation utilities for CSV data and numeric values.
 * Provides comprehensive validation for data integrity, type checking, and boundary validation.
 *
 * @author Harison Sharp
 * @since 0.3.0
 *
 * @module Data Validator
 * @type {Utility Library}
 *
 * @exports DataValidator - Centralized data validation service
 *
 * @example
 * DataValidator.validateCSVData(data);
 * DataValidator.validateNumericColumn(data, 'temperature');
 * DataValidator.validateDataExtents([0, 100]);
 */

import { debugLog, debugWarn } from '../../utils/debug.js';

export class ValidationError extends Error {
    constructor(message, field = null) {
        super(message);
        this.name = 'ValidationError';
        this.field = field;
    }
}

export class DataValidator {
    /**
     * Validate CSV data structure
     * @param {Array} data - Array of data objects
     * @throws {ValidationError} If data is invalid
     * @returns {boolean} True if valid
     */
    static validateCSVData(data) {
        if (!Array.isArray(data)) {
            throw new ValidationError('CSV data must be an array');
        }

        if (data.length === 0) {
            throw new ValidationError('CSV data cannot be empty');
        }

        return true;
    }

    /**
     * Validate that a column exists and contains numeric values
     * @param {Array} data - CSV data
     * @param {string} columnName - Column name to validate
     * @throws {ValidationError} If column is invalid or non-numeric
     * @returns {boolean} True if valid
     */
    static validateNumericColumn(data, columnName) {
        if (!columnName || typeof columnName !== 'string') {
            throw new ValidationError('Column name must be a non-empty string', 'columnName');
        }

        this.validateCSVData(data);

        // Check if column exists in at least one row
        const hasColumn = data.some(row => columnName in row);
        if (!hasColumn) {
            throw new ValidationError(`Column '${columnName}' not found in data`, 'columnName');
        }

        // Validate numeric values
        const validValues = data.filter(row => {
            const value = row[columnName];
            return value !== undefined && value !== null && value !== '';
        });

        if (validValues.length === 0) {
            throw new ValidationError(`Column '${columnName}' contains no valid values`, 'columnName');
        }

        const nonNumericValues = validValues.filter(row => {
            const value = row[columnName];
            return isNaN(Number(value)) || !isFinite(Number(value));
        });

        if (nonNumericValues.length > 0) {
            const sampleValue = nonNumericValues[0][columnName];
            throw new ValidationError(
                `Column '${columnName}' contains non-numeric values (e.g., '${sampleValue}')`,
                'columnName'
            );
        }

        return true;
    }

    /**
     * Validate data extents (min/max range)
     * @param {Array} extents - [min, max] array
     * @throws {ValidationError} If extents are invalid
     * @returns {boolean} True if valid
     */
    static validateDataExtents(extents) {
        if (!Array.isArray(extents) || extents.length !== 2) {
            throw new ValidationError('Extents must be an array of [min, max]');
        }

        const [min, max] = extents;

        if (!isFinite(min) || !isFinite(max)) {
            throw new ValidationError('Extents must be finite numbers');
        }

        if (min > max) {
            throw new ValidationError(`Invalid extents: min (${min}) is greater than max (${max})`);
        }

        if (min === max) {
            throw new ValidationError(`Invalid extents: min and max are equal (${min})`);
        }

        return true;
    }

    /**
     * Validate that data has sufficient points for analysis
     * @param {Array} data - Data array
     * @param {number} minPoints - Minimum required points
     * @throws {ValidationError} If insufficient data
     * @returns {boolean} True if valid
     */
    static validateSufficientData(data, minPoints = 2) {
        this.validateCSVData(data);

        if (data.length < minPoints) {
            throw new ValidationError(
                `Insufficient data points: need at least ${minPoints}, got ${data.length}`
            );
        }

        return true;
    }

    /**
     * Filter and validate data for specific columns
     * @param {Array} data - CSV data
     * @param {Array<string>} columnNames - Array of column names
     * @returns {Array} Filtered valid data
     */
    static filterValidData(data, columnNames) {
        if (!Array.isArray(columnNames) || columnNames.length === 0) {
            throw new ValidationError('Column names must be a non-empty array');
        }

        this.validateCSVData(data);

        return data.filter(row => {
            return columnNames.every(columnName => {
                const value = row[columnName];
                return value !== undefined &&
                    value !== null &&
                    value !== '' &&
                    !isNaN(Number(value)) &&
                    isFinite(Number(value));
            });
        });
    }

    /**
     * Validate a single data point
     * @param {Object} point - Data point object
     * @param {Array<string>} requiredFields - Required field names
     * @throws {ValidationError} If point is invalid
     * @returns {boolean} True if valid
     */
    static validateDataPoint(point, requiredFields = []) {
        if (!point || typeof point !== 'object') {
            throw new ValidationError('Data point must be an object');
        }

        for (const field of requiredFields) {
            if (!(field in point)) {
                throw new ValidationError(`Missing required field: ${field}`, field);
            }

            const value = point[field];
            if (value === null || value === undefined || value === '') {
                throw new ValidationError(`Field '${field}' is empty`, field);
            }
        }

        return true;
    }

    /**
     * Validate range values
     * @param {number} min - Minimum value
     * @param {number} max - Maximum value
     * @param {string} label - Label for error messages
     * @throws {ValidationError} If range is invalid
     * @returns {boolean} True if valid
     */
    static validateRange(min, max, label = 'Range') {
        if (!isFinite(min) || !isFinite(max)) {
            throw new ValidationError(`${label} values must be finite numbers`);
        }

        if (min >= max) {
            throw new ValidationError(`${label}: minimum (${min}) must be less than maximum (${max})`);
        }

        return true;
    }

    /**
     * Validate positive values only
     * @param {Array} data - Data array
     * @param {string} columnName - Column to validate
     * @throws {ValidationError} If non-positive values found
     * @returns {Array} Filtered positive values
     */
    static validatePositiveValues(data, columnName) {
        this.validateNumericColumn(data, columnName);

        const positiveData = data.filter(row => {
            const value = Number(row[columnName]);
            return isFinite(value) && value > 0;
        });

        if (positiveData.length === 0) {
            throw new ValidationError(
                `Column '${columnName}' contains no positive values`,
                'columnName'
            );
        }

        return positiveData;
    }

    /**
     * Validate array of column names exists in data
     * @param {Array} data - CSV data
     * @param {Array<string>} columnNames - Column names to check
     * @throws {ValidationError} If any column is missing
     * @returns {boolean} True if all columns exist
     */
    static validateColumnsExist(data, columnNames) {
        this.validateCSVData(data);

        if (!Array.isArray(columnNames) || columnNames.length === 0) {
            throw new ValidationError('Column names must be a non-empty array');
        }

        const firstRow = data[0];
        const missingColumns = columnNames.filter(col => !(col in firstRow));

        if (missingColumns.length > 0) {
            throw new ValidationError(
                `Missing columns: ${missingColumns.join(', ')}`,
                'columnNames'
            );
        }

        return true;
    }
}
