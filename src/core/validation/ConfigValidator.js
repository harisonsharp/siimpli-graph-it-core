/**
 * @fileoverview Configuration validation utilities for graph settings and parameters.
 * Provides comprehensive validation for graph configuration, curve fit parameters, and settings.
 *
 * @author Harison Sharp
 * @since 0.3.0
 *
 * @module Config Validator
 * @type {Utility Library}
 *
 * @exports ConfigValidator - Centralized configuration validation service
 *
 * @example
 * ConfigValidator.validateGraphConfig(config);
 * ConfigValidator.validateCurveFitConfig(curveFit);
 * ConfigValidator.validateAxisIntercept(intercept);
 */

import { ValidationError } from './DataValidator.js';
import { debugLog, debugWarn } from '../../utils/debug.js';

export class ConfigValidator {
    static VALID_GRAPH_TYPES = ['scatter', 'line', 'histogram', 'bar'];
    static VALID_COLOR_SCHEMES = ['warm-cool', 'rainbow', 'green-red'];
    static VALID_AXIS_INTERCEPTS = ['minimum', 'origin', 'custom'];
    static VALID_FIT_TYPES = ['polynomial', 'power_law', 'best_fit'];
    static VALID_BAR_MODES = ['group', 'stack'];

    /**
     * Validate complete graph configuration
     * @param {Object} config - Graph configuration object
     * @throws {ValidationError} If configuration is invalid
     * @returns {boolean} True if valid
     */
    static validateGraphConfig(config) {
        if (!config || typeof config !== 'object') {
            throw new ValidationError('Graph configuration must be an object');
        }

        // Validate series array
        if (config.series) {
            if (!Array.isArray(config.series)) {
                throw new ValidationError('Series must be an array', 'series');
            }

            config.series.forEach((series, index) => {
                this.validateSeriesConfig(series, index);
            });
        }

        // Validate graph type
        if (config.graphType && !this.VALID_GRAPH_TYPES.includes(config.graphType)) {
            throw new ValidationError(
                `Invalid graph type: ${config.graphType}. Must be one of: ${this.VALID_GRAPH_TYPES.join(', ')}`,
                'graphType'
            );
        }

        // Validate bar mode if present
        if (config.barMode && !this.VALID_BAR_MODES.includes(config.barMode)) {
            throw new ValidationError(
                `Invalid bar mode: ${config.barMode}. Must be one of: ${this.VALID_BAR_MODES.join(', ')}`,
                'barMode'
            );
        }

        // Validate color scheme
        if (config.colorScheme && !this.VALID_COLOR_SCHEMES.includes(config.colorScheme)) {
            throw new ValidationError(
                `Invalid color scheme: ${config.colorScheme}. Must be one of: ${this.VALID_COLOR_SCHEMES.join(', ')}`,
                'colorScheme'
            );
        }

        // Validate axis intercept
        if (config.axisIntercept && !this.VALID_AXIS_INTERCEPTS.includes(config.axisIntercept)) {
            throw new ValidationError(
                `Invalid axis intercept: ${config.axisIntercept}. Must be one of: ${this.VALID_AXIS_INTERCEPTS.join(', ')}`,
                'axisIntercept'
            );
        }

        // Validate custom intercept if specified
        if (config.axisIntercept === 'custom') {
            this.validateCustomIntercept(config.customIntercept);
        }

        // Validate dual Y-axis configuration
        if (config.dualYAxis === true && !config.yAxis2) {
            throw new ValidationError(
                'Dual Y-axis enabled but yAxis2 not specified',
                'yAxis2'
            );
        }

        return true;
    }

    /**
     * Validate series configuration
     * @param {Object} series - Series configuration
     * @param {number} index - Series index for error messages
     * @throws {ValidationError} If series configuration is invalid
     * @returns {boolean} True if valid
     */
    static validateSeriesConfig(series, index = 0) {
        if (!series || typeof series !== 'object') {
            throw new ValidationError(`Series ${index} must be an object`, `series[${index}]`);
        }

        if (series.graphType && !this.VALID_GRAPH_TYPES.includes(series.graphType)) {
            throw new ValidationError(
                `Series ${index}: Invalid graph type '${series.graphType}'`,
                `series[${index}].graphType`
            );
        }

        return true;
    }

