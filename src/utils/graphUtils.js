import * as d3 from 'd3';
import { writeFile } from '@tauri-apps/plugin-fs';
import { debugLog, debugWarn } from './debug.js';
import { parseColumnId } from './columnUtils.js';
import { drawAxes } from './axisUtils.js';
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
 * @exports {Function} drawColorLegend - Creates color scale legends for data visualization
 * @exports {Function} drawContourLegend - Generates contour level legends
 * @exports {Function} exportGraphToPNG - Exports rendered graphs to PNG format
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

export const drawColorLegend = (svg, colorScale, colorValues, colorInfo, margin, graphDimensions, colorScheme) => {
    const legend = svg.append("g")
        .attr("transform", `translate(${margin.left}, ${graphDimensions.height - 60})`);

    if (typeof colorValues[0] === 'string') {
        // Discrete legend
        const uniqueValues = [...new Set(colorValues)];
        uniqueValues.forEach((value, i) => {
            const legendRow = legend.append("g")
                .attr("transform", `translate(${i * 120}, 0)`);

            legendRow.append("rect")
                .attr("width", 15)
                .attr("height", 15)
                .style("fill", colorScale(value));

            legendRow.append("text")
                .attr("x", 20)
                .attr("y", 12)
                .style("font-family", "sans-serif")
                .style("font-size", "12px")
                .text(value);
        });
    } else {
        // Continuous gradient legend
        const gradientId = `gradient-${Date.now()}`;
        const gradient = svg.append("defs")
            .append("linearGradient")
            .attr("id", gradientId)
            .attr("x1", "0%")
            .attr("x2", "100%");

        // Create proper gradient stops based on the color scheme
        const numStops = 20;
        const colorExtent = d3.extent(colorValues);

        for (let i = 0; i <= numStops; i++) {
            const t = i / numStops;
            const value = colorExtent[0] + t * (colorExtent[1] - colorExtent[0]);
            gradient.append("stop")
                .attr("offset", `${t * 100}%`)
                .attr("stop-color", colorScale(value));
        }

        legend.append("rect")
            .attr("width", 200)
            .attr("height", 20)
            .style("fill", `url(#${gradientId})`);

        legend.append("text")
            .attr("x", 0)
            .attr("y", -5)
            .style("font-family", "sans-serif")
            .style("font-size", "12px")
            .text(typeof colorExtent[0] === 'number' ? colorExtent[0].toFixed(2) : colorExtent[0].toString());

        legend.append("text")
            .attr("x", 200)
            .attr("y", -5)
            .attr("text-anchor", "end")
            .style("font-family", "sans-serif")
            .style("font-size", "12px")
            .text(typeof colorExtent[1] === 'number' ? colorExtent[1].toFixed(2) : colorExtent[1].toString());

        legend.append("text")
            .attr("x", 100)
            .attr("y", 35)
            .attr("text-anchor", "middle")
            .style("font-family", "sans-serif")
            .style("font-size", "12px")
            .text(colorInfo.columnName);
    }
};

export const drawContourLegend = (svg, contourInfo, thresholds, contourColorScale, graphDimensions) => {
    const contourLegend = svg.append("g")
        .attr("transform", `translate(${graphDimensions.width - 120}, ${graphDimensions.height / 2})`);

    contourLegend.append("text")
        .attr("x", 0)
        .attr("y", -10)
        .attr("font-size", "12px")
        .attr("font-weight", "bold")
        .text(contourInfo.columnName);

    thresholds.forEach((threshold, i) => {
        const legendItem = contourLegend.append("g")
            .attr("transform", `translate(0, ${i * 20})`);

        legendItem.append("line")
            .attr("x1", 0)
            .attr("x2", 20)
            .attr("y1", 0)
            .attr("y2", 0)
            .attr("stroke", contourColorScale(i))
            .attr("stroke-width", 2);

        legendItem.append("text")
            .attr("x", 25)
            .attr("y", 4)
            .attr("font-size", "10px")
            .text(threshold.toFixed(2));
    });
};

