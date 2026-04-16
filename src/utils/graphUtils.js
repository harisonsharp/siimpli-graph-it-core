import * as d3 from 'd3';
import { writeFile } from '@tauri-apps/plugin-fs';
import { debugLog, debugWarn } from './debug.js';
import { parseColumnId } from './columnUtils.js';
import { drawAxes } from './axisUtils.js';
import { ScaleFactory } from '../rendering/ScaleFactory.js';
/**
 * @fileoverview Utility functions for D3.js graph operations, mathematical computations, and export functionality.
 * Provides column parsing, contour generation, axis rendering, legend creation, and PNG export capabilities
 * for the scientific data visualization pipeline with coordinate system management.
 *
 * @author Harison Sharp
 * @since 0.2.0
 *
 * @module Utility Functions
 * @type {Module}
 *
 * @requires d3 - Data visualization library for mathematical operations and rendering
 * @requires @tauri-apps/plugin-fs - File system operations for export functionality
 *
 * @exports {Function} parseColumnId - Parses column identifiers with file associations
 * @exports {Function} generateContours - Creates contour data from 3D point sets
// drawAxes moved to axisUtils.js

 * @exports {Function} generateStructuredFileName - Creates descriptive filenames with metadata
 * @exports {Function} isFunction - Determine if data represents a mathematical function
 * @example
 * const columnInfo = parseColumnId('temperature::data.csv');
 * const { contours, thresholds } = generateContours(data, 'x', 'y', 'z', xScale, yScale);
 * drawAxes(g, xScale, yScale, xAxisY, yAxisX, height, width, margin, 'X Label', 'Y Label');
 *
 * @related GraphService.js, GraphRenderer.jsx, ImageExportService.js
 */

// parseColumnId moved to columnUtils.js

export const generateContours = (data, xCol, yCol, zCol, xScale, yScale) => {
    debugLog('Generating contours for:', { xCol, yCol, zCol, dataPoints: data.length });

    const xExtent = d3.extent(data, d => +d[xCol]);
    const yExtent = d3.extent(data, d => +d[yCol]);
    const zExtent = d3.extent(data, d => +d[zCol]);

    debugLog('Data extents:', { xExtent, yExtent, zExtent });

    // Ensure we have valid extents
    if (!xExtent[0] && xExtent[0] !== 0 || !xExtent[1] && xExtent[1] !== 0 ||
        !yExtent[0] && yExtent[0] !== 0 || !yExtent[1] && yExtent[1] !== 0 ||
        !zExtent[0] && zExtent[0] !== 0 || !zExtent[1] && zExtent[1] !== 0) {
        throw new Error('Invalid data extents for contouring');
    }

    const gridSize = 50; // Reduced for better performance and visibility
    const xStep = (xExtent[1] - xExtent[0]) / gridSize;
    const yStep = (yExtent[1] - yExtent[0]) / gridSize;

    const values = new Array(gridSize + 1);
    for (let j = 0; j <= gridSize; j++) {
        values[j] = new Array(gridSize + 1);
        for (let i = 0; i <= gridSize; i++) {
            const x = xExtent[0] + i * xStep;
            const y = yExtent[0] + j * yStep;

            let sumZ = 0;
            let sumW = 0;

            data.forEach(d => {
                const dx = +d[xCol] - x;
                const dy = +d[yCol] - y;
                const dist = Math.sqrt(dx * dx + dy * dy);

                if (dist < 0.001) { // Very close point
                    sumZ = +d[zCol];
                    sumW = 1;
                    return;
                }

                const weight = 1 / (dist * dist + 0.1); // Added small constant to prevent division issues
                sumZ += +d[zCol] * weight;
                sumW += weight;
            });

            values[j][i] = sumW > 0 ? sumZ / sumW : zExtent[0];
        }
    }

    const numLevels = 8; // Reduced for clearer visualization
    const thresholds = d3.range(numLevels).map(i =>
        zExtent[0] + (i + 1) * (zExtent[1] - zExtent[0]) / (numLevels + 1)
    );

    const contourGenerator = d3.contours()
        .size([gridSize + 1, gridSize + 1])
        .thresholds(thresholds);

    const contours = contourGenerator(values.flat());

    // Transform contour coordinates to screen space
    contours.forEach(contour => {
        contour.coordinates = contour.coordinates.map(polygon =>
            polygon.map(ring =>
                ring.map(point => [
                    xScale(xExtent[0] + point[0] * xStep),
                    yScale(yExtent[0] + point[1] * yStep)
                ])
            )
        );
    });

    debugLog('Successfully generated', contours.length, 'contours');
    return { contours, thresholds };
};

// drawAxes moved to axisUtils.js



