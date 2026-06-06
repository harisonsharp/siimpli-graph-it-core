/**
 * @fileoverview Dynamic canvas sizing service for SVG graph visualizations.
 * Monitors content extents and automatically adjusts SVG dimensions to prevent clipping.
 * Provides both data-driven (fast) and DOM-based (fallback) extent calculation modes.
 *
 * @author Harison Sharp
 * @since 0.3.0
 *
 * @module CanvasSizer Service
 * @type {Class}
 *
 * @exports CanvasSizer - Dynamic canvas sizing orchestrator
 *
 * @example
 * const sizer = new CanvasSizer(svgElement, {
 *   margins: { top: 60, right: 150, bottom: 120, left: 80 },
 *   maxWidth: 8192,
 *   maxHeight: 8192,
 *   minPadding: 10,
 *   expandMode: 'expand',
 *   dpiMultiplier: 2
 * });
 * 
 * // Fast path: data-driven extent update
 * sizer.updateFromData({ xMin: 0, xMax: 500, yMin: 0, yMax: 300, radius: 5, strokeWidth: 1 });
 * const dims = sizer.ensureFit();
 *
 * // Fallback: DOM-based extent update
 * sizer.updateFromDOM();
 * const exportDims = sizer.ensureFit();
 *
 * @relatedFiles BaseChartRenderer, GraphService, ExportService
 */
import { debugLog, debugWarn } from "../utils/debug.js";
export class CanvasSizer {
    /**
     * Default configuration values
     */
    static DEFAULT_CONFIG = {
        margins: { top: 60, right: 150, bottom: 120, left: 80 },
        maxWidth: 8192,
        maxHeight: 8192,
        minWidth: 400,
        minHeight: 300,
        minPadding: 10,
        expandMode: 'scale', // 'expand' or 'scale'
        dpiMultiplier: 1,
        debounceMs: 100,
        maxLineWidthLegend: 40
    };

    /**
     * Create a CanvasSizer instance
     * @param {SVGElement} svgRoot - Root SVG element to manage
     * @param {Object} options - Configuration options
     * @param {Object} options.margins - Canvas margins {top, right, bottom, left}
     * @param {number} options.maxWidth - Maximum allowed width
     * @param {number} options.maxHeight - Maximum allowed height
     * @param {number} options.minWidth - Minimum allowed width
     * @param {number} options.minHeight - Minimum allowed height
     * @param {number} options.minPadding - Minimum padding around content
     * @param {string} options.expandMode - Sizing mode: 'expand' or 'scale'
     * @param {number} options.dpiMultiplier - DPI multiplier for exports
     * @param {number} options.debounceMs - Debounce delay for updates
     */
    constructor(svgRoot, options = {}) {
        if (!svgRoot) {
            throw new Error('SVG root element is required');
        }

        this.svgRoot = svgRoot;
        this.config = { ...CanvasSizer.DEFAULT_CONFIG, ...options };

        // Merge margins properly
        if (options.margins) {
            this.config.margins = { ...CanvasSizer.DEFAULT_CONFIG.margins, ...options.margins };
        }

        // State tracking
        this.lastExtents = null;
        this.lastAppliedDims = null;
        this.updatePending = false;
        this.debounceTimer = null;

        // Observers (optional, not used by default)
        this.mutationObserver = null;
        this.resizeObserver = null;
    }

