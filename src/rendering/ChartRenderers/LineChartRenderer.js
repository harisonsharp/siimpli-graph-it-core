/**
 * @fileoverview Line chart renderer for D3 visualizations.
 * Renders data as connected line segments, sorting data by x-value.
 *
 * @author Harison Sharp
 * @since 0.3.0
 *
 * @module Line Chart Renderer
 * @type {Class}
 *
 * @requires d3 - Data visualization library
 * @requires BaseChartRenderer - Abstract base class
 *
 * @exports LineChartRenderer - Line chart rendering implementation
 *
 * @example
 * const renderer = new LineChartRenderer({ strokeWidth: 3, smooth: false });
 * renderer.render(g, data, scales, xAxisInfo, yAxisInfo, config, null, null, 'blue');
 *
 * @relatedFiles BaseChartRenderer, GraphService
 */

import * as d3 from 'd3';
import { BaseChartRenderer } from './BaseChartRenderer.js';
import { ScaleFactory } from '../ScaleFactory.js';
import { debugLog, debugWarn } from '../../utils/debug.js';
import { parseNumber } from '../../utils/dataUtils.js';

export class LineChartRenderer extends BaseChartRenderer {
    /** Body size of an on-line side label, in px. */
    static SIDE_LABEL_FONT_PX = 11;
    /** Clearance between the line and the nearer edge of a side label, in px. Set by eye
     *  against a rendered chart: any tighter and the two labels read as one two-line block
     *  sitting on the line rather than as one statement each side of it. */
    static SIDE_LABEL_GAP_PX = 11;
    /** Half-width of the chord a side label takes its angle from, as a fraction of the
     *  line's x extent. Wide enough that a rolling median's own steps don't tilt the text,
     *  narrow enough that the text still follows a curving line. */
    static SIDE_LABEL_SLOPE_WINDOW = 0.06;

    /**
     * Create a line chart renderer
     * @param {Object} options - Rendering options
     * @param {number} options.strokeWidth - Line width (default: 3)
     * @param {boolean} options.smooth - Use curve interpolation (default: false)
     * @param {string} options.curveType - D3 curve type if smooth (default: 'curveMonotoneX')
     */
    constructor(options = {}) {
        super();
        this.strokeWidth = options.strokeWidth || 2;
        this.smooth = options.smooth || false;
        this.curveType = options.curveType || 'curveMonotoneX';
    }

    /**
     * Get renderer type
     * @returns {string} 'line'
     */
    getType() {
        return 'line';
    }

    /**
     * Get minimum data points for line chart
     * @returns {number} 2 points minimum
     */
    getMinimumDataPoints() {
        return 2;
    }

