/**
 * @fileoverview Base abstract class for all chart renderers.
 * Provides common functionality and interface for specialized chart rendering implementations.
 *
 * @author Harison Sharp
 * @since 0.3.0
 *
 * @module Base Chart Renderer
 * @type {Abstract Class}
 *
 * @exports BaseChartRenderer - Abstract base class for chart renderers
 *
 * @example
 * class MyChartRenderer extends BaseChartRenderer {
 *     render(g, data, scales, config) {
 *         this.validateRenderParams(g, data, scales);
 *         // Implement specific rendering logic
 *     }
 * }
 *
 * @relatedFiles ScatterChartRenderer, LineChartRenderer, BarChartRenderer, HistogramRenderer
 */

import { DataValidator } from '../../core/validation/DataValidator.js';
import { ScaleFactory } from '../ScaleFactory.js';
import { debugWarn } from '../../utils/debug.js';
import { parseNumber } from '../../utils/dataUtils.js';
import { parseColumnId } from '../../utils/columnUtils.js';
import { HoverTableRenderer } from '../HoverTableRenderer.js';
import { SymbolFactory } from '../../utils/SymbolFactory.js';

export class BaseChartRenderer {
    static HOVER_MODAL_CLASS = HoverTableRenderer.HOVER_MODAL_CLASS;

    // When a point is hovered, every other point is repainted with this flat, fully-opaque
    // neutral colour rather than being made transparent. Transparency would stack where many
    // points overlap (a dense cluster of faded dots still reads as solid), whereas overlapping
    // opaque grey dots all composite to the same grey — so the dimming looks identical
    // regardless of how many points pile up. The hovered point keeps its real colour/opacity.
    static HOVER_DIM_COLOR = '#dde3ea';

    // Class for the throwaway overlay copy of the hovered point. We draw a clone on top of
    // everything rather than physically re-ordering the real point in the DOM — moving the
    // hovered node disrupts the browser's pointer tracking (causing stuck/lingering hovers)
    // and would need order-restoration bookkeeping. The clone is non-interactive and simply
    // removed on mouse-leave, so the real points never move.
    static POINT_HIGHLIGHT_CLASS = 'dot-highlight';

    constructor() {
        this.hoverTableRenderer = new HoverTableRenderer();
    }

    /**
     * Get renderer type identifier
     * @returns {string} Chart type
     */
    getType() {
        throw new Error('getType() must be implemented by subclass');
    }

    /**
     * Validate data for rendering
     * @param {Array<Object>} data - Data to validate
     * @throws {Error} If data is invalid
     * @returns {boolean} True if valid
     */
    validateData(data) {
        DataValidator.validateCSVData(data);
        DataValidator.validateSufficientData(data, 1);
        return true;
    }

    /**
     * Filter data to include only valid numeric points
     * @param {Array<Object>} data - Source data
     * @param {Object} xAxisInfo - X-axis column info
     * @param {Object} yAxisInfo - Y-axis column info
     * @returns {Array<Object>} Filtered valid data
     */
    filterValidData(data, xAxisInfo, yAxisInfo) {
        return data.filter(d => {
            // File-qualified series should only consume rows from the matching source file.
            // Keep rows without _sourceFile for backward compatibility with older datasets.
            if (yAxisInfo.fileName && d._sourceFile && d._sourceFile !== yAxisInfo.fileName) {
                return false;
            }

            const xValue = d[xAxisInfo.columnName];
            const yValue = d[yAxisInfo.columnName];

            // X-axis must always be valid
            const xValid = xValue !== undefined &&
                xValue !== null &&
                xValue !== '' &&
                !isNaN(parseNumber(xValue)) &&
                isFinite(parseNumber(xValue));

            if (!xValid) return false;

            // Y-axis validation - be lenient for bar charts
            // Allow undefined/null/empty values which will be handled by the renderer
            if (yValue === undefined || yValue === null || yValue === '') {
                return false; // Still filter out completely missing Y values for single series
            }

            return !isNaN(parseNumber(yValue)) && isFinite(parseNumber(yValue));
        });
    }

    /**
     * Validate render parameters
     * @param {d3.Selection} g - D3 group selection
     * @param {Array<Object>} data - Data to render
     * @param {Object} scales - Scale objects {xScale, yScale}
     * @throws {Error} If parameters are invalid
     * @returns {boolean} True if valid
     */
    validateRenderParams(g, data, scales) {
        if (!g) {
            throw new Error('SVG group element is required');
        }

        this.validateData(data);

        if (!scales || !scales.xScale || !scales.yScale) {
            throw new Error('Both xScale and yScale are required');
        }

        return true;
    }

