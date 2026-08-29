/**
 * Covers the two marks a REFERENCE line carries that an ordinary series does not: hollow
 * dots showing where its own data starts and stops, and a label each side saying what
 * falling that side of it means. Both exist because these lines are read against, not just
 * plotted — and neither can be expressed in a legend swatch.
 *
 * The assertions are geometric (positions, rotation, which side of the line) rather than
 * visual, since that is the part that goes wrong: a label offset taken in the page's frame
 * instead of the line's drifts onto the line as the line steepens.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import * as d3 from 'd3';
import { LineChartRenderer } from './LineChartRenderer.js';

const xAxisInfo = { columnName: 'head' };
const yAxisInfo = { columnName: 'model' };
const scales = {
    xScale: d3.scaleLinear().domain([0, 10]).range([0, 100]),
    yScale: d3.scaleLinear().domain([0, 20]).range([100, 0])
};

// A straight rising line, so the expected pixel geometry is arithmetic rather than a guess.
// Sampled finely enough (2.5px apart) that the slope window holds several points, the way
// an advice line fitted over hundreds of reports does.
const heads = Array.from({ length: 29 }, (_, i) => 1 + i * 0.25);
const data = heads.map(head => ({ head, model: head * 1.5 }));

function render(extra = {}, rows = data) {
    const svg = d3.select(document.body).append('svg');
    const g = svg.append('g');
    const seriesConfig = { graphType: 'line', yAxis: 'model::data.csv', strokeWidth: 2.5, ...extra };
    new LineChartRenderer().render(
        g, rows, scales, xAxisInfo, yAxisInfo, { series: [seriesConfig] },
        null, null, '#ff6b6b', seriesConfig
    );
    return { g, cleanup: () => svg.remove() };
}

const markers = (g) => g.selectAll('.line-end-marker').nodes().map(node => ({
    cx: +node.getAttribute('cx'),
    cy: +node.getAttribute('cy'),
    fill: node.getAttribute('fill'),
    stroke: node.getAttribute('stroke'),
}));

/** The filled labels only — each is drawn over a white-stroked copy of itself. */
const labels = (g) => g.selectAll('.line-side-label').nodes().map(node => ({
    text: node.textContent,
    y: +node.getAttribute('y'),
    fill: node.getAttribute('fill'),
    transform: node.getAttribute('transform'),
}));

const rotationOf = (transform) => Number(/rotate\(([-\d.]+)\)/.exec(transform)?.[1]);
const translateOf = (transform) => {
    const m = /translate\(([-\d.]+), ([-\d.]+)\)/.exec(transform);
    return { x: Number(m?.[1]), y: Number(m?.[2]) };
};

describe('endMarkers', () => {
    beforeEach(() => { document.body.innerHTML = ''; });

    it('are absent unless asked for — every other line on every other chart is untouched', () => {
        const { g, cleanup } = render();
        expect(markers(g)).toHaveLength(0);
        cleanup();
    });

    it('sit on the first and last plotted point', () => {
        const { g, cleanup } = render({ endMarkers: true });
        const [first, last] = markers(g);
        expect(first).toMatchObject({ cx: 10, cy: 92.5 });   // head 1 -> 1.5 mass pull
        expect(last).toMatchObject({ cx: 80, cy: 40 });      // head 8 -> 12
        cleanup();
    });

    it('are hollow, in the line\'s own colour — a filled dot means something else here', () => {
        const { g, cleanup } = render({ endMarkers: true });
        for (const marker of markers(g)) {
            expect(marker.fill).toBe('#fff');
            expect(marker.stroke).toBe('#ff6b6b');
        }
        cleanup();
    });
});

describe('sideLabels', () => {
    beforeEach(() => { document.body.innerHTML = ''; });

    const spec = { above: 'dirtier than median', below: 'cleaner than median' };

    it('are absent unless asked for', () => {
        const { g, cleanup } = render();
        expect(labels(g)).toHaveLength(0);
        cleanup();
    });

    it('write both readings in the line\'s own colour, so there is no doubt which line', () => {
        const { g, cleanup } = render({ sideLabels: spec });
        expect(labels(g).map(l => l.text)).toEqual(['dirtier than median', 'cleaner than median']);
        expect(labels(g).every(l => l.fill === '#ff6b6b')).toBe(true);
        cleanup();
    });

    it('put each one over a white copy of itself — unhaloed text over a scatter is unreadable', () => {
        const { g, cleanup } = render({ sideLabels: spec });
        const halos = g.selectAll('.line-side-label-halo').nodes();
        expect(halos).toHaveLength(2);
        expect(halos.every(node => node.getAttribute('stroke') === '#fff')).toBe(true);
        cleanup();
    });

    it('sit at the line\'s own angle', () => {
        const { g, cleanup } = render({ sideLabels: spec });
        // 1 head unit = 10px across, 1.5 mass units = 7.5px up: atan2(-7.5, 10) = -36.87°
        for (const label of labels(g)) {
            expect(rotationOf(label.transform)).toBeCloseTo(-36.87, 1);
        }
        cleanup();
    });

    it('offset perpendicular to the line, above and below, about a shared anchor', () => {
        const { g, cleanup } = render({ sideLabels: spec });
        const [above, below] = labels(g);
        // Same anchor, opposite sides: the separation is entirely in the rotated frame's y,
        // which is what keeps it perpendicular however the line is sloped.
        expect(translateOf(above.transform)).toEqual(translateOf(below.transform));
        expect(above.y).toBeLessThan(0);
        expect(below.y).toBeGreaterThan(0);
        cleanup();
    });

    it('anchor where along the line they are told to', () => {
        const at = (fraction) => {
            const { g, cleanup } = render({ sideLabels: { ...spec, at: fraction } });
            const x = translateOf(labels(g)[0].transform).x;
            cleanup();
            return x;
        };
        expect(at(0)).toBeCloseTo(10, 6);        // the line's first point
        expect(at(1)).toBeCloseTo(80, 6);        // its last
        expect(at(0.5)).toBeCloseTo(45, 6);
    });

    it('reads the line where the anchor falls BETWEEN points, not at the nearest one', () => {
        const { g, cleanup } = render({ sideLabels: { ...spec, at: 0.5 } });
        // x = 45px is head 4.5, which no row carries; the line is at 6.75 -> 66.25px.
        expect(translateOf(labels(g)[0].transform).y).toBeCloseTo(66.25, 6);
        cleanup();
    });

    it('takes its angle from a chord, so one spike inside the window cannot tilt the text', () => {
        // A level median line with one point stepped up, close to where the anchor lands.
        const bumpy = heads.map(head => ({ head, model: head === 6 ? 12 : 10 }));
        const { g, cleanup } = render({ sideLabels: { ...spec, at: 0.7 } }, bumpy);
        const [above] = labels(g);
        // The anchor sits ON the spike's rising edge — so the spike is genuinely inside the
        // window, and a two-point slope taken there would tilt the text by 40°+.
        expect(translateOf(above.transform).y).toBeCloseTo(44, 6);
        // The chord spans the level stretch either side of it, so the text stays flat.
        expect(Math.abs(rotationOf(above.transform))).toBeLessThan(1);
        cleanup();
    });

    it('draws nothing rather than dividing by a zero-width line', () => {
        const flat = [{ head: 3, model: 10 }, { head: 3, model: 12 }];
        const { g, cleanup } = render({ sideLabels: spec }, flat);
        expect(labels(g)).toHaveLength(0);
        cleanup();
    });
});
