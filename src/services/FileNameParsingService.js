/**
 * @fileoverview Service for parsing structured graph filenames to extract coordinate system information.
 * Decodes axis scaling parameters, dimensions, intercepts, and metadata from standardized filename format.
 *
 * @author Harison Sharp
 * @since 1.0.0
 *
 * @class FilenameParsingService
 * @type {Service Class}
 *
 * @method parseGraphFilename - Extract coordinate system data from structured filename
 *  @param {string} filename - Graph filename with embedded coordinate information
 *  @returns {Object|null} Parsed axis data or null if parsing fails
 *
 * @exports FilenameParsingService
 *
 * @example
 * const parsed = FilenameParsingService.parseGraphFilename("240915_w800h600_xTimes80,10_yAmplitudes60,15.png");
 * // Returns: {date: "240915", x: {name: "Time", zero: 80, ppu: 10}, y: {name: "Amplitude", zero: 60, ppu: 15}}
 *
 * @relatedFiles FileNameDecoder.jsx, CoordinateService.js - Filename parsing for coordinate system extraction
 */
import { debugLog, debugWarn } from '../utils/debug.js';

export class FilenameParsingService {
    static parseGraphFilename(filename) {
        if (!filename || typeof filename !== 'string') {
            return null;
        }

        const baseName = filename.replace(/^.*[\/]/, '').replace(/\.png$/i, '');
        debugLog('Parsing filename:', baseName);

        const result = {
            date: '',
            x: null,
            y: null,
            y2: null,
            colorGrading: null,
            contouring: null,
            intercepts: { x: 0, y: 0 },
            dimensions: { width: 800, height: 600 }
        };

        try {
            // Extract date (first 6 digits)
            debugLog('Extracting date from filename:', baseName);
            const dateMatch = baseName.match(/^(\d{6})/);
            if (dateMatch) {
                result.date = dateMatch[1];
                debugLog('Found date:', result.date);
            }

            // Extract dimensions (w{width}h{height})
            const dimMatch = baseName.match(/_w(\d+)h(\d+)/);
            if (dimMatch) {
                result.dimensions = {
                    width: parseInt(dimMatch[1], 10),
                    height: parseInt(dimMatch[2], 10)
                };
                debugLog('Found dimensions:', result.dimensions);
            }

            // Parse x-axis info: _x{name}s{zero},{ppu}
            const xMatch = baseName.match(/_x([^_s]+)s(-?\d+),(\d+)/);
            if (xMatch) {
                result.x = {
                    name: xMatch[1],
                    zero: parseInt(xMatch[2], 10),
                    ppu: parseInt(xMatch[3], 10)
                };
                debugLog('Found x-axis:', result.x);
            }

            // Parse y-axis info: _y{name}s{zero},{ppu}
            const yMatch = baseName.match(/_y([^_s]+)s(-?\d+),(\d+)/);
            if (yMatch) {
                result.y = {
                    name: yMatch[1],
                    zero: parseInt(yMatch[2], 10),
                    ppu: parseInt(yMatch[3], 10)
                };
                debugLog('Found y-axis:', result.y);
            }

            // Parse y2-axis info if present: _y2{name}s{zero},{ppu}
            const y2Match = baseName.match(/_y2([^_s]+)s(-?\d+),(\d+)/);
            if (y2Match) {
                result.y2 = {
                    name: y2Match[1],
                    zero: parseInt(y2Match[2], 10),
                    ppu: parseInt(y2Match[3], 10)
                };
                debugLog('Found y2-axis:', result.y2);
            }

            // Extract color grading
            const cgMatch = baseName.match(/_cg([^_]+)/);
            if (cgMatch) {
                result.colorGrading = cgMatch[1];
                debugLog('Found color grading:', result.colorGrading);
            }

            // Extract contouring
            const ctMatch = baseName.match(/_ct([^_]+)/);
            if (ctMatch) {
                result.contouring = ctMatch[1];
                debugLog('Found contouring:', result.contouring);
            }

            // Extract intercepts: _o{x},{y}
            const interceptMatch = baseName.match(/_o(-?\d+),(-?\d+)/);
            if (interceptMatch) {
                result.intercepts = {
                    x: parseInt(interceptMatch[1], 10),
                    y: parseInt(interceptMatch[2], 10)
                };
                debugLog('Found intercepts:', result.intercepts);
            }

            // Validate that we found at least x and y axes
            if (!result.x || !result.y) {
                console.warn('Could not extract axis information from filename');
                return null;
            }

            // Validate numeric values
            if (!isFinite(result.x.zero) || !isFinite(result.x.ppu) ||
                !isFinite(result.y.zero) || !isFinite(result.y.ppu) ||
                result.x.ppu === 0 || result.y.ppu === 0) {
                console.warn('Invalid axis scale parameters');
                return null;
            }

            debugLog('Successfully parsed filename:', result);
            return result;
        } catch (error) {
            console.error('Error parsing filename:', error);
            return null;
        }
    }
}
