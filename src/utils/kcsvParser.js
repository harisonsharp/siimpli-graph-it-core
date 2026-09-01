/**
 * Parser for the Kernel CSV (KCSV) graph configuration format.
 *
 * KCSV is a hybrid CSV format used to encode both graph configuration and
 * data in a single file. It is produced by the EV2 backend and consumed by
 * all siimpli-graph-it-* consumers that need to load or export graph configs
 * as CSV (e.g. script_manager batch generation, GUI debug import/export).
 *
 * Schema:
 *   Header Section  — key/value rows, ends at the "Data for display…" marker
 *   Metadata Section — per-series config rows (chart type, axis, colour…)
 *   Data Section    — rows starting with "Data" containing the plot values
 */

import * as d3 from 'd3';
import { debugWarn } from './debug.js';

// biome-ignore lint/complexity/noStaticOnlyClass: <explanation>
export class KCSVParser {
    /**
     * Parse a KCSV content string into a GraphConfiguration object.
     * @param {string} content - Raw file content
     * @param {string} filename - Original filename (used in warnings)
     * @returns {Object|null} GraphConfiguration or null if the file is invalid
     */
    static parse(content, filename) {
        if (!content) return null;

        const lines = content.split(/\r?\n/);
        const header = {};
        const metadata = {};
        const dataRows = [];
        let section = 'HEADER';
        let markerFound = false;

        const parseLine = (line) => {
            let trimmed = line.trim();
            while (trimmed.endsWith(',')) {
                trimmed = trimmed.slice(0, -1).trim();
            }

            const parts = [];
            let current = '';
            let inQuote = false;

            for (const element of trimmed) {
                const char = element;
                if (char === '"') {
                    inQuote = !inQuote;
                } else if (char === ',' && !inQuote) {
                    parts.push(current.trim().replaceAll(/^"|"$/g, ''));
                    current = '';
                } else {
                    current += char;
                }
            }
            parts.push(current.trim().replaceAll(/^"|"$/g, ''));
            return parts;
        };

        for (const element of lines) {
            const line = element.trim();
            if (!line) continue;

            const parts = parseLine(line);
            const key = parts[0]?.toLowerCase();

            if (key === 'data for display below is in columns' || parts[0]?.toLowerCase().includes('data for display below')) {
                section = 'METADATA';
                markerFound = true;
                continue;
            }

            if (section === 'HEADER') {
                if (parts.length >= 2) {
                    header[key] = parts[1];
                }
            } else if (section === 'METADATA') {
                if (key === 'data') {
                    section = 'DATA';
                    dataRows.push(parts);
                } else {
                    metadata[key] = parts.slice(1);
                }
            } else if (section === 'DATA') {
                if (key === 'data') {
                    dataRows.push(parts);
                }
            }
        }

        if (!markerFound && dataRows.length === 0) {
            debugWarn(`Invalid KCSV file: ${filename} — no section marker or data rows found`);
            return null;
        }

        return KCSVParser.buildGraphConfig(header, metadata, dataRows, filename);
    }

