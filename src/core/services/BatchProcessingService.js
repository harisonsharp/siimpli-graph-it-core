/**
 * @fileoverview Service for batch processing of multiple CSV files into graph visualizations.
 * Handles JSON configuration processing, standard batch processing, file iteration,
 * graph generation orchestration, and PNG export management.
 *
 * @author Harison Sharp
 * @since 0.3.0
 *
 * @module BatchProcessingService
 * @requires ./FileService - File reading and validation
 * @requires ../dataUtils - Graph type determination and title generation
 * @requires ../curveFittingUtils - Curve fitting operations
 * @requires ../graphUtils - Graph export functionality
 * @requires ../constants - Watermark configuration
 * @requires ../watermarkUtils - Watermark tile generation
 *
 * @exports BatchProcessingService
 *
 * @example
 * const service = new BatchProcessingService({
 *   inputFolder: '/path/to/input',
 *   outputFolder: '/path/to/output',
 *   globalSettings,
 *   colorSchemes,
 *   logoImage,
 *   getAxisIntercepts,
 *   generateGraph,
 *   processFile,
 *   processDirectory,
 *   saveFile,
 *   resolveConfig,
 *   updateGlobalSettings,
 *   onProgress: (file) => debugLog('Processed:', file)
 * });
 *
 * await service.processBatch({ useJsonConfig: true, jsonConfig });
 */

import { FileService } from '../../services/FileService.js';
import { determineGraphType } from '../../utils/dataUtils.js';
import { parseCurveFits, performCurveFitting } from '../../utils/curveFittingUtils.js';
import { exportGraphToPNG, generateStructuredFileName } from '../../utils/graphUtils.js';
import { WATERMARK_CONFIG } from '../../constants.js';
import { generateWatermarkTile } from '../../utils/watermarkUtils.js';
import { debugLog, debugWarn } from '../../utils/debug.js';

/**
 * Service class for batch processing of graph generation
 */
export class BatchProcessingService {
    /**
     * Create a new BatchProcessingService
     * 
     * @param {Object} config - Service configuration
     * @param {string} config.inputFolder - Input folder path
     * @param {string} config.outputFolder - Output folder path
     * @param {Object} config.globalSettings - Global application settings
     * @param {Object} config.colorSchemes - Available color schemes
     * @param {Image} config.logoImage - Logo image for watermarking
     * @param {Function} config.getAxisIntercepts - Axis intercept calculator
     * @param {Function} config.generateGraph - Graph generation function
     * @param {Function} config.processFile - File reading function
     * @param {Function} config.processDirectory - Directory scanning function
     * @param {Function} config.saveFile - File saving function
     * @param {Function} config.resolveConfig - Configuration resolution function
     * @param {Function} config.updateGlobalSettings - Global settings updater
     * @param {Function} [config.onProgress] - Progress callback
     * @param {Function} [config.onError] - Error callback
     */
    constructor(config) {
        this.inputFolder = config.inputFolder;
        this.outputFolder = config.outputFolder;
        this.globalSettings = config.globalSettings;
        this.colorSchemes = config.colorSchemes;
        this.logoImage = config.logoImage;
        this.getAxisIntercepts = config.getAxisIntercepts;
        this.generateGraph = config.generateGraph;
        this.processFile = config.processFile;
        this.processDirectory = config.processDirectory;
        this.saveFile = config.saveFile;
        this.resolveConfig = config.resolveConfig;
        this.updateGlobalSettings = config.updateGlobalSettings;
        this.onProgress = config.onProgress || (() => { });
        this.onError = config.onError || ((error, context) => console.error(context, error));

        // Refs for SVG and Canvas (passed from component)
        this.svgRef = config.svgRef;
        this.canvasRef = config.canvasRef;
    }

