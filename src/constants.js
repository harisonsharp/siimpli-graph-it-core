
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
 * @exports DEFAULT_BOUND - Default parameters for bound lines for curve fit limits
 * @example
 * import { GRAPH_CONFIG, DEFAULT_CURVE_FIT } from './constants.js';
 * const margins = GRAPH_CONFIG.MARGINS;
 *
 * @relatedFiles ConfigContext.jsx, CurveFittingPanel.jsx - Imported by configuration and UI components
 */


export const GRAPH_CONFIG = {
    MARGINS: { top: 60, right: 150, bottom: 120, left: 80 },
    GRID_SIZE: 200,
    LOGO_SIZE: 60,
    DEFAULT_DIMENSIONS: { width: 800, height: 600 },
    CROSSHAIR_SIZE: 15,
    CONTOUR_LEVELS: 10
};

export const WATERMARK_CONFIG = {
    // Visual watermark tile settings used by browser/canvas PNG export.
    seed: 'a4b7e1c8-d9f2-4g5h-6i7j-8k9l0m1n2o3p',
    tilePxSize: 64,
    shadeDifference: 2,
    baseColor: { r: 255, g: 255, b: 255 },

    // Invisible watermark embedding settings used by headless PNG export.
    secret: null,
    domain: 'siimpli-graph-it',
    salt: '',
    version: 1,
    sampleCount: 8192,
    detectionThreshold: 0.58,
};

export const DEFAULT_SERIES_CONFIG = {
    yAxis: '',
    graphType: 'scatter',
    axisAssignment: 'primary', // 'primary' or 'secondary'
    titleName: '',
    color: '',
    strokeWidth: 2,
    colorGrading: {
        enabled: false,
        mode: 'continuous',       // 'continuous' | 'distinct'
        column: '',               // column id string, e.g. "colName::fileName"
        scheme: 'warm-cool',      // for continuous: scheme name from ScaleFactory.COLOR_SCHEMES
        categoryColors: {}        // for distinct: { [categoryValue]: hexColor }
    }
};

export const DEFAULT_GRAPH_CONFIG = {
    xAxis: '',
    informativeFields: [],
    pdfLinking: {
        enabled: false,
        folderPath: '',
        nameField: '',
        fileType: 'pdf'
    },
    series: [{ ...DEFAULT_SERIES_CONFIG }],
    contouring: '',
    graphType: 'scatter', // Kept for backwards compatibility, but series-specific type is preferred
    barMode: 'group', // 'group' or 'stack'
    title: '',
    subtitle: '',
    dualUnits: false,
    scaleFactor: 1,
    fromUnits: '',
    toUnits: '',
    xAxisLabel: '',
    yAxisLabel: '',
    yAxisLabel2: '',
    axisIntercept: 'origin',
    customIntercept: { x: 0, y: 0 },
    staticScales: {
        x: { enabled: false, min: '', max: '', step: '' },
        y: { enabled: false, min: '', max: '', step: '' },
        y2: { enabled: false, min: '', max: '', step: '' }
    },
    dualYAxis: false,
    yAxis2: '',
    showUnifiedTable: false,
    ignoreUnifiedValues: false
};

export const DEFAULT_CURVE_FIT = {
    enabled: true,
    seriesIndex: 0,
    xMin: '',
    color: '#ff6b6b',
    xMax: '',
    fitType: 'best_fit',
    order: 2,
    strokeWidth: 2,
    lineStyle: 'solid',
    customEquation: '',
    confidenceBands: { enabled: false, bands: [] },
    result: null,
    bounds: []
};

export const DEFAULT_BOUND = {
    value: 0,
    color: '#ff6b6b',
    x: 0,
    y: 0,
    height: 0,
    fontSize: 12,
    strokeWidth: 1,
    lineStyle: 'solid'
}
