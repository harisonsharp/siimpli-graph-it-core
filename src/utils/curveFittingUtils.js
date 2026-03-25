import { parseColumnId } from './columnUtils.js';
import { debugLog, debugWarn } from './debug.js';

// ---------------------------------------------------------------------------
// Safe expression parser for user-entered equations
// Supports: numbers, 'x', 'y', +, -, *, /, ^ (right-associative), parentheses
// e.g. "30.65 * x^(0.2286)"  or  "y * 1.235"
// ---------------------------------------------------------------------------

/**
 * Tokenise an infix expression string into an array of token objects.
 * @param {string} src
 * @returns {Array<{type: string, value: string|number}>}
 */
const tokenise = (src) => {
    const tokens = [];
    let i = 0;
    while (i < src.length) {
        const ch = src[i];
        if (/\s/.test(ch)) { i++; continue; }
        if (/[0-9.]/.test(ch)) {
            let num = '';
            while (i < src.length && /[0-9.eE+-]/.test(src[i])) {
                // Allow 'e+' / 'e-' as part of scientific notation only after 'e'/'E'
                if ((src[i] === '+' || src[i] === '-') && !/[eE]/.test(src[i - 1])) break;
                num += src[i++];
            }
            tokens.push({ type: 'num', value: parseFloat(num) });
        } else if (ch === 'x') {
            tokens.push({ type: 'var', value: 'x' }); i++;
        } else if (ch === 'y') {
            tokens.push({ type: 'var', value: 'y' }); i++;
        } else if ('+-*/^()'.includes(ch)) {
            tokens.push({ type: 'op', value: ch }); i++;
        } else {
            throw new Error(`Unexpected character in equation: '${ch}'`);
        }
    }
    return tokens;
};

/**
 * Recursive-descent parser / evaluator.
 * Returns a compiled function (x, y?) => number.
 * Grammar (EBNF):
 *   expr   = term   { ('+' | '-') term }
 *   term   = power  { ('*' | '/') power }
 *   power  = unary  [ '^' power ]          (right-associative)
 *   unary  = '-' unary | primary
 *   primary = number | 'x' | 'y' | '(' expr ')'
 */
const buildEvaluator = (tokens) => {
    let pos = 0;

    const peek = () => tokens[pos];
    const consume = (val) => {
        if (val !== undefined && tokens[pos]?.value !== val)
            throw new Error(`Expected '${val}' but got '${tokens[pos]?.value}'`);
        return tokens[pos++];
    };

    const parseExpr = () => {
        let left = parseTerm();
        while (peek()?.value === '+' || peek()?.value === '-') {
            const op = consume().value;
            const right = parseTerm();
            const l = left; // closure capture
            const r = right;
            left = op === '+' ? (x, y) => l(x, y) + r(x, y) : (x, y) => l(x, y) - r(x, y);
        }
        return left;
    };

    const parseTerm = () => {
        let left = parsePower();
        while (peek()?.value === '*' || peek()?.value === '/') {
            const op = consume().value;
            const right = parsePower();
            const l = left; const r = right;
            left = op === '*' ? (x, y) => l(x, y) * r(x, y) : (x, y) => l(x, y) / r(x, y);
        }
        return left;
    };

    const parsePower = () => {
        const base = parseUnary();
        if (peek()?.value === '^') {
            consume('^');
            const exp = parsePower(); // right-associative
            return (x, y) => base(x, y) ** exp(x, y);
        }
        return base;
    };

    const parseUnary = () => {
        if (peek()?.value === '-') {
            consume('-');
            const operand = parseUnary();
            return (x, y) => -operand(x, y);
        }
        return parsePrimary();
    };

    const parsePrimary = () => {
        const t = peek();
        if (!t) throw new Error('Unexpected end of expression');
        if (t.type === 'num') { consume(); const v = t.value; return () => v; }
        if (t.type === 'var' && t.value === 'x') { consume(); return (x) => x; }
        if (t.type === 'var' && t.value === 'y') { consume(); return (_x, y) => y; }
        if (t.value === '(') {
            consume('(');
            const inner = parseExpr();
            consume(')');
            return inner;
        }
        throw new Error(`Unexpected token: '${t.value}'`);
    };

    const fn = parseExpr();
    if (pos !== tokens.length)
        throw new Error(`Unexpected token at position ${pos}: '${tokens[pos]?.value}'`);
    return fn;
};

/**
 * Compile an equation string to an evaluator function (x, y?) => number.
 * Throws a descriptive error if parsing fails.
 * @param {string} equation - e.g. "30.65 * x^(0.2286)"
 * @returns {Function}
 */
export const compileEquation = (equation) => {
    if (!equation || typeof equation !== 'string') throw new Error('Equation must be a non-empty string');
    const trimmed = equation.trim();
    // Strip leading "y = " or "y=" prefix if present
    const body = trimmed.replace(/^y\s*=\s*/i, '');
    try {
        return buildEvaluator(tokenise(body));
    } catch (e) {
        throw new Error(`Failed to parse equation "${body}": ${e.message}`);
    }
};

