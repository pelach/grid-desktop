import St from 'gi://St';
import GLib from 'gi://GLib';
import {
    resolveWidgetForegroundColor,
    parseCssColor,
} from '../../utils/widgetUtils.js';
import {
    createWidgetContainer,
    connectTimerCleanup,
    attachResponsiveScaler,
} from '../../shell/widgetUIUtils.js';

const BASE_CONTAINER_WIDTH_PX = 400;
const BASE_CONTAINER_HEIGHT_PX = 200;

const ROWS = 4;
const BIT_COUNTS = [2, 4, 3, 4, 3, 4];
const WITHIN_GAP_RATIO = 0.35;
const BETWEEN_GAP_RATIO = 0.9;
const EDGE_GAP_RATIO = 0.25;

function getClockDigits() {
    const now = GLib.DateTime.new_now_local();
    const h = now.get_hour();
    const m = now.get_minute();
    const s = now.get_second();

    return [
        Math.floor(h / 10), h % 10,
        Math.floor(m / 10), m % 10,
        Math.floor(s / 10), s % 10,
    ];
}

export function createBinaryNode(config, width, height, xPosition, yPosition) {
    const textColor = resolveWidgetForegroundColor(config);
    const container = createWidgetContainer(config, width, height, xPosition, yPosition);

    const parsedText = parseCssColor(textColor);
    const activeColor = [parsedText.r, parsedText.g, parsedText.b, 0.95];
    const inactiveColor = [parsedText.r, parsedText.g, parsedText.b, 0.18];

    const state = { timerId: null };

    const drawingArea = new St.DrawingArea({
        x_expand: true,
        y_expand: true,
        reactive: false,
    });

    drawingArea.connect('repaint', (area) => {
        const cr = area.get_context();
        const [w, h] = area.get_surface_size();

        if (w <= 0 || h <= 0) {
            //cr.$dispose();
            return;
        }

        const digits = getClockDigits();
        const margin = Math.min(12, Math.min(w, h) * 0.08);
        const availableWidth = Math.max(10, w - margin * 2);
        const availableHeight = Math.max(10, h - margin * 2);

        const cols = BIT_COUNTS.length;
        const pairs = Math.ceil(cols / 2);
        const colUnits = cols + (cols - pairs) * WITHIN_GAP_RATIO + (pairs - 1) * BETWEEN_GAP_RATIO + 2 * EDGE_GAP_RATIO;
        const rowUnits = ROWS + (ROWS - 1) * WITHIN_GAP_RATIO + 2 * EDGE_GAP_RATIO;

        const dotSize = Math.max(2, Math.min(
            availableWidth / colUnits,
            availableHeight / rowUnits
        ));

        const withinGap = dotSize * WITHIN_GAP_RATIO;
        const betweenGap = dotSize * BETWEEN_GAP_RATIO;
        const edgeGap = dotSize * EDGE_GAP_RATIO;

        const colGaps = [];
        for (let col = 0; col < cols - 1; col++) {
            colGaps.push(col % 2 === 0 ? withinGap : betweenGap);
        }

        const baseGridWidth = cols * dotSize + colGaps.reduce((sum, g) => sum + g, 0) + edgeGap * 2;
        const colStretch = (cols + 1) > 0 ? Math.max(0, availableWidth - baseGridWidth) / (cols + 1) : 0;
        const edge = margin + edgeGap + colStretch;

        const baseGridHeight = ROWS * dotSize + (ROWS - 1) * withinGap + edgeGap * 2;
        const rowStretch = (ROWS + 1) > 0 ? Math.max(0, availableHeight - baseGridHeight) / (ROWS + 1) : 0;
        const rowGap = withinGap + rowStretch;
        const rowEdge = margin + edgeGap + rowStretch;

        const radius = Math.max(1, dotSize / 2 - 0.5);

        const positions = [];
        let cursor = edge;
        for (let col = 0; col < cols; col++) {
            positions.push(cursor + dotSize / 2);
            if (col < cols - 1) {
                cursor += dotSize + colGaps[col] + colStretch;
            }
        }

        for (let col = 0; col < cols; col++) {
            const bitCount = BIT_COUNTS[col];
            const val = digits[col];
            const posX = positions[col];

            for (let row = 0; row < ROWS; row++) {
                const posY = rowEdge + (ROWS - 1 - row) * (dotSize + rowGap) + dotSize / 2;
                const lit = row < bitCount && ((val >> row) & 1) === 1;
                const c = lit ? activeColor : inactiveColor;

                cr.arc(posX, posY, radius, 0, Math.PI * 2);
                cr.setSourceRGBA(c[0], c[1], c[2], c[3]);
                cr.fill();
            }
        }

        //cr.$dispose();
    });

    container.set_child(drawingArea);

    state.timerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
        drawingArea.queue_repaint();
        return GLib.SOURCE_CONTINUE;
    });

    connectTimerCleanup(container, state);

    attachResponsiveScaler(container, BASE_CONTAINER_WIDTH_PX, BASE_CONTAINER_HEIGHT_PX, () => {
        drawingArea.queue_repaint();
    });

    return container;
}