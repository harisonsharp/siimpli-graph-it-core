import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { DEFAULT_GRAPH_CONFIG, DEFAULT_CURVE_FIT, DEFAULT_SERIES_CONFIG, DEFAULT_BOUND } from '../constants.js';
/**
 * @fileoverview React Context provider for centralized application state management and configuration.
 * Manages graph settings, curve fit parameters, and global application state with validation and persistence.
 *
 * @author Harison Sharp
 * @since 0.2.0
 *
 * @component React Context Provider
 * @type {React.Context}
 *
 * @requires react - Core React library for context creation and state management
 * @requires ./constants.js - Default configuration values and constants
 *
 * @exports ConfigProvider - Context provider component wrapping application
 * @exports useConfig - Custom hook for accessing configuration context
 *
 * @provides graphConfig - Current graph configuration state
 * @provides curveFits - Array of curve fitting configurations
 * @provides globalSettings - Application-wide settings (colors, dimensions, intercepts)
 * @provides updateGraphConfig - Function to update graph settings
 * @provides updateGlobalSettings - Function to update global settings
 * @provides updateCurveFit - Function to modify individual curve fit parameters
 * @provides addCurveFit - Function to add new curve fit
 * @provides removeCurveFit - Function to remove curve fit
 * @provides updateGlobalSettings - Function to update global settings
 * @provides resetConfig - Function to restore default configuration
 *
 * @example
 * <ConfigProvider><App /></ConfigProvider>
 * const { graphConfig, updateGraphConfig } = useConfig();
 *
 * @relatedFiles All components - Provides centralized state to entire application
 */
import { debugLog, debugWarn } from '../utils/debug.js';

const ConfigContext = createContext();

export const ConfigProvider = ({ children }) => {
    const [graphConfig, setGraphConfig] = useState(DEFAULT_GRAPH_CONFIG);
    const [curveFits, setCurveFits] = useState([
        { ...DEFAULT_CURVE_FIT, color: '#ff6b6b' }
    ]);
    // const [bounds, setBounds] = useState([
    //     { ...DEFAULT_BOUND, color: '#ff6b6b' }
    // ]);
    const [globalSettings, setGlobalSettings] = useState({
        colorScheme: 'green-red',
        axisIntercept: 'origin',
        customIntercept: { x: 0, y: 0 },
        graphDimensions: { width: 800, height: 600 },
        showGuideLines: false,
        showDataTable: false,
        showStaticTable: false,
        selectedXValue: null
    });


    const updateGraphConfig = useCallback((updates) => {
        if (!updates || typeof updates !== 'object') {
            debugWarn('Invalid updates provided to updateGraphConfig');
            return;
        }
        setGraphConfig(prev => ({ ...prev, ...updates }));
    }, []);

    const addSeries = useCallback(() => {
        setGraphConfig(prev => ({
            ...prev,
            series: [...prev.series, { ...DEFAULT_SERIES_CONFIG }]
        }));
    }, []);

    const removeSeries = useCallback((index) => {
        setGraphConfig(prev => ({
            ...prev,
            series: prev.series.filter((_, i) => i !== index)
        }));
    }, []);

    const updateSeries = useCallback((index, updates) => {
        setGraphConfig(prev => ({
            ...prev,
            series: prev.series.map((s, i) => i === index ? { ...s, ...updates } : s)
        }));
    }, []);

    const moveSeries = useCallback((fromIndex, toIndex) => {
        if (fromIndex === toIndex) return;
        setGraphConfig(prev => {
            const newSeries = [...prev.series];
            const [movedSeries] = newSeries.splice(fromIndex, 1);
            newSeries.splice(toIndex, 0, movedSeries);
            return {
                ...prev,
                series: newSeries
            };
        });
    }, []);

    const updateCurveFit = useCallback((index, field, value) => {
        setCurveFits(prev => {
            if (typeof index !== 'number' || index < 0 || index >= prev.length) {
                debugWarn('Invalid index provided to updateCurveFit');
                return prev;
            }
            if (!field || typeof field !== 'string') {
                debugWarn('Invalid field provided to updateCurveFit');
                return prev;
            }
            return prev.map((fit, i) => i === index ? { ...fit, [field]: value } : fit);
        });
    }, []);

    // const updateBound = useCallback((index, field, value) => {
    //     setBounds(prev)
    // }, []);
    const addCurveFit = useCallback(() => {
        const colors = ['#ff6b6b', '#4ecdc4', '#45b7d1', '#96ceb4', '#ffeaa7', '#dda0dd'];
        setCurveFits(prev => {
            const newColor = colors[prev.length % colors.length];
            return [...prev, { ...DEFAULT_CURVE_FIT, color: newColor }];
        });
    }, []);

    const removeCurveFit = useCallback(() => {
        setCurveFits(prev => prev.slice(0, -1));
    }, []);

    const loadCurveFits = useCallback((fits) => {
        if (!Array.isArray(fits) || fits.length === 0) return;
        setCurveFits(fits);
    }, []);

    const updateGlobalSettings = useCallback((updates) => {
        if (!updates || typeof updates !== 'object') {
            debugWarn('Invalid updates provided to updateGlobalSettings');
            return;
        }
        const stack = (new Error()).stack;
        setGlobalSettings(prev => {
            const next = { ...prev, ...updates };
            debugLog('[ConfigContext] setGlobalSettings -> next:', next, 'from:', prev, 'stack:', stack);
            return next;
        });
    }, []);

    const resetConfig = useCallback(() => {
        setGraphConfig(DEFAULT_GRAPH_CONFIG);
        setCurveFits([
            { ...DEFAULT_CURVE_FIT, color: '#ff6b6b' }
        ]);
        setGlobalSettings({
            colorScheme: 'warm-cool',
            axisIntercept: 'origin',
            customIntercept: { x: 0, y: 0 },
            graphDimensions: { width: 800, height: 600 },
            showGuideLines: false,
            showDataTable: false,
            showStaticTable: false,
            selectedXValue: null
        });
    }, []);

    const contextValue = useMemo(() => ({
        graphConfig,
        curveFits,
        globalSettings,
        updateGraphConfig,
        addSeries,
        removeSeries,
        updateSeries,
        moveSeries,
        updateCurveFit,
        addCurveFit,
        removeCurveFit,
        loadCurveFits,
        updateGlobalSettings,
        resetConfig
    }), [graphConfig, curveFits, globalSettings,
        updateGraphConfig, addSeries, removeSeries,
        updateSeries, moveSeries, updateCurveFit,
        addCurveFit, removeCurveFit, loadCurveFits, updateGlobalSettings, resetConfig
    ]);

    return (
        <ConfigContext.Provider value={contextValue}>
            {children}
        </ConfigContext.Provider>
    );
};

export const useConfig = () => {
    const context = useContext(ConfigContext);
    if (!context) {
        throw new Error('useConfig must be used within ConfigProvider');
    }
    return context;
};