    /**
     * Render line chart
     * @param {d3.Selection} g - D3 group selection
     * @param {Array<Object>} data - Data to render
     * @param {Object} scales - {xScale, yScale}
     * @param {Object} xAxisInfo - X-axis column info
     * @param {Object} yAxisInfo - Y-axis column info
     * @param {Object} config - Graph configuration
     * @param {d3.Scale} colorScale - Optional color scale (not typically used for lines)
     * @param {Object} colorInfo - Optional color column info
     * @param {string} seriesColor - Line color
     * @param {Object} [seriesConfig] - This series' own config.
     * @param {boolean|Object} [seriesConfig.endMarkers] - Draw a hollow dot at each end of
     *   the line, marking where its own data starts and stops (see {@link drawEndMarkers}).
     * @param {{above?: string, below?: string, at?: number}} [seriesConfig.sideLabels] -
     *   What falling above / below this line MEANS, written along the line itself (see
     *   {@link drawSideLabels}). For reference lines a reader measures their own value
     *   against, where a legend swatch cannot carry the reading.
     */
    render(g, data, scales, xAxisInfo, yAxisInfo, config, colorScale = null, colorInfo = null, seriesColor = null, seriesConfig = {}) {
        this.validateRenderParams(g, data, scales);
        const { xScale, yScale } = scales;
        const validData = this.filterValidData(data, xAxisInfo, yAxisInfo);
        if (validData.length < this.getMinimumDataPoints()) {
            console.warn(`Insufficient data points for line chart: need at least ${this.getMinimumDataPoints()}, got ${validData.length}`);
            return;
        }

        // Sort data by x-value for proper line connection
        // Sort data by x-value for proper line connection
        const sortedData = validData.sort((a, b) => {
            const aVal = a[xAxisInfo.columnName];
            const bVal = b[xAxisInfo.columnName];

            // Try numeric comparison first (handles numbers and dates via updated parseNumber)
            const aNum = parseNumber(aVal);
            const bNum = parseNumber(bVal);

            if (!isNaN(aNum) && !isNaN(bNum)) {
                return aNum - bNum;
            }

            // Fallback to string comparison for purely categorical data
            return String(aVal).localeCompare(String(bVal));
        });

        // Handle both band and linear scales for x-axis
        const getXPosition = (d) => {
            const xValue = d[xAxisInfo.columnName];
            if (typeof xScale.bandwidth === 'function') {
                // Band scale - position at center of band
                return xScale(xValue) + xScale.bandwidth() / 2;
            } else {
                // Linear scale - pre-transform to log space if logX is active
                const raw = parseNumber(xValue);
                const mapped = config?.logX ? Math.log10(raw) : raw;
                return xScale(mapped);
            }
        };

        // Determine curve type from series config or default
        const curveType = seriesConfig.curveType || this.curveType || 'curveMonotoneX';

        const getYPosition = (d) => {
            const raw = parseNumber(d[yAxisInfo.columnName]);
            return yScale(config?.logY ? Math.log10(raw) : raw);
        };

        // Create line generator
        const lineGenerator = d3.line()
            .x(getXPosition)
            .y(getYPosition);

        // Apply curve interpolation
        if (d3[curveType]) {
            lineGenerator.curve(d3[curveType]);
        } else {
            console.warn(`Invalid curve type: ${curveType}, falling back to linear`);
            lineGenerator.curve(d3.curveLinear);
        }

        // Determine line style (dash array)
        let strokeDashArray = 'none';
        const lineStyle = seriesConfig.lineStyle || 'solid';
        if (lineStyle === 'dashed') strokeDashArray = '10,5';
        else if (lineStyle === 'dotted') strokeDashArray = '2,4';
        else if (lineStyle === 'dash-dot') strokeDashArray = '10,5,2,5';

        const finalColor = ScaleFactory.resolveColor(seriesConfig.color || seriesColor) || this.getDefaultColor();
        const finalStrokeWidth = seriesConfig.strokeWidth || this.strokeWidth;

        const hasColorGrading = colorScale && colorInfo?.columnName;
        const gradColName = colorInfo?.columnName;

        if (!hasColorGrading) {
            // Standard path: single SVG path with full curve interpolation
            g.append('path')
                .datum(sortedData)
                .attr('class', 'line-chart')
                .attr('fill', 'none')
                .attr('stroke', finalColor)
                .attr('stroke-width', finalStrokeWidth)
                .attr('stroke-linejoin', 'round')
                .attr('stroke-linecap', 'round')
                .attr('stroke-dasharray', strokeDashArray)
                .attr('d', lineGenerator);
        } else {
            // Graded path: N-1 individual line segments, each coloured by midpoint grading value.
            // Curve interpolation is not applied — segments are straight lines between sorted points.
            const segGroup = g.append('g').attr('class', 'line-chart-graded');
            for (let i = 0; i < sortedData.length - 1; i++) {
                const p1 = sortedData[i];
                const p2 = sortedData[i + 1];
                const v1 = p1[gradColName];
                const v2 = p2[gradColName];
                let midVal;
                if (v1 !== undefined && v2 !== undefined && typeof v1 === 'number' && typeof v2 === 'number') {
                    midVal = (v1 + v2) / 2;
                } else {
                    midVal = v1 !== undefined ? v1 : v2;
                }
                const segColor = (midVal !== undefined && midVal !== null) ? colorScale(midVal) : finalColor;
                const y1raw = parseNumber(p1[yAxisInfo.columnName]);
                const y2raw = parseNumber(p2[yAxisInfo.columnName]);
                segGroup.append('line')
                    .attr('class', 'line-chart-segment')
                    .attr('x1', getXPosition(p1))
                    .attr('y1', yScale(config?.logY ? Math.log10(y1raw) : y1raw))
                    .attr('x2', getXPosition(p2))
                    .attr('y2', yScale(config?.logY ? Math.log10(y2raw) : y2raw))
                    .attr('stroke', segColor)
                    .attr('stroke-width', finalStrokeWidth)
                    .attr('stroke-linecap', 'round')
                    .attr('stroke-dasharray', strokeDashArray);
            }
        }

        // Draw points if enabled (per-point colour when grading is active)
        if (seriesConfig.showPoints) {
            const linePoints = g.selectAll('.line-point')
                .data(sortedData)
                .enter()
                .append('circle')
                .attr('class', 'line-point')
                .attr('cx', getXPosition)
                .attr('cy', d => {
                    const raw = parseNumber(d[yAxisInfo.columnName]);
                    return yScale(config?.logY ? Math.log10(raw) : raw);
                })
                .attr('r', (this.strokeWidth || 3) + 1)
                .attr('fill', d => {
                    if (!hasColorGrading) return finalColor;
                    const val = d[gradColName];
                    return (val !== undefined && val !== null) ? colorScale(val) : finalColor;
                })
                .attr('stroke', '#fff')
                .attr('stroke-width', 1);

            linePoints
                .on('mouseenter', (event, d) => {
                    this.cancelPointHoverHide(g);
                    this.showPointHoverModal(g, event, d, { seriesName: yAxisInfo.columnName, graphConfig: config });
                })
                .on('mousemove', () => {
                    this.cancelPointHoverHide(g);
                })
                .on('mouseleave', (event) => {
                    if (event.relatedTarget?.closest?.(`.${BaseChartRenderer.HOVER_MODAL_CLASS}`)) {
                        return;
                    }
                    this.schedulePointHoverHide(g, 500);
                })
                .on('click', (_event, d) => {
                    void this.openLinkedResourceForPoint(d, config);
                });
        }

        // Everything below is drawn ON the line rather than beside it, so it needs the
        // line in pixel space rather than in data space. Built once, shared by both.
        const pixels = sortedData
            .map(d => ({ x: getXPosition(d), y: getYPosition(d) }))
            .filter(p => Number.isFinite(p.x) && Number.isFinite(p.y));

        if (seriesConfig.endMarkers) this.drawEndMarkers(g, pixels, finalColor, seriesConfig.endMarkers);
        if (seriesConfig.sideLabels) this.drawSideLabels(g, pixels, finalColor, seriesConfig.sideLabels);
    }

