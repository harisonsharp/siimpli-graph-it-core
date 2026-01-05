
/**
 * @fileoverview Histogram utilities for adaptive binning and heaping detection.
 *
 * Core functionality:
 * - Outlier partitioning via percentile thresholds
 * - Freedman–Diaconis rule for optimal bin width
 * - Custom bin generation with support for outlier bins
 * - Detection of "heaped" values caused by human rounding behavior
 * - Proposal of candidate bin sizes and scoring for significance
 * @author Liam Coady
 * @since 0.2.0
 * @module histogramUtils
 *
 * @functions
 * divideDataForBins(dataSeries) → {Object}
 * FreedmanDiaconis(data) → {number|null}
 * generateCustomBins(dataSeries) → {Array<Object>}
 * calculateHeapingScores(data, base, tolerance) → {number}
 * proposeTestBins(data) → {Array<number>}
 * getHeapingAwareBinSize(data, fdBin) → {number|null}
 * @requesire Math
 * @example
 * const bins = generateCustomBins(myData);
 * debugLog(bins[0].label, bins[0].values.length);
 *
 * @related findPercentile
 */
import { debugLog, debugWarn } from './debug.js';

function ambiguousDate(dates) {
    const sampleDate = dates[0];
    const separator = sampleDate.includes('-') ? '-' : '/';
    const parts = sampleDate.split(separator);
    const yearIndex = parts.findIndex(part => part.length === 4);
    const otherIndices = [0, 1, 2].filter(i => i !== yearIndex);
    let dayIndex = null, monthIndex = null;

    for (let d of dates) {
        const p = d.split(separator);
        const val1 = parseInt(p[otherIndices[0]], 10);
        const val2 = parseInt(p[otherIndices[1]], 10);

        if (val1 > 12) {
            dayIndex = otherIndices[0];
            monthIndex = otherIndices[1];
            break;
        } else if (val2 > 12) {
            dayIndex = otherIndices[1];
            monthIndex = otherIndices[0];
            break;
        }
    }
    // Assume first is month if we can't figure this one out too simply, in worst case need 
    // prediction algorithm defiitly not in scope of this project
    if (dayIndex === null) {
        monthIndex = otherIndices[0];
        dayIndex = otherIndices[1];
    }

    return [dayIndex, monthIndex];
}

function standardizeDates(dates) {
    if (!dates || dates.length === 0) {
        debugWarn("Date array is empty.");
        return [];
    }

    const sampleDate = dates[0];
    const separator = sampleDate.includes('-') ? '-' : '/';
    const parts = sampleDate.split(separator);

    if (parts.length !== 3) {
        debugWarn("Date format is not recognized. Expected 3 parts separated by '-' or '/'.");
        return [];
    }
    const yearIndex = parts.findIndex(part => part.length === 4);
    if (yearIndex === -1) {
        debugWarn("Could not find a 4-digit year in the sample date.");
        return [];
    }

    const otherIndices = [0, 1, 2].filter(i => i !== yearIndex);
    let monthIndex, dayIndex;

    const val1 = parseInt(parts[otherIndices[0]], 10);
    const val2 = parseInt(parts[otherIndices[1]], 10);

    if (val1 > 12) {
        dayIndex = otherIndices[0];
        monthIndex = otherIndices[1];
    } else if (val2 > 12) {
        dayIndex = otherIndices[1];
        monthIndex = otherIndices[0];
    } else {
        // ambiguous: Try to infer
        const cols = ambiguousDate(dates);
        dayIndex = cols[0];
        monthIndex = cols[1];
    }

    // normalize all dates and convert to js date objects for plotting
    return dates.map(d => {
        const parts = d.split(separator);
        const year = parseInt(parts[yearIndex], 10);
        const month = parseInt(parts[monthIndex], 10).toString().padStart(2, '0');
        const day = parseInt(parts[dayIndex], 10).toString().padStart(2, '0');
        const isoStr = `${year}-${month}-${day}`;
        return new Date(isoStr);
    });
}

/**
 * Calculates the mean (average) of an array of numbers.
 */
function getMean(arr) {
    if (arr.length === 0) return 0;
    return arr.reduce((a, b) => a + b) / arr.length;
}

/**
 * Calculates the sample standard deviation of an array of numbers.
 */
function getStandardDeviation(arr) {
    const n = arr.length;
    if (n < 2) return 0; // Std dev requires at least 2 points

    const mean = getMean(arr);
    const sumOfSquaredDiffs = arr
        .map(x => (x - mean) ** 2)
        .reduce((a, b) => a + b);

    // Use n-1 for sample standard deviation
    const variance = sumOfSquaredDiffs / (n - 1);
    return Math.sqrt(variance);
}

