/**
 * @fileoverview Dedicated renderer for logo/branding image overlays on SVG charts.
 * Encapsulates all logo positioning and rendering logic, extracted from graphUtils.js.
 *
 * @author Harison Sharp
 * @since 0.4.0
 *
 * @module LogoRenderer
 * @type {Utility}
 *
 * @requires None (pure D3 selection operations)
 *
 * @function renderLogo - Appends a logo image to an SVG at the correct position
 *
 * @exports renderLogo
 *
 * @example
 * import { renderLogo } from '@siimpl/graph-it-core';
 * renderLogo(svgSelection, logoImage, dimensions);
 *
 * @relatedFiles graphUtils.js (re-exports for backward compatibility), useGraphRenderer.js
 */

import { debugLog, debugWarn } from '../utils/debug.js';

/**
 * Render logo image on an SVG chart.
 *
 * @param {d3.Selection} svg - D3 selection of the SVG element
 * @param {HTMLImageElement} logoImage - Preloaded Image element with src set
 * @param {Object} dimensions - Layout dimensions { height, margin: {left, top, ...} }
 */
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
    const logoX = margin.left - logoTargetWidth - 20;
    const logoY = margin.top + height + 20;

    svg.append("image")
        .attr("href", logoImage.src)
        .attr("x", logoX)
        .attr("y", logoY)
        .attr("width", logoTargetWidth)
        .attr("height", logoHeight)
        .attr("opacity", 0.8);
};
