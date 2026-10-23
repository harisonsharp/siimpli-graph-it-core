import React, { useRef, useEffect, useState, forwardRef, useImperativeHandle } from 'react';
import { useGraphRenderer } from '../hooks/useGraphRenderer.js';
import { calculateAxisIntercepts } from '../utils/axisUtils.js';

/**
 * @fileoverview Core Graph Controller component.
 * Acts as the primary interface for rendering graphs from data + config.
 * 
 * @param {Object} props
 * @param {Array} props.csvData - The data to render
 * @param {Object} props.graphConfig - The configuration object
 * @param {Object} props.globalSettings - Global settings (dimensions, styling)
 * @param {Image} props.logoImage - Optional logo image object
 * @param {boolean} props.logoReady - Whether logo is ready
 * @param {Function} props.onGraphGenerated - Callback when rendering is complete
 * @param {boolean} [props.pickValuesOnClick=false] - Lets a click on the plot pick the x
 *   the legend table reads its values at (see rendering/valuePicker.js). Off by default,
 *   since a host that adds its own rows to the legend table would lose them on a click.
 */
export const GraphController = forwardRef(({
    csvData,
    graphConfig,
    globalSettings,
    curveFits = [],
    logoImage,
    logoReady = true,
    onGraphGenerated,
    pickValuesOnClick = false,
    className = "",
    style = {}
}, ref) => {
    const internalSvgRef = useRef(null);
    const internalCanvasRef = useRef(null);
    const [dimensions, setDimensions] = useState(globalSettings?.graphDimensions || { width: 800, height: 600 });

    // Use the hook
    const { generateGraph } = useGraphRenderer({
        csvData,
        graphConfig,
        globalSettings,
        curveFits,
        logoImage,
        logoReady,
        getAxisIntercepts: (x, y, c) => calculateAxisIntercepts(x, y, c || graphConfig, globalSettings),
        colorSchemes: {},
        onXValueSelect: () => { },
        pickValuesOnClick
    });

    useImperativeHandle(ref, () => ({
        generate: () => {
            generateGraph(internalSvgRef, (result) => {
                if (result.finalDimensions) setDimensions(result.finalDimensions);
                if (onGraphGenerated) onGraphGenerated(result);
            }, (err) => console.error(err));
        },
        svg: internalSvgRef.current,
        canvas: internalCanvasRef.current
    }));

    useEffect(() => {
        if (csvData && graphConfig) {
            generateGraph(internalSvgRef, (result) => {
                if (result.finalDimensions) setDimensions(result.finalDimensions);
                if (onGraphGenerated) onGraphGenerated(result);
            }, (err) => console.error("GraphController render error:", err));
        }
    }, [csvData, graphConfig, globalSettings, logoReady]);

    return (
        <div className={`graph-controller-container ${className}`} style={{ overflow: 'auto', ...style }}>
            <svg
                ref={internalSvgRef}
                width={dimensions.width}
                height={dimensions.height}
                className="graph-canvas"
            />
            <canvas
                ref={internalCanvasRef}
                style={{ display: 'none' }}
            />
        </div>
    );
});

export default GraphController;
