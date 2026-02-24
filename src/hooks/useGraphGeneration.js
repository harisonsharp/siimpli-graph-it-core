/**
 * @fileoverview Deprecated hook for graph generation.
 * Replaced by useGraphRenderer and useBatchGraphRenderer.
 *
 * @author Harison Sharp
 * @since 0.2.0
 * @deprecated Since 0.4.0
 * @module useGraphGeneration
 * @exports useGraphGeneration
 */
import { useRef, useCallback } from 'react';
import { useGraphRenderer } from './useGraphRenderer.js';
import { useError } from '../contexts/ErrorContext.jsx';
import { debugLog, debugWarn } from '../index.js';

export const useGraphGeneration = (logoImage) => {
    const { handleError } = useError();
    const hasWarnedRef = useRef(false);

    if (!hasWarnedRef.current && typeof window !== 'undefined') {
        debugWarn('[DEPRECATED] useGraphGeneration is deprecated. Switch to useGraphRenderer or useBatchGraphRenderer.');
        hasWarnedRef.current = true;
    }

    const { generateGraph } = useGraphRenderer({
        csvData: [],
        graphConfig: {},
        curveFits: [],
        globalSettings: { graphDimensions: { width: 800, height: 600 }, colorScheme: 'warm-cool' },
        logoImage,
        logoReady: true,
        getAxisIntercepts: () => ({ x: 0, y: 0 }),
        colorSchemes: {},
        isBatchMode: true
    });

    const legacyGenerateGraph = useCallback((csvData, config, svgRef, globalSettings, colorSchemes, getAxisIntercepts) => {
        try {
            return generateGraph(
                svgRef,
                null,
                (error) => handleError(error, 'Failed to generate graph'),
                {
                    csvData,
                    graphConfig: config,
                    globalSettings,
                    colorSchemes,
                    logoImage,
                    logoReady: true,
                    curveFits: config.curveFits || [],
                    isBatchMode: true
                }
            );
        } catch (error) {
            handleError(error, 'Failed to generate graph');
            return false;
        }
    }, [generateGraph, handleError, logoImage]);

    return { generateGraph: legacyGenerateGraph };
};
