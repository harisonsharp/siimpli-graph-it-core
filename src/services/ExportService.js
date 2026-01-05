import { save } from '@tauri-apps/plugin-dialog';
import { exportGraphToPNG, generateStructuredFileName } from '../utils/graphUtils.js';
import { WATERMARK_CONFIG } from '../constants.js';
import { generateWatermarkTile } from '../utils/watermarkUtils.js';
import { CanvasSizer } from './CanvasSizer.js';
import { debugLog, debugWarn } from '../utils/debug.js';

/**
 * @fileoverview Service class for exporting graphs and visualizations to PNG format with watermarking.
 * Handles file dialog interactions, filename generation, and PNG export with integrated watermark functionality.
 *
 * @author Harison Sharp
 * @since 0.2.0
 *
 * @class ExportService
 * @type {Service Class}
 *
 * @requires @tauri-apps/plugin-dialog - File system dialog integration
 * @requires ./graphUtils.js - Graph export and filename utilities
 * @requires ./constants.js - Watermark configuration constants
 * @requires ./watermarkUtils.js - Watermark generation functions
 *
 * @method exportAsPNG - Export graph to PNG with user file dialog
 *
 * @exports ExportService
 *
 * @example
 * await ExportService.exportAsPNG(svgRef, canvasRef, csvData, config, settings, getIntercepts, logo);
 *
 * @relatedFiles Batch.jsx, graphUtils.js - PNG export functionality for batch processing
 */


export class ExportService {
    static async exportAsPNG(svgRef, canvasRef, csvData, graphConfig, globalSettings, getAxisIntercepts, logoImage) {
        try {
            // Validate required parameters
            if (!svgRef?.current && !svgRef) {
                throw new Error('SVG reference is required for export');
            }

            const svgElement = svgRef.current || svgRef;

            // Use CanvasSizer to ensure we're exporting the full content
            // This reads the current SVG dimensions which should already be sized correctly
            let exportDimensions = globalSettings.graphDimensions;

            try {
                const currentWidth = parseInt(svgElement.getAttribute('width'));
                const currentHeight = parseInt(svgElement.getAttribute('height'));

                if (currentWidth && currentHeight) {
                    // Use the current SVG dimensions (which were sized by CanvasSizer in useGraphRenderer)
                    exportDimensions = {
                        width: currentWidth,
                        height: currentHeight
                    };
                    debugLog('[ExportService] Using canvas-sized dimensions for export:', exportDimensions);
                }
            } catch (dimError) {
                console.warn('[ExportService] Could not read SVG dimensions, using defaults:', dimError);
            }

            const filename = generateStructuredFileName(csvData, graphConfig, exportDimensions, getAxisIntercepts);

            // Try Tauri file dialog first, fallback to browser download
            let filePath = null;
            try {
                filePath = await save({
                    defaultPath: filename,
                    filters: [{ name: 'PNG', extensions: ['png'] }]
                });
            } catch (tauriError) {
                console.warn('Tauri dialog not available, using browser download:', tauriError.message);
                // Fallback to direct browser download
                filePath = filename;
            }

            if (filePath) {
                const result = await exportGraphToPNG(
                    svgRef,
                    canvasRef,
                    exportDimensions,  // Use dynamically sized dimensions
                    WATERMARK_CONFIG,
                    generateWatermarkTile,
                    logoImage,
                    filePath
                );

                // If Tauri save failed, use browser download
                if (result && !filePath.includes('/') && !filePath.includes('\\')) {
                    this.downloadFromBrowser(result.pngData, filePath);
                }

                return result;
            }
        } catch (error) {
            console.error('PNG export failed:', error);
            throw error;
        }
    }

    /**
     * Export SVG to PNG data (headless mode)
     * @param {HTMLElement} svgElement - The SVG element
     * @param {HTMLCanvasElement} canvasElement - The canvas element
     * @param {HTMLImageElement} logoImage - The logo image
     * @returns {Promise<Uint8Array>} - The PNG data as Uint8Array
     */
    static async exportSvgToPng(svgElement, canvasElement, logoImage) {
        // Use a temporary dimensions object based on the SVG
        const width = parseInt(svgElement.getAttribute('width') || '800');
        const height = parseInt(svgElement.getAttribute('height') || '600');

        const dimensions = { width, height };

        const result = await exportGraphToPNG(
            svgElement,
            canvasElement,
            dimensions,
            WATERMARK_CONFIG,
            generateWatermarkTile,
            logoImage,
            null // No output path, just return data
        );

        if (!result || !result.buffer) {
            throw new Error('Failed to generate PNG data');
        }

        return new Uint8Array(result.buffer);
    }

    /**
     * Fallback method to download file in browser
     * @param {string} dataUrl - Data URL of the PNG
     * @param {string} filename - Filename for download
     */
    static downloadFromBrowser(dataUrl, filename) {
        const link = document.createElement('a');
        link.download = filename;
        link.href = dataUrl;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }
}
