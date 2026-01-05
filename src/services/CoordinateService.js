/**
 * @fileoverview Service class for coordinate system transformations and mathematical conversions.
 * Converts between data coordinate values and pixel positions using parsed axis scaling information.
 *
 * @author Harison Sharp
 * @since 0.2.0
 *
 * @class CoordinateService
 * @type {Service Class}
 *
 * @method valuesToPixels
 * @param {Object} values - Input coordinate values {x: number, y: number, y2?: number}
 * @param {Object} parsedData - Axis information {x: {zero, ppu, name}, y: {zero, ppu, name}, y2?: {zero, ppu, name}}
 * @returns {Object|null} Pixel coordinates {x: number, y: number, y2?: number} or null if invalid
 *
 * @method validatePixelBounds
 * @param {Object} pixels - Pixel coordinates to validate
 * @param {Object} imageDimensions - Image bounds {width: number, height: number}
 * @returns {boolean} True if coordinates are within bounds
 *
 * @exports CoordinateService
 *
 * @example
 * const pixelPos = CoordinateService.valuesToPixels({x: 1.5, y: 2.3}, axisData);
 * const inBounds = CoordinateService.validatePixelBounds(pixelPos, {width: 800, height: 600});
 *
 * @relatedFiles FileNameParsingService.js, FileNameDecoder.jsx - Coordinate conversion for plotting
 */

import { debugLog, debugWarn } from '../utils/debug.js';

export class CoordinateService {
    static valuesToPixels(values, parsedData) {
        if (!parsedData?.x?.ppu || !parsedData?.y?.ppu || !values.x || !values.y) {
            return null;
        }

        const x = parseFloat(values.x);
        const y = parseFloat(values.y);

        if (isNaN(x) || isNaN(y)) {
            return null;
        }

        const margin = { top: 60, right: 150, bottom: 120, left: 80 };

        // Calculate pixel positions with proper coordinate system
        // X: measured from left margin + zero position + (value * pixels per unit)
        const pixelX = margin.left + parsedData.x.zero + (x * parsedData.x.ppu);

        // Y: measured from top margin + zero position - (value * pixels per unit)
        // Note: SVG y increases downward, so we subtract for positive y values
        const pixelY = margin.top + parsedData.y.zero - (y * parsedData.y.ppu);

        const result = { x: pixelX, y: pixelY };

        // Handle y2 if present
        if (parsedData.y2?.ppu && values.y2) {
            const y2 = parseFloat(values.y2);
            if (!isNaN(y2)) {
                const pixelY2 = margin.top + parsedData.y2.zero - (y2 * parsedData.y2.ppu);
                result.y2 = pixelY2;
            }
        }

        debugLog('Converted values to pixels:', { input: values, output: result, parsedData });
        return result;
    }

    static validatePixelBounds(pixels, imageDimensions) {
        return pixels.x >= 0 && pixels.x <= imageDimensions.width &&
            pixels.y >= 0 && pixels.y <= imageDimensions.height;
    }
}
