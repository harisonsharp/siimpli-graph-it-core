# Math Audit: `curveFittingUtils.js`

Audit date: 2026-04-15  
File audited: `src/utils/curveFittingUtils.js`

---

## Bugs (correctness impact)

### BUG-1 — Asymmetric residual std is computed around the half-sample mean, not around zero

**Location:** `computeAsymmetricResidualStd`, lines 306–311 (`stdOf` helper)

**Severity:** Moderate — bands will be narrower than they should be whenever residuals are not symmetric around a small value.

**What the code does:**

```js
const stdOf = (arr) => {
    const mean = arr.reduce((s, v) => s + v, 0) / arr.length;
    const variance = arr.reduce((s, v) => s + (v - mean) ** 2, 0) / arr.length;
    return Math.sqrt(variance);
};
```

Positive residuals are collected into one array, negative residuals (as absolute values) into another. `stdOf` then computes the standard deviation of each array *around its own mean*. This measures spread *within* each half of the residual distribution, not spread relative to the fit line.

**Why it is wrong for the stated purpose:**

The intent (confirmed) is to express how far positive/negative residuals typically deviate *from the fit*. The correct statistic for that is the RMS from zero:

```
σ⁺ = sqrt( Σ rᵢ² / n )   for all rᵢ > 0
σ⁻ = sqrt( Σ rᵢ² / n )   for all rᵢ < 0  (using |rᵢ|)
```

Using `std around mean` instead of `RMS from zero` produces a value that is always ≤ the correct value, and can be substantially smaller when the half-sample residuals are clustered (e.g. all positive residuals are near +5 — the std-around-mean is near zero, but the correct answer is near 5).

**Fix:**

```js
const rmsOf = (arr) => {
    if (arr.length === 0) return 0;
    const sumSq = arr.reduce((s, v) => s + v * v, 0);
    return Math.sqrt(sumSq / arr.length);
};
```

Replace all three calls to `stdOf(...)` with `rmsOf(...)`. The `negRes.map(Math.abs)` call can then be dropped since `r²` is sign-invariant — or kept for clarity.

---

### BUG-2 — Population variance (÷ n) instead of sample variance (÷ n−1)

**Location:** `computeAsymmetricResidualStd`, line 309

**Severity:** Minor for large samples, noticeable for small ones (< ~20 points per half).

**What the code does:**

```js
const variance = arr.reduce((s, v) => s + (v - mean) ** 2, 0) / arr.length;
```

Divides by `n`. The unbiased sample variance divides by `n - 1` (Bessel's correction). For residuals from a fitted curve, the correct denominator is `n - p` where `p` is the number of fit parameters, but `n - 1` is a reasonable approximation and standard practice for residual std.

Note: if BUG-1 is fixed by switching to RMS-from-zero (recommended), the mean is gone entirely and this issue becomes moot. If the std-around-mean formulation is kept for any reason, change the divisor to `arr.length - 1` (with a guard for `arr.length < 2`).

---

### BUG-3 — Inconsistency between `stddev` and `lowess_stddev` estimators

**Location:** `computeAsymmetricResidualStd` vs `buildLowessStdFunctions`

**Severity:** Moderate — the two modes are not comparable; switching between them produces band widths that differ for reasons unrelated to data structure.

**What happens:**

- `stddev` mode calls `computeAsymmetricResidualStd`, which uses std-around-half-mean (BUG-1).
- `lowess_stddev` mode calls `buildLowessStdFunctions`, which correctly computes weighted RMS from zero:

```js
wrSum += w * r * r;
return Math.sqrt(wrSum / wSum);
```

Fixing BUG-1 (switching `computeAsymmetricResidualStd` to RMS-from-zero) resolves this inconsistency as a side effect.

---

## Non-bugs worth knowing

### NOTE-1 — Condition number estimate is not mathematically valid

**Location:** `fitPolynomial`, lines 776–780

**Impact:** Diagnostic only — does not affect results.

The code computes:

```js
const conditionEstimate = matrixNorm ** n / Math.abs(diagonalProduct);
```

where `matrixNorm` is the max element and `diagonalProduct` is the product of diagonal entries. This has no reliable relationship to the true matrix condition number (`||A|| · ||A⁻¹||`). It may fire the warning spuriously or fail to fire when the matrix is genuinely ill-conditioned.

Since the estimate is debug-only and the normalization step already substantially improves conditioning, this is low priority. If a better diagnostic is wanted, compute the ratio of the largest to smallest diagonal of the upper-triangular factor after Gaussian elimination (a cheap approximation used in practice).

---

### NOTE-2 — R² computed on original scale after log-space fit (power law and exponential)

**Location:** `fitPowerLaw` line 964, `fitExponential` line 1042

**Impact:** None — this is correct behavior for user-facing reporting.

R² is computed on the original (untransformed) y values, even though coefficients were found by linear regression in log space. This is the right choice: it tells the user how much variance in the actual data is explained. However, it means R² can appear lower than expected for data that is a near-perfect power law but has multiplicative (heteroscedastic) noise, because the large absolute residuals at high y values dominate ssTot.

No action needed unless users report confusion about R² values for power law / exponential fits.

---

### NOTE-3 — `numPoints` in `generateCurvePoints` behaves as `numIntervals`

**Location:** `generateCurvePoints`, line 1145

**Impact:** Cosmetic — generates 101 points when called with `numPoints = 100`.

The loop runs `for (let i = 0; i <= numPoints; i++)`, producing `numPoints + 1` points. The parameter name implies a count, but it acts as a step count. This is consistent between the log-x and linear branches so the output is correct; it just means the caller gets one more point than the name implies.

---

## Recommended fix order

1. **BUG-1** — switch `stdOf` to RMS-from-zero. This is the most impactful fix and also resolves BUG-3 as a side effect.
2. **BUG-2** — only relevant if the std-around-mean formulation is kept for any reason. If BUG-1 is fixed, this is moot.
3. **NOTE-1** — low priority; only improves a debug warning.
4. **NOTE-3** — rename parameter or adjust loop if API clarity matters.
