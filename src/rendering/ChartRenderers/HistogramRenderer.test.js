import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { JSDOM } from 'jsdom';
import * as d3 from 'd3';
import { HistogramRenderer } from './HistogramRenderer.js';

const createSvg = () => d3.create('svg');

describe('HistogramRenderer', () => {
    let renderer;
    let svg;
    let group;
    let dom;

    beforeEach(() => {
        dom = new JSDOM('<!DOCTYPE html><body></body>');
        global.window = dom.window;
        global.document = dom.window.document;
        global.SVGElement = dom.window.SVGElement;
        global.HTMLElement = dom.window.HTMLElement;
        global.Node = dom.window.Node;
    });

    afterEach(() => {
        dom.window.close();
        delete global.window;
        delete global.document;
        delete global.SVGElement;
        delete global.HTMLElement;
        delete global.Node;
    });

    beforeEach(() => {
        renderer = new HistogramRenderer();
        svg = createSvg();
        group = svg.append('g');
    });

    it('renders histogram bars for numeric data', () => {
        const data = Array.from({ length: 20 }, (_, i) => ({ Value: i * 2 }));
        const xScale = d3.scaleLinear().domain([0, 40]).range([0, 400]);
        const yScale = d3.scaleLinear().domain([0, 10]).range([300, 0]);

        renderer.render(group, data, { xScale, yScale }, { columnName: 'Value' }, null, { graphType: 'histogram' });

        expect(group.selectAll('rect.histogram-bar').size()).toBeGreaterThan(0);
    });

    it('handles outlier bins when present', () => {
        const data = [
            ...Array.from({ length: 50 }, (_, i) => ({ Value: i })),
            { Value: 400 },
            { Value: 450 }
        ];
        const xScale = d3.scaleLinear().domain([0, 100]).range([0, 400]);
        const yScale = d3.scaleLinear().domain([0, 20]).range([300, 0]);

        renderer.render(group, data, { xScale, yScale }, { columnName: 'Value' }, null, { graphType: 'histogram' });

        expect(group.selectAll('.histogram-outlier-bar').size()).toBe(1);
    });

    it('gracefully skips rendering when insufficient data', () => {
        const data = [{ Value: 'not-a-number' }];
        const xScale = d3.scaleLinear().domain([0, 10]).range([0, 400]);
        const yScale = d3.scaleLinear().domain([0, 10]).range([300, 0]);

        renderer.render(group, data, { xScale, yScale }, { columnName: 'Value' }, null, { graphType: 'histogram' });

        expect(group.selectAll('rect.histogram-bar').size()).toBe(0);
    });
});
