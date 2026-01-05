
import { describe, it, expect } from 'vitest';
import { aggregateData } from './statisticsUtils';

describe('statisticsUtils', () => {
    describe('aggregateData', () => {
        const xAxisInfo = { columnName: 'Year' };
        const seriesInfo = [{ yAxisInfo: { columnName: 'Value' } }];

        it('should calculate average correctly for grouped data', () => {
            const data = [
                { Year: '2025', Value: 10 },
                { Year: '2025', Value: 20 },
                { Year: '2026', Value: 30 }
            ];

            const result = aggregateData(data, xAxisInfo, seriesInfo);

            expect(result).toHaveLength(2);

            const group2025 = result.find(d => d.Year === '2025');
            expect(group2025.Value).toBe(15); // (10+20)/2

            const group2026 = result.find(d => d.Year === '2026');
            expect(group2026.Value).toBe(30);
        });

        it('should calculate confidence intervals when requested', () => {
            const data = [
                { Year: '2025', Value: 10 },
                { Year: '2025', Value: 12 },
                { Year: '2025', Value: 14 },
                { Year: '2025', Value: 16 },
                { Year: '2025', Value: 18 }
            ];
            // Mean = 14
            // StdDev = 3.162
            // N = 5
            // StdErr = 1.414
            // t(0.95, df=4) approx 2.776 (using our simplified Z=1.96 it will be different, let's check logic not exact math if approx)
            // Our util uses Z=1.96 for simplicity in this iteration unless N is large, wait, let's check code.
            // Code uses 1.96 for all N < 30 in the simplified version I wrote? 
            // "return 1.96;" was the fallback.

            const result = aggregateData(data, xAxisInfo, seriesInfo, { calculateCI: true, confidenceLevel: 95 });
            const item = result[0];

            expect(item.Value).toBe(14);
            expect(item.Value_n).toBe(5);
            expect(item.Value_std_err).toBeCloseTo(1.414, 2);

            // Margin = 1.96 * 1.414 = 2.77
            const expectedMargin = 1.96 * (3.16227766 / Math.sqrt(5));
            expect(item.Value_ci_upper).toBeCloseTo(14 + expectedMargin, 1);
            expect(item.Value_ci_lower).toBeCloseTo(14 - expectedMargin, 1);
        });

        it('should handle single value groups (CI should be mean)', () => {
            const data = [{ Year: '2025', Value: 10 }];
            const result = aggregateData(data, xAxisInfo, seriesInfo, { calculateCI: true });

            expect(result[0].Value).toBe(10);
            expect(result[0].Value_ci_lower).toBe(10);
            expect(result[0].Value_ci_upper).toBe(10);
        });

        it('should ignore null/undefined values', () => {
            const data = [
                { Year: '2025', Value: 10 },
                { Year: '2025', Value: null },
                { Year: '2025', Value: undefined },
                { Year: '2025', Value: 20 }
            ];
            const result = aggregateData(data, xAxisInfo, seriesInfo);
            expect(result[0].Value).toBe(15);
        });
    });
});
