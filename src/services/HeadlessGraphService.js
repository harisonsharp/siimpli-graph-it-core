/**
 * @fileoverview Service for headless graph generation (no UI).
 * Listens for backend events and generates graphs automatically for batch operations.
 *
 * @author Harison Sharp
 * @since 0.3.0
 *
 * @module Headless Graph Service
 * @type {Service}
 *
 * @requires d3
 * @requires ExportService
 * @requires GraphService
 *
 * @exports HeadlessGraphService
 */
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { writeFile } from '@tauri-apps/plugin-fs';
import * as d3 from 'd3';
import { ExportService } from './ExportService.js';
import { renderGraph } from '../core/renderGraph.js';
import { CanvasSizer } from './CanvasSizer.js';
import { debugLog, debugWarn } from '../utils/debug.js';

/**
 * Service for headless graph generation (no UI)
 * Listens for backend events and generates graphs automatically
 */
export class HeadlessGraphService {
    constructor() {
        this.isInitialized = false;
        this.logoImage = null;
        this.pendingGenerations = new Map();
        this.colorSchemes = {
            'warm-cool': d3.interpolateRdYlBu,
            'rainbow': d3.interpolateRainbow,
            'green-red': d3.interpolateRdYlGn
        };
    }

    /**
     * Initialize the service and start listening for events
     */
    async initialize() {
        if (this.isInitialized) {
            debugLog('[HeadlessGraphService] Already initialized');
            return;
        }

        // Load logo image
        await this.loadLogo();

        // Listen for graph generation events from backend
        await listen('generate-graph-headless', async (event) => {
            await this.handleGraphGeneration(event.payload);
        });

        this.isInitialized = true;
        debugLog('[HeadlessGraphService] Initialized and listening for events');
    }

    /**
     * Load logo as data URI for embedding in SVG
     */
    async loadLogo() {
        return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => {
                // Convert image to data URI
                const canvas = document.createElement('canvas');
                canvas.width = img.naturalWidth;
                canvas.height = img.naturalHeight;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0);
                this.logoImage = canvas.toDataURL('image/png');
                debugLog('[HeadlessGraphService] Logo loaded successfully');
                resolve();
            };
            img.onerror = (err) => {
                console.warn('[HeadlessGraphService] Failed to load logo:', err);
                resolve(); // Continue without logo
            };
            // Load from public directory
            img.src = './public/siimpli-graph-it-logo.png';
        });
    }

    /**
     * Handle graph generation request from backend
     */
    async handleGraphGeneration(payload) {
        const { config, outputPath, graphName, graphIndex } = payload;

        try {
            debugLog('[HeadlessGraphService] Generating graph:', graphName || graphIndex);

            // Create hidden SVG and Canvas elements
            const svgElement = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            const canvasElement = document.createElement('canvas');

            // Get dimensions from config
            const width = config.globalSettings?.graphDimensions?.width || 800;
            const height = config.globalSettings?.graphDimensions?.height || 600;

            // Set initial dimensions (will be expanded by CanvasSizer if needed)
            svgElement.setAttribute('width', width);
            svgElement.setAttribute('height', height);
            svgElement.style.position = 'absolute';
            svgElement.style.left = '-9999px';
            svgElement.style.top = '-9999px';

            canvasElement.width = width;
            canvasElement.height = height;
            canvasElement.style.position = 'absolute';
            canvasElement.style.left = '-9999px';
            canvasElement.style.top = '-9999px';

            // Append to body
            document.body.appendChild(svgElement);
            document.body.appendChild(canvasElement);

            // Load CSV data from files
            const csvData = await this.loadCsvFiles(config.files);

            if (!csvData || csvData.length === 0) {
                throw new Error('No data loaded from CSV files');
            }

            // Use the proper renderGraph function to handle all rendering
            const result = renderGraph({
                svg: svgElement,
                csvData: csvData,
                graphConfig: config.graphConfig,
                globalSettings: config.globalSettings,
                curveFits: config.curveFits || [],
                logoDataUri: this.logoImage,
                colorSchemes: this.colorSchemes,
                isBatchMode: true
            });

            if (!result.success) {
                throw new Error(result.error || 'Graph rendering failed');
            }

            // Wait a moment for D3 rendering to complete
            await new Promise(resolve => setTimeout(resolve, 100));

            // Resize SVG to fit all rendered content (logo, tables, legends)
            // This prevents elements from being clipped off the bottom
            const sizer = new CanvasSizer(svgElement, {
                margins: { top: 60, right: 60, bottom: 120, left: 80 },
                expandMode: 'expand'
            });
            sizer.updateFromDOMSync().ensureFit();

            // Update canvas to match expanded SVG size
            const finalWidth = parseInt(svgElement.getAttribute('width'), 10);
            const finalHeight = parseInt(svgElement.getAttribute('height'), 10);
            canvasElement.width = finalWidth;
            canvasElement.height = finalHeight;

            // Export to PNG
            const pngData = await ExportService.exportSvgToPng(svgElement, canvasElement, null);

            // Save to file using Tauri
            await this.savePngToFile(pngData, outputPath);

            debugLog('[HeadlessGraphService] Successfully generated:', outputPath);

            // Cleanup
            document.body.removeChild(svgElement);
            document.body.removeChild(canvasElement);

        } catch (error) {
            console.error('[HeadlessGraphService] Failed to generate graph:', error);
            throw error;
        }
    }

    /**
     * Load CSV files from paths
     */
    async loadCsvFiles(filePaths) {
        const allData = [];

        for (const pathOrObj of filePaths) {
            const path = typeof pathOrObj === 'string' ? pathOrObj : pathOrObj.path;

            try {
                // Read file content via Tauri
                const content = await invoke('read_text_file', { path });

                // Parse CSV
                const rows = d3.csvParse(content);

                if (rows && rows.length > 0) {
                    allData.push(...rows);
                }
            } catch (error) {
                console.error(`[HeadlessGraphService] Failed to load file ${path}:`, error);
                throw error;
            }
        }

        return allData;
    }


    /**
     * Save PNG data to file using Tauri
     */
    async savePngToFile(data, outputPath) {
        try {
            // Write file using Tauri fs plugin
            await writeFile(outputPath, data);
        } catch (error) {
            console.error('[HeadlessGraphService] Failed to write file:', error);
            throw error;
        }
    }
}

// Export singleton instance
export const headlessGraphService = new HeadlessGraphService();
