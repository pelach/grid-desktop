import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

import {
    CAIRO_OPERATOR_CLEAR,
    CAIRO_OPERATOR_OVER,
    SECONDARY_OPACITY,
    cssColorToRgba,
    parseCssColor,
    resolveExplicitFontFamily,
    resolveWidgetBackgroundColor,
    resolveWidgetForegroundColor,
} from '../../utils/widgetUtils.js';
import {
    createWidgetContainer,
    attachResponsiveScaler,
    startPollingTimer,
    connectTimerCleanup,
} from '../../shell/widgetUIUtils.js';
import { isActorDestroyed } from '../../utils/actorLifecycle.js';

const BASE_CONTAINER_WIDTH_PX = 400;
const BASE_CONTAINER_HEIGHT_PX = 200;
const CONTAINER_PADDING_PX = 12;

const TITLE_FONT_SIZE_PX = 17;        // 15 helyett
const SUBTITLE_FONT_SIZE_PX = 13;     // 11 helyett (város és megvilágítás)
const INFO_LABEL_FONT_SIZE_PX = 12.5; // 11 helyett (Full moon, New moon címkék)
const INFO_VALUE_FONT_SIZE_PX = 14;   // 12.5 helyett (dátumok és hátralévő napok)
const MOON_CANVAS_SIZE_PX = 125;

const SYNODIC_MONTH = 29.53058867;
const KNOWN_NEW_MOON_TIMESTAMP = 947182440;

let moonImagePath = null;
try {
    const currentFilePath = Gio.File.new_for_uri(import.meta.url).get_path();
    const currentDir = GLib.path_get_dirname(currentFilePath);
    const p = GLib.build_filenamev([currentDir, 'moon', 'moon.png']);
    if (GLib.file_test(p, GLib.FileTest.EXISTS)) {
        moonImagePath = p;
    }
} catch (e) {
    console.warn('Grid Desktop: Nem található a hold kép:', e.message);
}

function getMoonPhaseData(date = new Date()) {
    const diffSeconds = (date.getTime() / 1000) - KNOWN_NEW_MOON_TIMESTAMP;
    const diffDays = diffSeconds / 86400;
    const cycles = diffDays / SYNODIC_MONTH;
    const phase = cycles - Math.floor(cycles);
    const age = phase * SYNODIC_MONTH;
    const fraction = (1 - Math.cos(phase * 2 * Math.PI)) / 2;
    return { phase, age, fraction };
}

function getUpcomingPhases(currentDate = new Date()) {
    const { phase } = getMoonPhaseData(currentDate);

    let daysToFull = (0.5 - phase) * SYNODIC_MONTH;
    if (daysToFull <= 0) daysToFull += SYNODIC_MONTH;

    let daysToNew = (1.0 - phase) * SYNODIC_MONTH;
    if (daysToNew <= 0) daysToNew += SYNODIC_MONTH;

    const nextFull = new Date(currentDate.getTime() + daysToFull * 86400 * 1000);
    const nextNew = new Date(currentDate.getTime() + daysToNew * 86400 * 1000);

    return { nextFull, nextNew, daysToFull, daysToNew };
}

function getPhaseName(phase) {
    if (phase < 0.03 || phase > 0.97) return 'New Moon';
    if (phase < 0.22) return 'Waxing Crescent';
    if (phase < 0.28) return 'First Quarter';
    if (phase < 0.47) return 'Waxing Gibbous';
    if (phase < 0.53) return 'Full Moon';
    if (phase < 0.72) return 'Waning Gibbous';
    if (phase < 0.78) return 'Last Quarter';
    return 'Waning Crescent';
}

function formatDateShort(date) {
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    return `${month}.${day}.`;
}

