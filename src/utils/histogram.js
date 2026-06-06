
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


//  THE MAIN FUNCTION 

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
function generateCustomBins(dataSeries, numBinsOverride = null, skipOutliers = false, domainMin = null, domainMax = null) {
    let bulkData, outliers;

    if (!skipOutliers && dataSeries && dataSeries.length > 100) {
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

    // Use caller-supplied domain bounds (e.g. from staticScales) so bin edges
    // land on whole numbers instead of the data's actual min/max.
    const hasDomain = domainMin !== null && Number.isFinite(domainMin) &&
                      domainMax !== null && Number.isFinite(domainMax);
    const rangeMin = hasDomain ? domainMin : Math.min(...bulkData);
    const rangeMax = hasDomain ? domainMax : Math.max(...bulkData);

    let desiredNumBins;
    if (numBinsOverride && Number.isFinite(numBinsOverride) && numBinsOverride >= 1) {
        desiredNumBins = Math.round(numBinsOverride);
    } else {
        const fdBin = FreedmanDiaconis(bulkData);
        const heapingBin = getHeapingAwareBinSize(bulkData, fdBin);
        const binWidth = heapingBin || fdBin;
        desiredNumBins = Math.max(1, Math.ceil((rangeMax - rangeMin) / binWidth));
    }

    const finalBinWidth = (rangeMax - rangeMin) / desiredNumBins;

    // When a fixed domain is supplied each bin value is a whole number (e.g. 5, 8, 10).
    // Shift bin edges left by half a bin so bars are centered on those whole numbers
    // rather than spanning [5,6) — i.e. the 5% bar becomes [4.5, 5.5).
    const binOffset = hasDomain ? finalBinWidth / 2 : 0;

    // Build bins
    const bins = [];
    for (let i = 0; i < desiredNumBins; i++) {
        bins.push({
            label: `Bin ${i + 1}`,
            min: rangeMin + i * finalBinWidth - binOffset,
            max: rangeMin + (i + 1) * finalBinWidth - binOffset,
            values: [],
            isOutlierBin: false
        });
    }

    // Outlier bin — only added when outlier splitting is active
    const outlierBin = {
        label: 'Outliers',
        min: -Infinity,
        max: Infinity,
        values: [],
        isOutlierBin: true
    };
    if (!skipOutliers) bins.push(outlierBin);

    // Assign values to bins
    for (const value of dataSeries) {
        if (value < rangeMin || value > rangeMax) {
            if (!skipOutliers) outlierBin.values.push(value);
            // when skipOutliers, values outside domain are simply dropped (they
            // are genuinely out of the declared range, not statistical outliers)
        } else {
            // With centered bins use round so 7.5 → bin for 8, 7.25 → bin for 7.
            // Without centering use floor (original behaviour).
            let binIndex = hasDomain
                ? Math.round((value - rangeMin) / finalBinWidth - 0.5)
                : Math.floor((value - rangeMin) / finalBinWidth);
            if (binIndex < 0) binIndex = 0;
            if (binIndex >= desiredNumBins) binIndex = desiredNumBins - 1;
            bins[binIndex].values.push(value);
        }
    }

    return bins;
}

/**
 * Generates histogram bins stacked by categorical grouping column 
 * 
 * Unlike generateCustomBins (which bins a flat number array), this function takes an array of row objects
 * and produces per group counts inside each bin so the rendered can draw stacked bars. All groups share identical bin boundaries
 * bin structure is derivec from the full x dataset, then each row is assigned to its bin and its group bucket. 
 * @param {Object[]} data              - Array of row objects from the data source.
 * @param {string}   xColumnName       - Key on each row for the numeric x value (e.g. 'base_case_discount_rate').
 * @param {string}   stackByColumnName - Key on each row for the category label (e.g. 'commodity_group').
 * @param {number|null} numBinsOverride - Forces this many bins (same as generateCustomBins).
 * @param {boolean}  skipOutliers      - Drop values outside the declared domain instead of bucketing them.
 * @param {number|null} domainMin      - Lower bound from staticScales.x.min.
 * @param {number|null} domainMax      - Upper bound from staticScales.x.max.
 * @returns {Array<{min, max, label, isOutlierBin, groups: Object, total: number}>}
 */
function generateStackedBins(
    data,
    xColumnName,
    stackByColumnName,
    numBinsOverride = null,
    skipOutliers    = false,
    domainMin       = null,
    domainMax       = null
) {
    //  1. Extract flat x values and discover all unique group labels 
    const xValues  = [];
    const groupSet = new Set();

    for (const row of data) {
        const x     = Number(row[xColumnName]);
        const group = row[stackByColumnName];
        if (Number.isFinite(x)) xValues.push(x);
        if (group != null && group !== '') groupSet.add(String(group));
    }

    // Sorted so group order is deterministic (same order = same legend every render)
    const groupNames = [...groupSet].sort();

    //  2. Build the bin skeleton using the existing logic 
    // generateCustomBins handles domain clamping, bin centering, outlier logic, etc.
    // We reuse it on the full x array to get consistent bin boundaries, then
    // throw away the .values arrays — we recount per group below.
    const skeletonBins = generateCustomBins(xValues, numBinsOverride, skipOutliers, domainMin, domainMax);

    // Convert skeleton bins → stacked bins (add groups map and total)
    const stackedBins = skeletonBins.map(bin => ({
        min:        bin.min,
        max:        bin.max,
        label:      bin.label,
        isOutlierBin: bin.isOutlierBin,
        // Initialize every known group to 0 so the renderer can iterate reliably
        groups:     Object.fromEntries(groupNames.map(g => [g, 0])),
        total:      0,
    }));

    //  3. Recompute the bin-assignment parameters (must mirror generateCustomBins exactly) 
    const hasDomain = domainMin !== null && Number.isFinite(domainMin) &&
                      domainMax !== null && Number.isFinite(domainMax);

    const rangeMin = hasDomain ? domainMin : (xValues.length ? Math.min(...xValues) : 0);
    const rangeMax = hasDomain ? domainMax : (xValues.length ? Math.max(...xValues) : 1);

    const normalBins = stackedBins.filter(b => !b.isOutlierBin);
    const outlierBin = stackedBins.find(b => b.isOutlierBin) ?? null;
    const n          = normalBins.length || 1;
    const binWidth   = (rangeMax - rangeMin) / n;

    //  4. Walk every row and assign to the right bin + group 
    for (const row of data) {
        const x     = Number(row[xColumnName]);
        const group = String(row[stackByColumnName] ?? '');

        if (!Number.isFinite(x)) continue;

        if (x < rangeMin || x > rangeMax) {
            // Outside declared domain — route to outlier bin if one exists
            if (!skipOutliers && outlierBin) {
                outlierBin.groups[group] = (outlierBin.groups[group] ?? 0) + 1;
                outlierBin.total++;
            }
            continue;
        }

        // Exact mirror of the bin-index formula in generateCustomBins
        let binIndex = hasDomain
            ? Math.round((x - rangeMin) / binWidth - 0.5)
            : Math.floor((x - rangeMin) / binWidth);
        if (binIndex < 0) binIndex = 0;
        if (binIndex >= normalBins.length) binIndex = normalBins.length - 1;

        const bin = normalBins[binIndex];
        if (bin) {
            bin.groups[group] = (bin.groups[group] ?? 0) + 1;
            bin.total++;
        }
    }

    return stackedBins;
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

export { generateCustomBins, generateStackedBins };