/**
 * Fit a user-supplied equation to data (no regression — equation is taken as-is).
 * Returns rSquared so the user can assess quality.
 * @param {Array<{x:number,y:number}>} data
 * @param {string} equationStr - e.g. "30.65 * x^0.2286"
 * @returns {{ coefficients: null, rSquared: number, equation: string, fitType: 'Custom', evaluator: Function }}
 */
export const fitCustomEquation = (data, equationStr) => {
    const evaluator = compileEquation(equationStr);

    const validData = data.filter(p =>
        p && Number.isFinite(p.x) && Number.isFinite(p.y)
    );
    if (validData.length < 1) throw new Error('No valid data points for R² calculation');

    // Collect only the points used in the fit (positive x, finite prediction)
    // so that meanY and ssTot are computed over the same subset as ssRes.
    const fittedPoints = validData
        .filter(p => p.x > 0)
        .map(p => ({ ...p, yPred: evaluator(p.x) }))
        .filter(p => Number.isFinite(p.yPred));

    if (fittedPoints.length < 1) throw new Error('No valid data points with x > 0 and finite prediction for R² calculation');

    const meanY = fittedPoints.reduce((s, p) => s + p.y, 0) / fittedPoints.length;
    let ssTot = 0, ssRes = 0;

    for (const p of fittedPoints) {
        ssTot += (p.y - meanY) ** 2;
        ssRes += (p.y - p.yPred) ** 2;
    }

    const rSquared = ssTot === 0 ? 1 : Math.max(0, Math.min(1, 1 - ssRes / ssTot));
    // Normalise stored equation to y = ... form
    const normalised = equationStr.trim().replace(/^y\s*=\s*/i, '');

    return {
        coefficients: null,
        evaluator,
        rSquared,
        equation: `y = ${normalised}`,
        fitType: 'Custom',
        dataPoints: validData.length
    };
};

// ---------------------------------------------------------------------------
// Confidence band utilities
// ---------------------------------------------------------------------------

/**
 * Compute asymmetric residual standard deviations from a set of data points
 * and a predictor function, returning separate upper/lower std values.
 *
 * Upper std = std of positive residuals (actual > predicted)
 * Lower std = std of negative residuals (actual < predicted)
 *
 * @param {Array<{x:number,y:number}>} data
 * @param {Function} predictor  (x) => yHat
 * @returns {{ upperStd: number, lowerStd: number, n: number }}
 */
export const computeAsymmetricResidualStd = (data, predictor) => {
    const posRes = [], negRes = [];
    for (const p of data) {
        const yHat = predictor(p.x);
        if (!Number.isFinite(yHat)) continue;
        const r = p.y - yHat;
        if (r >= 0) posRes.push(r);
        else negRes.push(r);
    }

    const stdOf = (arr) => {
        if (arr.length === 0) return 0;
        const mean = arr.reduce((s, v) => s + v, 0) / arr.length;
        const variance = arr.reduce((s, v) => s + (v - mean) ** 2, 0) / arr.length;
        return Math.sqrt(variance);
    };

    return {
        upperStd: stdOf(posRes),
        lowerStd: stdOf(negRes.map(Math.abs)),
        n: posRes.length + negRes.length
    };
};

/**
 * Build a local-std function by binning raw residuals into x-quantile bins and
 * then smoothing the per-bin std values with a Gaussian kernel.
 *
 * Each curve point gets its own upper/lower std estimate interpolated from the
 * smoothed bin values, so the band width reflects the actual spread of data in
 * that region rather than a single global constant.
 *
 * Smoothing prevents the jagged steps that would appear if raw bin boundaries
 * were used directly.
 *
 * @param {Array<{x:number,y:number}>} data
 * @param {Function} predictor  (x) => yHat
 * @param {number}   nBins      number of quantile bins (default 8)
 * @returns {{ upperStdAt: (x:number)=>number, lowerStdAt: (x:number)=>number }}
 */
const buildLocalStdFunctions = (data, predictor, nBins = 8) => {
    const valid = data
        .filter(p => Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(predictor(p.x)))
        .sort((a, b) => a.x - b.x);

    if (valid.length < 4) {
        // Fall back to global std when there is too little data to bin
        const { upperStd, lowerStd } = computeAsymmetricResidualStd(valid, predictor);
        return { upperStdAt: () => upperStd, lowerStdAt: () => lowerStd };
    }

    const actualBins = Math.min(nBins, Math.floor(valid.length / 2));
    const binSize = Math.ceil(valid.length / actualBins);

    // Collect bin centres and per-bin asymmetric std values
    const centres = [], upperStds = [], lowerStds = [];
    for (let b = 0; b < actualBins; b++) {
        const slice = valid.slice(b * binSize, (b + 1) * binSize);
        if (slice.length === 0) continue;
        const { upperStd, lowerStd } = computeAsymmetricResidualStd(slice, predictor);
        const cx = slice.reduce((s, p) => s + p.x, 0) / slice.length;
        centres.push(cx);
        upperStds.push(upperStd);
        lowerStds.push(lowerStd);
    }

    // Gaussian kernel smoother: for query x, weighted average of bin values
    // Bandwidth = half the total x-range, so all bins contribute meaningfully
    const xMin = centres[0], xMax = centres[centres.length - 1];
    const bandwidth = Math.max((xMax - xMin) * 0.5, 1e-10);

    const gaussianSmooth = (stds, queryX) => {
        let wSum = 0, vSum = 0;
        for (let i = 0; i < centres.length; i++) {
            const u = (queryX - centres[i]) / bandwidth;
            const w = Math.exp(-0.5 * u * u);
            wSum += w;
            vSum += w * stds[i];
        }
        return wSum > 0 ? vSum / wSum : stds[0];
    };

    return {
        upperStdAt: (x) => gaussianSmooth(upperStds, x),
        lowerStdAt: (x) => gaussianSmooth(lowerStds, x),
    };
};

