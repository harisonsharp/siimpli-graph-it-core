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
/** biome-ignore-all lint/complexity/noStaticOnlyClass: <explanation> */
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
     * Draws floating per-series colour grading legend panels.
     * One panel per series that has colorGrading.enabled === true.
     * Panels are stacked vertically in the right margin area.
     *
     * @param {d3.Selection} svg - Root SVG selection
     * @param {Array} seriesInfo - Parsed series info array (each entry has .colorGrading and .yAxisInfo)
     * @param {Array} seriesColorScales - Per-series grading objects: Array<{colorScale, colorInfo, mode}|null>
     * @param {Array} validData - Filtered valid data (for extracting color column values)
     * @param {Object} dimensions - { width, height, margin }
     */
    static drawColorGradingLegends(svg, seriesInfo, seriesColorScales, validData, dimensions) {
        if (!seriesInfo || !seriesColorScales) return;
        const { width, height, margin } = dimensions;
        const panelX = margin.left + width + 12;
        const panelWidth = 160;
        let panelY = margin.top;

        seriesInfo.forEach((series, i) => {
            const grading = seriesColorScales[i];
            if (!grading) return;

            const { colorScale, colorInfo, mode } = grading;
            if (!colorScale || !colorInfo?.columnName) return;

            const seriesLabel = series.titleName || series.yAxisInfo?.columnName || `Series ${i + 1}`;
            const colLabel = colorInfo.columnName;

            if (mode === 'distinct') {
                // --- Discrete panel ---
                const colorValues = validData
                    .map(d => d[colorInfo.columnName])
                    .filter(v => v !== undefined && v !== null && v !== '');
                const uniqueValues = [...new Set(colorValues)];
                if (uniqueValues.length === 0) return;

                const rowH = 18;
                const headerH = 28;
                const panelH = headerH + uniqueValues.length * rowH + 10;

                const panel = svg.append('g').attr('class', 'color-grading-legend');
                panel.append('rect')
                    .attr('x', panelX).attr('y', panelY)
                    .attr('width', panelWidth).attr('height', panelH)
                    .attr('rx', 6).attr('ry', 6)
                    .attr('fill', '#fff').attr('fill-opacity', 0.95)
                    .attr('stroke', '#d1d5db').attr('stroke-width', 1);

                panel.append('text')
                    .attr('x', panelX + 8).attr('y', panelY + 11)
                    .attr('font-size', 10).attr('font-weight', 600)
                    .attr('font-family', 'Inter, sans-serif').attr('fill', '#1e293b')
                    .text(seriesLabel);

                panel.append('text')
                    .attr('x', panelX + 8).attr('y', panelY + 22)
                    .attr('font-size', 9).attr('font-family', 'Inter, sans-serif')
                    .attr('fill', '#64748b')
                    .text(colLabel);

                uniqueValues.forEach((val, j) => {
                    const rowY = panelY + headerH + j * rowH;
                    panel.append('rect')
                        .attr('x', panelX + 8).attr('y', rowY)
                        .attr('width', 12).attr('height', 12)
                        .attr('rx', 2).attr('ry', 2)
                        .attr('fill', colorScale(val));
                    panel.append('text')
                        .attr('x', panelX + 24).attr('y', rowY + 10)
                        .attr('font-size', 9).attr('font-family', 'Inter, sans-serif')
                        .attr('fill', '#334155')
                        .text(String(val).length > 16 ? String(val).slice(0, 15) + '…' : String(val));
                });

                panelY += panelH + 8;
            } else {
                // --- Continuous gradient panel ---
                const colorValues = validData
                    .map(d => d[colorInfo.columnName])
                    .filter(v => v !== undefined && v !== null && v !== '' && typeof v === 'number');
                if (colorValues.length === 0) return;

                const extent = [Math.min(...colorValues), Math.max(...colorValues)];
                const gradientId = `cg-gradient-${i}-${Date.now()}`;
                const barW = panelWidth - 16;
                const panelH = 62;

                const defs = svg.select('defs').empty() ? svg.append('defs') : svg.select('defs');
                const gradient = defs.append('linearGradient')
                    .attr('id', gradientId)
                    .attr('x1', '0%').attr('x2', '100%');

                for (let s = 0; s <= 20; s++) {
                    const t = s / 20;
                    const val = extent[0] + t * (extent[1] - extent[0]);
                    gradient.append('stop')
                        .attr('offset', `${t * 100}%`)
                        .attr('stop-color', colorScale(val));
                }

                const panel = svg.append('g').attr('class', 'color-grading-legend');
                panel.append('rect')
                    .attr('x', panelX).attr('y', panelY)
                    .attr('width', panelWidth).attr('height', panelH)
                    .attr('rx', 6).attr('ry', 6)
                    .attr('fill', '#fff').attr('fill-opacity', 0.95)
                    .attr('stroke', '#d1d5db').attr('stroke-width', 1);

                panel.append('text')
                    .attr('x', panelX + 8).attr('y', panelY + 11)
                    .attr('font-size', 10).attr('font-weight', 600)
                    .attr('font-family', 'Inter, sans-serif').attr('fill', '#1e293b')
                    .text(seriesLabel);

                panel.append('text')
                    .attr('x', panelX + 8).attr('y', panelY + 22)
                    .attr('font-size', 9).attr('font-family', 'Inter, sans-serif')
                    .attr('fill', '#64748b')
                    .text(colLabel);

                panel.append('rect')
                    .attr('x', panelX + 8).attr('y', panelY + 28)
                    .attr('width', barW).attr('height', 14)
                    .attr('rx', 3)
                    .attr('fill', `url(#${gradientId})`);

                const fmt = v => (Math.abs(v) >= 1000 || (v !== 0 && Math.abs(v) < 0.01))
                    ? v.toExponential(2)
                    : v.toPrecision(4).replace(/\.?0+$/, '');

                panel.append('text')
                    .attr('x', panelX + 8).attr('y', panelY + 56)
                    .attr('font-size', 9).attr('font-family', 'Inter, sans-serif')
                    .attr('fill', '#475569').text(fmt(extent[0]));

                panel.append('text')
                    .attr('x', panelX + panelWidth - 8).attr('y', panelY + 56)
                    .attr('text-anchor', 'end')
                    .attr('font-size', 9).attr('font-family', 'Inter, sans-serif')
                    .attr('fill', '#475569').text(fmt(extent[1]));

                panelY += panelH + 8;
            }
        });
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

    static drawSeriesLegend(graphConfig, svg, validData, seriesInfo, colorScale, graphDimensions, margin, xOffset = 90) {
        // Legend placement. Defaults to bottom-left (below the plot); 'top-right' / 'bottom-right'
        // tuck it into a chart corner — set via graphConfig.legendPosition in the template.
        const LEGEND_W = 150; // approx width reserved when right-aligning
        const legendPosition = graphConfig?.legendPosition || 'bottom-left';
        let legendTransform;
        if (legendPosition === 'top-right') {
            legendTransform = `translate(${margin.left + graphDimensions.width - LEGEND_W}, ${margin.top + 10})`;
        } else if (legendPosition === 'bottom-right') {
            legendTransform = `translate(${margin.left + graphDimensions.width - LEGEND_W}, ${margin.top + graphDimensions.height - margin.bottom / 2})`;
        } else {
            legendTransform = `translate(${margin.left}, ${margin.top + graphDimensions.height - margin.bottom / 2})`;
        }
        const legend = svg.append("g").attr("transform", legendTransform);

        debugLog('[LegendRenderer.drawSeriesLegend]', seriesInfo, colorScale, graphDimensions, margin, xOffset);

        let currentY = 0;
        // if a stacked proportional graph shares an axis with some other series, then we need to disclose the stack is not using the axis, but rather is using the max value as 100%
        let stackProportionalLegend = false;
        if (graphConfig.barMode === 'stack-proportional' && seriesInfo.length > 1 && seriesInfo.some(s => s.graphType !== 'bar')) {
            stackProportionalLegend = true;
        }
        seriesInfo.forEach((series, _i) => {
            if (series.color==='white'){
                return;
            }
            if(seriesInfo.filter(s => s.color!=='white').length <= 1){
                return;
            }
            debugLog('[LegendRenderer.drawSeriesLegend] validData, series.filterColumn', validData, series.filterColumn);
            let uniqueValues = [];
            if (SymbolFactory.shouldUseUniqueSymbolEncoding(series)) {
                uniqueValues = SymbolFactory.getUniqueValues(validData, series.filterColumn?.split('::')[0]);
            }
            debugLog('[LegendRenderer.drawSeriesLegend] uniqueValues', uniqueValues);
            if (series.excludeEmptyValues) {
                // getUniqueValues folds null/blank into MISSING_CATEGORY; drop that group.
                uniqueValues = uniqueValues.filter(v => v !== SymbolFactory.MISSING_CATEGORY);
            }
            const symbolMap = SymbolFactory.getSymbolMap(uniqueValues);
            debugLog('[LegendRenderer.drawSeriesLegend] uniqueValues, symbolMap', uniqueValues, symbolMap);
            const maxCharactersPerLine = CanvasSizer.DEFAULT_CONFIG.maxLineWidthLegend;

            // Determine sub-items (unique values for categorical filter) or single item
            // We expect series.uniqueValues and series.symbolMap if discrete mode is active
            let subItems = [];

            if (series.graphType === 'scatter' && uniqueValues && uniqueValues.length > 0) {
                // Ensure we have a map. If not provided on series object, generate it on the fly (failsafe)


                subItems = uniqueValues.map(val => {
                    const isMissing = val === SymbolFactory.MISSING_CATEGORY;
                    const displayVal = isMissing ? SymbolFactory.MISSING_LABEL : val;
                    return {
                        label: `${series.titleName} - ${displayVal}`, // Requirement: Series Name - Unique Value
                        shapeType: 'symbol',
                        symbol: SymbolFactory.getSymbol(val, symbolMap),
                        // The (none) group uses the shared neutral color; graded groups keep the series color.
                        color: isMissing
                            ? SymbolFactory.MISSING_COLOR
                            : (ScaleFactory.resolveColor(series.color) || colorScale(series.yAxisInfo.columnName))
                    };
                });
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
                const labelArr = [];
                let line = '';
                for (let k = 0; k < labelArrTmp.length; k++) {
                    if (line.length + labelArrTmp[k].length > maxCharactersPerLine) {
                        labelArr.push(line.trimEnd());
                        line = '';
                    }
                    line += labelArrTmp[k] + ' ';
                }
                if (line.trim().length > 0) labelArr.push(line.trimEnd());

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
                        // Add (100%) to the last line if stackProportionalLegend is true
                        .text(txt + (lineIdx === labelArr.length - 1 && stackProportionalLegend ? ' (100%)' : ''));
                });

                // Advance Y
                // itemHeight covers the text. Add padding.
                currentY += (labelArr.length * 12) + 12;
            });

            // Add extra spacing between series groups

        });
    }
}

// Backward-compatible named exports for legacy imports that expect
// free functions from @siimpli/graph-it-core.
export const drawColorLegend = (...args) => LegendRenderer.drawColorLegend(...args);
export const drawContourLegend = (...args) => LegendRenderer.drawContourLegend(...args);
export const drawSeriesLegend = (...args) => LegendRenderer.drawSeriesLegend(...args);