    /**
     * Marks where this line's own data starts and stops, with a hollow dot at each end.
     *
     * A plotted line is only as good as the rows under it, and nothing about the stroke says
     * where those rows run out — which matters most on a chart that draws a second, fitted
     * line beside this one over a narrower span. Hollow rather than filled: on these charts a
     * filled dot already means "your value", so an end-stop has to read as a different kind
     * of mark.
     *
     * @param {d3.Selection} g - Group to draw into.
     * @param {Array<{x: number, y: number}>} pixels - The line's points in pixel space.
     * @param {string} color - The line's own colour; the marker is stroked in it.
     * @param {boolean|{radius?: number, strokeWidth?: number}} spec - `true` for the
     *   defaults, or an object overriding them.
     */
    drawEndMarkers(g, pixels, color, spec) {
        if (pixels.length === 0) return;
        const { radius = 4, strokeWidth = 2 } = (spec === true ? {} : (spec || {}));
        const ends = [pixels[0], pixels[pixels.length - 1]];

        const markers = g.append('g').attr('class', 'line-end-markers');
        for (const end of ends) {
            markers.append('circle')
                .attr('class', 'line-end-marker')
                .attr('cx', end.x)
                .attr('cy', end.y)
                .attr('r', radius)
                .attr('fill', '#fff')
                .attr('stroke', color)
                .attr('stroke-width', strokeWidth);
        }
    }

