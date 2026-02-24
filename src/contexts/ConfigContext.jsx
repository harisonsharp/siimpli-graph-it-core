import React, { createContext, useContext, useState } from 'react';
import { DEFAULT_GRAPH_CONFIG, DEFAULT_CURVE_FIT, CURVE_FIT_COLORS, DEFAULT_SERIES_CONFIG } from '@siimpli/graph-it-core';
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
import { debugLog, debugWarn } from '@siimpli/graph-it-core';

const ConfigContext = createContext();

export const ConfigProvider = ({ children }) => {
    const [graphConfig, setGraphConfig] = useState(DEFAULT_GRAPH_CONFIG);
    const [curveFits, setCurveFits] = useState([
        { ...DEFAULT_CURVE_FIT, color: '#ff6b6b' }
    ]);
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


    const updateGraphConfig = (updates) => {
        if (!updates || typeof updates !== 'object') {
            debugWarn('Invalid updates provided to updateGraphConfig');
            return;
        }
        setGraphConfig(prev => ({ ...prev, ...updates }));
    };

    const addSeries = () => {
        setGraphConfig(prev => ({
            ...prev,
            series: [...prev.series, { ...DEFAULT_SERIES_CONFIG }]
        }));
    };

    const removeSeries = (index) => {
        setGraphConfig(prev => ({
            ...prev,
            series: prev.series.filter((_, i) => i !== index)
        }));
    };

    const updateSeries = (index, updates) => {
        setGraphConfig(prev => ({
            ...prev,
            series: prev.series.map((s, i) => i === index ? { ...s, ...updates } : s)
        }));
    };

    const moveSeries = (fromIndex, toIndex) => {
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
    };

    const updateCurveFit = (index, field, value) => {
        if (typeof index !== 'number' || index < 0 || index >= curveFits.length) {
            debugWarn('Invalid index provided to updateCurveFit');
            return;
        }
        if (!field || typeof field !== 'string') {
            debugWarn('Invalid field provided to updateCurveFit');
            return;
        }
        setCurveFits(prev => prev.map((fit, i) =>
            i === index ? { ...fit, [field]: value } : fit
        ));
    };

    const addCurveFit = () => {
        const colors = ['#ff6b6b', '#4ecdc4', '#45b7d1', '#96ceb4', '#ffeaa7', '#dda0dd'];
        const newColor = colors[curveFits.length % colors.length];
        setCurveFits(prev => [...prev, { ...DEFAULT_CURVE_FIT, color: newColor }]);
    };

    const removeCurveFit = () => {
        setCurveFits(prev => prev.slice(0, -1));
    };

    const updateGlobalSettings = (updates) => {
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
    };

    const resetConfig = () => {
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
    };

    const contextValue = {
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
        updateGlobalSettings,
        resetConfig
    };

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
