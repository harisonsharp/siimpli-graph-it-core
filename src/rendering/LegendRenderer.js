/**
 * @fileoverview Renderer for graph legends, including series, discrete color, continuous gradient, and contour legends.
 * Handles symbol generation, text formatting, and layout for various legend types.
 *
 * @author Harison Sharp
 * @since 0.3.0
 *
 * @module Legend Renderer
 * @type {Renderer}
 *
 * @requires d3
 * @requires ScaleFactory
 * @requires SymbolFactory
 *
 * @exports LegendRenderer
 */
import * as d3 from 'd3';
import { ScaleFactory } from './ScaleFactory.js';
import { SymbolFactory } from '../utils/SymbolFactory.js';
import { debugLog } from '../utils/debug.js';
import { CanvasSizer } from '../services/CanvasSizer.js';

export class LegendRenderer {
    /**
     * Draws the color scale legend (discrete or continuous).
     */
    static drawColorLegend(svg, colorScale, colorValues, colorInfo, margin, graphDimensions, colorScheme) {
        const legend = svg.append("g")
            .attr("transform", `translate(${margin.left}, ${graphDimensions.height - 60})`);

        if (typeof colorValues[0] === 'string') {
            // Discrete legend
            const uniqueValues = [...new Set(colorValues)];
            uniqueValues.forEach((value, i) => {
                const legendRow = legend.append("g")
                    .attr("transform", `translate(${i * 120}, 0)`);

                legendRow.append("rect")
                    .attr("width", 15)
                    .attr("height", 15)
                    .style("fill", colorScale(value));

                legendRow.append("text")
                    .attr("x", 20)
                    .attr("y", 12)
                    .style("font-family", "sans-serif")
                    .style("font-size", "12px")
                    .text(value);
            });
        } else {
            // Continuous gradient legend
            const gradientId = `gradient-${Date.now()}`;
            const gradient = svg.append("defs")
                .append("linearGradient")
                .attr("id", gradientId)
                .attr("x1", "0%")
                .attr("x2", "100%");

            // Create proper gradient stops based on the color scheme
            const numStops = 20;
            const colorExtent = d3.extent(colorValues);

            for (let i = 0; i <= numStops; i++) {
                const t = i / numStops;
                const value = colorExtent[0] + t * (colorExtent[1] - colorExtent[0]);
                gradient.append("stop")
                    .attr("offset", `${t * 100}%`)
                    .attr("stop-color", colorScale(value));
            }

            legend.append("rect")
                .attr("width", 200)
                .attr("height", 20)
                .style("fill", `url(#${gradientId})`);

            legend.append("text")
                .attr("x", 0)
                .attr("y", -5)
                .style("font-family", "sans-serif")
                .style("font-size", "12px")
                .text(typeof colorExtent[0] === 'number' ? colorExtent[0].toFixed(2) : colorExtent[0].toString());

            legend.append("text")
                .attr("x", 200)
                .attr("y", -5)
                .attr("text-anchor", "end")
                .style("font-family", "sans-serif")
                .style("font-size", "12px")
                .text(typeof colorExtent[1] === 'number' ? colorExtent[1].toFixed(2) : colorExtent[1].toString());

            legend.append("text")
                .attr("x", 100)
                .attr("y", 35)
                .attr("text-anchor", "middle")
                .style("font-family", "sans-serif")
                .style("font-size", "12px")
                .text(colorInfo.columnName);
        }
    }

    /**
     * Draws the contour level legend.
     */
    static drawContourLegend(svg, contourInfo, thresholds, contourColorScale, graphDimensions) {
        const contourLegend = svg.append("g")
            .attr("transform", `translate(${graphDimensions.width - 120}, ${graphDimensions.height / 2})`);

        contourLegend.append("text")
            .attr("x", 0)
            .attr("y", -10)
            .attr("font-size", "12px")
            .attr("font-weight", "bold")
            .text(contourInfo.columnName);

        thresholds.forEach((threshold, i) => {
            const legendItem = contourLegend.append("g")
                .attr("transform", `translate(0, ${i * 20})`);

            legendItem.append("line")
                .attr("x1", 0)
                .attr("x2", 20)
                .attr("y1", 0)
                .attr("y2", 0)
                .attr("stroke", contourColorScale(i))
                .attr("stroke-width", 2);

            legendItem.append("text")
                .attr("x", 25)
                .attr("y", 4)
                .attr("font-size", "10px")
                .text(threshold.toFixed(2));
        });
    }

    /**
     * Draws the main series legend (lines, markers, etc).
     */