    /**
     * Validate curve fit configuration
     * @param {Object} curveFit - Curve fit configuration
     * @throws {ValidationError} If configuration is invalid
     * @returns {boolean} True if valid
     */
    static validateCurveFitConfig(curveFit) {
        if (!curveFit || typeof curveFit !== 'object') {
            throw new ValidationError('Curve fit configuration must be an object');
        }

        // Validate fit type
        if (curveFit.fitType && !this.VALID_FIT_TYPES.includes(curveFit.fitType)) {
            throw new ValidationError(
                `Invalid fit type: ${curveFit.fitType}. Must be one of: ${this.VALID_FIT_TYPES.join(', ')}`,
                'fitType'
            );
        }

        // Validate polynomial order
        if (curveFit.fitType === 'polynomial') {
            const order = parseInt(curveFit.order);
            if (isNaN(order) || order < 1 || order > 10) {
                throw new ValidationError(
                    'Polynomial order must be an integer between 1 and 10',
                    'order'
                );
            }
        }

        // Validate x range
        if (curveFit.xMin !== undefined && curveFit.xMax !== undefined) {
            const xMin = parseFloat(curveFit.xMin);
            const xMax = parseFloat(curveFit.xMax);

            if (isNaN(xMin) || isNaN(xMax)) {
                throw new ValidationError('xMin and xMax must be valid numbers', 'xRange');
            }

            if (!isFinite(xMin) || !isFinite(xMax)) {
                throw new ValidationError('xMin and xMax must be finite', 'xRange');
            }

            if (xMin >= xMax) {
                throw new ValidationError(
                    `xMin (${xMin}) must be less than xMax (${xMax})`,
                    'xRange'
                );
            }
        }

        // Validate color
        if (curveFit.color && typeof curveFit.color !== 'string') {
            throw new ValidationError('Curve fit color must be a string', 'color');
        }

        return true;
    }

    /**
     * Validate custom intercept values
     * @param {Object} intercept - {x, y} intercept values
     * @throws {ValidationError} If intercept is invalid
     * @returns {boolean} True if valid
     */
    static validateCustomIntercept(intercept) {
        if (!intercept || typeof intercept !== 'object') {
            throw new ValidationError('Custom intercept must be an object with x and y properties');
        }

        if (!('x' in intercept) || !('y' in intercept)) {
            throw new ValidationError('Custom intercept must have x and y properties');
        }

        const x = parseFloat(intercept.x);
        const y = parseFloat(intercept.y);

        if (isNaN(x) || isNaN(y)) {
            throw new ValidationError('Custom intercept x and y must be valid numbers');
        }

        if (!isFinite(x) || !isFinite(y)) {
            throw new ValidationError('Custom intercept x and y must be finite');
        }

        return true;
    }

    /**
     * Validate graph dimensions
     * @param {Object} dimensions - {width, height} dimensions
     * @throws {ValidationError} If dimensions are invalid
     * @returns {boolean} True if valid
     */
    static validateGraphDimensions(dimensions) {
        if (!dimensions || typeof dimensions !== 'object') {
            throw new ValidationError('Graph dimensions must be an object');
        }

        if (!('width' in dimensions) || !('height' in dimensions)) {
            throw new ValidationError('Graph dimensions must have width and height properties');
        }

        const width = parseInt(dimensions.width);
        const height = parseInt(dimensions.height);

        if (isNaN(width) || isNaN(height)) {
            throw new ValidationError('Width and height must be valid numbers');
        }

        if (width <= 0 || height <= 0) {
            throw new ValidationError('Width and height must be positive');
        }

        if (width < 100 || height < 100) {
            throw new ValidationError('Width and height must be at least 100 pixels');
        }

        if (width > 10000 || height > 10000) {
            throw new ValidationError('Width and height must be at most 10000 pixels');
        }

        return true;
    }

    /**
     * Validate global settings
     * @param {Object} settings - Global settings object
     * @throws {ValidationError} If settings are invalid
     * @returns {boolean} True if valid
     */
    static validateGlobalSettings(settings) {
        if (!settings || typeof settings !== 'object') {
            throw new ValidationError('Global settings must be an object');
        }

        if (settings.colorScheme) {
            if (!this.VALID_COLOR_SCHEMES.includes(settings.colorScheme)) {
                throw new ValidationError(
                    `Invalid color scheme in settings: ${settings.colorScheme}`,
                    'colorScheme'
                );
            }
        }

        if (settings.axisIntercept) {
            if (!this.VALID_AXIS_INTERCEPTS.includes(settings.axisIntercept)) {
                throw new ValidationError(
                    `Invalid axis intercept in settings: ${settings.axisIntercept}`,
                    'axisIntercept'
                );
            }
        }

        if (settings.graphDimensions) {
            this.validateGraphDimensions(settings.graphDimensions);
        }

        if (settings.customIntercept) {
            this.validateCustomIntercept(settings.customIntercept);
        }

        return true;
    }

    /**
     * Validate column identifier
     * @param {string} columnId - Column identifier (may include ::filename)
     * @throws {ValidationError} If column ID is invalid
     * @returns {boolean} True if valid
     */
    static validateColumnId(columnId) {
        if (!columnId || typeof columnId !== 'string') {
            throw new ValidationError('Column ID must be a non-empty string');
        }

        // Column IDs can be empty strings for optional columns
        if (columnId.trim() === '') {
            return true;
        }

        return true;
    }

    /**
     * Validate array of curve fits
     * @param {Array} curveFits - Array of curve fit configurations
     * @throws {ValidationError} If any curve fit is invalid
     * @returns {boolean} True if all valid
     */
    static validateCurveFits(curveFits) {
        if (!Array.isArray(curveFits)) {
            throw new ValidationError('Curve fits must be an array');
        }

        curveFits.forEach((fit, index) => {
            try {
                this.validateCurveFitConfig(fit);
            } catch (error) {
                throw new ValidationError(
                    `Curve fit ${index}: ${error.message}`,
                    `curveFits[${index}]`
                );
            }
        });

        return true;
    }
}