    /**
     * Update canvas size based on precomputed data extents (fast path)
     * Preferred method - avoids DOM reads and layout thrashing
     * 
     * @param {Object} extents - Precomputed extents in pixel coordinates
     * @param {number} extents.xMin - Minimum x coordinate
     * @param {number} extents.xMax - Maximum x coordinate
     * @param {number} extents.yMin - Minimum y coordinate
     * @param {number} extents.yMax - Maximum y coordinate
     * @param {number} extents.radius - Optional marker radius to add to extents
     * @param {number} extents.strokeWidth - Optional stroke width to add to extents
     * @param {number} extents.labelPadding - Optional label padding to add to extents
     * @returns {CanvasSizer} this for chaining
     */
    updateFromData(extents) {
        debugLog('[CanvasSizer.updateFromData]', extents);
        if (!extents || typeof extents.xMin !== 'number' || typeof extents.xMax !== 'number' ||
            typeof extents.yMin !== 'number' || typeof extents.yMax !== 'number') {
            debugWarn('[CanvasSizer] Invalid extents provided to updateFromData');
            return this;
        }

        // Add padding for visual elements (radius, stroke, labels)
        const padding = (extents.radius || 0) + (extents.strokeWidth || 0) + (extents.labelPadding || 0);

        this.lastExtents = {
            xMin: extents.xMin - padding,
            xMax: extents.xMax + padding,
            yMin: extents.yMin - padding,
            yMax: extents.yMax + padding,
            source: 'data'
        };

        this._scheduleUpdate();
        return this;
    }

    /**
     * Update canvas size based on DOM bounding box (fallback path)
     * Use when transforms, rotations, or complex text metrics are involved
     * 
     * @param {SVGElement} groupElement - Optional group to measure (defaults to main group)
     * @returns {CanvasSizer} this for chaining
     */
    updateFromDOM(groupElement = null) {
        try {
            // Target the main content group or specified group
            const target = groupElement || this.svgRoot.querySelector('g');

            if (!target) {
                console.warn('[CanvasSizer] No group element found for DOM measurement');
                return this;
            }

            // Use requestAnimationFrame to ensure layout is complete
            requestAnimationFrame(() => {
                try {
                    const bbox = target.getBBox();

                    if (!bbox || bbox.width === 0 || bbox.height === 0) {
                        console.warn('[CanvasSizer] Invalid bounding box from DOM');
                        return;
                    }

                    this.lastExtents = {
                        xMin: bbox.x,
                        xMax: bbox.x + bbox.width,
                        yMin: bbox.y,
                        yMax: bbox.y + bbox.height,
                        source: 'dom'
                    };

                    this._scheduleUpdate();
                } catch (error) {
                    console.error('[CanvasSizer] getBBox failed:', error);
                }
            });
        } catch (error) {
            console.error('[CanvasSizer] DOM measurement failed:', error);
        }

        return this;
    }

