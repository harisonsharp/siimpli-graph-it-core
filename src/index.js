/**
 * @siimpli/graph-it-core
 * Shared logic and components for SiimpliGraphIt visualization system
 */

// Constants
export * from './constants.js';

// Utils
export * from './utils/debug.js';
export * from './utils/graphUtils.js';
export * from './utils/axisUtils.js';
export * from './utils/dataUtils.js';
export * from './utils/columnUtils.js';
export * from './utils/curveFittingUtils.js';
export * from './utils/dualAxisUtils.js';
export * from './utils/histogram.js';
export * from './utils/parseCSV.js';
export * from './utils/statisticsUtils.js';
export * from './utils/watermarkUtils.js';
export * from './utils/batchConfigAdapter.js';
export * from './utils/SymbolFactory.js';
export * from './utils/MathUtils.js';
export * from './utils/mathUtils.js';

// Services
export * from './services/GraphService.js';
export * from './services/FileService.js';
export * from './services/ExportService.js';
export * from './services/ImageExportService.js';
export * from './services/CoordinateService.js';
export * from './services/CanvasSizer.js';
export * from './services/SvgPlottingService.js';
export * from './services/HeadlessGraphService.js';
export * from './services/FileNameParsingService.js';
export * from './io/IOProvider.js';
export * from './io/TauriIOProvider.js';
// Rendering
export * from './rendering/ScaleFactory.js';
export * from './rendering/ChartRenderers/ChartRendererFactory.js';
export * from './rendering/ChartRenderers/BaseChartRenderer.js';
export * from './rendering/ChartRenderers/ScatterChartRenderer.js';
export * from './rendering/ChartRenderers/LineChartRenderer.js';
export * from './rendering/ChartRenderers/BarChartRenderer.js';
export * from './rendering/ChartRenderers/HistogramRenderer.js';
export * from './rendering/GraphCompositionRenderer.js';
export * from './rendering/DataTableRenderer.js';
export * from './rendering/LegendRenderer.js';
export * from './rendering/UnifiedTableRenderer.js';
export * from './rendering/BiasTableRenderer.js';
export * from './rendering/LogoRenderer.js';
export * from './rendering/AnnotationRenderer.js';

// Core
export * from './core/services/BatchProcessingService.js';
export * from './core/validation/ConfigValidator.js';
export * from './core/validation/DataValidator.js';
export { renderGraph } from './core/renderGraph.js';

// Note: React-dependent exports are commented out to prevent JSX loading errors in headless environment
// These are only used by the GUI (@siimpli/graph-it) and not the headless CLI
// export * from './contexts/ErrorContext.jsx';
// export * from './contexts/ConfigContext.jsx';
// export * from './components/GraphController.jsx';
// export * from './hooks/useGraphRenderer.js';
// export * from './hooks/useGraphGeneration.js';