/**
 * Generate upper and lower confidence band curve points for a fitted curve.
 *
 * Three band modes:
 *  - 'stddev':       bands at ±N global standard deviations of residuals (asymmetric)
 *  - 'local_stddev': bands at ±N local standard deviations, varying along x (tapers with data)
 *  - 'expression':   bands defined by user-entered offset expressions referencing 'y'
 *
 * @param {Array<{x:number,y:number}>} mainPoints  - already-generated main curve points
 * @param {Array<{x:number,y:number}>} rawData     - original scatter data for stddev modes
 * @param {Function} predictor                      - (x) => y for the main curve
 * @param {Object}   bandConfig
 * @param {string}   bandConfig.mode               - 'stddev' | 'local_stddev' | 'expression'
 * @param {number}   [bandConfig.nStdDev]          - number of std deviations (stddev modes)
 * @param {number}   [bandConfig.nBins]            - number of x-quantile bins (local_stddev mode, default 8)
 * @param {string}   [bandConfig.upperExpr]        - e.g. "y * 1.235"  (expression mode)
 * @param {string}   [bandConfig.lowerExpr]        - e.g. "y * 0.793"  (expression mode)
 * @returns {{ upperBandPoints: Array, lowerBandPoints: Array, upperStdPct: number|null, lowerStdPct: number|null }}
 */
export const generateConfidenceBandPoints = (mainPoints, rawData, predictor, bandConfig) => {
    const { mode, nStdDev, nBins, upperExpr, lowerExpr } = bandConfig;

    let upperOffset, lowerOffset;

    if (mode === 'stddev') {
        const n = typeof nStdDev === 'number' && isFinite(nStdDev) ? nStdDev : 1;
        const { upperStd, lowerStd } = computeAsymmetricResidualStd(rawData, predictor);
        upperOffset = (_x, y) => y + n * upperStd;
        lowerOffset = (_x, y) => y - n * lowerStd;
    } else if (mode === 'local_stddev') {
        const n = typeof nStdDev === 'number' && isFinite(nStdDev) ? nStdDev : 1;
        const bins = typeof nBins === 'number' && nBins >= 2 ? Math.round(nBins) : 8;
        const { upperStdAt, lowerStdAt } = buildLocalStdFunctions(rawData, predictor, bins);
        upperOffset = (x, y) => y + n * upperStdAt(x);
        lowerOffset = (x, y) => y - n * lowerStdAt(x);
    } else if (mode === 'expression') {
        const upperFn = upperExpr ? compileEquation(upperExpr) : null;
        const lowerFn = lowerExpr ? compileEquation(lowerExpr) : null;
        upperOffset = upperFn ? (x, y) => upperFn(x, y) : (_x, y) => y;
        lowerOffset = lowerFn ? (x, y) => lowerFn(x, y) : (_x, y) => y;
    } else {
        throw new Error(`Unknown band mode: ${mode}`);
    }

    const upperBandPoints = mainPoints
        .map(p => { const v = upperOffset(p.x, p.y); return Number.isFinite(v) ? { x: p.x, y: v } : null; })
        .filter(Boolean);

    const lowerBandPoints = mainPoints
        .map(p => { const v = lowerOffset(p.x, p.y); return Number.isFinite(v) ? { x: p.x, y: v } : null; })
        .filter(Boolean);

    // Compute percentage std deviations relative to the mean y of main curve
    // (for display in the result panel — mirrors the example: "Upper std = 23.5 %")
    let upperStdPct = null, lowerStdPct = null;
    if ((mode === 'stddev' || mode === 'local_stddev') && rawData.length > 0) {
        const { upperStd, lowerStd } = computeAsymmetricResidualStd(rawData, predictor);
        const meanYhat = mainPoints.reduce((s, p) => s + p.y, 0) / (mainPoints.length || 1);
        if (Number.isFinite(meanYhat) && meanYhat !== 0) {
            upperStdPct = (upperStd / meanYhat) * 100;
            lowerStdPct = (lowerStd / meanYhat) * 100;
        }
    }

    return { upperBandPoints, lowerBandPoints, upperStdPct, lowerStdPct };
};
/**
 * @fileoverview Mathematical utilities for curve fitting algorithms and statistical analysis.
 * Implements polynomial regression, power law fitting, and Gaussian elimination with robust error handling and numerical stability.
 *
 * @author Harison Sharp
 * @since 0.2.0
 *
 * @module Curve Fitting Utilities
 * @type {Math Library}
 *
 * @requires ./graphUtils.js - Graph parsing utilities
 *
 * @function gaussianElimination - Solve linear systems using Gaussian elimination with partial pivoting
 * @function fitPolynomial - Perform polynomial regression up to order 10 with R-squared calculation
 * @function fitPowerLaw - Fit power law relationships using logarithmic transformation
 * @function fitExponential - Fit exponential curves with parameter estimation
 * @function performCurveFitting - Main entry point for curve fitting operations (supports multiple series)
 * @function parseCurveFits - Parse curve fit configurations from JSON
 *
 * @exports gaussianElimination, fitPolynomial, fitPowerLaw, performCurveFitting, parseCurveFits
 *
 * @example
 * const result = fitPolynomial(dataPoints, 2);
 * const powerFit = fitPowerLaw(positiveData);
 * const curves = performCurveFitting(data, config, fits); // config.series used for Y-axis
 *
 * @relatedFiles CurveFittingPanel.jsx, GraphApp.jsx - Mathematical engine for curve fitting operations
 */

