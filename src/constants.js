
/**
 * @fileoverview Centralized configuration constants and default values for the scientific data visualization application.
 * Defines graph layout parameters, watermark settings, color schemes, and default configurations for charts and curve fitting.
 *
 * @author Harison Sharp
 * @since 0.2.0
 *
 * @module Configuration Constants
 * @type {Object}
 *
 * @exports GRAPH_CONFIG - Layout dimensions and margins for graph rendering
 * @exports WATERMARK_CONFIG - Settings for background watermark generation
 * @exports COLOR_SCHEMES - Available color palettes for data visualization
 * @exports DEFAULT_GRAPH_CONFIG - Default settings for new graphs
 * @exports DEFAULT_CURVE_FIT - Default parameters for curve fitting operations
 * @exports CURVE_FIT_COLORS - Color palette for multiple curve overlays
 *
 * @example
 * import { GRAPH_CONFIG, DEFAULT_CURVE_FIT } from './constants.js';
 * const margins = GRAPH_CONFIG.MARGINS;
 *
 * @relatedFiles ConfigContext.jsx, CurveFittingPanel.jsx - Imported by configuration and UI components
 */

import { debugLog, debugWarn } from './utils/debug.js';

export const GRAPH_CONFIG = {
    MARGINS: { top: 60, right: 150, bottom: 120, left: 80 },
    GRID_SIZE: 200,
    LOGO_SIZE: 60,
    DEFAULT_DIMENSIONS: { width: 800, height: 600 },
    CROSSHAIR_SIZE: 15,
    CONTOUR_LEVELS: 10
};

export const WATERMARK_CONFIG = {
    seed: 'a4b7e1c8-d9f2-4g5h-6i7j-8k9l0m1n2o3p',
    tilePxSize: 64,
    shadeDifference: 2,
    baseColor: { r: 255, g: 255, b: 255 },
};

export const COLOR_SCHEMES = {
    'warm-cool': 'RdYlBu',
    'rainbow': 'Rainbow',
    'green-red': 'RdYlGn'
};

export const DEFAULT_SERIES_CONFIG = {
    yAxis: '',
    graphType: 'scatter',
    axisAssignment: 'primary', // 'primary' or 'secondary'
    titleName: '',
    color: '',
    strokeWidth: 2,

};

export const DEFAULT_GRAPH_CONFIG = {
    xAxis: '',
    series: [{ ...DEFAULT_SERIES_CONFIG }],
    colorGrading: '',
    contouring: '',
    graphType: 'scatter', // Kept for backwards compatibility, but series-specific type is preferred
    barMode: 'group', // 'group' or 'stack'
    title: '',
    dualUnits: false,
    scaleFactor: 1,
    fromUnits: '',
    toUnits: '',
    xAxisLabel: '',
    yAxisLabel: '',
    yAxisLabel2: '',
    axisIntercept: 'origin',
    customIntercept: { x: 0, y: 0 },
    colorScheme: 'green-red',
    dualYAxis: false,
    yAxis2: '',
};

export const DEFAULT_CURVE_FIT = {
    enabled: true,
    seriesIndex: 0,
    xMin: '',
    xMax: '',
    fitType: 'best_fit',
    order: 2,
    result: null
};

export const CURVE_FIT_COLORS = ['#ff6b6b', '#4ecdc4'];