export function createMoonNode(config, width, height, xPosition, yPosition) {
    const textColor = resolveWidgetForegroundColor(config);
    const fontFamily = resolveExplicitFontFamily(config);
    const fontCss = fontFamily ? `font-family: ${fontFamily}; ` : '';
    const textRgba = (alpha) => cssColorToRgba(textColor, alpha);
    const container = createWidgetContainer(config, width, height, xPosition, yPosition);

    let scale = Math.max(0.65, Math.min(width / BASE_CONTAINER_WIDTH_PX, height / BASE_CONTAINER_HEIGHT_PX));
    const state = { timerId: null };

    const isSouthernHemisphere = (config.latitude !== undefined && config.latitude < 0);

    const mainBox = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_expand: true,
        y_expand: true,
        x_align: Clutter.ActorAlign.FILL,
        y_align: Clutter.ActorAlign.FILL,
    });
    container.add_child(mainBox);

    const moonCanvasBox = new St.Widget({
        layout_manager: new Clutter.BinLayout(),
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
    });

    const moonBgImage = new St.Widget({
        style: moonImagePath ? `background-image: url("${moonImagePath}"); background-size: contain;` : '',
        x_expand: true,
        y_expand: true,
    });
    moonCanvasBox.add_child(moonBgImage);

    const moonCanvas = new St.DrawingArea({
        x_expand: true,
        y_expand: true,
    });
    moonCanvasBox.add_child(moonCanvas);
    mainBox.add_child(moonCanvasBox);

    const contentBox = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_align: Clutter.ActorAlign.CENTER,
        style: 'spacing: 4px;',
    });
    mainBox.add_child(contentBox);

    const locationLabel = new St.Label({
        text: config.city || 'Holdfázis',
        x_expand: true,
    });
    contentBox.add_child(locationLabel);

    const phaseNameLabel = new St.Label({
        text: 'Telihold',
        x_expand: true,
    });
    contentBox.add_child(phaseNameLabel);

    const illuminationLabel = new St.Label({
        text: '100% megvilágítás',
        x_expand: true,
    });
    contentBox.add_child(illuminationLabel);

    const separator = new St.Widget({
        x_expand: true,
        style: 'height: 1px;',
    });
    contentBox.add_child(separator);

    const datesRow = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        style: 'spacing: 3px;',
    });
    contentBox.add_child(datesRow);

    const buildPhaseInfoBlock = (title) => {
        const box = new St.BoxLayout({
            orientation: Clutter.Orientation.HORIZONTAL,
            x_expand: true,
            x_align: Clutter.ActorAlign.FILL,
            style: 'spacing: 8px;',
        });
        const lbl = new St.Label({
            text: title,
            x_expand: true,
        });
        const val = new St.Label({
            text: '--.--',
            x_align: Clutter.ActorAlign.END,
        });
        box.add_child(lbl);
        box.add_child(val);
        return { box, lbl, val };
    };

    const fullMoonBlock = buildPhaseInfoBlock('Full moon:');
    const newMoonBlock = buildPhaseInfoBlock('New moon:');
    datesRow.add_child(fullMoonBlock.box);
    datesRow.add_child(newMoonBlock.box);

    let currentPhaseData = getMoonPhaseData();

    function drawMoon(canvas) {
        const ctx = canvas.get_context();
        const [w, h] = canvas.get_surface_size();
        if (w <= 0 || h <= 0) return;

        ctx.setOperator(CAIRO_OPERATOR_CLEAR);
        ctx.paint();
        ctx.setOperator(CAIRO_OPERATOR_OVER);

        const cx = w / 2;
        const cy = h / 2;
        const radius = Math.min(w, h) * 0.46;

        let phase = currentPhaseData.phase;
        if (isSouthernHemisphere) {
            phase = (1.0 - phase) % 1.0;
        }

        const isWaxing = phase <= 0.5;
        const fraction = currentPhaseData.fraction;
        const k = 2 * fraction - 1;
        const steps = 60;

        if (fraction >= 0.99) {
            ctx.$dispose();
            return;
        }

        ctx.save();
        ctx.newPath();

        if (isWaxing) {
            ctx.arc(cx, cy, radius, -Math.PI / 2, Math.PI / 2);
            for (let i = 0; i <= steps; i++) {
                const angle = Math.PI / 2 - (i / steps) * Math.PI;
                const y = cy + radius * Math.sin(angle);
                const x = cx + radius * k * Math.cos(angle);
                ctx.lineTo(x, y);
            }
        } else {
            ctx.arc(cx, cy, radius, Math.PI / 2, 3 * Math.PI / 2);
            for (let i = 0; i <= steps; i++) {
                const angle = 3 * Math.PI / 2 - (i / steps) * Math.PI;
                const y = cy + radius * Math.sin(angle);
                const x = cx + radius * k * Math.cos(angle);
                ctx.lineTo(x, y);
            }
        }

        ctx.closePath();
        ctx.setSourceRGBA(0.05, 0.05, 0.08, 0.82);
        ctx.fill();
        ctx.restore();

        ctx.$dispose();
    }
    moonCanvas.connect('repaint', drawMoon);

    function updateData() {
        const now = new Date();
        currentPhaseData = getMoonPhaseData(now);
        const { nextFull, nextNew, daysToFull, daysToNew } = getUpcomingPhases(now);

        phaseNameLabel.text = getPhaseName(currentPhaseData.phase);
        illuminationLabel.text = `${Math.round(currentPhaseData.fraction * 100)}% illuminance`;

        fullMoonBlock.val.text = `${formatDateShort(nextFull)} (${Math.ceil(daysToFull)} d)`;
        newMoonBlock.val.text = `${formatDateShort(nextNew)} (${Math.ceil(daysToNew)} d)`;

        if (container.mapped) {
            moonCanvas.queue_repaint();
        }
    }

    function applyLayout(currentWidth, currentHeight) {
        if (!currentWidth || !currentHeight) return;
        scale = Math.max(0.65, Math.min(currentWidth / BASE_CONTAINER_WIDTH_PX, currentHeight / BASE_CONTAINER_HEIGHT_PX));
        const px = (v) => Math.max(1, Math.round(v * scale));

        mainBox.style = `padding: ${px(CONTAINER_PADDING_PX)}px;`;

        const canvasSize = px(MOON_CANVAS_SIZE_PX);
        moonCanvasBox.set_size(canvasSize, canvasSize);
        moonBgImage.set_size(canvasSize, canvasSize);
        moonCanvas.set_size(canvasSize, canvasSize);
        moonCanvasBox.style = `margin-right: ${px(14)}px;`;

        locationLabel.style = `${fontCss}font-size: ${px(SUBTITLE_FONT_SIZE_PX)}px; color: ${textColor}; opacity: ${SECONDARY_OPACITY}; font-weight: 500;`;
        phaseNameLabel.style = `${fontCss}font-size: ${px(TITLE_FONT_SIZE_PX)}px; color: ${textColor}; font-weight: bold;`;
        illuminationLabel.style = `${fontCss}font-size: ${px(SUBTITLE_FONT_SIZE_PX)}px; color: ${textColor}; opacity: ${SECONDARY_OPACITY};`;

        separator.style = `height: 1px; background-color: ${textRgba(0.12)}; margin: ${px(4)}px 0;`;

        fullMoonBlock.lbl.style = `${fontCss}font-size: ${px(INFO_LABEL_FONT_SIZE_PX)}px; color: ${textColor}; opacity: ${SECONDARY_OPACITY};`;
        fullMoonBlock.val.style = `${fontCss}font-size: ${px(INFO_VALUE_FONT_SIZE_PX)}px; color: ${textColor}; font-weight: 600;`;

        newMoonBlock.lbl.style = `${fontCss}font-size: ${px(INFO_LABEL_FONT_SIZE_PX)}px; color: ${textColor}; opacity: ${SECONDARY_OPACITY};`;
        newMoonBlock.val.style = `${fontCss}font-size: ${px(INFO_VALUE_FONT_SIZE_PX)}px; color: ${textColor}; font-weight: 600;`;

        updateData();
    }

    connectTimerCleanup(container, state);

    if (container.mapped) {
        updateData();
    } else {
        const mappedId = container.connect('notify::mapped', () => {
            container.disconnect(mappedId);
            if (!isActorDestroyed(container)) {
                updateData();
            }
        });
    }

    applyLayout(width, height);

    attachResponsiveScaler(container, BASE_CONTAINER_WIDTH_PX, BASE_CONTAINER_HEIGHT_PX, (_ratio, w, h) => {
        if (isActorDestroyed(container)) return;
        applyLayout(w, h);
    });

    const REFRESH_INTERVAL_MS = 600000;
    startPollingTimer(updateData, REFRESH_INTERVAL_MS, state);

    return container;
}