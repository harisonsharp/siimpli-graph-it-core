/**
 * @fileoverview Custom React hook for graph rendering orchestration.
 * Refactored in Phase 1 to delegate core rendering to the pure Headless renderGraph.
 *
 * @author Harison Sharp
 * @since 0.3.0
 */

import { useCallback } from 'react';
import { renderGraph } from '../core/renderGraph.js';
import { CanvasSizer, DataTableRenderer, debugWarn } from '../index.js';

export function useGraphRenderer({
    csvData,
    graphConfig,
    curveFits = [],
    globalSettings,
    logoImage = null,
    logoReady = true,
    getAxisIntercepts,
    colorSchemes,
    isBatchMode = false,
    onXValueSelect
}) {
    const generateGraph = useCallback((svgRef, onSuccess, onError, overrides = {}) => {
        try {
            const targetGraphConfig = overrides.graphConfig || graphConfig;
            const targetCsvData = overrides.csvData || csvData;
            const targetGlobalSettings = overrides.globalSettings || globalSettings;
            const targetColorSchemes = overrides.colorSchemes || colorSchemes;
            const targetLogoImage = overrides.hasOwnProperty('logoImage') ? overrides.logoImage : logoImage;
            const targetLogoReady = overrides.hasOwnProperty('logoReady') ? overrides.logoReady : logoReady;
            const targetCurveFits = overrides.curveFits ?? curveFits;
            const targetIsBatchMode = overrides.hasOwnProperty('isBatchMode') ? overrides.isBatchMode : isBatchMode;

            if (!targetIsBatchMode && !targetLogoReady) {
                console.warn('Logo not ready yet, delaying graph generation');
                if (onError) onError(new Error('Logo not ready'));
                return false;
            }

            let logoDataUri = null;
            if (targetLogoImage && targetLogoImage.src) {
                logoDataUri = targetLogoImage.src;
            }

            const result = renderGraph({
                svg: svgRef.current,
                csvData: targetCsvData,
                graphConfig: targetGraphConfig,
                globalSettings: targetGlobalSettings,
                curveFits: targetCurveFits,
                logoDataUri,
                colorSchemes: targetColorSchemes,
                isBatchMode: targetIsBatchMode
            });

            if (!result.success) {
                if (onError) onError(new Error(result.error));
                return false;
            }

            if (onSuccess) onSuccess(result);
            return true;
        } catch (error) {
            debugWarn('Failed to generate graph:', error);
            if (onError) onError(error);
            return false;
        }
    }, [
        csvData,
        graphConfig,
        curveFits,
        globalSettings,
        logoImage,
        logoReady,
        getAxisIntercepts,
        colorSchemes,
        isBatchMode,
        onXValueSelect
    ]);

    return { generateGraph };
}