export const gaussianElimination = (matrix, vector) => {
    const n = matrix.length;
    if (n === 0 || vector.length !== n) {
        throw new Error('Invalid matrix dimensions');
    }

    // Check for valid input
    for (let i = 0; i < n; i++) {
        if (!matrix[i] || matrix[i].length !== n) {
            throw new Error('Matrix must be square');
        }
        for (let j = 0; j < n; j++) {
            if (!Number.isFinite(matrix[i][j])) {
                throw new Error('Matrix contains invalid values');
            }
        }
        if (!Number.isFinite(vector[i])) {
            throw new Error('Vector contains invalid values');
        }
    }

    // Create copies to avoid modifying originals
    const workMatrix = matrix.map(row => [...row]);
    const workVector = [...vector];

    // Forward elimination with partial pivoting
    for (let i = 0; i < n; i++) {
        // Find pivot
        let maxRow = i;
        for (let j = i + 1; j < n; j++) {
            if (Math.abs(workMatrix[j][i]) > Math.abs(workMatrix[maxRow][i])) {
                maxRow = j;
            }
        }

        // Check for singular matrix
        if (Math.abs(workMatrix[maxRow][i]) < 1e-12) {
            throw new Error('Matrix is singular or nearly singular');
        }

        // Swap rows if needed
        if (maxRow !== i) {
            [workMatrix[i], workMatrix[maxRow]] = [workMatrix[maxRow], workMatrix[i]];
            [workVector[i], workVector[maxRow]] = [workVector[maxRow], workVector[i]];
        }

        // Eliminate column
        for (let j = i + 1; j < n; j++) {
            if (Math.abs(workMatrix[i][i]) < 1e-12) {
                throw new Error('Division by zero in Gaussian elimination');
            }

            const factor = workMatrix[j][i] / workMatrix[i][i];
            if (!Number.isFinite(factor)) {
                throw new Error('Numerical instability detected');
            }

            workVector[j] -= factor * workVector[i];
            for (let k = i; k < n; k++) {
                workMatrix[j][k] -= factor * workMatrix[i][k];
            }
        }
    }

    // Back substitution
    const solution = new Array(n).fill(0);
    for (let i = n - 1; i >= 0; i--) {
        if (Math.abs(workMatrix[i][i]) < 1e-12) {
            throw new Error('Matrix is singular');
        }

        solution[i] = workVector[i];
        for (let j = i + 1; j < n; j++) {
            solution[i] -= workMatrix[i][j] * solution[j];
        }
        solution[i] /= workMatrix[i][i];

        if (!Number.isFinite(solution[i])) {
            throw new Error('Solution contains invalid values');
        }
    }

    return solution;
};

