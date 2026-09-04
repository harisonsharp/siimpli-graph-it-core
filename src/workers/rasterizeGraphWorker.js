/**
 * @fileoverview Off-main-thread rasterizer: takes an already-serialized SVG
 * (as a Blob) plus a pre-decoded logo ImageBitmap and placement, and produces
 * a PNG buffer. Deliberately dumb — no layout, no DOM measurement, no business
 * logic beyond "draw these things at these coordinates" — that all happens on
 * the main thread in rasterizeGraphJob.js, which has the DOM this worker
 * doesn't.
 *
 * Runs inside a dedicated Worker via RasterizeWorkerPool. A dedicated Worker is
 * a separate *thread* in the same renderer *process*, not a separate OS
 * process — it does not protect against a true renderer-process crash (a full
 * process OOM, or the GPU process itself failing), only against main-thread
 * blocking and lets a stuck/failed job be torn down in isolation.
 *
 * @module rasterizeGraphWorker
 */
import { generateWatermarkTile } from '../utils/watermarkUtils.js';

self.onmessage = async (event) => {
    const { id, svgBlob, width, height, watermarkConfig, logoBitmap, logoPlacement } = event.data;
    try {
        const buffer = await rasterize({ svgBlob, width, height, watermarkConfig, logoBitmap, logoPlacement });
        self.postMessage({ id, buffer }, [buffer]);
    } catch (error) {
        self.postMessage({ id, error: error?.message || String(error) });
    }
};

async function rasterize({ svgBlob, width, height, watermarkConfig, logoBitmap, logoPlacement }) {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');

    // Watermark background — mirrors exportWithOptimizedCanvas in graphUtils.js.
    const baseColor = watermarkConfig?.baseColor || { r: 255, g: 255, b: 255 };
    ctx.fillStyle = `rgb(${baseColor.r}, ${baseColor.g}, ${baseColor.b})`;
    ctx.fillRect(0, 0, width, height);

    const tileSize = watermarkConfig?.tilePxSize || 64;
    const tile = generateWatermarkTile(watermarkConfig, () => new OffscreenCanvas(tileSize, tileSize));
    const pattern = ctx.createPattern(tile, 'repeat');
    if (pattern) {
        ctx.fillStyle = pattern;
        ctx.fillRect(0, 0, width, height);
    }

    const svgBitmap = await createImageBitmap(svgBlob);
    try {
        ctx.drawImage(svgBitmap, 0, 0);
    } finally {
        svgBitmap.close();
    }

    if (logoBitmap && logoPlacement?.shouldDraw) {
        ctx.save();
        ctx.globalAlpha = logoPlacement.alpha;
        ctx.drawImage(logoBitmap, logoPlacement.x, logoPlacement.y, logoPlacement.targetWidth, logoPlacement.targetHeight);
        ctx.restore();
        logoBitmap.close();
    }

    const blob = await canvas.convertToBlob({ type: 'image/png' });
    return await blob.arrayBuffer();
}
