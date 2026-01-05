/**
 * @fileoverview Unit tests for CanvasSizer service
 * Tests data-driven sizing, DOM fallback, dimension clamping, and export DPI handling
 *
 * @author Harison Sharp
 * @since 0.3.0
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CanvasSizer } from './CanvasSizer.js';

/**
 * Create a mock SVG element with necessary methods
 */
function createMockSVG() {
    const attributes = {
        width: '800',
        height: '600',
        viewBox: '0 0 800 600'
    };

    const mockSVG = {
        getAttribute: vi.fn((name) => attributes[name]),
        setAttribute: vi.fn((name, value) => {
            attributes[name] = String(value);
        }),
        querySelector: vi.fn(() => ({
            getBBox: vi.fn(() => ({
                x: 50,
                y: 50,
                width: 700,
                height: 500
            }))
        }))
    };

    return mockSVG;
}

describe('CanvasSizer', () => {
    let mockSVG;
    let sizer;

    beforeEach(() => {
        mockSVG = createMockSVG();
        sizer = new CanvasSizer(mockSVG, {
            margins: { top: 60, right: 150, bottom: 120, left: 80 },
            debounceMs: 0 // Disable debouncing for tests
        });
    });

    describe('Construction', () => {
        it('should throw error if no SVG root provided', () => {
            expect(() => new CanvasSizer(null)).toThrow('SVG root element is required');
        });

        it('should use default configuration', () => {
            expect(sizer.config.maxWidth).toBe(8192);
            expect(sizer.config.maxHeight).toBe(8192);
            expect(sizer.config.expandMode).toBe('expand');
        });

        it('should merge custom options with defaults', () => {
            const customSizer = new CanvasSizer(mockSVG, {
                maxWidth: 4096,
                margins: { top: 100 }
            });

            expect(customSizer.config.maxWidth).toBe(4096);
            expect(customSizer.config.margins.top).toBe(100);
            expect(customSizer.config.margins.left).toBe(80); // Default preserved
        });
    });

    describe('updateFromData (fast path)', () => {
        it('should accept valid extents', () => {
            const result = sizer.updateFromData({
                xMin: 0,
                xMax: 500,
                yMin: 0,
                yMax: 300
            });

            expect(result).toBe(sizer); // Should return this for chaining
            expect(sizer.lastExtents).toBeDefined();
            expect(sizer.lastExtents.source).toBe('data');
        });

        it('should add padding for radius and stroke', () => {
            sizer.updateFromData({
                xMin: 100,
                xMax: 500,
                yMin: 50,
                yMax: 300,
                radius: 5,
                strokeWidth: 2
            });

            expect(sizer.lastExtents.xMin).toBe(100 - 7); // 5 + 2
            expect(sizer.lastExtents.xMax).toBe(500 + 7);
            expect(sizer.lastExtents.yMin).toBe(50 - 7);
            expect(sizer.lastExtents.yMax).toBe(300 + 7);
        });

        it('should warn on invalid extents', () => {
            const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
            
            sizer.updateFromData({ xMin: 0 }); // Missing required fields
            
            expect(consoleSpy).toHaveBeenCalledWith(
                expect.stringContaining('Invalid extents')
            );
            
            consoleSpy.mockRestore();
        });

        it('should handle zero extents', () => {
            sizer.updateFromData({
                xMin: 0,
                xMax: 0,
                yMin: 0,
                yMax: 0
            });

            expect(sizer.lastExtents.xMin).toBe(0);
            expect(sizer.lastExtents.xMax).toBe(0);
        });
    });

    describe('ensureFit', () => {
        it('should calculate and apply dimensions in expand mode', () => {
            sizer.updateFromData({
                xMin: 0,
                xMax: 500,
                yMin: 0,
                yMax: 300
            });

            const dims = sizer.ensureFit();

            expect(dims.width).toBeGreaterThan(500);
            expect(dims.height).toBeGreaterThan(300);
            expect(mockSVG.setAttribute).toHaveBeenCalledWith('width', expect.any(Number));
            expect(mockSVG.setAttribute).toHaveBeenCalledWith('height', expect.any(Number));
        });

        it('should include margins in total dimensions', () => {
            sizer.updateFromData({
                xMin: 0,
                xMax: 500,
                yMin: 0,
                yMax: 300
            });

            const dims = sizer.ensureFit();
            const expectedWidth = 500 + 80 + 150 + (sizer.config.minPadding * 2); // content + left + right + padding
            const expectedHeight = 300 + 60 + 120 + (sizer.config.minPadding * 2); // content + top + bottom + padding

            expect(dims.width).toBe(expectedWidth);
            expect(dims.height).toBe(expectedHeight);
        });

        it('should enforce minimum dimensions', () => {
            sizer.updateFromData({
                xMin: 0,
                xMax: 10,
                yMin: 0,
                yMax: 10
            });

            const dims = sizer.ensureFit();

            expect(dims.width).toBeGreaterThanOrEqual(sizer.config.minWidth);
            expect(dims.height).toBeGreaterThanOrEqual(sizer.config.minHeight);
        });

        it('should enforce maximum dimensions and warn', () => {
            const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
            
            sizer.updateFromData({
                xMin: 0,
                xMax: 10000,
                yMin: 0,
                yMax: 10000
            });

            const dims = sizer.ensureFit();

            expect(dims.width).toBeLessThanOrEqual(sizer.config.maxWidth);
            expect(dims.height).toBeLessThanOrEqual(sizer.config.maxHeight);
            expect(consoleSpy).toHaveBeenCalled();
            
            consoleSpy.mockRestore();
        });

        it('should warn if no extents available', () => {
            const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
            
            const dims = sizer.ensureFit();
            
            expect(consoleSpy).toHaveBeenCalledWith(
                expect.stringContaining('No extents available')
            );
            expect(dims).toBeDefined(); // Should still return current dimensions
            
            consoleSpy.mockRestore();
        });

        it('should set viewBox matching dimensions in expand mode', () => {
            sizer.updateFromData({
                xMin: 0,
                xMax: 500,
                yMin: 0,
                yMax: 300
            });

            const dims = sizer.ensureFit();

            expect(mockSVG.setAttribute).toHaveBeenCalledWith(
                'viewBox',
                `0 0 ${dims.width} ${dims.height}`
            );
        });
    });

    describe('Scale mode', () => {
        beforeEach(() => {
            sizer = new CanvasSizer(mockSVG, {
                margins: { top: 60, right: 150, bottom: 120, left: 80 },
                expandMode: 'scale',
                debounceMs: 0
            });
        });

        it('should adjust viewBox instead of dimensions', () => {
            sizer.updateFromData({
                xMin: 100,
                xMax: 600,
                yMin: 50,
                yMax: 350
            });

            sizer.ensureFit();

            // Width and height should remain at current values
            expect(mockSVG.setAttribute).toHaveBeenCalledWith('width', expect.any(Number));
            expect(mockSVG.setAttribute).toHaveBeenCalledWith('height', expect.any(Number));
            
            // ViewBox should encompass content with margins
            const viewBoxCall = mockSVG.setAttribute.mock.calls.find(call => call[0] === 'viewBox');
            expect(viewBoxCall).toBeDefined();
            expect(viewBoxCall[1]).toContain('100'); // Should start near xMin
        });
    });

    describe('DPI multiplier', () => {
        it('should calculate export dimensions with DPI multiplier', () => {
            sizer.setDPIMultiplier(2);
            
            sizer.updateFromData({
                xMin: 0,
                xMax: 500,
                yMin: 0,
                yMax: 300
            });

            const dims = sizer.ensureFit();

            expect(dims.exportWidth).toBe(dims.width * 2);
            expect(dims.exportHeight).toBe(dims.height * 2);
        });

        it('should reject invalid DPI multipliers', () => {
            sizer.setDPIMultiplier(2);
            expect(sizer.config.dpiMultiplier).toBe(2);

            sizer.setDPIMultiplier(0); // Invalid
            expect(sizer.config.dpiMultiplier).toBe(2); // Should not change

            sizer.setDPIMultiplier(5); // Too high
            expect(sizer.config.dpiMultiplier).toBe(2); // Should not change
        });
    });

    describe('updateFromDOM (fallback path)', () => {
        it('should use getBBox from DOM', (done) => {
            sizer.updateFromDOM();

            // Wait for requestAnimationFrame
            setTimeout(() => {
                expect(mockSVG.querySelector).toHaveBeenCalled();
                expect(sizer.lastExtents).toBeDefined();
                expect(sizer.lastExtents.source).toBe('dom');
                done();
            }, 50);
        });

        it('should warn if no group element found', () => {
            const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
            mockSVG.querySelector = vi.fn(() => null);
            
            sizer.updateFromDOM();
            
            expect(consoleSpy).toHaveBeenCalledWith(
                expect.stringContaining('No group element found')
            );
            
            consoleSpy.mockRestore();
        });
    });

    describe('Teardown', () => {
        it('should clean up resources', () => {
            sizer.updateFromData({ xMin: 0, xMax: 100, yMin: 0, yMax: 100 });
            
            sizer.teardown();

            expect(sizer.svgRoot).toBeNull();
            expect(sizer.lastExtents).toBeNull();
            expect(sizer.lastAppliedDims).toBeNull();
        });

        it('should clear debounce timer', () => {
            const sizerWithDebounce = new CanvasSizer(mockSVG, {
                debounceMs: 1000
            });

            sizerWithDebounce.updateFromData({ xMin: 0, xMax: 100, yMin: 0, yMax: 100 });
            expect(sizerWithDebounce.debounceTimer).toBeDefined();

            sizerWithDebounce.teardown();
            expect(sizerWithDebounce.debounceTimer).toBeNull();
        });
    });

    describe('getDimensions', () => {
        it('should return current dimensions without modifying', () => {
            const dims = sizer.getDimensions();

            expect(dims.width).toBe(800);
            expect(dims.height).toBe(600);
            expect(dims.viewBox).toBe('0 0 800 600');
            
            // Should not have modified anything
            expect(mockSVG.setAttribute).not.toHaveBeenCalled();
        });
    });

    describe('Chaining', () => {
        it('should support method chaining', () => {
            const result = sizer
                .updateFromData({ xMin: 0, xMax: 100, yMin: 0, yMax: 100 })
                .setDPIMultiplier(2);

            expect(result).toBe(sizer);
        });
    });

    describe('Integration scenarios', () => {
        it('should handle scatter plot with markers', () => {
            // Simulate scatter plot with 5px radius markers
            sizer.updateFromData({
                xMin: 0,
                xMax: 1000,
                yMin: -50,
                yMax: 500,
                radius: 5,
                strokeWidth: 0.5
            });

            const dims = sizer.ensureFit();

            // Should include marker size in calculations
            expect(dims.width).toBeGreaterThan(1000);
            expect(dims.height).toBeGreaterThan(550);
        });

        it('should handle line chart across full range', () => {
            sizer.updateFromData({
                xMin: 0,
                xMax: 2000,
                yMin: 0,
                yMax: 1000,
                strokeWidth: 3
            });

            const dims = sizer.ensureFit();

            expect(dims.width).toBeGreaterThan(2000);
            expect(dims.height).toBeGreaterThan(1000);
        });

        it('should handle export with high DPI', () => {
            sizer.setDPIMultiplier(3); // 3x for retina displays

            sizer.updateFromData({
                xMin: 0,
                xMax: 800,
                yMin: 0,
                yMax: 600
            });

            const dims = sizer.ensureFit();

            expect(dims.exportWidth).toBe(dims.width * 3);
            expect(dims.exportHeight).toBe(dims.height * 3);
            expect(dims.exportWidth).toBeGreaterThan(2400);
        });
    });
});
