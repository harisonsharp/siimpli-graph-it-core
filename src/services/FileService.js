import { parseCSV } from "../utils/parseCSV.js";
import { debugLog, debugWarn } from '../utils/debug.js';

/**
 * @fileoverview Service class for handling CSV file processing and data validation operations.
 * Manages file loading, CSV parsing, data filtering, and column extraction for the data visualization pipeline.
 *
 * @author Harison Sharp
 * @since 0.2.0
 *
 * @module Service Class
 * @type {Class}
 *
 * @requires ./dataUtils.js - CSV parsing utilities and data processing functions
 *
 * @exports {Class} FileService
 *
 * @example
 * const { newFiles, newData, allColumns } = await FileService.loadFiles(fileList);
 * const validData = FileService.filterValidData(csvData, xAxisInfo, yAxisInfo);
 *
 * @related GraphService.js, GraphRenderer.jsx, FileUploadSection.jsx
 */

export class FileService {
    /**
     * Load and parse a list of CSV files.
     *
     * @param {Array<{name: string, path?: string}>} files - File descriptors.
     *   In Tauri, each entry must have a `path` property (absolute FS path).
     *   In the browser, each entry should be a native `File` object.
     * @param {{ ioProvider?: import('../io/IOProvider.js').IOProvider }} [options]
     *   When `ioProvider` is supplied it is used for all file I/O, bypassing both
     *   the Tauri plugin and the browser FileReader. This is the path taken by the
     *   headless Node.js pipeline.
     * @returns {Promise<{newFiles: Array, newData: Array, allColumns: Array}>}
     */
    static async loadFiles(files, { ioProvider } = {}) {
        const newFiles = [];
        const newData = [];
        let allColumns = [];

        const isTauri = typeof window !== 'undefined' && Boolean(window.__TAURI__ || window.__TAURI_IPC__);

        await Promise.all(files.map(async file => {
            try {
                if (ioProvider && file.path) {
                    // Headless / injected IOProvider path — no browser globals required.
                    const csvText = await ioProvider.readFile(file.path);
                    const { headers, data } = parseCSV(csvText);

                    if (!headers || headers.length === 0) throw new Error('No headers found');
                    newFiles.push({ name: file.name, headers });
                    const taggedData = data.map(row => ({ ...row, _sourceFile: file.name }));
                    newData.push(...taggedData);
                    allColumns = [...allColumns, ...headers.map(h => ({
                        name: h,
                        file: file.name,
                        uniqueId: `${h}::${file.name}`
                    }))];
                } else if (isTauri && file.path) {
                    const { readTextFile } = await import('@tauri-apps/plugin-fs');
                    const csvText = await readTextFile(file.path);
                    const { headers, data } = parseCSV(csvText);

                    if (!headers || headers.length === 0) throw new Error('No headers found');
                    newFiles.push({ name: file.name, headers });
                    const taggedData = data.map(row => ({ ...row, _sourceFile: file.name }));
                    newData.push(...taggedData);
                    allColumns = [...allColumns, ...headers.map(h => ({
                        name: h,
                        file: file.name,
                        uniqueId: `${h}::${file.name}`
                    }))];
                } else {
                    // Browser/webview: use FileReader
                    await new Promise((resolve) => {
                        const reader = new FileReader();
                        reader.onload = (e) => {
                            try {
                                const { headers, data } = parseCSV(e.target.result);
                                if (!headers || headers.length === 0) throw new Error('No headers found');
                                newFiles.push({ name: file.name, headers });
                                const taggedData = data.map(row => ({ ...row, _sourceFile: file.name }));
                                newData.push(...taggedData);
                                allColumns = [...allColumns, ...headers.map(h => ({
                                    name: h,
                                    file: file.name,
                                    uniqueId: `${h}::${file.name}`
                                }))];
                            } catch (err) {
                                console.error(`Error parsing file ${file.name}:`, err);
                                alert(`Error parsing file ${file.name}: ${err.message}`);
                            }
                            resolve();
                        };
                        reader.onerror = (err) => {
                            console.error(`Error reading file ${file.name}:`, err);
                            alert(`Error reading file ${file.name}`);
                            resolve();
                        };
                        reader.readAsText(file);
                    });
                }
            } catch (err) {
                console.error(`Error loading file ${file.name}:`, err);
                alert(`Error loading file ${file.name}: ${err.message}`);
            }
        }));

        return { newFiles, newData, allColumns };
    }

    static filterValidData(csvData, xAxisInfo, yAxisInfos) {
        const hasYAxes = Array.isArray(yAxisInfos) && yAxisInfos.length > 0;

        const validData = csvData.filter(d => {
            const xValue = d[xAxisInfo.columnName];
            // Relaxed validation: allow any defined value that isn't null/undefined/empty string
            // We handle specific type checks (like isNaN) in the renderers/scale factory if needed
            const xValid = xValue !== undefined && xValue !== null && xValue !== '';

            if (!xValid) {
                return false;
            }

            if (!hasYAxes) {
                return true;
            }

            // For multiple series (like bar charts), allow rows with at least one valid Y value
            return yAxisInfos.some(yInfo => {
                if (yInfo.columnName === '__frequency__') return true;
                const yValue = d[yInfo.columnName];
                // For Y-axis, we generally still expect numbers for most charts, 
                // BUT some advanced charts might use categories on Y. 
                // For now, let's keep Y-axis numeric-focused but allow nulls (gaps)
                // If it's a number, check isNaN. If it's not a number, check if it's defined.
                if (typeof yValue === 'number') {
                    return !isNaN(yValue);
                }
                return yValue !== undefined && yValue !== null && yValue !== '';
            });
        });

        debugLog('[FileService] filterValidData:', {
            totalRows: csvData.length,
            validRows: validData.length,
            xAxis: xAxisInfo.columnName,
            yAxes: yAxisInfos.map(y => y.columnName)
        });

        return validData;
    }
}