export const fitPolynomial = (data, order) => {
    if (!Array.isArray(data) || data.length === 0) {
        throw new Error('Data must be a non-empty array');
    }

    if (!Number.isInteger(order) || order < 1 || order > 10) {
        throw new Error('Order must be an integer between 1 and 10');
    }

    if (data.length <= order) {
        throw new Error(`Not enough data points (${data.length}) for polynomial order ${order}. Need at least ${order + 1} points.`);
    }

    // Validate data points
    const validData = data.filter(point => {
        return point &&
            typeof point.x === 'number' &&
            typeof point.y === 'number' &&
            Number.isFinite(point.x) &&
            Number.isFinite(point.y);
    });

    if (validData.length < data.length) {
        debugWarn(`Filtered out ${data.length - validData.length} invalid data points`);
    }

    if (validData.length <= order) {
        throw new Error(`Not enough valid data points (${validData.length}) for polynomial order ${order}`);
    }

    // Center and scale data for numerical stability
    const xValues = validData.map(p => p.x);
    const yValues = validData.map(p => p.y);

    const xMean = xValues.reduce((sum, x) => sum + x, 0) / xValues.length;
    const yMean = yValues.reduce((sum, y) => sum + y, 0) / yValues.length;

    const xRange = Math.max(...xValues) - Math.min(...xValues);
    const yRange = Math.max(...yValues) - Math.min(...yValues);

    // Prevent division by zero for constant data
    const xScale = xRange > 1e-12 ? xRange : 1.0;
    const yScale = yRange > 1e-12 ? yRange : 1.0;

    // Normalize data to [-1, 1] range for better conditioning
    const normalizedData = validData.map(point => ({
        x: (point.x - xMean) / xScale,
        y: (point.y - yMean) / yScale
    }));

    const n = order + 1;
    const matrix = Array(n).fill().map(() => Array(n).fill(0));
    const vector = Array(n).fill(0);

    // Build normal equations with normalized data
    try {
        for (let i = 0; i < n; i++) {
            for (let j = 0; j < n; j++) {
                for (const point of normalizedData) {
                    const powerSum = point.x ** (i + j);
                    if (!Number.isFinite(powerSum)) {
                        throw new Error('Numerical overflow in matrix construction');
                    }
                    matrix[i][j] += powerSum;
                }
            }

            for (const point of normalizedData) {
                const term = point.y * point.x ** i;
                if (!Number.isFinite(term)) {
                    throw new Error('Numerical overflow in vector construction');
                }
                vector[i] += term;
            }
        }
    } catch (error) {
        throw new Error(`Failed to construct normal equations: ${error.message}`);
    }

    // Check condition number (rough estimate)
    const diagonalProduct = matrix.reduce((prod, row, i) => prod * Math.abs(row[i]), 1);
    const matrixNorm = Math.max(...matrix.flat().map(Math.abs));
    const conditionEstimate = matrixNorm ** n / Math.abs(diagonalProduct);

    if (conditionEstimate > 1e12) {
        debugWarn(`Matrix is poorly conditioned (est. condition number: ${conditionEstimate.toExponential(2)}). Results may be unreliable.`);
    }

    const normalizedCoefficients = gaussianElimination(matrix, vector);

    // Transform coefficients back to original scale
    const coefficients = new Array(n);

    // For polynomial P(x) = a₀ + a₁x + a₂x² + ... where x is normalized
    // We need to convert back to original coordinates
    // If x_norm = (x - xMean)/xScale, then x = x_norm * xScale + xMean
    // P(x_norm) = b₀ + b₁x_norm + b₂x_norm² + ...
    // P_original(x) = P((x - xMean)/xScale) * yScale + yMean

    for (let i = 0; i < n; i++) {
        coefficients[i] = 0;
    }

    // Apply binomial expansion to transform coefficients
    for (let i = 0; i < n; i++) {
        for (let j = i; j < n; j++) {
            // Binomial coefficient for (x - xMean)^j expansion
            const binomialTerm = normalizedCoefficients[j];
            for (let k = 0; k <= j; k++) {
                if (k === i) {
                    const binomialCoef = binomial(j, k);
                    const scaleFactor = (-xMean / xScale) ** (j - k) * (1 / xScale) ** k;
                    coefficients[i] += binomialTerm * binomialCoef * scaleFactor * yScale;
                }
            }
        }
    }

    // Add back the mean offset
    coefficients[0] += yMean;

    // Calculate R-squared using original data
    const meanY = validData.reduce((sum, p) => sum + p.y, 0) / validData.length;
    let ssTot = 0;
    let ssRes = 0;

    for (const point of validData) {
        const yPred = coefficients.reduce((sum, coef, i) => {
            const term = coef * point.x ** i;
            if (!Number.isFinite(term)) {
                throw new Error('Numerical instability in prediction');
            }
            return sum + term;
        }, 0);

        ssTot += (point.y - meanY) ** 2;
        ssRes += (point.y - yPred) ** 2;
    }

    const rSquared = ssTot === 0 ? 1 : Math.max(0, Math.min(1, 1 - (ssRes / ssTot)));

    // Generate equation string with scientific notation for small coefficients
    let equation = '';
    for (let i = 0; i < coefficients.length; i++) {
        const coef = coefficients[i];

        // Use more stringent threshold - only skip truly negligible terms
        if (Math.abs(coef) < 1e-15) continue;

        const formatCoefficient = (val) => {
            const absVal = Math.abs(val);
            if (absVal >= 1e-1 && absVal < 1e4) {
                return absVal.toFixed(3);
            } else {
                return absVal.toExponential(3);
            }
        };

        if (i === 0) {
            equation += formatCoefficient(coef);
        } else {
            const sign = coef >= 0 ? ' + ' : ' - ';
            equation += sign;
            if (i === 1) {
                equation += `${formatCoefficient(coef)}x`;
            } else {
                equation += `${formatCoefficient(coef)}x^${i}`;
            }
        }
    }

    if (!equation) equation = '0';
    equation = `y = ${equation}`;

    return {
        coefficients,
        rSquared,
        equation,
        fitType: `Polynomial (Order ${order})`,
        order,
        dataPoints: validData.length,
        conditionNumber: conditionEstimate
    };
};

