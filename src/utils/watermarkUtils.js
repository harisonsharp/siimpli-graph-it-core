/**
 * @fileoverview Utility functions for generating deterministic watermark patterns on graph visualizations.
 * Creates canvas-based watermark tiles using seeded random patterns for consistent
 * background textures across scientific data plots.
 *
 * @author Harison Sharp
 * @since 0.2.0
 * @module watermarkUtils
 *
 * @description Pure utility module providing watermark generation functionality using HTML5 Canvas.
 * Generates deterministic pixel patterns based on seed values for consistent visual branding
 * and background textures in exported graph images.
 *
 * @requires HTML5 Canvas API - Browser canvas functionality for pixel manipulation
 *
 * @exports generateWatermarkTile - Function to create watermark canvas elements
 *
 * @example
 * const tile = generateWatermarkTile({ seed: 'graph123', tilePxSize: 64 });
 *
 * @relatedFiles useGraphGeneration.js, constants.js
 */

export const generateWatermarkTile = (config) => {
    const { seed, tilePxSize, shadeDifference, baseColor } = config;
    const tileCanvas = document.createElement('canvas');
    tileCanvas.width = tilePxSize;
    tileCanvas.height = tilePxSize;
    const ctx = tileCanvas.getContext('2d');

    // Parse colors once
    const colorA = { r: baseColor.r, g: baseColor.g, b: baseColor.b };
    const colorB = {
        r: Math.max(0, baseColor.r - shadeDifference),
        g: Math.max(0, baseColor.g - shadeDifference),
        b: Math.max(0, baseColor.b - shadeDifference)
    };

    // Use ImageData for direct pixel manipulation (100x faster than fillRect for large tiles)
    const imageData = ctx.createImageData(tilePxSize, tilePxSize);
    const data = imageData.data;

    // Pre-compute hash for seed prefix (optimization)
    let seedHash = 0;
    for (let i = 0; i < seed.length; i++) {
        seedHash = ((seedHash << 5) + seedHash) + seed.charCodeAt(i);
        seedHash |= 0;
    }

    for (let y = 0; y < tilePxSize; y++) {
        for (let x = 0; x < tilePxSize; x++) {
            // Fast deterministic hash (seeded by position)
            let hash = seedHash;
            hash = ((hash << 5) + hash) + x;
            hash = ((hash << 5) + hash) + y;
            hash |= 0;

            // Choose color based on hash
            const color = (Math.abs(hash) % 2 === 0) ? colorA : colorB;

            // Set pixel in ImageData (4 bytes per pixel: R, G, B, A)
            const idx = (y * tilePxSize + x) * 4;
            data[idx] = color.r;     // R
            data[idx + 1] = color.g; // G
            data[idx + 2] = color.b; // B
            data[idx + 3] = 255;     // A (fully opaque)
        }
    }

    // Single putImageData call instead of 262K fillRect calls
    ctx.putImageData(imageData, 0, 0);

    return tileCanvas;
};

// Module-level cache for watermark pattern
let cachedWatermarkTile = null;
let cachedConfigKey = null;

/**
 * Generate a cache key from config to detect changes
 */
const getConfigKey = (config) =>
    `${config.seed}_${config.tilePxSize}_${config.shadeDifference}_${config.baseColor.r}_${config.baseColor.g}_${config.baseColor.b}`;

/**
 * Get cached watermark pattern for CanvasRenderingContext2D
 * Creates pattern once and reuses for all subsequent exports
 * Invalidates cache when config changes
 * 
 * @param {Object} config - Watermark configuration
 * @param {CanvasRenderingContext2D} ctx - Canvas context to create pattern for
 * @returns {CanvasPattern} Reusable watermark pattern
 */
export const getCachedWatermarkPattern = (config, ctx) => {
    const configKey = getConfigKey(config);

    // Invalidate cache if config changed
    if (!cachedWatermarkTile || cachedConfigKey !== configKey) {
        cachedWatermarkTile = generateWatermarkTile(config);
        cachedConfigKey = configKey;
    }

    // Create pattern for this context (patterns are context-specific)
    const pattern = ctx.createPattern(cachedWatermarkTile, 'repeat');
    return pattern;

};

/**
 * Clear the watermark cache (call after config changes)
 */
export const clearWatermarkCache = () => {
    cachedWatermarkTile = null;
    cachedConfigKey = null;
};