/**
 * Calculates the Z-score for a given percentile using an approximation.
 * This is the magic part that JS doesn't have built-in.
 * It's an approximation of the inverse of the standard normal CDF.
 * @param {number} p - The percentile (e.g., 99 for 99th).
 */
function getZScoreForPercentile(p) {
    // Convert percentile to a value between 0 and 1
    const alpha = p / 100;

    // Handle edge cases
    if (alpha <= 0.0) return -Infinity;
    if (alpha >= 1.0) return Infinity;

    // A well-known approximation (Abramowitz and Stegun formula 26.2.23)
    let t = alpha < 0.5 ? Math.sqrt(-2.0 * Math.log(alpha)) : Math.sqrt(-2.0 * Math.log(1.0 - alpha));
    const c0 = 2.515517;
    const c1 = 0.802853;
    const c2 = 0.010328;
    const d1 = 1.432788;
    const d2 = 0.189269;
    const d3 = 0.001308;

    let z = t - ((c0 + c1 * t + c2 * t * t) / (1 + d1 * t + d2 * t * t + d3 * t * t));

    return alpha < 0.5 ? -z : z;
}


// --- THE MAIN FUNCTION ---

/**
 * Finds the data value for a percentile assuming a normal distribution.
 * This is the function you want to use for anomaly detection cutoffs.
 * @param {number[]} dataArr - The array of data points (does not need to be sorted).
 * @param {number} p - The percentile to find the cutoff for (e.g., 99 for 99th percentile).
 * @returns {number} The theoretical data value that marks the cutoff.
 */
function findPercentile(dataArr, p) {
    if (dataArr.length < 2) {
        return dataArr.length === 1 ? dataArr[0] : 0;
    }

    const mean = getMean(dataArr);
    const stdDev = getStandardDeviation(dataArr);

    const zScore = getZScoreForPercentile(p);

    const cutoffValue = mean + zScore * stdDev;

    return cutoffValue;
}



function divideDataForBins(dataSeries) {
    let bulkData = [];
    let outliers = [];

    // This could be manually tweaked, how many samples must ther be before we consider cutting out outliers?
    if (!dataSeries || dataSeries.length < 100) {
        return {
            bulkData: dataSeries ? [...dataSeries] : [], outliers: []
        };
    }
    const sortedData = [...dataSeries].sort((a, b) => a - b);

    const lowerBound = findPercentile(sortedData, 1);
    const upperBound = findPercentile(sortedData, 99);
    const k = 0;
    // Partitian here k can be adjused if we want some more margin for our particular plot
    for (const value of dataSeries) {
        if (value <= (lowerBound - value * k) || value >= (upperBound + upperBound * k)) {
            outliers.push(value);
        } else {
            bulkData.push(value);
        }
    }
    return {
        bulkData: bulkData,
        outliers: outliers
    };
}

function FreedmanDiaconis(data) {
    if (!data || data.length < 2) return null;

    const sorted = [...data].sort((a, b) => a - b);
    const q1 = findPercentile(sorted, 25);
    const q3 = findPercentile(sorted, 75);
    const iqr = q3 - q1;

    const rangeMin = sorted[0];
    const rangeMax = sorted[sorted.length - 1];
    const n = sorted.length;

    let binWidth;
    if (iqr > 0) {
        binWidth = (2 * iqr) / Math.cbrt(n);
    } else {
        // fallback: sqrt rule
        binWidth = (rangeMax - rangeMin) / Math.sqrt(n);
    }
    // Should we throw error if we cant get a bin width?
    return binWidth > 0 ? binWidth : null;
}


