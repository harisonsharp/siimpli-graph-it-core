/**
 * @fileoverview Fills `{column}` tokens in chart text from the chart's own data.
 *
 * Lets a template state a number that moves with the data, e.g. a footnote of
 * "2.7 t/m³ assumed for {assumed_density_reports} of {plotted_reports} reports",
 * where the SQL returns each total as a column (the same value on every row).
 *
 * @module dataTokens
 *
 * @exports fillDataTokens
 *
 * @relatedFiles renderGraph.js (fills title, subtitle, provenanceNote and footnote)
 */

const TOKEN_PATTERN = /\{([A-Za-z0-9_.]+)\}/g;

/**
 * Replace each `{column}` token with the first non-blank value of that column.
 * A token naming no column, or a column with no value in any row, is left as
 * written, so a misspelt token shows on the chart rather than printing nothing.
 *
 * @param {string} text - Text that may carry tokens
 * @param {Array<Object>} rows - Parsed data rows, keyed by column name
 * @returns {string} The text with every resolvable token filled
 */
export const fillDataTokens = (text, rows) => {
    if (typeof text !== 'string' || !text.includes('{') || !Array.isArray(rows)) return text;

    return text.replace(TOKEN_PATTERN, (token, column) => {
        for (const row of rows) {
            const value = row?.[column];
            if (value !== undefined && value !== null && String(value).trim() !== '') {
                return String(value).trim();
            }
        }
        return token;
    });
};