    /**
     * Convert parsed sections into the application's GraphConfiguration format.
     * @param {Object} header
     * @param {Object} metadata
     * @param {Array} dataRows
     * @param {string} filename
     * @returns {Object} GraphConfiguration
     */
    static buildGraphConfig(header, metadata, dataRows, filename) {
        const title = header['graph title'] || 'Untitled Graph';
        const projectName = header['project name'] || '';
        const yAxisPrimary = header['graph primary y axis label'] || '';
        const yAxisSecondary = header['graph secondary y axis label'] || '';

        let axisIntercept = 'origin';
        let customIntercept = null;
        const interceptRaw = (header['axis intercept'] || '').toLowerCase().trim();

        if (interceptRaw === 'minimum') {
            axisIntercept = 'minimum';
        } else if (interceptRaw.includes(',')) {
            axisIntercept = 'custom';
            const parts = interceptRaw.split(',').map(p => parseFloat(p.trim()));
            customIntercept = {
                x: !isNaN(parts[0]) ? parts[0] : 0,
                y: !isNaN(parts[1]) ? parts[1] : 0
            };
            if (parts.length > 2 && !isNaN(parts[2])) {
                customIntercept.y2 = parts[2];
            } else if (parts.length > 1) {
                // Both y-axes take the second value when only two intercept values are given
                customIntercept.y2 = customIntercept.y;
            }
        }

        let secondaryYAxisScale = 'default';
        const scaleRaw = (header['secondary y axis scale'] || header['y-axis sync'] || '').toLowerCase().trim();
        if (scaleRaw === 'matching') {
            secondaryYAxisScale = 'matching';
        }

        const seriesConfigs = [];

        const getMeta = (key, index, defaultValue) => {
            const row = metadata[key.toLowerCase()];
            if (row && row.length > index + 1) {
                return row[index + 1] || defaultValue;
            }
            return defaultValue;
        };

        const labelRow = metadata['chart data label'];
        let seriesCount = 0;

        // labelRow[0] is the X-axis column name; series start at index 1
        const xAxisColumnName = labelRow?.[0] || 'Year';

        if (labelRow) {
            seriesCount = labelRow.length - 1;
        } else if (dataRows.length > 0) {
            seriesCount = dataRows[0].length - 2;
        }

        KCSVParser.buildSeriesConfig(seriesCount, getMeta, dataRows, filename, seriesConfigs);

        const graphData = dataRows.map(row => {
            const dataPoint = { [xAxisColumnName]: row[1] };
            seriesConfigs.forEach(series => {
                const val = parseFloat(row[series.dataIndex]);
                dataPoint[series.label] = isNaN(val) ? 0 : val;
            });
            return dataPoint;
        });

        const hasStackedBars = seriesConfigs.some(s => s.isStacked);

        return {
            title,
            projectName,
            chartType: 'custom',
            xAxis: xAxisColumnName,
            yAxisLabel: yAxisPrimary,
            yAxisLabel2: yAxisSecondary,
            barMode: hasStackedBars ? 'stack' : 'group',
            axisIntercept,
            customIntercept,
            secondaryYAxisScale,
            // calculateDimensions() reserves extra margin.right for a legend based on
            // series label length; 'top-right' is the position that actually lands in
            // that reserved space (drawSeriesLegend defaults to 'bottom-left' otherwise).
            legendPosition: 'top-right',
            series: seriesConfigs.map((s, i) => ({
                yAxis: s.label,
                titleName: s.label,
                graphType: s.type,
                axisAssignment: s.axis,
                color: s.seriesColor || d3.schemeCategory10[i % 10],
                colorGrading: {
                    enabled: s.colorGrading === true,
                    mode: 'continuous',
                    column: '',
                    scheme: 'warm-cool',
                    categoryColors: {}
                },
                curveType: s.curveType,
                showPoints: s.showPoints,
                lineStyle: s.lineStyle
            })),
            graphData,
            rawHeader: header,
            rawMetadata: metadata
        };
    }

    static buildSeriesConfig(seriesCount, getMeta, dataRows, filename, seriesConfigs) {
        
        for (let i = 0; i < seriesCount; i++) {
            const label = getMeta('chart data label', i, `Series ${i + 1}`);

            if (!label || label.trim() === '') continue;

            const seriesColor = getMeta('series color', i, null);
            const typeRaw = getMeta('chart type', i, 'Scatter').toLowerCase();
            const axisRaw = getMeta('axis control', i, 'Y-Primary').toLowerCase();
            const colorGrading = getMeta('series color grading', i, 'False').toLowerCase() === 'true';
            const contour = getMeta('series contour', i, 'False').toLowerCase() === 'true';

            const { type, curveType, showPoints, isStacked, lineStyle } = KCSVParser._parseTypeProps(typeRaw);

            const axis = axisRaw.includes('secondary') ? 'secondary' : 'primary';

            const dataIndex = i + 2;
            const hasDataRows = dataRows.length > 0;
            const firstDatRowLength = dataRows[0].length
            if (hasDataRows && dataIndex >= firstDatRowLength) {
                debugWarn(`KCSVParser: series "${label}" index ${dataIndex} out of bounds in ${filename}`);
                continue;
            }

            seriesConfigs.push({
                label,
                type,
                axis,
                colorGrading,
                contour,
                dataIndex,
                isStacked,
                curveType,
                showPoints,
                lineStyle,
                seriesColor
            });
        }
    }

    static _parseTypeProps(typeRaw) {
        const base = typeRaw.split(/-/)[0];
        let type = 'scatter';
        let curveType = 'curveMonotoneX';
        let showPoints = true;
        let lineStyle = 'solid';
        const isStacked = typeRaw.includes('stacked');

        if (base === 'bar') {
            type = 'bar';
        } else if (base === 'line') {
            type = 'line';
            if (typeRaw.includes('straight')) {
                curveType = 'curveLinear';
            }
            if (typeRaw.includes('nopoint') || typeRaw.includes('no-point')) {
                showPoints = false;
            }
            if (typeRaw.includes('dashed')) {
                lineStyle = 'dashed';
            } else if (typeRaw.includes('dotted')) {
                lineStyle = 'dotted';
            }
        } else {
            console.warn('unexpected value in KCSVParser buildSeriesConfig: series type')
        }

        return { type, curveType, showPoints, isStacked, lineStyle };
    }
}

export default KCSVParser;