    /**
     * Get default color for the chart
     * @returns {string} Default color
     */
    getDefaultColor() {
        return 'steelblue';
    }

    /**
     * Determine fill color for a data point
     * @param {Object} dataPoint - Individual data point
     * @param {d3.Scale} colorScale - Color scale (optional)
     * @param {Object} colorInfo - Color column info (optional)
     * @param {Object} config - Graph configuration
     * @param {string} fallbackColor - Fallback color if no scale
     * @returns {string} Color value
     */
    getPointColor(dataPoint, colorScale, colorInfo, config, fallbackColor) {
        // Per-series color grading takes priority
        if (colorScale && colorInfo?.columnName) {
            const value = dataPoint[colorInfo.columnName];
            // Missing color value → explicit neutral "(none)" color, not the series default,
            // so absent-value points are visibly distinct in the plot.
            if (value === undefined || value === null || value === '') {
                return SymbolFactory.MISSING_COLOR;
            }
            return colorScale(value);
        }
        const series = config.series.filter(s => s.yAxis.split('::')[1] === dataPoint._sourceFile && Array.from(Object.keys(dataPoint)).includes(s.yAxis.split('::')[0]));
        if (series.length === 0) {
            debugWarn('[BASE_CHART_RENDERER - getPointColor] No series found for data point when getting color', dataPoint);
            return fallbackColor || this.getDefaultColor();
        }
        // FIXME: why just series[0]?
        return ScaleFactory.resolveColor(series[0].color) || fallbackColor || this.getDefaultColor();
    }

    /**
     * Ensure a shared hover modal exists for the current graph container.
     * @param {d3.Selection} g - D3 group selection for the current chart render
     * @returns {{ modal: HTMLDivElement|null, host: HTMLElement|null }}
     */
    ensureHoverModal(g) {
        return this.hoverTableRenderer.ensureHoverModal(g);
    }

    clearHoverHideTimer(modal) {
        this.hoverTableRenderer.clearHideTimer(modal);
    }

    cancelPointHoverHide(g) {
        this.hoverTableRenderer.cancelHide(g);
    }

    schedulePointHoverHide(g, delayMs = 450) {
        this.hoverTableRenderer.scheduleHide(g, delayMs);
    }

    showPointHoverModal(g, event, pointData, context = {}) {
        this.hoverTableRenderer.show(g, event, pointData, context);
    }

    updatePointHoverModalPosition(g, event) {
        this.hoverTableRenderer.updatePosition(g, event);
    }

    hidePointHoverModal(g) {
        this.hoverTableRenderer.hide(g);
    }

    /**
     * Resolve the SVG root that owns the current chart group. All point highlighting is
     * scoped to this root so charts rendered into separate SVGs (e.g. popups) don't dim
     * each other's points.
     * @param {d3.Selection} g - D3 group selection for the current chart render
     * @returns {SVGSVGElement|null}
     */
    getHostSvg(g) {
        return g?.node?.()?.ownerSVGElement ?? null;
    }

    /**
     * Read a point's stored base opacity (set at render time), falling back to fully opaque.
     * @param {Element} el - The point element
     * @returns {number}
     */
    getPointBaseOpacity(el) {
        const base = parseFloat(el.getAttribute('data-base-opacity'));
        return Number.isFinite(base) ? base : 1;
    }

    /**
     * Restore a single point to its rendered appearance (base fill + base opacity).
     * @param {Element} el - The point element
     */
    restorePointAppearance(el) {
        el.style.fill = el.getAttribute('data-base-fill') || el.style.fill;
        el.style.opacity = this.getPointBaseOpacity(el);
    }

    /**
     * Remove any existing highlight clones from the SVG.
     * @param {SVGSVGElement} svg - Host SVG root
     */
    removePointHighlightClones(svg) {
        svg.querySelectorAll(`.${BaseChartRenderer.POINT_HIGHLIGHT_CLASS}`)
            .forEach((clone) => clone.remove());
    }