    static drawSeriesLegend(svg, validData, seriesInfo, colorScale, graphDimensions, margin, xOffset = 90) {
        const legend = svg.append("g")
            .attr("transform", `translate(${margin.left}, ${margin.top + graphDimensions.height - margin.bottom / 2})`);
        // .attr("transform", `translate(${graphDimensions.width - margin.right + xOffset}, ${margin.top})`);

        debugLog('[LegendRenderer.drawSeriesLegend]', seriesInfo, colorScale, graphDimensions, margin, xOffset);

        let currentY = 0;


        seriesInfo.forEach((series, i) => {
            debugLog('[LegendRenderer.drawSeriesLegend] validData, series.filterColumn', validData, series.filterColumn);
            let uniqueValues = SymbolFactory.getUniqueValues(validData, series.filterColumn?.split('::')[0]);
            debugLog('[LegendRenderer.drawSeriesLegend] uniqueValues', uniqueValues);
            if (series.excludeEmptyValues) {
                uniqueValues = uniqueValues.filter(v => v !== undefined && v !== null && v !== '');
            }
            const symbolMap = SymbolFactory.getSymbolMap(uniqueValues);
            debugLog('[LegendRenderer.drawSeriesLegend] uniqueValues, symbolMap', uniqueValues, symbolMap);
            const maxCharactersPerLine = CanvasSizer.DEFAULT_CONFIG.maxLineWidthLegend;

            // Determine sub-items (unique values for categorical filter) or single item
            // We expect series.uniqueValues and series.symbolMap if discrete mode is active
            let subItems = [];

            if (series.graphType === 'scatter' && uniqueValues && uniqueValues.length > 0) {
                // Ensure we have a map. If not provided on series object, generate it on the fly (failsafe)


                subItems = uniqueValues.map(val => ({
                    label: `${series.titleName} - ${val}`, // Requirement: Series Name - Unique Value
                    shapeType: 'symbol',
                    symbol: SymbolFactory.getSymbol(val, symbolMap),
                    color: ScaleFactory.resolveColor(series.color) || colorScale(series.yAxisInfo.columnName) // Use series color for all shapes? Or distinct? Usually series color.
                }));
            } else {
                // Default single item
                let label = series.titleName || series.yAxisInfo.columnName;
                if (series.yAxisInfo.columnName === '__frequency__') label = 'Frequency';

                subItems.push({
                    label: label,
                    shapeType: series.graphType || 'scatter',
                    color: ScaleFactory.resolveColor(series.color) || colorScale(series.yAxisInfo.columnName)
                });
            }

            subItems.forEach((item) => {
                // Calculate wrapping for THIS specific item
                const labelArrTmp = item.label.split(/[\s_]/g);
                let labelArr = [];
                let line = '';
                for (let k = 0; k < labelArrTmp.length; k++) {
                    if (line.length + labelArrTmp[k].length > maxCharactersPerLine) {
                        labelArr.push(line);
                        line = '';
                    }
                    line += labelArrTmp[k] + ' ';
                }
                labelArr.push(line.trim());

                // Calculate height for this item
                // 1 line = roughly 20px space needed? Original logic was numLines * 30.
                const itemNumLines = labelArr.length;
                const itemHeight = Math.max(30, itemNumLines * 20); // Ensure at least enough for icon

                const legendItem = legend.append("g")
                    .attr("transform", `translate(0, ${currentY})`);

                const shapeSize = series.strokeWidth || 4;
                const lineStyle = series.lineStyle || 'solid';
                let strokeDashArray = 'none';
                if (lineStyle === 'dashed') strokeDashArray = '5,3';
                else if (lineStyle === 'dotted') strokeDashArray = '2,2';
                else if (lineStyle === 'dash-dot') strokeDashArray = '5,2,2,2';

                // Render Shape
                const iconX = 7.5;
                const iconY = 8; // Centered roughly relative to first line of text?

                if (item.shapeType === 'line') {
                    legendItem.append("line")
                        .attr("x1", 0)
                        .attr("y1", iconY)
                        .attr("x2", 15)
                        .attr("y2", iconY)
                        .attr("stroke", item.color)
                        .attr("stroke-width", shapeSize)
                        .attr("stroke-linecap", "round")
                        .attr('stroke-dasharray', strokeDashArray);
                } else if (item.shapeType === 'bar' || item.shapeType === 'histogram') {
                    legendItem.append("rect")
                        .attr("x", 0)
                        .attr("y", 0) // Align top
                        .attr("width", 15)
                        .attr("height", 15)
                        .attr("fill", item.color);
                } else {
                    // Scatter / Symbol
                    // Use d3 symbol generator
                    const symbolFn = d3.symbol()
                        .type(item.symbol || d3.symbolCircle)
                        .size(SymbolFactory.LEGEND_SHAPE_SIZE || 64);

                    legendItem.append("path")
                        .attr("d", symbolFn)
                        .attr("transform", `translate(${iconX}, ${iconY})`) // Center the symbol
                        .attr("fill", item.color)
                        .attr("stroke", '#0a0808ff')
                        .attr("stroke-width", 1);
                }

                // Render Text
                // Original logic: y = 18 + j*12 - (lineHeight/4) ... extremely heuristic.
                // Let's simplify: First line at y=10 (v-center with icon), subsequent lines follow.

                labelArr.forEach((txt, lineIdx) => {
                    legendItem.append("text")
                        .attr("x", 20)
                        .attr("y", 12 + (lineIdx * 12)) // 12 baseline roughly centers with 15px icon?
                        .style("font-family", "sans-serif")
                        .style("font-size", "9px")
                        .text(txt);
                });

                // Advance Y
                // itemHeight covers the text. Add padding.
                currentY += (labelArr.length * 12) + 12;
            });

            // Add extra spacing between series groups

        });
    }
}

