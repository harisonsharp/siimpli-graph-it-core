/**
 * Covers click-to-pick on a real render: a click on the plot redraws the legend table at
 * the clicked x, in place, and a double-click goes back to the most recent point.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderGraph } from '../core/renderGraph.js';
import { attachValuePicker, canPickValues } from './valuePicker.js';

const openerMock = vi.hoisted(() => ({ openPath: vi.fn(), openUrl: vi.fn() }));
vi.mock('@tauri-apps/plugin-opener', () => openerMock);

const SVG_NS = 'http://www.w3.org/2000/svg';

const csvData = [
    { year: 2000, price: 1 },
    { year: 2005, price: 2 },
    { year: 2010, price: 3 },
    { year: 2015, price: 4 },
    { year: 2020, price: 5 }
];

const graphConfig = {
    graphType: 'line',
    xAxis: 'year',
    series: [{ yAxis: 'price', type: 'line' }]
};

const globalSettings = {
    graphDimensions: { width: 800, height: 500 },
    colorScheme: 'default',
    showUnifiedTable: true,
    showStaticTable: true
};

const tableTexts = (svg) => Array.from(svg.querySelectorAll('.unified-table-group text'))
    .map(node => node.textContent);

/** Clicks the overlay at plot pixel `px` (jsdom has no layout, so d3.pointer reads clientX). */
function clickAt(overlay, px, type = 'click') {
    overlay.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: px, clientY: 10 }));
}

describe('valuePicker', () => {
    let svg;

    beforeEach(() => {
        document.body.innerHTML = '';
        svg = document.createElementNS(SVG_NS, 'svg');
        document.body.appendChild(svg);
    });

    it('only picks where the legend table shows values read at a point', () => {
        expect(canPickValues(graphConfig, globalSettings)).toBe(true);
        expect(canPickValues({ ...graphConfig, unifiedValueMode: 'median' }, globalSettings)).toBe(false);
        expect(canPickValues({ ...graphConfig, ignoreUnifiedValues: true }, globalSettings)).toBe(false);
        expect(canPickValues(graphConfig, { ...globalSettings, showUnifiedTable: false })).toBe(false);
    });

    it('reads the values at the clicked x, keeps the table in place, and resets on double-click', () => {
        const result = renderGraph({ svg, csvData, graphConfig, globalSettings });
        expect(result.success).toBe(true);
        expect(attachValuePicker(result, globalSettings)).toBe(true);

        const table = () => svg.querySelector('.unified-table-group');
        const transform = table().getAttribute('transform');
        expect(tableTexts(svg)).toContain('Legend, Values at Most Recent Point');
        expect(tableTexts(svg)).toContain('5.00');

        // Halfway between 2005 and 2010: the table reads the last value at or before it.
        const overlay = svg.querySelector('rect.value-picker');
        clickAt(overlay, result.scales.xScale(2007));

        expect(tableTexts(svg)).toContain('Legend, Values at Selected Point');
        expect(tableTexts(svg)).toContain('2.00');
        expect(table().getAttribute('transform')).toBe(transform);
        expect(svg.querySelectorAll('.value-picker-marker')).toHaveLength(1);

        clickAt(overlay, 0, 'dblclick');
        expect(tableTexts(svg)).toContain('Legend, Values at Most Recent Point');
        expect(tableTexts(svg)).toContain('5.00');
        expect(svg.querySelectorAll('.value-picker-marker')).toHaveLength(0);
    });

    it('does nothing on a graph without a legend table', () => {
        const settings = { ...globalSettings, showUnifiedTable: false };
        const result = renderGraph({ svg, csvData, graphConfig, globalSettings: settings });
        expect(attachValuePicker(result, settings)).toBe(false);
        expect(svg.querySelector('rect.value-picker')).toBeNull();
    });
});
