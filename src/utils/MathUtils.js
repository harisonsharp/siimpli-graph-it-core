/**
  * @fileoverview Comprehensive math utilities for math operations.
 *
 * @author Harison Sharp
 * @since 0.2.0
 *
 * @module Math Utilities
 * @type {Utility Library}
 *
 * @function dmtToUnitFactor - Convert USD/dmt to USD/unit
 *
 * @exports dmtToUnitFactor
 *
 * @example
 * const factor = MathUtils.dmtToUnitFactor("troy oz");
 *
 * @relatedFiles mathUtils.js - Core math operations
 */
export class MathUtils {
    static dmtToUnitFactor(fromUnit, toUnit) {
        // 1 metric tonne = 1000 kg
        const KG_PER_METRIC_TONNE = 1000; // [web:10][web:13]

        // 1 troy ounce = 31.1034768 g = 0.0311034768 kg [web:3][web:5]
        const KG_PER_TROY_OUNCE = 0.0311034768;

        // 1 lb = 0.45359237 kg (exact, by definition) [web:9][web:12]
        const KG_PER_POUND = 0.45359237;

        switch (fromUnit) {
            case "USD$/oz":
                switch (toUnit) {
                    case "USD$/oz":
                        return 1;
                    case "USD$/lbs":
                        return KG_PER_TROY_OUNCE / KG_PER_POUND;
                    case "USD$/dmt":
                        return KG_PER_TROY_OUNCE / KG_PER_METRIC_TONNE;
                    case "":
                        return 1;
                    default:
                        return 1;
                }

            case "USD$/lbs":
                switch (toUnit) {
                    case "USD$/oz":
                        return KG_PER_POUND / KG_PER_TROY_OUNCE;
                    case "USD$/lbs":
                        return 1;
                    case "USD$/dmt":
                        return KG_PER_POUND / KG_PER_METRIC_TONNE;
                    case "":
                        return 1;
                    default:
                        return 1;
                }
            case "USD$/dmt":
                switch (toUnit) {
                    case "USD$/oz":
                        return KG_PER_METRIC_TONNE / KG_PER_TROY_OUNCE;
                    case "USD$/lbs":
                        return KG_PER_METRIC_TONNE / KG_PER_POUND;
                    case "USD$/dmt":
                        return 1;
                    case "":
                        return 1;
                    default:
                        return 1;
                }
            case "":
                switch (toUnit) {
                    case "USD$/oz":
                        return 1;
                    case "USD$/lbs":
                        return 1;
                    case "USD$/dmt":
                        return 1;
                    case "":
                        return 1;
                    default:
                        return 1;
                }
            default:
                return 1;
        }
    }
}