    /**
     * Calculate SVG bounds by traversing elements (fallback for getBBox unavailability)
     * Used in headless environments like jsdom where getBBox is not implemented.
     * @private
     */
    _calculateBoundsFromElements(target) {
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;

        // Recursively traverse all SVG elements to find bounds
        const traverse = (el) => {
            if (!el) return;

            const x = parseFloat(el.getAttribute('x')) || 0;
            const y = parseFloat(el.getAttribute('y')) || 0;
            const cx = parseFloat(el.getAttribute('cx'));
            const cy = parseFloat(el.getAttribute('cy'));
            const r = parseFloat(el.getAttribute('r'));
            const width = parseFloat(el.getAttribute('width'));
            const height = parseFloat(el.getAttribute('height'));
            const x1 = parseFloat(el.getAttribute('x1'));
            const y1 = parseFloat(el.getAttribute('y1'));
            const x2 = parseFloat(el.getAttribute('x2'));
            const y2 = parseFloat(el.getAttribute('y2'));

            // Handle circle elements
            if (!Number.isNaN(cx) && !Number.isNaN(cy) && !Number.isNaN(r)) {
                minX = Math.min(minX, cx - r);
                maxX = Math.max(maxX, cx + r);
                minY = Math.min(minY, cy - r);
                maxY = Math.max(maxY, cy + r);
            }

            // Handle rect elements
            if (!Number.isNaN(x) && !Number.isNaN(y) && !Number.isNaN(width) && !Number.isNaN(height)) {
                minX = Math.min(minX, x);
                maxX = Math.max(maxX, x + width);
                minY = Math.min(minY, y);
                maxY = Math.max(maxY, y + height);
            }

            // Handle line elements
            if (!Number.isNaN(x1) && !Number.isNaN(y1) && !Number.isNaN(x2) && !Number.isNaN(y2)) {
                minX = Math.min(minX, x1, x2);
                maxX = Math.max(maxX, x1, x2);
                minY = Math.min(minY, y1, y2);
                maxY = Math.max(maxY, y1, y2);
            }

            // Handle text elements (approximate)
            if (el.tagName === 'text' || el.tagName === 'tspan') {
                const textX = parseFloat(el.getAttribute('x')) || x;
                const textY = parseFloat(el.getAttribute('y')) || y;
                if (!Number.isNaN(textX) && !Number.isNaN(textY)) {
                    minX = Math.min(minX, textX);
                    minY = Math.min(minY, textY - 10);
                    maxX = Math.max(maxX, textX + 100);
                    maxY = Math.max(maxY, textY + 10);
                }
            }

            // Recurse into children
            for (const child of el.children || []) {
                traverse(child);
            }
        };

        traverse(target);

        return (Number.isFinite(minX) && Number.isFinite(maxX) && Number.isFinite(minY) && Number.isFinite(maxY))
            ? { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
            : null;
    }

    /**
     * Update canvas size based on DOM bounding box (Synchronous)
     * Performs immediate measurement. Use this during imperative generation flows.
     * Gracefully handles environments where getBBox is unavailable (e.g., jsdom).
     *
     * When no groupElement is provided, iterates ALL direct SVG children and computes
     * the union bounding box in SVG ROOT coordinates (applying each child's translate
     * transform). This correctly captures legend and bias-table groups that are siblings
     * of the main chart group rather than children of it.
     *
     * @param {SVGElement} groupElement - Optional specific group to measure (local coords)
     * @returns {CanvasSizer} this for chaining
     */
    updateFromDOMSync(groupElement = null) {
        try {
            let bbox = null;

            if (groupElement) {
                // Caller supplied a specific element — measure in its local coordinate space
                try {
                    if (typeof groupElement.getBBox === 'function') {
                        bbox = groupElement.getBBox();
                    }
                } catch {}
                if (!bbox) bbox = this._calculateBoundsFromElements(groupElement);
            } else {
                // No specific element: union ALL direct SVG children in SVG root coordinates.
                // Each child's getBBox() returns local coords; we apply its translate() to get
                // SVG-space coords so legend/bias-table groups (siblings, not children of chart g)
                // are included in the measurement.
                let xMin = Infinity, xMax = -Infinity;
                let yMin = Infinity, yMax = -Infinity;
                let found = false;

                for (const child of this.svgRoot.children) {
                    if (child.tagName === 'defs' || child.tagName === 'style' || child.tagName === 'filter') continue;
                    try {
                        if (typeof child.getBBox !== 'function') continue;
                        const localBbox = child.getBBox();
                        if (!localBbox || (localBbox.width === 0 && localBbox.height === 0)) continue;

                        // Parse translate(tx, ty) from this child's transform attribute
                        let tx = 0, ty = 0;
                        const transformAttr = child.getAttribute('transform') || '';
                        const tm = transformAttr.match(/translate\(\s*([-\d.]+)(?:[,\s]+([-\d.]+))?\s*\)/);
                        if (tm) {
                            tx = parseFloat(tm[1]) || 0;
                            ty = parseFloat(tm[2] || '0') || 0;
                        }

                        xMin = Math.min(xMin, localBbox.x + tx);
                        xMax = Math.max(xMax, localBbox.x + localBbox.width + tx);
                        yMin = Math.min(yMin, localBbox.y + ty);
                        yMax = Math.max(yMax, localBbox.y + localBbox.height + ty);
                        found = true;
                    } catch {}
                }

                if (found && isFinite(xMin)) {
                    bbox = { x: xMin, y: yMin, width: xMax - xMin, height: yMax - yMin };
                } else {
                    // Fallback: first group in local coords (original behaviour)
                    const firstGroup = this.svgRoot.querySelector('g');
                    if (firstGroup) {
                        try { bbox = firstGroup.getBBox(); } catch {}
                        if (!bbox) bbox = this._calculateBoundsFromElements(firstGroup);
                    }
                }
            }

            if (!bbox || (bbox.width === 0 && bbox.height === 0)) {
                console.warn('[CanvasSizer] Invalid bounding box from DOM');
                return this;
            }

            this.lastExtents = {
                xMin: bbox.x,
                xMax: bbox.x + bbox.width,
                yMin: bbox.y,
                yMax: bbox.y + bbox.height,
                source: 'dom'
            };

        } catch (error) {
            console.error('[CanvasSizer] Synchronous DOM measurement failed:', error);
        }

        return this;
    }

    /**
     * Calculate required dimensions and apply to SVG
     * Call this after updating extents to resize the canvas
     * 
     * @returns {Object} Applied dimensions {width, height, viewBox, exportWidth, exportHeight}
     */
    ensureFit() {
        if (!this.lastExtents) {
            console.warn('[CanvasSizer] No extents available, cannot resize');
            return this._getCurrentDimensions();
        }

        const required = this._calculateRequiredDimensions();
        const clamped = this._clampDimensions(required);

        if (this.config.expandMode === 'expand') {
            this._applyExpandMode(clamped);
        } else {
            this._applyScaleMode(clamped);
        }

        this.lastAppliedDims = clamped;

        return {
            width: clamped.width,
            height: clamped.height,
            viewBox: this.svgRoot.getAttribute('viewBox'),
            exportWidth: Math.round(clamped.width * this.config.dpiMultiplier),
            exportHeight: Math.round(clamped.height * this.config.dpiMultiplier)
        };
    }

    /**
     * Get current SVG dimensions without modifying
     * @returns {Object} Current dimensions {width, height, viewBox}
     */
    getDimensions() {
        return this._getCurrentDimensions();
    }

    /**
     * Set DPI multiplier for export calculations
     * @param {number} multiplier - DPI multiplier (1 = 96 DPI, 2 = 192 DPI, etc.)
     */
    /**
     * Set DPI multiplier for export calculations
     * @param {number} multiplier - DPI multiplier (1 = 96 DPI, 2 = 192 DPI, etc.)
     */
    setDPIMultiplier(multiplier) {
        if (multiplier > 0 && multiplier <= 4) {
            this.config.dpiMultiplier = multiplier;
        }
        return this;
    }

    /**
     * Update margins dynamically
     * @param {Object} margins - New margins {top, right, bottom, left}
     * @returns {CanvasSizer} this for chaining
     */
    setMargins(margins) {
        if (margins) {
            this.config.margins = { ...this.config.margins, ...margins };
            this._scheduleUpdate();
        }
        return this;
    }

    /**
     * Enable DOM mutation observer for automatic updates
     * Use sparingly - prefer explicit updateFromData calls
     */
    enableMutationObserver() {
        if (this.mutationObserver) {
            return; // Already enabled
        }

        this.mutationObserver = new MutationObserver(() => {
            this._scheduleUpdate();
        });

        this.mutationObserver.observe(this.svgRoot, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['transform', 'x', 'y', 'width', 'height']
        });
    }

