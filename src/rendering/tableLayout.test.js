/**
 * Covers the footer block's vertical placement: the legend and bias tables start on one top
 * edge, and the block as a whole has to be anchorable below whatever sits above it (the
 * x-axis title, on the flotation advice charts).
 *
 * Positions are asserted from the group `transform` and the background rect's `height`
 * attribute — the same attributes the code reads, and the only ones that exist under jsdom,
 * where `getBBox()` is absent.
 */
import { describe, it, expect } from 'vitest';
import { alignFooterTables } from './tableLayout.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Builds an `<svg>` holding the named table groups at `y` with background height `h`. */
function buildSvg(tables) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    for (const { className, x = 0, y, height } of tables) {
        const group = document.createElementNS(SVG_NS, 'g');
        group.setAttribute('class', className);
        group.setAttribute('transform', `translate(${x}, ${y})`);
        const bg = document.createElementNS(SVG_NS, 'rect');
        bg.setAttribute('height', String(height));
        group.appendChild(bg);
        svg.appendChild(group);
    }
    document.body.appendChild(svg);
    return svg;
}

/** Reads back a group's `translate(x, y)`. */
function positionOf(svg, className) {
    const transform = svg.querySelector(`.${className}`).getAttribute('transform');
    const [, x, y] = /translate\(\s*(-?[\d.]+)\s*[ ,]\s*(-?[\d.]+)\s*\)/.exec(transform);
    return { x: parseFloat(x), y: parseFloat(y) };
}

describe('alignFooterTables', () => {
    it('lifts the lower table to the higher top, so both top edges meet', () => {
        const svg = buildSvg([
            { className: 'unified-table-group', x: 120, y: 1000, height: 260 },
            { className: 'bias-table-group', x: 400, y: 1160, height: 100 }
        ]);

        const block = alignFooterTables(svg);

        expect(block).toEqual({ top: 1000, bottom: 1260, height: 260 });
        expect(positionOf(svg, 'unified-table-group')).toEqual({ x: 120, y: 1000 });
        expect(positionOf(svg, 'bias-table-group')).toEqual({ x: 400, y: 1000 });
    });

    it('puts every table top at topY; the block ends at the bottom of the tallest', () => {
        const svg = buildSvg([
            { className: 'unified-table-group', x: 120, y: 1000, height: 260 },
            { className: 'bias-table-group', x: 400, y: 1000, height: 100 }
        ]);

        const block = alignFooterTables(svg, { topY: 800 });

        expect(block).toEqual({ top: 800, bottom: 1060, height: 260 });
        expect(positionOf(svg, 'unified-table-group')).toEqual({ x: 120, y: 800 });
        expect(positionOf(svg, 'bias-table-group')).toEqual({ x: 400, y: 800 });
    });

    it('places a lone legend table at topY — the charts without a bias table still re-anchor', () => {
        const svg = buildSvg([{ className: 'unified-table-group', x: 120, y: 1000, height: 100 }]);

        expect(alignFooterTables(svg, { topY: 800 })).toEqual({ top: 800, bottom: 900, height: 100 });
        expect(positionOf(svg, 'unified-table-group')).toEqual({ x: 120, y: 800 });
    });

    it('returns null when there is nothing to place', () => {
        expect(alignFooterTables(buildSvg([]), { topY: 800 })).toBeNull();
        expect(alignFooterTables(null)).toBeNull();
    });

    it('ignores a group whose background has no usable height', () => {
        const svg = buildSvg([
            { className: 'unified-table-group', x: 120, y: 1000, height: 100 },
            { className: 'bias-table-group', x: 400, y: 1000, height: 0 }
        ]);

        expect(alignFooterTables(svg, { topY: 800 })).toEqual({ top: 800, bottom: 900, height: 100 });
        expect(positionOf(svg, 'bias-table-group')).toEqual({ x: 400, y: 1000 });
    });
});
