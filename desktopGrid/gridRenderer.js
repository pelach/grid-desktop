import St from 'gi://St';
import {
    CAIRO_OPERATOR_CLEAR,
    CAIRO_OPERATOR_OVER
} from '../utils/widgetUtils.js';

export function drawRoundedRect(ctx, x, y, w, h, r) {
    const deg = Math.PI / 180;
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arc(x + w - r, y + r, r, -90 * deg, 0 * deg);
    ctx.lineTo(x + w, y + h - r);
    ctx.arc(x + w - r, y + h - r, r, 0 * deg, 90 * deg);
    ctx.lineTo(x + r, y + h);
    ctx.arc(x + r, y + h - r, r, 90 * deg, 180 * deg);
    ctx.lineTo(x, y + r);
    ctx.arc(x + r, y + r, r, 180 * deg, -90 * deg);
    ctx.closePath();
}

export function createGridOverlay(gridCols, gridRows, cellTotalWidth, cellSize, gridMargin, red, green, blue, alpha) {
    const step = (Number.isFinite(cellTotalWidth) && cellTotalWidth > 0) ? cellTotalWidth : 96;
    const size = (Number.isFinite(cellSize) && cellSize > 0) ? cellSize : (step - 16);
    const margin = Number.isFinite(gridMargin) ? gridMargin : 4;
    const cols = Number.isFinite(gridCols) ? Math.max(1, gridCols) : 1;
    const rows = Number.isFinite(gridRows) ? Math.max(1, gridRows) : 1;

    const gap = Math.max(0, step - size);
    const overlayWidth = Math.max(0, Math.round((cols * step) - gap));
    const overlayHeight = Math.max(0, Math.round((rows * step) - gap));

    if (overlayWidth <= 0 || overlayHeight <= 0) {
        return new St.Widget({ visible: false });
    }

    const cornerRadius = Math.min(gap > 0 ? gap : 8, Math.round(size / 2));

    const canvas = new St.DrawingArea({
        x: Math.round(margin),
        y: Math.round(margin),
        width: overlayWidth,
        height: overlayHeight,
    });

    canvas.connect('repaint', area => {
        const [w, h] = area.get_surface_size();
        if (w <= 0 || h <= 0) return;

        const ctx = area.get_context();
        if (!ctx) return;

        ctx.setOperator(CAIRO_OPERATOR_OVER);
        ctx.setSourceRGBA(red, green, blue, alpha);
        ctx.rectangle(0, 0, w, h);
        ctx.fill();

        ctx.setOperator(CAIRO_OPERATOR_CLEAR);
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const cellX = Math.round(c * step);
                const cellY = Math.round(r * step);
                drawRoundedRect(ctx, cellX, cellY, size, size, cornerRadius);
                ctx.fill();
            }
        }

        // ctx.$dispose() ELTÁVOLÍTVA: a Clutter kezeli a saját kontextusát!
    });

    canvas.queue_repaint();
    return canvas;
}