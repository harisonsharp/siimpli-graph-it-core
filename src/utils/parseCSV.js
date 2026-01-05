
/**
 * Parses a CSV string into an object containing headers and data rows.
 * Supports robust type inference for Numbers, Booleans, Dates, and NULLs.
 *
 * @param {string} csvText - The CSV content as a string.
 * @returns {{ headers: string[], data: Object[] }} An object with `headers` (array of column names)
 *   and `data` (array of row objects).
 */
/**
 * Helper to parse dates with multiple formats
 */
const parseDate = (value) => {
    // 1. ISO Format (YYYY-MM-DD)
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        const parts = value.split('-');
        return new Date(Number.parseInt(parts[0], 10), Number.parseInt(parts[1], 10) - 1, Number.parseInt(parts[2], 10));
    }

    // 2. US Format (MM/DD/YYYY or MM-DD-YYYY)
    const parts = value.split(/[-/]/);
    if (parts.length === 3 && !/[a-zA-Z]/.test(value)) {
        const p1 = Number.parseInt(parts[0], 10);
        const p2 = Number.parseInt(parts[1], 10);
        const p3 = Number.parseInt(parts[2], 10);

        if (p1 > 1000) { // YYYY-MM-DD
            return new Date(p1, p2 - 1, p3);
        }

        if (p3 > 1000) {
            if (p1 > 12) { // DD-MM-YYYY
                return new Date(p3, p2 - 1, p1);
            }
            // Default to US MM/DD/YYYY
            return new Date(p3, p1 - 1, p2);
        }
    }

    // 3. Underscore format (DD_MM_YYYY)
    if (/^\d{2}_\d{2}_\d{4}$/.test(value)) {
        const parts = value.split('_');
        return new Date(parts[2], parts[1] - 1, parts[0]);
    }

    // 4. Named Month (DD-Mon-YYYY or DD Mon YYYY)
    const namedMatch = value.match(/^(\d{1,2})[- ]([a-zA-Z]+)[- ](\d{4})$/);
    if (namedMatch) {
        const day = Number.parseInt(namedMatch[1], 10);
        const monthStr = namedMatch[2].toLowerCase();
        const year = Number.parseInt(namedMatch[3], 10);

        const monthMap = {
            jan: 0, january: 0,
            feb: 1, february: 1,
            mar: 2, march: 2,
            apr: 3, april: 3,
            may: 4,
            jun: 5, june: 5,
            jul: 6, july: 6,
            aug: 7, august: 7,
            sep: 8, september: 8,
            oct: 9, october: 9,
            nov: 10, november: 10,
            dec: 11, december: 11
        };

        let monthIndex = monthMap[monthStr];
        if (monthIndex === undefined) {
            const prefix = monthStr.substring(0, 3);
            monthIndex = monthMap[prefix];
        }

        if (monthIndex !== undefined) {
            return new Date(year, monthIndex, day);
        }
    }

    // Fallback to native parsing
    if (/[a-zA-Z]/.test(value) || /[-/_]/.test(value)) {
        const d = new Date(value);
        if (!Number.isNaN(d.getTime())) return d;
    }

    return null;
};

/**
 * Helper to process a single row
 */
const processRow = (line, headers, splitRegex, cleanValue) => {
    const values = line.split(splitRegex).map(v => cleanValue(v));
    const row = {};
    headers.forEach((header, index) => {
        const rawValue = values[index] || '';

        // 1. NULLs
        if (['null', 'NULL', 'NA', 'N/A', 'nan', 'NaN'].includes(rawValue)) {
            row[header] = null;
            return;
        }

        if (rawValue === '') {
            row[header] = '';
            return;
        }

        // 2. Booleans
        const lowerVal = rawValue.toLowerCase();
        if (lowerVal === 'true') {
            row[header] = true;
            return;
        }
        if (lowerVal === 'false') {
            row[header] = false;
            return;
        }

        // 3. Numbers
        if (!Number.isNaN(Number(rawValue)) && rawValue.trim() !== '') {
            row[header] = Number.parseFloat(rawValue);
            return;
        }

        // 4. Dates
        if (/[-/_]/.test(rawValue) || /\d{4}/.test(rawValue) || /[a-zA-Z]{3,}/.test(rawValue)) {
            const dateVal = parseDate(rawValue);
            if (dateVal && !Number.isNaN(dateVal.getTime())) {
                row[header] = dateVal;
                return;
            }
        }

        // 5. Fallback to String
        row[header] = rawValue;
    });
    return row;
};

export const parseCSV = (csvText) => {
    const lines = csvText.split('\n').filter(line => line.trim());
    if (lines.length === 0) return { headers: [], data: [] };

    // Regex to split by comma, but ignore commas inside double quotes
    const splitRegex = /,(?=(?:(?:[^"]*"){2})*[^"]*$)/;

    // Helper to clean values: remove surrounding quotes and unescape double quotes
    const cleanValue = (val) => {
        const trimmed = val.trim();
        if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
            return trimmed.slice(1, -1).replaceAll('""', '"');
        }
        return trimmed;
    };

    const headers = lines[0].split(splitRegex).map(h => cleanValue(h));

    const data = lines.slice(1).map(line => processRow(line, headers, splitRegex, cleanValue));

    return { headers, data };
};
