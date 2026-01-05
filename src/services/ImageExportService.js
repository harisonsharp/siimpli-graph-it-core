import { readFile, writeFile } from '@tauri-apps/plugin-fs';
import { open, save } from '@tauri-apps/plugin-dialog';
/**
 * @fileoverview Service class for handling image file operations and graph export functionality.
 * Manages PNG file loading, canvas-based graph annotation, and export operations using Tauri file system APIs
 * for desktop application integration.
 *
 * @author Harison Sharp
 * @since 0.2.0
 *
 * @module Service Class
 * @type {Class}
 *
 * @requires @tauri-apps/plugin-fs - File system operations (readFile, writeFile)
 * @requires @tauri-apps/plugin-dialog - File dialog operations (open, save)
 *
 * @exports {Class} ImageExportService
 *
 * @example
 * const imageData = await ImageExportService.loadImageFile();
 * const exportPath = await ImageExportService.exportAnnotatedGraph(url, svg, dims, file);
 *
 * @related GraphImageDisplay.jsx, GraphRenderer.jsx, FileUploadCard.jsx
 */

export class ImageExportService {
    static async loadImageFile() {
        const selected = await open({
            multiple: false,
            filters: [{ name: 'PNG Image', extensions: ['png'] }]
        });

        if (!selected) {
            return null;
        }

        const fileData = await readFile(selected);
        const blob = new Blob([fileData], { type: 'image/png' });
        const fileUrl = URL.createObjectURL(blob);

        return {
            filePath: selected,
            fileUrl,
            cleanup: () => URL.revokeObjectURL(fileUrl)
        };
    }

    static async exportAnnotatedGraph(imageUrl, svgRef, imageDimensions, selectedFile) {
        const canvas = document.createElement('canvas');
        canvas.width = imageDimensions.width;
        canvas.height = imageDimensions.height;
        const ctx = canvas.getContext('2d');

        // Draw base image
        const baseImage = new Image();
        await new Promise((resolve, reject) => {
            baseImage.onload = resolve;
            baseImage.onerror = () => reject(new Error('Failed to load base image'));
            baseImage.src = imageUrl;
        });

        ctx.drawImage(baseImage, 0, 0);

        // Draw SVG overlay
        const svgElement = svgRef;
        const svgString = new XMLSerializer().serializeToString(svgElement);
        const svgBlob = new Blob([svgString], { type: 'image/svg+xml' });
        const svgUrl = URL.createObjectURL(svgBlob);

        try {
            const svgImage = new Image();
            await new Promise((resolve, reject) => {
                svgImage.onload = resolve;
                svgImage.onerror = () => reject(new Error('Failed to load SVG overlay'));
                svgImage.src = svgUrl;
            });

            ctx.drawImage(svgImage, 0, 0);
        } finally {
            URL.revokeObjectURL(svgUrl);
        }

        // Export
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
        if (!blob) {
            throw new Error('Failed to create export blob');
        }

        const arrayBuffer = await blob.arrayBuffer();
        const uint8Array = new Uint8Array(arrayBuffer);

        const date = new Date();
        const dateStr = date.toISOString().slice(2, 10).replace(/-/g, '');
        const filename = selectedFile ? selectedFile.split(/[\/]/).pop() : 'graph.png';
        const defaultFilename = `annotated_${dateStr}_${filename}`;

        const filePath = await save({
            defaultPath: defaultFilename,
            filters: [{ name: 'PNG', extensions: ['png'] }]
        });

        if (filePath) {
            await writeFile(filePath, uint8Array);
            return filePath;
        }

        return null;
    }
}
