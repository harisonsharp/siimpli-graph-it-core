import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { writeFile } from '@tauri-apps/plugin-fs';
import * as d3 from 'd3';
import { ExportService } from './ExportService.js';
import { GraphService } from './GraphService.js';
import { FileService } from './FileService.js';
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
     * Load logo image for watermarking
     */
    async loadLogo() {
        return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => {
                this.logoImage = img;
                debugLog('[HeadlessGraphService] Logo loaded successfully');
                resolve();
            };
            img.onerror = (err) => {
                console.warn('[HeadlessGraphService] Failed to load logo:', err);
                resolve(); // Continue without logo
            };
            // Try multiple potential paths
            img.src = './src/graphs/logo.png';
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

            // Set dimensions
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

            // Create D3 selection for SVG
            const svg = d3.select(svgElement);

            // Initialize GraphService
            const graphService = new GraphService();

            // Parse configuration
            const graphConfig = {
                xAxis: config.graphConfig.xAxis,
                yAxes: config.graphConfig.series.map(s => s.yAxis),
                graphType: config.graphConfig.graphType || 'scatter',
                title: config.graphConfig.title || graphName || 'Graph',
                colorGrading: config.graphConfig.colorGrading,
                contouring: config.graphConfig.contouring,
                series: config.graphConfig.series,
            };

            const globalSettings = {
                colorScheme: config.globalSettings?.colorScheme || 'green-red',
                axisIntercept: config.globalSettings?.axisIntercept || 'origin',
                customIntercept: config.globalSettings?.customIntercept,
                graphDimensions: {
                    width,
                    height
                },
                dualYAxis: config.globalSettings?.dualYAxis || false,
            };

            // Calculate scales and render graph
            await this.renderGraph(svg, csvData, graphConfig, globalSettings, config.curveFits || []);

            // Wait a moment for D3 rendering to complete
            await new Promise(resolve => setTimeout(resolve, 100));

            // Export to PNG
            const pngData = await ExportService.exportSvgToPng(svgElement, canvasElement, this.logoImage);

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
        const fileService = new FileService();
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
     * Render graph using GraphService
     */
    async renderGraph(svg, data, graphConfig, globalSettings, curveFits) {
        const graphService = new GraphService();

        // Set up margins
        const margin = { top: 60, right: 60, bottom: 80, left: 80 };
        const width = globalSettings.graphDimensions.width - margin.left - margin.right;
        const height = globalSettings.graphDimensions.height - margin.top - margin.bottom;

        // Create main group
        const g = svg.append('g')
            .attr('transform', `translate(${margin.left},${margin.top})`);

        // Extract column data
        const xData = data.map(d => +d[graphConfig.xAxis]).filter(v => !isNaN(v));
        const yDataArrays = graphConfig.yAxes.map(yAxis =>
            data.map(d => +d[yAxis]).filter(v => !isNaN(v))
        );

        // Create scales
        const xExtent = d3.extent(xData);
        const yExtent = d3.extent(yDataArrays.flat());

        const xScale = d3.scaleLinear()
            .domain(xExtent)
            .range([0, width]);

        const yScale = d3.scaleLinear()
            .domain(yExtent)
            .range([height, 0]);

        // Draw axes
        const xAxis = d3.axisBottom(xScale);
        const yAxis = d3.axisLeft(yScale);

        g.append('g')
            .attr('class', 'x-axis')
            .attr('transform', `translate(0,${height})`)
            .call(xAxis)
            .append('text')
            .attr('x', width / 2)
            .attr('y', 40)
            .attr('fill', '#000')
            .style('text-anchor', 'middle')
            .style('font-size', '14px')
            .text(graphConfig.xAxis);

        g.append('g')
            .attr('class', 'y-axis')
            .call(yAxis)
            .append('text')
            .attr('transform', 'rotate(-90)')
            .attr('y', -50)
            .attr('x', -height / 2)
            .attr('fill', '#000')
            .style('text-anchor', 'middle')
            .style('font-size', '14px')
            .text(graphConfig.yAxes.join(', '));

        // Draw title
        svg.append('text')
            .attr('x', globalSettings.graphDimensions.width / 2)
            .attr('y', 30)
            .attr('text-anchor', 'middle')
            .style('font-size', '18px')
            .style('font-weight', 'bold')
            .text(graphConfig.title);

        // Draw data based on graph type
        if (graphConfig.graphType === 'scatter') {
            graphConfig.series.forEach((series, idx) => {
                const seriesData = data.map(d => ({
                    x: +d[graphConfig.xAxis],
                    y: +d[series.yAxis]
                })).filter(d => !isNaN(d.x) && !isNaN(d.y));

                g.selectAll(`.dot-${idx}`)
                    .data(seriesData)
                    .enter()
                    .append('circle')
                    .attr('class', `dot-${idx}`)
                    .attr('cx', d => xScale(d.x))
                    .attr('cy', d => yScale(d.y))
                    .attr('r', 3)
                    .attr('fill', this.getSeriesColor(idx, graphConfig.series.length));
            });
        } else if (graphConfig.graphType === 'line') {
            const line = d3.line()
                .x(d => xScale(d.x))
                .y(d => yScale(d.y));

            graphConfig.series.forEach((series, idx) => {
                const seriesData = data.map(d => ({
                    x: +d[graphConfig.xAxis],
                    y: +d[series.yAxis]
                })).filter(d => !isNaN(d.x) && !isNaN(d.y))
                    .sort((a, b) => a.x - b.x);

                g.append('path')
                    .datum(seriesData)
                    .attr('class', `line-${idx}`)
                    .attr('fill', 'none')
                    .attr('stroke', this.getSeriesColor(idx, graphConfig.series.length))
                    .attr('stroke-width', 2)
                    .attr('d', line);
            });
        } else if (graphConfig.graphType === 'bar') {
            const barWidth = width / data.length * 0.8;

            graphConfig.series.forEach((series, idx) => {
                g.selectAll(`.bar-${idx}`)
                    .data(data)
                    .enter()
                    .append('rect')
                    .attr('class', `bar-${idx}`)
                    .attr('x', (d, i) => i * (width / data.length) + idx * (barWidth / graphConfig.series.length))
                    .attr('y', d => yScale(+d[series.yAxis]))
                    .attr('width', barWidth / graphConfig.series.length)
                    .attr('height', d => height - yScale(+d[series.yAxis]))
                    .attr('fill', this.getSeriesColor(idx, graphConfig.series.length));
            });
        }

        // Draw curve fits if specified
        if (curveFits && curveFits.length > 0) {
            curveFits.forEach(fit => {
                if (fit.enabled && fit.seriesIndex < graphConfig.series.length) {
                    this.drawCurveFit(g, data, graphConfig, fit, xScale, yScale, width);
                }
            });
        }
    }

    /**
     * Get color for series based on index
     */
    getSeriesColor(index, total) {
        const colors = ['#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd', '#8c564b'];
        return colors[index % colors.length];
    }

    /**
     * Draw curve fit
     */
    drawCurveFit(g, data, graphConfig, fit, xScale, yScale, width) {
        const series = graphConfig.series[fit.seriesIndex];
        const seriesData = data.map(d => ({
            x: +d[graphConfig.xAxis],
            y: +d[series.yAxis]
        })).filter(d => !isNaN(d.x) && !isNaN(d.y))
            .sort((a, b) => a.x - b.x);

        if (seriesData.length < 2) return;

        // Filter by xMin/xMax if specified
        let filteredData = seriesData;
        if (fit.xMin !== undefined || fit.xMax !== undefined) {
            filteredData = seriesData.filter(d =>
                (fit.xMin === undefined || d.x >= fit.xMin) &&
                (fit.xMax === undefined || d.x <= fit.xMax)
            );
        }

        if (filteredData.length < 2) return;

        // Generate curve line
        const line = d3.line()
            .x(d => xScale(d.x))
            .y(d => yScale(d.y));

        g.append('path')
            .datum(filteredData)
            .attr('class', 'curve-fit')
            .attr('fill', 'none')
            .attr('stroke', fit.color || '#ff0000')
            .attr('stroke-width', 2)
            .attr('stroke-dasharray', '5,5')
            .attr('d', line);
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