// Helper function for binomial coefficients
const binomial = (n, k) => {
    if (k > n || k < 0) return 0;
    if (k === 0 || k === n) return 1;

    let result = 1;
    for (let i = 0; i < k; i++) {
        result = result * (n - i) / (i + 1);
    }
    return result;
};

export const fitPowerLaw = (data) => {
    if (!Array.isArray(data) || data.length === 0) {
        throw new Error('Data must be a non-empty array');
    }

    const validData = data.filter(p =>
        p &&
        typeof p.x === 'number' &&
        typeof p.y === 'number' &&
        p.x > 0 &&
        p.y > 0 &&
        Number.isFinite(p.x) &&
        Number.isFinite(p.y)
    );

    if (validData.length < 2) {
        throw new Error(`Not enough positive data points for power law fitting. Need at least 2, got ${validData.length}.`);
    }

    try {
        const logData = validData.map(p => ({
            x: Math.log(p.x),
            y: Math.log(p.y)
        }));

        // Validate log data
        for (const point of logData) {
            if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
                throw new Error('Logarithm produced invalid values');
            }
        }

        const n = logData.length;
        const sumX = logData.reduce((sum, p) => sum + p.x, 0);
        const sumY = logData.reduce((sum, p) => sum + p.y, 0);
        const sumXY = logData.reduce((sum, p) => sum + p.x * p.y, 0);
        const sumX2 = logData.reduce((sum, p) => sum + p.x * p.x, 0);

        const denominator = n * sumX2 - sumX * sumX;
        if (Math.abs(denominator) < 1e-12) {
            throw new Error('Cannot fit power law: insufficient variation in x values');
        }

        const slope = (n * sumXY - sumX * sumY) / denominator;
        const intercept = (sumY - slope * sumX) / n;

        if (!Number.isFinite(slope) || !Number.isFinite(intercept)) {
            throw new Error('Power law fit produced invalid coefficients');
        }

        const a = Math.exp(intercept);
        const power = slope;

        if (!Number.isFinite(a) || a <= 0) {
            throw new Error('Power law coefficient is invalid');
        }

        // Calculate R-squared on original data
        const meanY = validData.reduce((sum, p) => sum + p.y, 0) / validData.length;
        let ssTot = 0;
        let ssRes = 0;

        for (const point of validData) {
            const yPred = a * point.x ** power;
            if (!Number.isFinite(yPred)) {
                throw new Error('Power law prediction produced invalid values');
            }
            ssTot += (point.y - meanY) ** 2;
            ssRes += (point.y - yPred) ** 2;
        }

        const rSquared = ssTot === 0 ? 1 : Math.max(0, Math.min(1, 1 - (ssRes / ssTot)));

        // Format coefficients with scientific notation for small values
        const formatCoefficient = (val) => {
            const absVal = Math.abs(val);
            if (absVal >= 1e-1 && absVal < 1e4) {
                return absVal.toFixed(3);
            } else {
                return absVal.toExponential(3);
            }
        };

        const equation = `y = ${formatCoefficient(a)}x^${formatCoefficient(power)}`;

        return {
            coefficients: [a, power],
            rSquared,
            equation,
            fitType: 'Power Law',
            dataPoints: validData.length
        };
    } catch (error) {
        throw new Error(`Power law fitting failed: ${error.message}`);
    }
};

export const findBestFit = (data) => {
    if (!Array.isArray(data) || data.length < 2) {
        throw new Error('Insufficient data for curve fitting');
    }

    let bestFit = null;
    let bestRSquared = -Infinity;
    const errors = [];

    // Try polynomial fits of different orders
    const maxOrder = Math.min(6, Math.floor(data.length / 2) - 1);
    for (let order = 1; order <= maxOrder; order++) {
        if (data.length > order) {
            try {
                const fit = fitPolynomial(data, order);
                if (fit.rSquared > bestRSquared) {
                    bestRSquared = fit.rSquared;
                    bestFit = fit;
                }
            } catch (error) {
                errors.push(`Order ${order} polynomial: ${error.message}`);
            }
        }
    }

    // Try power law fit
    try {
        const fit = fitPowerLaw(data);
        if (fit.rSquared > bestRSquared) {
            bestFit = fit;
        }
    } catch (error) {
        errors.push(`Power law: ${error.message}`);
    }

    if (!bestFit) {
        const errorMsg = errors.length > 0
            ? `Could not find suitable fit. Errors: ${errors.join('; ')}`
            : 'Could not find any suitable fit';
        throw new Error(errorMsg);
    }

    return bestFit;
};