// This gorups the data into the bins they belong in, makes the graphing app less code heavy by grouping and labelling data in this helper
function generateCustomBins(dataSeries) {
    let bulkData, outliers;

    if (dataSeries && dataSeries.length > 100) {
        ({ bulkData, outliers } = divideDataForBins(dataSeries));
    } else {
        bulkData = [...(dataSeries || [])];
        outliers = [];
    }


    if (bulkData.length < 2) {
        return [{
            label: 'All Data',
            min: -Infinity,
            max: Infinity,
            values: [...dataSeries],
            isOutlierBin: true
        }];
    }

    const rangeMin = Math.min(...bulkData);
    const rangeMax = Math.max(...bulkData);
    const n = bulkData.length;

    let binWidth;
    const fdBin = FreedmanDiaconis(bulkData)

    const heapingBin = getHeapingAwareBinSize(bulkData, fdBin);
    if (heapingBin) {
        binWidth = heapingBin;
    }
    else {
        binWidth = fdBin;
    }

    // Number of bins implied by binWidth
    const desiredNumBins = Math.max(1, Math.ceil((rangeMax - rangeMin) / binWidth));
    const finalBinWidth = (rangeMax - rangeMin) / desiredNumBins;

    // Build bins
    const bins = [];
    for (let i = 0; i < desiredNumBins; i++) {
        bins.push({
            label: `Bin ${i + 1}`,
            min: rangeMin + i * finalBinWidth,
            max: rangeMin + (i + 1) * finalBinWidth,
            values: [],
            isOutlierBin: false
        });
    }

    // Outlier bin
    const outlierBin = {
        label: 'Outliers',
        min: -Infinity,
        max: Infinity,
        values: [],
        isOutlierBin: true
    };
    bins.push(outlierBin);

    // Assign values to bins and return objects with value -> bin pairs
    for (const value of dataSeries) {
        if (value < rangeMin || value > rangeMax) {
            outlierBin.values.push(value);
        } else {
            let binIndex = Math.floor((value - rangeMin) / finalBinWidth);
            if (binIndex >= desiredNumBins) binIndex = desiredNumBins - 1;
            bins[binIndex].values.push(value);
        }
    }

    return bins;
}


function calculateHeapingScores(data, base, tolerance = 1e-9) {
    if (data.length === 0) return 0.0;

    const residuals = data.map(x => (x / base) % 1.0);
    const heaped_count = residuals.reduce(
        (count, r) => count + ((r < tolerance) || (r > 1.0 - tolerance) ? 1 : 0),
        0
    );

    return heaped_count / data.length;
}

function proposeTestBins(data) {
    const mean_val = data.reduce((a, b) => a + b, 0) / data.length;
    if (mean_val <= 0) return [];

    const magnitude = Math.pow(10, Math.floor(Math.log10(mean_val)));
    const normalized_mean = mean_val / magnitude;

    const normalized_base = normalized_mean <= 5 ? 5 : 10;
    const base_val = normalized_base * magnitude;

    const factors = normalized_base === 10
        ? [0.25, 0.1, 0.05, 0.01]
        : [0.2, 0.1, 0.04, 0.02];

    let bins = factors.map(f => base_val * f);
    bins = [...new Set(bins.filter(b => b > 0))].sort((a, b) => a - b);

    return bins;
}

function getHeapingAwareBinSize(data, fdBin) {
    const cleanData = data.filter(x => !Number.isNaN(x));
    if (cleanData.length < 50) {
        debugLog(`Not enough data points (${cleanData.length}) for heaping detection.`);
        return null;
    }

    const testBases = proposeTestBins(cleanData).sort((a, b) => b - a);

    if (fdBin != null) {
        debugLog(`Freedman-Diaconis suggested bin width: ${fdBin.toFixed(2)}`);
    }

    const scores = {};
    let remainingData = [...cleanData];

    for (const base of testBases) {
        const score = calculateHeapingScores(remainingData, base);
        scores[base] = score;

        if (score > 0.15) {
            debugLog(`  - Base: ${base.toFixed(1).padEnd(4, ' ')} | Score: ${score.toFixed(3)} -> Significant. Removing these points for next tests.`);
            remainingData = remainingData.filter(x => {
                const mod = x % base;
                return !((Math.abs(mod) < 1e-9) || (Math.abs(mod - base) < 1e-9));
            });
        } else {
            debugLog(`  - Base: ${base.toFixed(1).padEnd(4, ' ')} | Score: ${score.toFixed(3)}`);
        }
    }
    // Integrated bestHeapingBin logic
    const threshold = 0.30;
    const candidates = Object.entries(scores)
        .map(([key, val]) => [parseFloat(key), val])
        .filter(([b, score]) => score > threshold && (fdBin === null || b >= fdBin))
        .map(([b]) => b)
        .sort((a, b) => a - b);

    if (candidates.length === 0) {
        debugLog(`No significant heaping bin ≥ FD bin (${fdBin}).`);
        return null;
    }

    const chosen = candidates[0];
    debugLog(`Selected heaping-aware bin: ${chosen} (score=${scores[String(chosen)].toFixed(3)})`);
    return chosen;
}

export { generateCustomBins };