export const exportGraphToPNG = async (svgRef, canvasRef, graphDimensions, WATERMARK_CONFIG, generateWatermarkTile, logoImage, outputPath, margin = null, scale = 1) => {
    const svgNode = svgRef.current || svgRef;
    const { width, height } = graphDimensions;

    // Clone the SVG node to avoid modifying the live DOM
    const clone = svgNode.cloneNode(true);

    // Find and remove all image elements from the CLONE
    // This prevents broken image placeholders in the exported PNG
    const imageElements = clone.querySelectorAll('image');
    imageElements.forEach(imgEl => {
        if (imgEl.parentNode) {
            imgEl.parentNode.removeChild(imgEl);
        }
    });

    // Handle scaling
    if (scale !== 1) {
        // Ensure viewBox exists for proper scaling
        if (!clone.getAttribute('viewBox')) {
            clone.setAttribute('viewBox', `0 0 ${width} ${height}`);
        }

        // Update width and height to scaled values
        clone.setAttribute('width', width * scale);
        clone.setAttribute('height', height * scale);

        // If the SVG uses internal styles/transform attributes that rely on pixels, 
        // they should scale automatically via viewBox, but we ensure the root attributes are set.
    }

    // Serialize SVG to string
    const svgData = new XMLSerializer().serializeToString(clone);

    const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });

    // Use optimized canvas path with Image loading
    return exportWithOptimizedCanvas(svgBlob, canvasRef, width * scale, height * scale, WATERMARK_CONFIG, generateWatermarkTile, logoImage, margin, outputPath, scale);
};

/**
 * Optimized canvas export with Image loading
 * Uses standard canvas with Image loading approach (only reliable method for SVG)
 */
function exportWithOptimizedCanvas(svgBlob, canvasRef, width, height, WATERMARK_CONFIG, generateWatermarkTile, logoImage, margin, outputPath, scale = 1) {
    const canvas = canvasRef.current || canvasRef || document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = width;
    canvas.height = height;

    // Draw watermark background
    ctx.fillStyle = `rgb(${WATERMARK_CONFIG.baseColor.r}, ${WATERMARK_CONFIG.baseColor.g}, ${WATERMARK_CONFIG.baseColor.b})`;
    ctx.fillRect(0, 0, width, height);

    const watermarkTile = generateWatermarkTile(WATERMARK_CONFIG);
    const pattern = ctx.createPattern(watermarkTile, 'repeat');
    if (pattern) {
        ctx.fillStyle = pattern;
        ctx.fillRect(0, 0, width, height);
    }

    const url = URL.createObjectURL(svgBlob);

    return new Promise((resolve) => {
        const img = new Image();
        img.onload = async () => {
            ctx.drawImage(img, 0, 0);
            URL.revokeObjectURL(url);

            // Draw logo
            drawLogoToCanvas(ctx, logoImage, width, height, margin, scale);

            // Convert to PNG
            canvas.toBlob(async (blob) => {
                if (!blob) {
                    resolve(null);
                    return;
                }

                const buffer = await blob.arrayBuffer();

                // Write file if path provided
                let writeSuccess = false;
                if (outputPath && (outputPath.includes('/') || outputPath.includes('\\'))) {
                    try {

                        await writeFile(outputPath, new Uint8Array(buffer));
                        writeSuccess = true;
                    } catch (writeError) {
                        debugWarn('Tauri file write failed:', writeError);
                    }
                }

                // Create a blob URL for potential browser download
                const blobUrl = URL.createObjectURL(blob);
                resolve({ buffer, pngData: blobUrl, writeSuccess });
            }, 'image/png');
        };

        img.onerror = () => {
            URL.revokeObjectURL(url);
            resolve(null);
        };

        img.src = url;
    });
}

/**
 * Helper: Draw logo onto canvas context
 */
function drawLogoToCanvas(ctx, logoImage, width, height, margin, scale = 1) {
    if (logoImage && logoImage.complete && logoImage.naturalWidth > 0) {
        if (logoImage.src && !logoImage.src.includes('data:') && logoImage.naturalWidth > 1 && logoImage.naturalHeight > 1) {
            const baseMargin = margin || { top: 80, right: 320, bottom: 100, left: 100 };
            const usedMargin = {
                top: baseMargin.top * scale,
                right: baseMargin.right * scale,
                bottom: baseMargin.bottom * scale,
                left: baseMargin.left * scale
            };

            const graphHeight = height - usedMargin.top - usedMargin.bottom;
            const logoTargetWidth = 60 * scale;
            const aspectRatio = logoImage.naturalHeight / logoImage.naturalWidth;
            const logoHeight = logoTargetWidth * aspectRatio;
            const logoX = usedMargin.left - logoTargetWidth - 20;
            const logoY = usedMargin.top + graphHeight + 30;

            ctx.save();
            ctx.globalAlpha = 0.8;
            if (logoX >= 0 && logoY >= 0) {
                ctx.drawImage(logoImage, logoX, logoY, logoTargetWidth, logoHeight);
            }
            ctx.restore();
        }
    }
}

