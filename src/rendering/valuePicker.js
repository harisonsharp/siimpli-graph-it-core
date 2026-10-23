/**
 * @fileoverview Click-to-pick for the legend table's values.
 *
 * The legend table shows each series' value at the most recent point. With the picker
 * attached, a click on the plot reads the values at the clicked x instead, and a
 * double-click goes back to the most recent point. A dashed line marks the picked x.
 *
 * Only the legend table is redrawn, in place, not the whole graph. A full render would
 * throw away state the host keeps on the SVG, such as the popup's zoom and pan.
 *
 * Interactive renders only: the headless PNG renderer never calls this.
 *
 * @module valuePicker
 */

import * as d3 from 'd3';
import { UnifiedTableRenderer } from './UnifiedTableRenderer.js';

/** Gap between the legend table and the bias table, as BiasTableRenderer places it. */
const BIAS_TABLE_GAP = 50;

const TRANSLATE_RE = /translate\(\s*(-?[\d.]+)\s*[ ,]\s*(-?[\d.]+)\s*\)/;

/**
 * Whether the picker has anything to change on this graph: a legend table that shows
 * values read at a point. Median mode summarises each row over all of x, so a picked x
 * would change nothing.
 *
 * @param {Object} graphConfig
 * @param {Object} globalSettings
 * @returns {boolean}
 */
export function canPickValues(graphConfig, globalSettings) {
    return Boolean(
        globalSettings?.showUnifiedTable
        && globalSettings?.showStaticTable
        && !graphConfig?.ignoreUnifiedValues
        && graphConfig?.unifiedValueMode !== 'median'
    );
}

/**
 * Turns a click position along the x axis into an x value. Time scales give a number
 * (ms), the form the legend table's lookup and header expect.
 * @private
 */
function xAtPixel(xScale, px) {
    if (typeof xScale?.invert !== 'function') return null;
    const x = xScale.invert(px);
    const n = +x;
    return Number.isFinite(n) ? n : null;
}

/**
 * Attaches the picker to a rendered graph.
 *
 * @param {Object} render - What `renderGraph` returned: `svg`, `g`, `validData`, `scales`,
 *   `columnInfo`, `dimensions` and `targetGraphConfig`.
 * @param {Object} globalSettings - The settings the graph was rendered with.
 * @returns {boolean} Whether the picker was attached.
 */
export function attachValuePicker(render, globalSettings) {
    const { svg, g, validData, scales, columnInfo, dimensions, targetGraphConfig } = render || {};
    if (!svg || !g || !scales?.xScale || !dimensions) return false;
    if (!canPickValues(targetGraphConfig, globalSettings)) return false;

    const svgNode = typeof svg.node === 'function' ? svg.node() : svg;
    if (!svgNode?.querySelector('.unified-table-group')) return false;

    // Inserted as the plot group's first child so data elements paint above it. The
    // `overlay` class is what the popup's zoom setup looks for: it moves the rect into the
    // zoomed data group, so the rect pans and zooms with the data.
    const overlay = g.insert('rect', ':first-child')
        .attr('class', 'overlay value-picker')
        .attr('width', dimensions.width)
        .attr('height', dimensions.height)
        .style('fill', 'none')
        .style('pointer-events', 'all')
        .style('cursor', 'crosshair');

    const redrawTable = (selectedXValue) => {
        const oldTable = svgNode.querySelector('.unified-table-group');
        const oldTransform = oldTable?.getAttribute('transform');

        const width = UnifiedTableRenderer.drawUnifiedTable(
            d3.select(svgNode), validData, columnInfo, scales, targetGraphConfig,
            { ...globalSettings, selectedXValue }, dimensions
        );

        // drawUnifiedTable places the table from scratch, which knows nothing of the
        // footer alignment done after the first render. Put it back where it was.
        const table = svgNode.querySelector('.unified-table-group');
        if (table && oldTransform) table.setAttribute('transform', oldTransform);

        // The bias table sits to the right of the legend table, so follow its width.
        const bias = svgNode.querySelector('.bias-table-group');
        const tableMatch = TRANSLATE_RE.exec(table?.getAttribute('transform') || '');
        const biasMatch = TRANSLATE_RE.exec(bias?.getAttribute('transform') || '');
        if (bias && tableMatch && biasMatch && width > 0) {
            const biasX = parseFloat(tableMatch[1]) + width + BIAS_TABLE_GAP;
            bias.setAttribute('transform', `translate(${biasX}, ${biasMatch[2]})`);
        }
    };

    const drawMarker = (selectedXValue) => {
        // The marker goes beside the overlay, so it sits in whichever group the overlay is
        // in by now (the zoomed data group, in the popup) and moves with the data.
        const parent = d3.select(overlay.node().parentNode);
        parent.selectAll('.value-picker-marker').remove();
        if (selectedXValue === null) return;
        const px = scales.xScale(selectedXValue);
        if (!Number.isFinite(px)) return;
        parent.append('line')
            .attr('class', 'value-picker-marker')
            .attr('x1', px)
            .attr('x2', px)
            .attr('y1', 0)
            .attr('y2', dimensions.height)
            .style('stroke', '#666')
            .style('stroke-width', '1px')
            .style('stroke-dasharray', '4,3')
            .style('pointer-events', 'none');
    };

    const pick = (selectedXValue) => {
        redrawTable(selectedXValue);
        drawMarker(selectedXValue);
    };

    overlay
        .on('click', (event) => {
            // d3.pointer against the overlay itself gives plot coordinates before any
            // zoom, since the zoom transform sits on a group above it.
            const [px] = d3.pointer(event, overlay.node());
            const x = xAtPixel(scales.xScale, px);
            if (x !== null) pick(x);
        })
        .on('dblclick', () => pick(null));

    return true;
}
