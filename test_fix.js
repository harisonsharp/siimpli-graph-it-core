
import { parseNumber } from './src/utils/dataUtils.js';

const testValues = [
    "2007-08-31",
    "2023-01-01",
    "123.45",
    "1,234.56",
    "invalid-date"
];

console.log("Testing parseNumber with various inputs:");

testValues.forEach(val => {
    const parsed = parseNumber(val);
    const isNaNResult = isNaN(parsed);
    const isFiniteResult = isFinite(parsed);

    // Logic from BaseChartRenderer.filterValidData
    const isValid = val !== undefined && val !== null && val !== '' && !isNaNResult && isFiniteResult;

    console.log(`Input: "${val}"`);
    console.log(`  Parsed: ${parsed}`);
    console.log(`  !isNaN: ${!isNaNResult}`);
    console.log(`  isFinite: ${isFiniteResult}`);
    console.log(`  [BaseChartRenderer Check] Valid: ${isValid}`);
    console.log("---");
});