export const generateStructuredFileName = (csvData, graphConfig, graphDimensions, getAxisIntercepts, margin = null) => {
    const date = new Date();
    const dateStr = date.toISOString().slice(2, 10).replace(/-/g, '');

    // Parse column IDs to get actual column names
    const xAxisInfo = parseColumnId(graphConfig.xAxis);

    // Handle both legacy yAxis and new series format
    let yAxisInfo;
    if (graphConfig.series && graphConfig.series.length > 0) {
        yAxisInfo = parseColumnId(graphConfig.series[0].yAxis);
    } else if (graphConfig.yAxis) {
        yAxisInfo = parseColumnId(graphConfig.yAxis);
    } else {
        console.warn('No Y-axis configuration found for filename generation');
        return `graph_${dateStr}.png`;
    }

    const yAxis2Info = parseColumnId(graphConfig.yAxis2);
    const colorInfo = parseColumnId(graphConfig.colorGrading);
    const contourInfo = parseColumnId(graphConfig.contouring);

    // Get scale information - ensure we have valid data
    if (!csvData || csvData.length === 0) {
        return `graph_${dateStr}.png`;
    }

    const validData = csvData.filter(d =>
        d[xAxisInfo.columnName] !== undefined &&
        d[yAxisInfo.columnName] !== undefined &&
        !isNaN(+d[xAxisInfo.columnName]) &&
        !isNaN(+d[yAxisInfo.columnName])
    );

    if (validData.length === 0) {
        return `graph_${dateStr}.png`;
    }

    const xExtent = d3.extent(validData, d => +d[xAxisInfo.columnName]);
    const yExtent = d3.extent(validData, d => +d[yAxisInfo.columnName]);
    const intercepts = getAxisIntercepts(xExtent, yExtent);

    // Define margins - must match the graph generation margins
    const usedMargin = margin || { top: 80, right: 320, bottom: 100, left: 100 };

    // Calculate graph area dimensions
    const graphWidth = graphDimensions.width - usedMargin.left - usedMargin.right;
    const graphHeight = graphDimensions.height - usedMargin.top - usedMargin.bottom;

    // Adjust domain to include intercept points (same as graph generation)
    const xDomain = [
        Math.min(xExtent[0], intercepts.x),
        Math.max(xExtent[1], intercepts.x)
    ];
    const yDomain = [
        Math.min(yExtent[0], intercepts.y),
        Math.max(yExtent[1], intercepts.y)
    ];

    // Calculate pixels per unit based on the actual domain
    const xRange = xDomain[1] - xDomain[0];
    const yRange = yDomain[1] - yDomain[0];
    const xPixelsPerUnit = graphWidth / xRange;
    const yPixelsPerUnit = graphHeight / yRange;

    // Calculate zero position in pixels within the graph area
    // This represents where the zero line appears in the graph coordinate system
    const xZeroPos = Math.round((intercepts.x - xDomain[0]) * xPixelsPerUnit);
    const yZeroPos = Math.round((yDomain[1] - intercepts.y) * yPixelsPerUnit);

    let filename = `${dateStr}`;
    filename += `_x${xAxisInfo.columnName.replace(/[^a-zA-Z0-9]/g, '')}`;
    filename += `s${xZeroPos},${Math.round(xPixelsPerUnit)}`;
    filename += `_y${yAxisInfo.columnName.replace(/[^a-zA-Z0-9]/g, '')}`;
    filename += `s${yZeroPos},${Math.round(yPixelsPerUnit)}`;

    if (graphConfig.dualYAxis && graphConfig.yAxis2) {
        const y2Extent = d3.extent(validData, d => +d[yAxis2Info.columnName]);
        const y2Domain = [
            Math.min(y2Extent[0], intercepts.y),
            Math.max(y2Extent[1], intercepts.y)
        ];
        const y2Range = y2Domain[1] - y2Domain[0];
        const y2PixelsPerUnit = graphHeight / y2Range;
        const y2ZeroPos = Math.round((y2Domain[1] - intercepts.y) * y2PixelsPerUnit);
        filename += `_y2${yAxis2Info.columnName.replace(/[^a-zA-Z0-9]/g, '')}`;
        filename += `s${y2ZeroPos},${Math.round(y2PixelsPerUnit)}`;
    }

    if (graphConfig.colorGrading) {
        filename += `_cg${colorInfo.columnName.replace(/[^a-zA-Z0-9]/g, '')}`;
    }

    if (graphConfig.contouring) {
        filename += `_ct${contourInfo.columnName.replace(/[^a-zA-Z0-9]/g, '')}`;
    }

    // Add image dimensions for consistency
    filename += `_w${graphDimensions.width}h${graphDimensions.height}`;
    filename += `_o${Math.round(intercepts.x)},${Math.round(intercepts.y)}`;

    return filename + '.png';
};

export const isFunction = (data, xCol, yCol) => {
    const xValues = data.map(d => d[xCol]);
    const uniqueX = new Set(xValues);
    return uniqueX.size === xValues.length;
};

// Re-exported from LogoRenderer.js for backward compatibility
// @deprecated Import from '../rendering/LogoRenderer.js' directly
export { renderLogo } from '../rendering/LogoRenderer.js';