    /**
     * Export graph as PNG with structured filename
     * 
     * @param {string} baseFileName - Base filename without extension
     * @param {Array} csvData - CSV data for filename generation
     * @param {Object} config - Graph configuration
     * @returns {Promise<boolean>} Success status
     * @private
     */
    async exportAsPNG(baseFileName, csvData, config) {
        try {
            const filename = generateStructuredFileName(
                csvData,
                config,
                this.globalSettings.graphDimensions,
                (xExtent, yExtent) => this.getAxisIntercepts(xExtent, yExtent, config)
            );

            const outputPath = `${this.outputFolder}/${filename}`;

            const result = await exportGraphToPNG(
                this.svgRef,
                this.canvasRef,
                this.globalSettings.graphDimensions,
                WATERMARK_CONFIG,
                generateWatermarkTile,
                this.logoImage,
                outputPath
            );

            return result !== null;
        } catch (error) {
            this.onError(error, 'Failed to export PNG');
            return false;
        }
    }

    /**
     * Save curve fit summary to JSON file
     * 
     * @param {string} csvFileName - Original CSV filename
     * @param {Object} resolvedConfig - Resolved configuration
     * @param {Array} curveFits - Curve fit results
     * @returns {Promise<void>}
     * @private
     */
    async saveCurveFitSummary(csvFileName, resolvedConfig, curveFits) {
        const fitResults = curveFits
            .filter(fit => fit.enabled && fit.result)
            .map((fit, index) => ({
                fitNumber: index + 1,
                fitType: fit.result.fitType,
                equation: fit.result.equation,
                rSquared: fit.result.rSquared,
                xMin: fit.result.xMin,
                xMax: fit.result.xMax,
                coefficients: fit.result.coefficients
            }));

        if (fitResults.length === 0) {
            return;
        }

        const fitSummary = {
            csvFile: csvFileName,
            xAxis: resolvedConfig.xAxis,
            yAxis: resolvedConfig.yAxis,
            fits: fitResults
        };

        const summaryPath = `${this.outputFolder}/${csvFileName.replace(/\.csv$/i, '')}_fit_summary.json`;
        await this.saveFile(summaryPath, fitSummary);
    }

    /**
     * Process a single file with given configuration
     * 
     * @param {string} fileName - CSV filename
     * @param {Object} config - Graph configuration
     * @returns {Promise<Object>} Processing result
     * @private
     */
    async processSingleFile(fileName, config) {
        const csvPath = `${this.inputFolder}/${fileName}`;
        const fileNameWithoutExt = fileName.replace(/\.csv$/i, '');

        try {
            // Read file
            const fileData = await this.processFile(csvPath);
            if (!fileData) {
                return {
                    name: fileName,
                    status: 'error',
                    message: 'Failed to read file'
                };
            }

            const { headers, data } = fileData;

            // Resolve configuration
            const resolvedConfig = this.resolveConfig(config, data);
            const fullConfig = {
                ...resolvedConfig,
                colorScheme: config.colorScheme || this.globalSettings.colorScheme,
                axisIntercept: config.axisIntercept || this.globalSettings.axisIntercept,
                customIntercept: config.customIntercept || this.globalSettings.customIntercept,
                graphType: config.graphType || 'scatter',
                dualYAxis: config.dualYAxis || false,
                graphDimensions: this.globalSettings.graphDimensions,
                title: config.title || fileNameWithoutExt
            };

            // Perform curve fitting if configured
            let curveFits = [];
            if (config.curveFits) {
                const parsedFits = parseCurveFits(config);
                curveFits = performCurveFitting(data, resolvedConfig, parsedFits);
                fullConfig.curveFits = curveFits;
            }

            // Create local settings override
            const localSettings = {
                ...this.globalSettings,
                colorScheme: fullConfig.colorScheme,
                axisIntercept: fullConfig.axisIntercept,
                customIntercept: fullConfig.customIntercept
            };

            // Generate graph
            const graphGenerated = this.generateGraph(
                data,
                fullConfig,
                this.svgRef,
                localSettings,
                this.colorSchemes,
                this.getAxisIntercepts
            );

            if (!graphGenerated) {
                return {
                    name: fileName,
                    status: 'error',
                    message: 'Failed to generate graph'
                };
            }

            // Export as PNG
            const exported = await this.exportAsPNG(fileNameWithoutExt, data, fullConfig);

            // Save curve fit summary
            if (config.curveFits && curveFits.length > 0) {
                await this.saveCurveFitSummary(fileName, resolvedConfig, curveFits);
            }

            if (exported) {
                return {
                    name: fileName,
                    status: 'success',
                    message: `Exported as ${fileNameWithoutExt}.png`
                };
            } else {
                return {
                    name: fileName,
                    status: 'error',
                    message: 'Failed to export PNG'
                };
            }
        } catch (error) {
            this.onError(error, `Failed to process ${fileName}`);
            return {
                name: fileName,
                status: 'error',
                message: error.message
            };
        }
    }

