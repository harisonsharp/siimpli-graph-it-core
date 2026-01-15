
/**
 * @fileoverview Static service class for SVG plotting and interactive point visualization.
 * Manages SVG element creation, crosshair rendering, and coordinate point plotting
 * for the scientific data visualization application.
 *
 * @author Harison Sharp
 * @since 0.2.0
 * @deprecated Use AnnotationRenderer from rendering/AnnotationRenderer.js instead.
 * @class SvgPlottingService
 *
 * @description Utility service providing static methods for creating and manipulating SVG elements
 * within the data visualization context. Handles point plotting with crosshairs, labels,
 * and dual-axis support for mathematical analysis workflows.
 *
 * @requires ../rendering/AnnotationRenderer.js - Canonical implementation
 *
 * @exports SvgPlottingService - Static class with plotting utility methods
 *
 * @example
 * // DEPRECATED: Use AnnotationRenderer instead
 * import { AnnotationRenderer } from '@siimpl/graph-it-core';
 * AnnotationRenderer.plotPoint(svgElement, pixels, userInput, parsedData);
 *
 * @relatedFiles AnnotationRenderer.js, usePlotting.js, CoordinateService.js
 */

import { AnnotationRenderer } from '../rendering/AnnotationRenderer.js';

/**
 * @deprecated Use AnnotationRenderer directly.
 */
export class SvgPlottingService {
    /** @deprecated Use AnnotationRenderer.clearSvg */
    static clearSvg(svgElement) {
        return AnnotationRenderer.clearSvg(svgElement);
    }

    /** @deprecated Use AnnotationRenderer.createSvgElement */
    static createSvgElement(type, attributes = {}) {
        return AnnotationRenderer.createSvgElement(type, attributes);
    }

    /** @deprecated Use AnnotationRenderer.plotPoint */
    static plotPoint(svgElement, pixels, userInput, parsedData) {
        return AnnotationRenderer.plotPoint(svgElement, pixels, userInput, parsedData);
    }
}
