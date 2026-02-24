import React, { createContext, useContext, useState } from 'react';
/**
 * @fileoverview React Context provider for centralized error handling and user notification management.
 * Provides error state management, automatic error clearing, and consistent error display across the application.
 *
 * @author Harison Sharp
 * @since 0.2.0
 *
 * @component React Context Provider
 * @type {React.Context}
 *
 * @requires react - Core React library for context and state management
 *
 * @exports ErrorProvider - Context provider component for error management
 * @exports useError - Custom hook for accessing error handling functions
 *
 * @provides error - Current error message state
 * @provides showError - Function to display error messages with auto-clear
 * @provides hideError - Function to manually clear current error
 * @provides handleError - Function to log and display errors with user-friendly messages
 *
 * @example
 * <ErrorProvider><App /></ErrorProvider>
 * const { handleError, showError } = useError();
 *
 * @relatedFiles All components - Provides error handling to entire application
 */

const ErrorContext = createContext(undefined, undefined);

export const ErrorProvider = ({ children }) => {
    const [error, setError] = useState(null);
    const [success, setSuccess] = useState(null);

    const showError = (message) => {
        setError(message);
        setTimeout(() => setError(null), 5000);
    };

    const hideError = () => {
        setError(null);
    };

    const handleError = (error, userMessage) => {
        console.error('Application error:', error);
        const message = userMessage || 'An unexpected error occurred. Please try again.';
        showError(message);
    };

    const showSuccess = (message) => {
        setSuccess(message);
        setTimeout(() => setSuccess(null), 3000);
    };

    return (
        <ErrorContext.Provider value={{ error, success, showError, hideError, handleError, showSuccess }}>
            {children}
            {error && (
                <div className="fixed top-4 right-4 bg-red-500 text-white p-4 rounded-lg shadow-lg z-50 max-w-md">
                    <div className="flex items-center justify-between">
                        <span className="text-sm">{error}</span>
                        <button
                            onClick={hideError}
                            className="ml-4 text-white hover:text-gray-200 text-xl font-bold"
                        >
                            ×
                        </button>
                    </div>
                </div>
            )}
            {success && (
                <div className="fixed top-4 right-4 bg-green-500 text-white p-4 rounded-lg shadow-lg z-50 max-w-md">
                    <div className="flex items-center justify-between">
                        <span className="text-sm">{success}</span>
                        <button
                            onClick={() => setSuccess(null)}
                            className="ml-4 text-white hover:text-gray-200 text-xl font-bold"
                        >
                            ×
                        </button>
                    </div>
                </div>
            )}
        </ErrorContext.Provider>
    );
};

export const useError = () => {
    const context = useContext(ErrorContext);
    if (!context) {
        throw new Error('useError must be used within ErrorProvider');
    }
    return context;
};