    /**
     * Writes what each SIDE of this line means, along the line itself.
     *
     * Some lines are a reference rather than a series: a reader's own point falls above or
     * below one, and the whole use of the chart is knowing what that means. That reading
     * cannot live in a legend swatch, and in a footer table it sits a long way from the
     * geometry it describes — so it goes here, one label each side, set at the line's own
     * angle and in the line's own colour so there is no doubt which line is being read.
     *
     * The angle comes from a CHORD across a window around the anchor, not from the two
     * points either side of it: a rolling-median line is locally bumpy, and a two-point
     * slope would tilt the text by whatever the last step happened to do.
     *
     * Rotation is applied about the anchor, so the perpendicular offsets that separate the
     * two labels are taken in the ROTATED frame — they stay perpendicular to the line
     * whatever its slope, instead of drifting onto it as the line steepens.
     *
     * Each label is drawn twice, a white-stroked copy under a filled one. `paint-order` would
     * say this in one element, but the headless PNG path renders through resvg, which does
     * not implement it — and unhaloed text over a dense scatter is unreadable.
     *
     * @param {d3.Selection} g - Group to draw into.
     * @param {Array<{x: number, y: number}>} pixels - The line's points in pixel space.
     * @param {string} color - The line's own colour.
     * @param {{above?: string, below?: string, at?: number}} spec - The two readings, and
     *   where along the line to put them as a fraction of its x extent (default 0.7).
     */
    drawSideLabels(g, pixels, color, spec) {
        if (pixels.length < 2) return;
        const { above, below, at = 0.7 } = spec || {};
        if (!above && !below) return;

        const first = pixels[0];
        const last = pixels[pixels.length - 1];
        const span = last.x - first.x;
        if (!Number.isFinite(span) || span === 0) return;

        const anchorX = first.x + span * Math.min(Math.max(at, 0), 1);

        // The chord: the widest pair inside a window around the anchor. A line whose points
        // are sparse enough that the window holds fewer than two of them has no chord to
        // take, so it falls back to the anchor's immediate neighbours.
        const halfWindow = Math.abs(span) * LineChartRenderer.SIDE_LABEL_SLOPE_WINDOW;
        const inWindow = pixels.filter(p => Math.abs(p.x - anchorX) <= halfWindow);
        let nearest = 0;
        for (let i = 1; i < pixels.length; i++) {
            if (Math.abs(pixels[i].x - anchorX) < Math.abs(pixels[nearest].x - anchorX)) nearest = i;
        }
        const spans = inWindow.length >= 2;
        const chordStart = spans ? inWindow[0] : pixels[Math.max(0, nearest - 1)];
        const chordEnd = spans ? inWindow[inWindow.length - 1] : pixels[Math.min(pixels.length - 1, nearest + 1)];

        const dx = chordEnd.x - chordStart.x;
        const dy = chordEnd.y - chordStart.y;
        const angle = (dx === 0 && dy === 0) ? 0 : Math.atan2(dy, dx) * 180 / Math.PI;

        // Sit the labels on the line, not on the nearest vertex to it.
        const anchorY = this.interpolateY(pixels, anchorX, nearest);

        const labels = g.append('g')
            .attr('class', 'line-side-labels')
            .attr('pointer-events', 'none');

        const place = (text, dyOffset) => {
            if (!text) return;
            const common = (sel) => sel
                .attr('transform', `translate(${anchorX}, ${anchorY}) rotate(${angle})`)
                .attr('y', dyOffset)
                .attr('text-anchor', 'middle')
                .style('font-family', 'sans-serif')
                .style('font-size', `${LineChartRenderer.SIDE_LABEL_FONT_PX}px`)
                .style('font-weight', 'bold')
                .text(text);

            common(labels.append('text').attr('class', 'line-side-label-halo'))
                .attr('fill', '#fff')
                .attr('stroke', '#fff')
                .attr('stroke-width', 3)
                .attr('stroke-linejoin', 'round');

            common(labels.append('text').attr('class', 'line-side-label'))
                .attr('fill', color);
        };

        place(above, -LineChartRenderer.SIDE_LABEL_GAP_PX);
        place(below, LineChartRenderer.SIDE_LABEL_GAP_PX + LineChartRenderer.SIDE_LABEL_FONT_PX);
    }

    /**
     * The line's own y at an x, by linear interpolation between the two points either side.
     *
     * @param {Array<{x: number, y: number}>} pixels - The line's points, sorted by x.
     * @param {number} x - Where to read it.
     * @param {number} nearest - Index of the closest point, already found by the caller.
     * @returns {number} The interpolated y, or the nearest point's y past either end.
     */
    interpolateY(pixels, x, nearest) {
        for (let i = 1; i < pixels.length; i++) {
            const prev = pixels[i - 1];
            const next = pixels[i];
            if (x < prev.x || x > next.x) continue;
            if (next.x === prev.x) return next.y;
            return prev.y + (next.y - prev.y) * ((x - prev.x) / (next.x - prev.x));
        }
        return pixels[nearest].y;
    }

    /**
     * Set line stroke width
     * @param {number} width - New stroke width
     */
    setStrokeWidth(width) {
        if (width > 0) {
            this.strokeWidth = width;
        }
    }

    /**
     * Enable or disable smooth curves
     * @param {boolean} smooth - Whether to use smooth curves
     */
    setSmooth(smooth) {
        this.smooth = smooth;
    }

    /**
     * Set curve type for smooth lines
     * @param {string} curveType - D3 curve type name
     */
    setCurveType(curveType) {
        if (d3[curveType]) {
            this.curveType = curveType;
        }
    }

    /**
     * Calculate extents for line chart with stroke width
     * @param {Array<Object>} data - Data to analyze
     * @param {Object} scales - Scale objects
     * @param {Object} xAxisInfo - X-axis info
     * @param {Object} yAxisInfo - Y-axis info
     * @returns {Object} Extents including stroke width
     */
    calculateExtents(data, scales, xAxisInfo, yAxisInfo) {
        return super.calculateExtents(data, scales, xAxisInfo, yAxisInfo, {
            strokeWidth: this.strokeWidth
        });
    }
}