export const generateCurvePoints = (fit, xMin, xMax, numPoints = 100) => {
    if (!fit || (!fit.coefficients && fit.fitType !== 'Custom')) {
        throw new Error('Invalid fit object');
    }

    if (!Number.isFinite(xMin) || !Number.isFinite(xMax) || xMin >= xMax) {
        throw new Error('Invalid x range for curve generation');
    }

    const points = [];
    const step = (xMax - xMin) / numPoints;

    for (let i = 0; i <= numPoints; i++) {
        const x = xMin + (step * i);
        let y;

        try {
            if (fit.fitType === 'Custom') {
                if (!fit.evaluator) throw new Error('Custom fit has no evaluator');
                if (x <= 0) continue; // Skip non-positive x — power-law-style expressions are undefined/degenerate at x≤0
                y = fit.evaluator(x);
            } else if (fit.fitType.includes('Polynomial')) {
                y = fit.coefficients.reduce((sum, coef, j) => {
                    const term = coef * x ** j;
                    if (!Number.isFinite(term)) {
                        throw new Error(`Invalid term at x=${x}, power=${j}`);
                    }
                    return sum + term;
                }, 0);
            } else if (fit.fitType === 'Power Law') {
                const [a, power] = fit.coefficients;
                if (x <= 0 && power % 1 !== 0) {
                    continue; // Skip negative x for non-integer powers
                }
                y = a * x ** power;
            } else {
                throw new Error(`Unknown fit type: ${fit.fitType}`);
            }

            if (Number.isFinite(y)) {
                points.push({ x, y });
            }
        } catch (error) {
            debugWarn(`Skipping point at x=${x}: ${error.message}`);
        }
    }

    if (points.length === 0) {
        throw new Error('No valid points generated for curve');
    }

    return points;
};

