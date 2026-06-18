import { parseColumnId } from '../utils/columnUtils.js';

export class HoverTableRenderer {
    static HOVER_MODAL_CLASS = 'point-hover-modal';

    ensureHoverModal(g) {
        const svgNode = g?.node?.()?.ownerSVGElement;
        if (!svgNode) {
            return { modal: null, host: null };
        }

        const host = svgNode.parentElement;
        if (!host) {
            return { modal: null, host: null };
        }

        let modal = host.querySelector(`.${HoverTableRenderer.HOVER_MODAL_CLASS}`);
        if (!modal) {
            modal = document.createElement('div');
            modal.className = HoverTableRenderer.HOVER_MODAL_CLASS;
            Object.assign(modal.style, {
                position: 'absolute',
                zIndex: '40',
                maxWidth: '360px',
                maxHeight: '260px',
                overflow: 'auto',
                overscrollBehavior: 'contain',
                background: 'rgba(255, 255, 255, 0.96)',
                border: '1px solid rgba(148, 163, 184, 0.8)',
                borderRadius: '10px',
                boxShadow: '0 14px 30px rgba(15, 23, 42, 0.18)',
                padding: '10px 12px',
                fontFamily: 'Inter, Segoe UI, system-ui, sans-serif',
                fontSize: '12px',
                lineHeight: '1.4',
                color: '#0f172a',
                pointerEvents: 'auto',
                display: 'none',
                opacity: '0',
                transition: 'opacity 100ms ease-out'
            });
            modal.dataset.hovering = 'false';
            host.appendChild(modal);
        }

        if (modal.dataset.boundEvents !== 'true') {
            modal.addEventListener('mouseenter', () => {
                modal.dataset.hovering = 'true';
                this.cancelHide(g);
            });

            modal.addEventListener('mouseleave', () => {
                modal.dataset.hovering = 'false';
                this.scheduleHide(g, 120);
            });

            modal.dataset.boundEvents = 'true';
        }

        return { modal, host };
    }

    clearHideTimer(modal) {
        if (!modal) {
            return;
        }
        if (modal.__hoverHideTimer) {
            clearTimeout(modal.__hoverHideTimer);
            modal.__hoverHideTimer = null;
        }
    }

    cancelHide(g) {
        const { modal } = this.ensureHoverModal(g);
        this.clearHideTimer(modal);
    }

    scheduleHide(g, delayMs = 450) {
        const { modal } = this.ensureHoverModal(g);
        if (!modal) {
            return;
        }

        this.clearHideTimer(modal);
        modal.__hoverHideTimer = setTimeout(() => {
            if (modal.dataset.hovering === 'true') {
                return;
            }
            this.hide(g);
        }, delayMs);
    }

