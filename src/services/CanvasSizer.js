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
        expandMode: 'expand', // 'expand' or 'scale'
        dpiMultiplier: 1,
        debounceMs: 100
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
        if (!extents || typeof extents.xMin !== 'number' || typeof extents.xMax !== 'number' ||
            typeof extents.yMin !== 'number' || typeof extents.yMax !== 'number') {
            console.warn('[CanvasSizer] Invalid extents provided to updateFromData');
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
     * Update canvas size based on DOM bounding box (Synchronous)
     * Performs immediate measurement. Use this during imperative generation flows.
     * 
     * @param {SVGElement} groupElement - Optional group to measure
     * @returns {CanvasSizer} this for chaining
     */
    updateFromDOMSync(groupElement = null) {
        try {
            // Target the main content group or specified group
            const target = groupElement || this.svgRoot.querySelector('g');

            if (!target) {
                console.warn('[CanvasSizer] No group element found for DOM measurement');
                return this;
            }

            const bbox = target.getBBox();

            if (!bbox || bbox.width === 0 || bbox.height === 0) {
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

        // Total dimensions including margins
        const width = contentWidth + margins.left + margins.right;
        const height = contentHeight + margins.top + margins.bottom;

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