    /**
     * Emphasize a single hovered point. Every real point (including the hovered one) is
     * greyed out with a flat, fully-opaque neutral colour so the dimming is consistent no
     * matter how densely points overlap (see HOVER_DIM_COLOR). A non-interactive clone of
     * the hovered point is then drawn on top in its real colour, so it both stands out and
     * is never occluded — without moving the real point (which would break pointer tracking).
     * @param {d3.Selection} g - D3 group selection for the current chart render
     * @param {Element} target - The hovered point element
     */
    highlightPoint(g, target) {
        const svg = this.getHostSvg(g);
        if (!svg) {
            return;
        }

        svg.querySelectorAll('.dot').forEach((el) => {
            el.style.fill = BaseChartRenderer.HOVER_DIM_COLOR;
            el.style.opacity = 1;
        });

        // Draw a colour copy of the hovered point on top. Appending into the point's own
        // parent keeps it in the same coordinate space (the transform attribute matches),
        // and as the last sibling it paints above every other point.
        this.removePointHighlightClones(svg);
        const clone = target.cloneNode(true);
        clone.classList.remove('dot');
        clone.classList.add(BaseChartRenderer.POINT_HIGHLIGHT_CLASS);
        clone.style.pointerEvents = 'none'; // never steal hover from the real point
        clone.style.fill = target.getAttribute('data-base-fill') || target.style.fill;
        clone.style.opacity = this.getPointBaseOpacity(target);
        target.parentNode?.appendChild(clone);
    }

    /**
     * Restore every point to its base fill/opacity and remove the highlight clone,
     * undoing highlightPoint(). The real points never moved, so order is preserved.
     * @param {d3.Selection} g - D3 group selection for the current chart render
     */
    clearPointHighlight(g) {
        const svg = this.getHostSvg(g);
        if (!svg) {
            return;
        }

        this.removePointHighlightClones(svg);
        svg.querySelectorAll('.dot').forEach((el) => this.restorePointAppearance(el));
    }

    getPdfLinkingConfig(config = {}) {
        const pdfLinking = config?.pdfLinking;
        return {
            enabled: Boolean(pdfLinking?.enabled),
            folderPath: typeof pdfLinking?.folderPath === 'string' ? pdfLinking.folderPath.trim() : '',
            nameField: typeof pdfLinking?.nameField === 'string' ? pdfLinking.nameField.trim() : '',
            fileType: (pdfLinking?.fileType === 'json' ? 'json' : 'pdf')
        };
    }

    getPointFieldValue(pointData, fieldId) {
        if (!pointData || !fieldId) {
            return null;
        }

        const { columnName } = parseColumnId(fieldId);
        const targetField = columnName || fieldId;

        if (pointData[targetField] !== undefined && pointData[targetField] !== null && pointData[targetField] !== '') {
            return pointData[targetField];
        }

        const informative = pointData.__informative;
        if (informative && typeof informative === 'object' &&
            informative[targetField] !== undefined && informative[targetField] !== null && informative[targetField] !== '') {
            return informative[targetField];
        }

        return null;
    }

    buildResourceTarget(folderPath, baseFileName, fileType = 'pdf') {
        if (!folderPath || !baseFileName || !fileType) {
            return null;
        }

        const escapedExt = fileType.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const extRegex = new RegExp(`\\.${escapedExt}$`, 'i');
        const normalizedBase = String(baseFileName).trim().replace(extRegex, '');
        if (!normalizedBase) {
            return null;
        }

        const fileName = `${normalizedBase}.${fileType}`;
        const isHttp = /^https?:\/\//i.test(folderPath);
        if (isHttp) {
            const cleanFolder = folderPath.replace(/\/+$/, '');
            return {
                isLocalPath: false,
                openTarget: `${cleanFolder}/${encodeURIComponent(fileName)}`,
                fallbackUrl: `${cleanFolder}/${encodeURIComponent(fileName)}`
            };
        }

        const normalizedFolder = folderPath.replace(/[\\/]+$/, '');
        const separator = normalizedFolder.includes('\\') ? '\\' : '/';
        const fullPath = `${normalizedFolder}${separator}${fileName}`;
        const uriReadyPath = fullPath.replace(/\\/g, '/');
        const fallbackUrl = /^[A-Za-z]:\//.test(uriReadyPath)
            ? `file:///${encodeURI(uriReadyPath)}`
            : `file://${encodeURI(uriReadyPath)}`;

        return {
            isLocalPath: true,
            openTarget: fullPath,
            fallbackUrl
        };
    }

