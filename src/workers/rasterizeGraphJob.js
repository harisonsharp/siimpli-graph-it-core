/**
 * @fileoverview Builds the message payload for RasterizeWorkerPool from a live,
 * DOM-rendered SVG ref — the boundary between the main-thread-only half of
 * graph export (SVG generation, which needs a real DOM) and the off-main-thread
 * half (rasterizing that SVG to a PNG buffer, which doesn't).
 *
 * See rasterizeGraphWorker.js for the worker side of this contract, and
 * graphUtils.js's exportGraphToPNG for the original single-threaded
 * (main-thread-only) implementation this is an alternative path to — that
 * function is untouched and remains the fallback when Worker/OffscreenCanvas
 * support can't be assumed.
 *
 * @module rasterizeGraphJob
 */
import { computeLogoPlacement } from '../utils/graphUtils.js';

/**
 * Prepares a transferable rasterize job from a live SVG element.
 *
 * @param {SVGElement} svgNode - The rendered SVG to rasterize (read, not mutated).
 * @param {{width: number, height: number}} graphDimensions
 * @param {Object} watermarkConfig - Same shape as WATERMARK_CONFIG in constants.js.
 * @param {HTMLImageElement|null} logoImage - A *loaded* (logoImage.complete) logo image, or null/undefined to skip the watermark logo.
 * @param {Object|null} margin
 * @param {number} [scale=1]
 * @returns {Promise<{payload: object, transfer: Transferable[]}>} `payload` is
 *   ready to `postMessage` to a rasterizeGraphWorker (plus a `{id}`); `transfer`
 *   lists the objects (the logo ImageBitmap, if any) to pass as postMessage's
 *   transfer list for a zero-copy handoff.
 */
export async function buildRasterizeJob(svgNode, graphDimensions, watermarkConfig, logoImage, margin, scale = 1) {
    const { width, height } = graphDimensions;

    // Clone to avoid mutating the live DOM, exactly as exportGraphToPNG does.
    const clone = svgNode.cloneNode(true);
    clone.querySelectorAll('image').forEach((imgEl) => {
        if (imgEl.parentNode) imgEl.parentNode.removeChild(imgEl);
    });

    if (scale !== 1) {
        if (!clone.getAttribute('viewBox')) {
            clone.setAttribute('viewBox', `0 0 ${width} ${height}`);
        }
        clone.setAttribute('width', width * scale);
        clone.setAttribute('height', height * scale);
    }

    const svgData = new XMLSerializer().serializeToString(clone);
    const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });

    let logoBitmap = null;
    let logoPlacement = null;
    const hasUsableLogo = logoImage && logoImage.complete
        && logoImage.src && !logoImage.src.includes('data:')
        && logoImage.naturalWidth > 1 && logoImage.naturalHeight > 1;

    if (hasUsableLogo) {
        logoPlacement = computeLogoPlacement(
            logoImage.naturalWidth, logoImage.naturalHeight, width * scale, height * scale, margin, scale
        );
        if (logoPlacement.shouldDraw) {
            // createImageBitmap needs a real DOM-decoded source, so this step
            // still runs on the main thread — only the (already-decoded, cheap
            // to hand off) resulting bitmap crosses into the worker.
            logoBitmap = await createImageBitmap(logoImage);
        }
    }

    const payload = {
        svgBlob,
        width: width * scale,
        height: height * scale,
        watermarkConfig,
        logoBitmap,
        logoPlacement,
    };

    return { payload, transfer: logoBitmap ? [logoBitmap] : [] };
}
