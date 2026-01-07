
import { parseCSV } from './src/utils/parseCSV.js';

const csvContent = `Date,"Au Spot (USD/oz, LME…)",,
Jan-2015,"1,278.50",,
Feb-2015,"1,212.60",,`;

console.log("Parsing CSV content:");
console.log(csvContent);

const result = parseCSV(csvContent);
console.log("\nResult:");
console.log(JSON.stringify(result, null, 2));

const firstRow = result.data[0];
const yKey = "Au Spot (USD/oz, LME…)";
const yValue = firstRow[yKey];

console.log(`\nValue for '${yKey}':`, yValue);
console.log("Type:", typeof yValue);

if (typeof yValue === 'number' && !isNaN(yValue)) {
    console.log("SUCCESS: Value parses as a valid number.");
} else {
    console.log("FAILURE: Value is not a valid number.");
}

const dateValue = firstRow['Date'];
console.log(`\nValue for 'Date':`, dateValue);
console.log("Type:", typeof dateValue);
console.log("Is Date:", dateValue instanceof Date);