    /**
     * Process files using JSON configuration
     * 
     * @param {Object|Array} jsonConfig - JSON configuration(s)
     * @returns {Promise<Array>} Processing results
     */
    async processJsonConfiguration(jsonConfig) {
        const results = [];
        const configArray = Array.isArray(jsonConfig) ? jsonConfig : [jsonConfig];

        for (const config of configArray) {
            const result = await this.processSingleFile(config.csv, config);
            results.push(result);
            this.onProgress(result);
        }

        return results;
    }

    /**
     * Process files using standard batch mode
     * 
     * @returns {Promise<Array>} Processing results
     */
    async processStandardBatch() {
        const results = [];
        const { csvFiles, configFile } = await this.processDirectory(this.inputFolder);

        // Load base configuration if exists
        let baseConfig = null;
        if (configFile) {
            baseConfig = await this.processFile(`${this.inputFolder}/${configFile.name}`);
        }

        // Process each CSV file
        for (const file of csvFiles) {
            try {
                const fileData = await this.processFile(`${this.inputFolder}/${file.name}`);
                if (!fileData) {
                    const errorResult = {
                        name: file.name,
                        status: 'error',
                        message: 'Failed to read file'
                    };
                    results.push(errorResult);
                    this.onProgress(errorResult);
                    continue;
                }

                const { headers, data } = fileData;

                // Determine configuration
                let config;
                if (baseConfig) {
                    config = { ...baseConfig };
                } else {
                    config = determineGraphType(headers);
                    if (!config) {
                        const errorResult = {
                            name: file.name,
                            status: 'error',
                            message: 'Invalid column count'
                        };
                        results.push(errorResult);
                        this.onProgress(errorResult);
                        continue;
                    }
                }

                // Process the file
                const result = await this.processSingleFile(file.name, config);
                results.push(result);
                this.onProgress(result);
            } catch (error) {
                const errorResult = {
                    name: file.name,
                    status: 'error',
                    message: error.message
                };
                results.push(errorResult);
                this.onProgress(errorResult);
            }
        }

        return results;
    }

    /**
     * Process batch based on mode
     * 
     * @param {Object} options - Processing options
     * @param {boolean} options.useJsonConfig - Whether to use JSON configuration
     * @param {Object|Array} [options.jsonConfig] - JSON configuration (required if useJsonConfig is true)
     * @returns {Promise<Array>} Processing results
     */
    async processBatch({ useJsonConfig, jsonConfig }) {
        if (useJsonConfig) {
            if (!jsonConfig) {
                throw new Error('JSON configuration is required when useJsonConfig is true');
            }
            return await this.processJsonConfiguration(jsonConfig);
        } else {
            return await this.processStandardBatch();
        }
    }

    /**
     * Update service configuration
     * 
     * @param {Object} updates - Configuration updates
     */
    updateConfig(updates) {
        Object.assign(this, updates);
    }

    /**
     * Validate service configuration
     * 
     * @throws {Error} If configuration is invalid
     */
    validateConfig() {
        if (!this.inputFolder) {
            throw new Error('Input folder is required');
        }
        if (!this.outputFolder) {
            throw new Error('Output folder is required');
        }
        if (!this.svgRef || !this.canvasRef) {
            throw new Error('SVG and Canvas refs are required');
        }
    }
}
