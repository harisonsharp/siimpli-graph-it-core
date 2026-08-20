/**
 * @fileoverview Shared vertical placement for the chart's footer tables — the unified
 * legend/value table and the bias table that sits beside it.
 *
 * Each renderer draws its own table at its own top-left corner and sizes its background
 * rect to whatever its content came out at, so two tables of different heights end up
 * with a ragged bottom edge. Reading them as a pair is easier when they share one
 * baseline, which is what this does: the tallest table keeps the top, and the shorter
 * one is dropped so both bottom edges line up.
 *
 * Positions are read from and written to the group `transform` and the background rect's
 * `height` ATTRIBUTE — never `getBBox()`, which does not exist under jsdom (the headless
 * PNG renderer) and would silently no-op there.
 *
 * @module tableLayout
 */

/** Groups this places, in draw order. Absent ones are simply skipped. */
export const FOOTER_TABLE_SELECTORS = ['.unified-table-group', '.bias-table-group'];

/** Matches the `translate(x, y)` these tables are positioned with. */
const TRANSLATE_RE = /translate\(\s*(-?[\d.]+)\s*[ ,]\s*(-?[\d.]+)\s*\)/;

/**
 * Reads a table group's current position and drawn height.
 *
 * The background rect is appended before any content, so it is the group's first `<rect>`
 * in document order even on tables that draw swatch rects in their rows.
 *
 * @private
 * @param {Element} node - The table's `<g>` element.
 * @returns {{node: Element, x: number, y: number, height: number}|null} `null` when the
 *   group has no measurable background (nothing to align against).
 */
function readTable(node) {
    const bg = node.querySelector('rect');
    const height = bg ? parseFloat(bg.getAttribute('height')) : NaN;
    if (!Number.isFinite(height) || height <= 0) return null;

    const match = TRANSLATE_RE.exec(node.getAttribute('transform') || '');
    return {
        node,
        x: match ? parseFloat(match[1]) : 0,
        y: match ? parseFloat(match[2]) : 0,
        height
    };
}

/**
 * Aligns the footer tables on a common bottom edge, optionally re-anchoring the pair.
 *
 * The tallest table defines the block: its top sits at `topY` (or, without one, stays
 * where it was drawn), and every other table is pushed down so all of them finish on the
 * same line. Horizontal position is left untouched — each renderer owns its own column.
 *
 * @param {Element|null} svgNode - The root `<svg>` DOM node.
 * @param {Object} [options]
 * @param {number|null} [options.topY] - Absolute SVG y for the top of the TALLEST table.
 *   Callers that want the block to clear a specific element (e.g. the x-axis title) pass
 *   it here. Omitted, the current top of the tallest table is kept, so the block only
 *   closes up its own ragged bottom and never moves into content above it.
 * @param {Array<string>} [options.selectors] - Group selectors to place.
 * @returns {{top: number, bottom: number, height: number}|null} The block's extent in SVG
 *   coordinates, or `null` when there is nothing to place. Callers use `bottom` to check
 *   the canvas still covers the tables.
 */
export function alignFooterTables(svgNode, { topY = null, selectors = FOOTER_TABLE_SELECTORS } = {}) {
    if (!svgNode || typeof svgNode.querySelector !== 'function') return null;

    const tables = selectors
        .map(selector => svgNode.querySelector(selector))
        .filter(Boolean)
        .map(readTable)
        .filter(Boolean);

    if (tables.length === 0) return null;

    const tallest = Math.max(...tables.map(table => table.height));
    const top = Number.isFinite(topY) ? topY : Math.min(...tables.map(table => table.y));
    const bottom = top + tallest;

    for (const table of tables) {
        table.node.setAttribute('transform', `translate(${table.x}, ${bottom - table.height})`);
    }

    return { top, bottom, height: tallest };
}