    escapeHtml(text) {
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    formatHoverValue(value) {
        if (value instanceof Date) {
            return value.toISOString();
        }
        if (value === undefined) {
            return 'undefined';
        }
        if (value === null) {
            return 'null';
        }
        if (typeof value === 'object') {
            try {
                return JSON.stringify(value);
            } catch {
                return '[object]';
            }
        }
        return String(value);
    }

    getConfiguredHoverFields(graphConfig = {}) {
        const configured = new Set();

        const addFromColumnId = (columnId) => {
            if (!columnId || typeof columnId !== 'string') {
                return;
            }
            const parsed = parseColumnId(columnId);
            if (parsed?.columnName) {
                configured.add(parsed.columnName);
            }
        };

        addFromColumnId(graphConfig.xAxis);

        (graphConfig.series || []).forEach((series) => {
            addFromColumnId(series?.yAxis);

            if (series?.filter && series?.filterColumn) {
                addFromColumnId(series.filterColumn);
            }

            if (series?.colorGrading?.enabled && series?.colorGrading?.column) {
                addFromColumnId(series.colorGrading.column);
            }
        });

        addFromColumnId(graphConfig.colorGrading);
        addFromColumnId(graphConfig.contouring);

        (graphConfig.informativeFields || []).forEach(addFromColumnId);

        return configured;
    }

    getHoverRows(pointData = {}, allowedFields = null) {
        const rows = [];
        const hasWhitelist = allowedFields instanceof Set && allowedFields.size > 0;

        const shouldIncludeField = (fieldName) => {
            if (!hasWhitelist) {
                return true;
            }
            return allowedFields.has(fieldName);
        };

        // Skip empty cells so sparse columns (e.g. the inactive series in a UNION line+scatter
        // dataset) don't render as blank rows in the tooltip.
        const isEmpty = (v) => v === null || v === undefined || v === '';

        Object.entries(pointData).forEach(([key, value]) => {
            if (key === '__informative' && value && typeof value === 'object') {
                Object.entries(value).forEach(([infoKey, infoValue]) => {
                    if (shouldIncludeField(infoKey) && !isEmpty(infoValue)) {
                        rows.push([`informative.${infoKey}`, infoValue]);
                    }
                });
                return;
            }

            if (key.startsWith('_') || key.startsWith('__')) {
                return;
            }

            if (shouldIncludeField(key) && !isEmpty(value)) {
                rows.push([key, value]);
            }
        });

        return rows;
    }

    show(g, event, pointData, context = {}) {
        const { modal } = this.ensureHoverModal(g);
        if (!modal || !pointData) {
            return;
        }

        this.cancelHide(g);

        const allowedFields = this.getConfiguredHoverFields(context.graphConfig || {});
        const rows = this.getHoverRows(pointData, allowedFields);
        const title = context.seriesName ? `Point Details: ${context.seriesName}` : 'Point Details';

        const bodyHtml = rows.map(([key, value]) => (
            `<div style="display:grid;grid-template-columns:minmax(110px, 0.9fr) 1.1fr;gap:8px;margin-top:4px;">
                <div style="font-weight:600;color:#334155;word-break:break-word;">${this.escapeHtml(key)}</div>
                <div style="color:#0f172a;word-break:break-word;">${this.escapeHtml(this.formatHoverValue(value))}</div>
            </div>`
        )).join('');

        modal.innerHTML = `
            <div style="font-weight:700;font-size:12px;color:#0f172a;position:sticky;top:0;background:rgba(255,255,255,0.96);padding-bottom:6px;border-bottom:1px solid rgba(226,232,240,0.9);">${this.escapeHtml(title)}</div>
            <div style="padding-top:4px;">${bodyHtml || '<div style="color:#64748b;">No data available</div>'}</div>
        `;

        modal.style.display = 'block';
        modal.style.opacity = '1';
        this.updatePosition(g, event);
    }

    updatePosition(g, event) {
        const { modal, host } = this.ensureHoverModal(g);
        if (!modal || !host || modal.style.display === 'none') {
            return;
        }

        const hostRect = host.getBoundingClientRect();
        const offset = 14;
        let left = event.clientX - hostRect.left + offset;
        let top = event.clientY - hostRect.top + offset;

        const modalRect = modal.getBoundingClientRect();
        const maxLeft = hostRect.width - modalRect.width - 8;
        const maxTop = hostRect.height - modalRect.height - 8;

        if (left > maxLeft) {
            left = Math.max(8, event.clientX - hostRect.left - modalRect.width - offset);
        }
        if (top > maxTop) {
            top = Math.max(8, event.clientY - hostRect.top - modalRect.height - offset);
        }

        modal.style.left = `${Math.max(8, left)}px`;
        modal.style.top = `${Math.max(8, top)}px`;
    }

    hide(g) {
        const { modal } = this.ensureHoverModal(g);
        if (!modal) {
            return;
        }

        this.clearHideTimer(modal);
        modal.dataset.hovering = 'false';
        modal.style.opacity = '0';
        modal.style.display = 'none';
    }
}