export const performCurveFitting = (csvData, config, curveFits) => {
    debugLog('Starting curve fitting with:', {
        dataPoints: csvData.length,
        xAxis: config.xAxis,
        series: config.series?.length || 0,
        curveFits: curveFits.length
    });

    if (!Array.isArray(csvData) || !config || !Array.isArray(curveFits)) {
        debugWarn('Invalid input parameters for curve fitting');
        return curveFits;
    }

    // Parse column information to get actual column names
    const xAxisInfo = parseColumnId(config.xAxis);

    // Parse series information
    debugLog('Config: ', config);
    const seriesInfo = config.series
        ?.map(s => ({
            ...s,
            yAxisInfo: parseColumnId(s.yAxis)
        }))
        .filter(s => s.yAxisInfo.columnName) || [];

    debugLog('Parsed column info:', { xAxisInfo, seriesCount: seriesInfo.length });

    if (!xAxisInfo.columnName || seriesInfo.length === 0 || csvData.length === 0) {
        debugWarn('Missing column names or no data');
        return curveFits.map(fit => ({ ...fit, result: null }));
    }

    // Filter and prepare data for X-axis only (Y-axis will be filtered per series)
    debugLog('Filtering X-axis data...');
    const validXData = csvData.filter(d => {
        const hasXData = d && d[xAxisInfo.columnName] !== undefined && d[xAxisInfo.columnName] !== null;
        const xIsNumeric = hasXData && !Number.isNaN(+d[xAxisInfo.columnName]) && Number.isFinite(+d[xAxisInfo.columnName]);
        return hasXData && xIsNumeric;
    });

    debugLog(`Valid X-axis data: ${validXData.length} points from ${csvData.length} total`);

    if (validXData.length < 3) {
        debugWarn('Insufficient valid X-axis data points for curve fitting:', validXData.length);
        return curveFits.map(fit => ({ ...fit, result: null }));
    }

    // Compute data-wide x extent for fallback when user leaves xMin/xMax blank
    const allXValues = validXData.map(d => +d[xAxisInfo.columnName]);
    const dataXMin = Math.min(...allXValues);
    const dataXMax = Math.max(...allXValues);

    // Process each curve fit independently
    return curveFits.map((curveFit, index) => {
        debugLog(`Processing curve fit ${index + 1}:`, curveFit);

        if (!curveFit.enabled) {
            debugLog(`Curve fit ${index + 1} is disabled`);
            return { ...curveFit, result: null };
        }

        // Get the selected series for this curve fit
        const seriesIndex = curveFit.seriesIndex ?? 0;
        if (seriesIndex >= seriesInfo.length) {
            debugWarn(`Invalid series index ${seriesIndex} for curve fit ${index + 1}`);
            return { ...curveFit, result: null };
        }

        const selectedSeries = seriesInfo[seriesIndex];
        const yAxisInfo = selectedSeries.yAxisInfo;

        debugLog(`Using series ${seriesIndex + 1} (Y-axis: ${yAxisInfo.columnName})`);

        // Filter data for this series (X and Y must both be valid)
        const validData = validXData.filter(d => {
            if (yAxisInfo.fileName && d._sourceFile && d._sourceFile !== yAxisInfo.fileName) {
                return false;
            }
            const hasYData = d && d[yAxisInfo.columnName] !== undefined && d[yAxisInfo.columnName] !== null;
            const yIsNumeric = hasYData && !Number.isNaN(+d[yAxisInfo.columnName]) && Number.isFinite(+d[yAxisInfo.columnName]);
            return hasYData && yIsNumeric;
        }).map(d => ({
            x: +d[xAxisInfo.columnName],
            y: +d[yAxisInfo.columnName]
        }));

        if (validData.length < 3) {
            debugWarn(`Insufficient valid data points for series ${seriesIndex + 1}: ${validData.length} points`);
            return { ...curveFit, result: null };
        }

        // Fall back to data extent when the user leaves min/max blank
        const parsedXMin = parseFloat(curveFit.xMin);
        const parsedXMax = parseFloat(curveFit.xMax);
        const xMin = Number.isFinite(parsedXMin) ? parsedXMin : dataXMin;
        const xMax = Number.isFinite(parsedXMax) ? parsedXMax : dataXMax;

        if (!Number.isFinite(xMin) || !Number.isFinite(xMax) || xMin >= xMax) {
            debugWarn(`Invalid range for curve fit ${index + 1}: [${xMin}, ${xMax}]`);
            return { ...curveFit, result: null };
        }

        // Filter data for this specific range
        const rangeData = validData.filter(d => d.x >= xMin && d.x <= xMax);
        debugLog(`Curve fit ${index + 1}: ${rangeData.length} points in range [${xMin}, ${xMax}]`);

        if (rangeData.length < 3) {
            debugWarn(`Insufficient data points in range [${xMin}, ${xMax}] for curve fit ${index + 1}: ${rangeData.length} points`);
            return { ...curveFit, result: null };
        }

        try {
            let fitResult;

            switch (curveFit.fitType) {
                case 'polynomial': {
                    const order = parseInt(curveFit.order, 10) || 2;
                    if (rangeData.length <= order) {
                        debugWarn(`Not enough points (${rangeData.length}) for polynomial order ${order}`);
                        return { ...curveFit, result: null };
                    }
                    fitResult = fitPolynomial(rangeData, order);
                    break;
                }
                case 'power_law':
                    fitResult = fitPowerLaw(rangeData);
                    break;

                case 'best_fit':
                    fitResult = findBestFit(rangeData);
                    break;

                case 'custom': {
                    if (!curveFit.customEquation || !curveFit.customEquation.trim()) {
                        debugWarn(`Curve fit ${index + 1}: custom type requires an equation`);
                        return { ...curveFit, result: null };
                    }
                    fitResult = fitCustomEquation(rangeData, curveFit.customEquation);
                    break;
                }
                default:
                    throw new Error(`Unknown fit type: ${curveFit.fitType}`);
            }

            // Generate curve points for visualization
            const curvePoints = generateCurvePoints(fitResult, xMin, xMax);

            // Build a predictor function for band calculations
            const predictor = fitResult.fitType === 'Custom'
                ? fitResult.evaluator
                : fitResult.fitType.includes('Polynomial')
                    ? (x) => fitResult.coefficients.reduce((s, c, j) => s + c * x ** j, 0)
                    : (x) => fitResult.coefficients[0] * x ** fitResult.coefficients[1];

            // Generate confidence bands if configured
            let confidenceBands = null;
            if (curveFit.confidenceBands?.enabled && curveFit.confidenceBands?.bands?.length > 0) {
                confidenceBands = curveFit.confidenceBands.bands.map((band, bandIdx) => {
                    try {
                        return {
                            ...generateConfidenceBandPoints(curvePoints, rangeData, predictor, band),
                            color: band.color || curveFit.color,
                            label: band.label || `Band ${bandIdx + 1}`
                        };
                    } catch (e) {
                        debugWarn(`Confidence band ${bandIdx + 1} for curve ${index + 1} failed: ${e.message}`);
                        return null;
                    }
                }).filter(Boolean);
            }

            debugLog(`Successfully fitted curve ${index + 1}:`, fitResult);

            return {
                ...curveFit,
                result: {
                    ...fitResult,
                    curvePoints,
                    confidenceBands,
                    xMin,
                    xMax
                }
            };
        } catch (error) {
            console.error(`Curve fit ${index + 1} failed:`, error);
            return { ...curveFit, result: null };
        }
    });
};

// Updated to start with only one curve fit instead of two
export const parseCurveFits = (config) => {
    if (!config || !config.curveFits) {
        return [{
            enabled: false,
            seriesIndex: 0,
            xMin: '',
            xMax: '',
            fitType: 'polynomial',
            order: 2,
            color: '#ff6b6b',
            result: null
        }];
    }

    return config.curveFits.map((fit, i) => {
        const colors = ['#ff6b6b', '#4ecdc4', '#45b7d1', '#96ceb4', '#ffeaa7', '#dda0dd'];
        return {
            enabled: !!fit?.enabled,
            seriesIndex: parseInt(fit?.seriesIndex, 10) ?? 0,
            xMin: fit?.xMin ?? '',
            xMax: fit?.xMax ?? '',
            fitType: fit?.fitType ?? 'polynomial',
            order: parseInt(fit?.order, 10) || 2,
            customEquation: fit?.customEquation ?? '',
            confidenceBands: fit?.confidenceBands ?? { enabled: false, bands: [] },
            color: fit?.color ?? colors[i % colors.length],
            result: null
        };
    });
};
