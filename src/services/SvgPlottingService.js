
/**
 * @fileoverview Static service class for SVG plotting and interactive point visualization.
 * Manages SVG element creation, crosshair rendering, and coordinate point plotting
 * for the scientific data visualization application.
 *
 * @author Harison Sharp
 * @since 0.2.0
 * @class SvgPlottingService
 *
 * @description Utility service providing static methods for creating and manipulating SVG elements
 * within the data visualization context. Handles point plotting with crosshairs, labels,
 * and dual-axis support for mathematical analysis workflows.
 *
 * @requires Native SVG DOM API - Document.createElementNS for SVG element creation
 *
 * @exports SvgPlottingService - Static class with plotting utility methods
 *
 * @example
 * SvgPlottingService.plotPoint(svgElement, pixels, userInput, parsedData);
 * SvgPlottingService.clearSvg(svgElement);
 *
 * @relatedFiles usePlotting.js, CoordinateService.js, PlotControlsCard.jsx
 */

export class SvgPlottingService {
    static clearSvg(svgElement) {
        while (svgElement.firstChild) {
            svgElement.removeChild(svgElement.firstChild);
        }
    }

    static createSvgElement(type, attributes = {}) {
        const element = document.createElementNS('http://www.w3.org/2000/svg', type);
        Object.entries(attributes).forEach(([key, value]) => {
            element.setAttribute(key, value);
        });
        return element;
    }

    static plotPoint(svgElement, pixels, userInput, parsedData) {
        this.clearSvg(svgElement);

        const g = this.createSvgElement('g');
        const crosshairSize = 15;

        // Plot primary point
        const circle = this.createSvgElement('circle', {
            cx: pixels.x,
            cy: pixels.y,
            r: '8',
            fill: '#ff0000',
            stroke: '#ffffff',
            'stroke-width': '3'
        });

        // Add crosshair
        const hLine = this.createSvgElement('line', {
            x1: pixels.x - crosshairSize,
            x2: pixels.x + crosshairSize,
            y1: pixels.y,
            y2: pixels.y,
            stroke: '#ff0000',
            'stroke-width': '2',
            'stroke-dasharray': '5,5'
        });

        const vLine = this.createSvgElement('line', {
            x1: pixels.x,
            x2: pixels.x,
            y1: pixels.y - crosshairSize,
            y2: pixels.y + crosshairSize,
            stroke: '#ff0000',
            'stroke-width': '2',
            'stroke-dasharray': '5,5'
        });

        // Add label
        const labelText = `(${userInput.x}, ${userInput.y})`;
        const labelX = pixels.x + 15;
        const labelY = pixels.y - 15;

        const labelBg = this.createSvgElement('rect', {
            x: labelX - 5,
            y: labelY - 15,
            width: Math.max(100, labelText.length * 8 + 10),
            height: 20,
            fill: 'white',
            'fill-opacity': '0.9',
            rx: '3'
        });

        const label = this.createSvgElement('text', {
            x: labelX,
            y: labelY,
            fill: '#ff0000',
            'font-size': '14',
            'font-weight': 'bold',
            'font-family': 'sans-serif'
        });
        label.textContent = labelText;

        // Append elements
        g.appendChild(circle);
        g.appendChild(hLine);
        g.appendChild(vLine);
        g.appendChild(labelBg);
        g.appendChild(label);

        // Handle y2 point if applicable
        if (pixels.y2 && parsedData.y2) {
            const circle2 = this.createSvgElement('circle', {
                cx: pixels.x,
                cy: pixels.y2,
                r: '8',
                fill: '#e74c3c',
                stroke: '#ffffff',
                'stroke-width': '3'
            });

            const hLine2 = this.createSvgElement('line', {
                x1: pixels.x - crosshairSize,
                x2: pixels.x + crosshairSize,
                y1: pixels.y2,
                y2: pixels.y2,
                stroke: '#e74c3c',
                'stroke-width': '2',
                'stroke-dasharray': '5,5'
            });

            const label2Text = `Y2: ${userInput.y2}`;
            const label2Bg = this.createSvgElement('rect', {
                x: labelX - 5,
                y: pixels.y2 + 5,
                width: Math.max(80, label2Text.length * 8 + 10),
                height: 20,
                fill: 'white',
                'fill-opacity': '0.9',
                rx: '3'
            });

            const label2 = this.createSvgElement('text', {
                x: labelX,
                y: pixels.y2 + 20,
                fill: '#e74c3c',
                'font-size': '14',
                'font-weight': 'bold',
                'font-family': 'sans-serif'
            });
            label2.textContent = label2Text;

            g.appendChild(circle2);
            g.appendChild(hLine2);
            g.appendChild(label2Bg);
            g.appendChild(label2);
        }

        svgElement.appendChild(g);
    }
}