export const drawSeriesLegend = (svg, seriesInfo, colorScale, graphDimensions, margin, xOffset = 90) => {
    const legend = svg.append("g")
        .attr("transform", `translate(${graphDimensions.width - margin.right + xOffset}, ${margin.top})`);

    seriesInfo.forEach((series, i) => {
        const legendItem = legend.append("g")
            .attr("transform", `translate(0, ${i * 25})`);

        const color = colorScale(series.yAxisInfo.columnName);
        const graphType = series.graphType || 'scatter';

        // Draw different shapes based on series type
        switch (graphType.toLowerCase()) {
            case 'line':
                // Draw a thick horizontal line for line series
                legendItem.append("line")
                    .attr("x1", 0)
                    .attr("y1", 7.5)
                    .attr("x2", 15)
                    .attr("y2", 7.5)
                    .attr("stroke", color)
                    .attr("stroke-width", 4)
                    .attr("stroke-linecap", "round");
                break;

            case 'scatter':
                // Draw a circle for scatter plots
                legendItem.append("circle")
                    .attr("cx", 7.5)
                    .attr("cy", 7.5)
                    .attr("r", 6)
                    .attr("fill", color);
                break;

            case 'bar':
            case 'histogram':
            default:
                // Draw a square for bar charts and histograms
                legendItem.append("rect")
                    .attr("x", 0)
                    .attr("y", 0)
                    .attr("width", 15)
                    .attr("height", 15)
                    .attr("fill", color);
                break;
        }

        legendItem.append("text")
            .attr("x", 20)
            .attr("y", 12)
            .style("font-family", "sans-serif")
            .style("font-size", "12px")
            .text(series.yAxisInfo.columnName === '__frequency__' ? 'Frequency' : series.yAxisInfo.columnName);
    });
};

export const exportGraphToPNG = async (svgRef, canvasRef, graphDimensions, WATERMARK_CONFIG, generateWatermarkTile, logoImage, outputPath, margin = null) => {
    const svgNode = svgRef.current || svgRef;
    const { width, height } = graphDimensions;

    // Find and temporarily remove ALL image elements from SVG (including logo)
    // This prevents broken image placeholders in the exported PNG
    const imageElements = svgNode.querySelectorAll('image');
    const removedImages = [];

    imageElements.forEach(imgEl => {
        if (imgEl.parentNode) {
            removedImages.push({
                element: imgEl,
                parent: imgEl.parentNode,
                nextSibling: imgEl.nextSibling
            });
            imgEl.parentNode.removeChild(imgEl);
        }
    });

    // Serialize SVG to string
    const svgData = new XMLSerializer().serializeToString(svgNode);

    // Restore all image elements back to the SVG
    removedImages.forEach(({ element, parent, nextSibling }) => {
        if (nextSibling) {
            parent.insertBefore(element, nextSibling);
        } else {
            parent.appendChild(element);
        }
    });

    const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });

    // Use optimized canvas path with Image loading
    // Note: createImageBitmap doesn't work with SVG blobs, so we use the Image loading approach
    return exportWithOptimizedCanvas(svgBlob, canvasRef, width, height, WATERMARK_CONFIG, generateWatermarkTile, logoImage, margin, outputPath);
};

/**
 * Optimized canvas export with Image loading
 * Uses standard canvas with Image loading approach (only reliable method for SVG)
 */
function exportWithOptimizedCanvas(svgBlob, canvasRef, width, height, WATERMARK_CONFIG, generateWatermarkTile, logoImage, margin, outputPath) {
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
            drawLogoToCanvas(ctx, logoImage, width, height, margin);

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
function drawLogoToCanvas(ctx, logoImage, width, height, margin) {
    if (logoImage && logoImage.complete && logoImage.naturalWidth > 0) {
        if (logoImage.src && !logoImage.src.includes('data:') && logoImage.naturalWidth > 1 && logoImage.naturalHeight > 1) {
            const usedMargin = margin || { top: 80, right: 320, bottom: 100, left: 100 };
            const graphHeight = height - usedMargin.top - usedMargin.bottom;
            const logoTargetWidth = 60;
            const aspectRatio = logoImage.naturalHeight / logoImage.naturalWidth;
            const logoHeight = logoTargetWidth * aspectRatio;
            const logoX = usedMargin.left - logoTargetWidth - 10;
            const logoY = usedMargin.top + graphHeight + 10;

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


export const renderLogo = (svg, logoImage, dimensions) => {
    if (!logoImage || !logoImage.src) return;

    const { height, margin } = dimensions;
    const logoTargetWidth = 60;
    const aspectRatio = (logoImage.naturalHeight && logoImage.naturalWidth)
        ? logoImage.naturalHeight / logoImage.naturalWidth
        : 1;
    const logoHeight = logoTargetWidth * aspectRatio;

    // height in dimensions is already the inner graph height (fullHeight - margins)
    // We want to place the logo below the graph area
    const logoX = margin.left - logoTargetWidth - 10;
    const logoY = margin.top + height + 10;

    svg.append("image")
        .attr("href", logoImage.src)
        .attr("x", logoX)
        .attr("y", logoY)
        .attr("width", logoTargetWidth)
        .attr("height", logoHeight)
        .attr("opacity", 0.8);
};