    /**
     * Disable DOM mutation observer
     */
    disableMutationObserver() {
        if (this.mutationObserver) {
            this.mutationObserver.disconnect();
            this.mutationObserver = null;
        }
    }

    /**
     * Clean up resources and observers
     */
    teardown() {
        this.disableMutationObserver();

        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
            this.debounceTimer = null;
        }

        if (this.resizeObserver) {
            this.resizeObserver.disconnect();
            this.resizeObserver = null;
        }

        this.svgRoot = null;
        this.lastExtents = null;
        this.lastAppliedDims = null;
    }

    /**
     * PRIVATE: Schedule a debounced update
     */
    _scheduleUpdate() {
        if (this.config.debounceMs <= 0) {
            this.ensureFit();
            return;
        }

        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
        }

        this.debounceTimer = setTimeout(() => {
            this.ensureFit();
            this.debounceTimer = null;
        }, this.config.debounceMs);
    }

    /**
     * PRIVATE: Calculate required dimensions based on extents and margins
     * @returns {Object} Required dimensions {width, height, contentWidth, contentHeight}
     */
    _calculateRequiredDimensions() {
        const { margins, minPadding } = this.config;
        const { xMin, xMax, yMin, yMax } = this.lastExtents;

        // Content dimensions (extent range + padding)
        const contentWidth = (xMax - xMin) + (minPadding * 2);
        const contentHeight = (yMax - yMin) + (minPadding * 2);

        // Total dimensions including margins on both sides
        const widthFromSpan = contentWidth + margins.left + margins.right;
        const heightFromSpan = contentHeight + margins.top + margins.bottom;

        // Also ensure the SVG is wide/tall enough to contain content at its absolute
        // SVG-space maximum (critical when extents are measured in SVG root coordinates
        // and xMin/yMin are non-zero, e.g. chart group translated by its margins).
        const widthFromAbsMax = xMax + margins.right + minPadding;
        const heightFromAbsMax = yMax + margins.bottom + minPadding;

        const width = Math.max(widthFromSpan, widthFromAbsMax);
        const height = Math.max(heightFromSpan, heightFromAbsMax);

        return { width, height, contentWidth, contentHeight };
    }

    /**
     * PRIVATE: Clamp dimensions to min/max constraints
     * @param {Object} dims - Dimensions to clamp
     * @returns {Object} Clamped dimensions
     */
    _clampDimensions(dims) {
        const { minWidth, minHeight, maxWidth, maxHeight } = this.config;

        let width = Math.max(minWidth, Math.min(maxWidth, dims.width));
        let height = Math.max(minHeight, Math.min(maxHeight, dims.height));

        // Log warnings if we hit limits
        if (dims.width > maxWidth) {
            console.warn(`[CanvasSizer] Width ${dims.width} exceeds maximum ${maxWidth}, clamping`);
        }
        if (dims.height > maxHeight) {
            console.warn(`[CanvasSizer] Height ${dims.height} exceeds maximum ${maxHeight}, clamping`);
        }

        return { width, height, contentWidth: dims.contentWidth, contentHeight: dims.contentHeight };
    }

    /**
     * PRIVATE: Apply expand mode - increase SVG dimensions to fit content
     * @param {Object} dims - Dimensions to apply
     */
    _applyExpandMode(dims) {
        this.svgRoot.setAttribute('width', dims.width);
        this.svgRoot.setAttribute('height', dims.height);

        // Set viewBox to match pixel dimensions for 1:1 coordinate mapping
        this.svgRoot.setAttribute('viewBox', `0 0 ${dims.width} ${dims.height}`);
    }

    /**
     * PRIVATE: Apply scale mode - adjust viewBox to fit content within fixed dimensions
     * @param {Object} dims - Dimensions to apply
     */
    _applyScaleMode(dims) {
        const { margins } = this.config;
        const { xMin, xMax, yMin, yMax } = this.lastExtents;

        // Keep SVG dimensions fixed (use current or minimum)
        const currentDims = this._getCurrentDimensions();
        const width = currentDims.width || dims.width;
        const height = currentDims.height || dims.height;

        this.svgRoot.setAttribute('width', width);
        this.svgRoot.setAttribute('height', height);

        // Adjust viewBox to encompass all content
        const viewBoxX = xMin - margins.left;
        const viewBoxY = yMin - margins.top;
        const viewBoxWidth = (xMax - xMin) + margins.left + margins.right;
        const viewBoxHeight = (yMax - yMin) + margins.top + margins.bottom;

        this.svgRoot.setAttribute('viewBox', `${viewBoxX} ${viewBoxY} ${viewBoxWidth} ${viewBoxHeight}`);
    }

    /**
     * PRIVATE: Get current SVG dimensions
     * @returns {Object} Current dimensions {width, height, viewBox}
     */
    _getCurrentDimensions() {
        const width = parseInt(this.svgRoot.getAttribute('width')) || this.config.minWidth;
        const height = parseInt(this.svgRoot.getAttribute('height')) || this.config.minHeight;
        const viewBox = this.svgRoot.getAttribute('viewBox') || `0 0 ${width} ${height}`;

        return { width, height, viewBox };
    }
}