    async openLinkedResourceForPoint(pointData, config = {}) {
        const { enabled, folderPath, nameField, fileType } = this.getPdfLinkingConfig(config);
        if (!enabled || !folderPath || !nameField) {
            return false;
        }

        const rawFileName = this.getPointFieldValue(pointData, nameField);
        if (rawFileName === null) {
            return false;
        }

        const target = this.buildResourceTarget(folderPath, rawFileName, fileType);
        if (!target) {
            return false;
        }

        try {
            const openerPlugin = await import('@tauri-apps/plugin-opener');
            if (target.isLocalPath && typeof openerPlugin?.openPath === 'function') {
                await openerPlugin.openPath(target.openTarget);
                return true;
            }
            if (!target.isLocalPath && typeof openerPlugin?.openUrl === 'function') {
                await openerPlugin.openUrl(target.openTarget);
                return true;
            }
        } catch (error) {
            debugWarn('[BaseChartRenderer.openLinkedResourceForPoint] Failed to open with Tauri opener plugin', error);
            if (target.isLocalPath) {
                // Never attempt file:// navigation in webview for local files; it is blocked by Tauri.
                return false;
            }
        }

        const opener = globalThis?.window?.open;
        if (typeof opener !== 'function') {
            debugWarn('[BaseChartRenderer.openLinkedResourceForPoint] window.open is unavailable in this runtime');
            return false;
        }

        const openedWindow = opener(target.fallbackUrl, '_blank', 'noopener,noreferrer');
        if (openedWindow && typeof openedWindow === 'object') {
            openedWindow.opener = null;
        }
        return true;
    }

    /**
     * Main render method - must be implemented by subclasses
     * @param {d3.Selection} g - D3 group selection for drawing
     * @param {Array<Object>} data - Data to render
     * @param {Object} scales - Scale objects {xScale, yScale}
     * @param {Object} xAxisInfo - X-axis column information
     * @param {Object} yAxisInfo - Y-axis column information
     * @param {Object} config - Rendering configuration
     * @param {d3.Scale} colorScale - Optional color scale
     * @param {Object} colorInfo - Optional color column info
     * @param {string} seriesColor - Optional series color
     * @param {Object} seriesConfig - Optional series configuration (points, curve type, etc.)
     * @throws {Error} If not implemented by subclass
     */
    render(g, data, scales, xAxisInfo, yAxisInfo, config, colorScale = null, colorInfo = null, seriesColor = null, seriesConfig = {}) {
        throw new Error('render() must be implemented by subclass');
    }

    /**
     * Clean up any resources (optional override)
     */
    dispose() {
        // Override if cleanup needed
    }

    /**
     * Get recommended minimum data points for this chart type
     * @returns {number} Minimum recommended data points
     */
    getMinimumDataPoints() {
        return 1;
    }

    /**
     * Check if this renderer supports the given configuration
     * @param {Object} config - Graph configuration
     * @returns {boolean} True if configuration is supported
     */
    supportsConfig(config) {
        return true; // Override if specific requirements
    }

    /**
     * Calculate data extents for canvas sizing (fast path)
     * Override this method in subclasses to provide accurate extent calculation
     * 
     * @param {Array<Object>} data - Data to analyze
     * @param {Object} scales - Scale objects {xScale, yScale}
     * @param {Object} xAxisInfo - X-axis column information
     * @param {Object} yAxisInfo - Y-axis column information
     * @param {Object} options - Renderer-specific options (radius, strokeWidth, etc.)
     * @returns {Object} Extents {xMin, xMax, yMin, yMax, radius, strokeWidth, labelPadding}
     */
    calculateExtents(data, scales, xAxisInfo, yAxisInfo, options = {}) {
        if (!data || data.length === 0) {
            return null;
        }

        const validData = this.filterValidData(data, xAxisInfo, yAxisInfo);
        if (validData.length === 0) {
            return null;
        }

        const { xScale, yScale } = scales;

        // Calculate x positions (handle both band and linear scales)
        const xPositions = validData.map(d => {
            const xValue = d[xAxisInfo.columnName];
            if (typeof xScale.bandwidth === 'function') {
                // Band scale - center of band
                return xScale(xValue) + xScale.bandwidth() / 2;
            } else {
                // Linear scale
                return xScale(parseNumber(xValue));
            }
        });

        // Calculate y positions
        const yPositions = validData.map(d => yScale(parseNumber(d[yAxisInfo.columnName])));

        return {
            xMin: Math.min(...xPositions),
            xMax: Math.max(...xPositions),
            yMin: Math.min(...yPositions),
            yMax: Math.max(...yPositions),
            radius: options.radius || 0,
            strokeWidth: options.strokeWidth || 0,
            labelPadding: options.labelPadding || 0
        };
    }
}
