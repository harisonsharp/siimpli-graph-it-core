/**
 * @fileoverview Utility helpers to adapt legacy batch configuration objects to the
 * unified graph renderer configuration format.
 * Ensures backward compatibility while the batch pipeline migrates to useGraphRenderer.
 */

/**
 * Normalize a batch configuration object into the structure expected by useGraphRenderer.
 *
 * @param {Object} batchConfig - Legacy batch configuration
 * @returns {Object} Adapted configuration compatible with useGraphRenderer
 */
export function adaptBatchConfig(batchConfig = {}) {
    const graphType = (batchConfig.graphType || 'scatter').toLowerCase();
    const baseSeries = Array.isArray(batchConfig.series) ? batchConfig.series : [];

    if (graphType === 'histogram') {
        return {
            ...batchConfig,
            xAxis: batchConfig.xAxis,
            series: [],
            graphType: 'histogram',
            colorGrading: batchConfig.colorGrading || null,
            contouring: null,
            title: batchConfig.title || null
        };
    }

    const normalizedSeries = baseSeries.length > 0
        ? baseSeries
        : batchConfig.yAxis
            ? [{ yAxis: batchConfig.yAxis }]
            : [];

    return {
        ...batchConfig,
        xAxis: batchConfig.xAxis,
        series: normalizedSeries,
        graphType: graphType,
        colorGrading: batchConfig.colorGrading || null,
        contouring: batchConfig.contouring || null,
        title: batchConfig.title || null
    };
}
