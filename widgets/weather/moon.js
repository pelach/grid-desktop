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

const REF_WIDTH_PX = 320;
const REF_HEIGHT_PX = 160;
const CONTAINER_PADDING_PX = 16;


// Tipográfiai alapméretek
const TITLE_FONT_SIZE_PX = 16;
const SUBTITLE_FONT_SIZE_PX = 12;
const INFO_LABEL_FONT_SIZE_PX = 11;
const INFO_VALUE_FONT_SIZE_PX = 13;
const MOON_CANVAS_SIZE_PX = 110;

// Szinodikus hónap átlagos hossza napokban
const SYNODIC_MONTH = 29.53058867;
// Referencia újhold időpontja (2000. jan 6. 18:14 UTC)
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



/**
 * Kiszámítja az aktuális holdfázis paramétereit adott időpontban.
 * @param {Date} date 
 * @returns {{ phase: number, age: number, fraction: number }}
 * phase: 0..1 (0: Újhold, 0.25: Első negyed, 0.5: Telihold, 0.75: Utolsó negyed)
 */
function getMoonPhaseData(date = new Date()) {
    const diffSeconds = (date.getTime() / 1000) - KNOWN_NEW_MOON_TIMESTAMP;
    const diffDays = diffSeconds / 86400;
    const cycles = diffDays / SYNODIC_MONTH;
    const phase = cycles - Math.floor(cycles); // 0.0 - 1.0
    const age = phase * SYNODIC_MONTH;

    // Megvilágítottsági arány (0..1)
    const fraction = (1 - Math.cos(phase * 2 * Math.PI)) / 2;

    return { phase, age, fraction };
}

/**
 * Megkeresi a legközelebbi jövőbeli újhold és telihold időpontját.
 */
function getUpcomingPhases(currentDate = new Date()) {
    const { phase } = getMoonPhaseData(currentDate);

    // Mennyi nap van még hátra a fázisig
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
    const bgColor = resolveWidgetBackgroundColor(config);
    const textColor = resolveWidgetForegroundColor(config);
    const fontFamily = resolveExplicitFontFamily(config);
    const fontCss = fontFamily ? `font-family: ${fontFamily}; ` : '';
    const borderRadius = config.appliedBorderRadius || 12;
    const textRgb = parseCssColor(textColor);
    const textRgba = (alpha) => cssColorToRgba(textColor, alpha);
    const container = createWidgetContainer(config, width, height, xPosition, yPosition);

    let scale = Math.min(width / REF_WIDTH_PX, height / REF_HEIGHT_PX);
    const state = { timerId: null };

    // Déli félteke esetén a fázis vizuálisan tükröződik
    const isSouthernHemisphere = (config.latitude !== undefined && config.latitude < 0);

    const mainBox = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_expand: true,
        y_expand: true,
        x_align: Clutter.ActorAlign.FILL,
        y_align: Clutter.ActorAlign.FILL,
    });
    container.add_child(mainBox);

    // Bal oldal: Hold grafika (DrawingArea)
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

    // Jobb oldal: Szöveges adatok
    const contentBox = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_align: Clutter.ActorAlign.CENTER,
        style: 'spacing: 4px;',
    });
    mainBox.add_child(contentBox);

    // Város / Helyszín
    const locationLabel = new St.Label({
        text: config.city || 'Holdfázis',
        x_expand: true,
    });
    contentBox.add_child(locationLabel);

    // Aktuális fázis neve
    const phaseNameLabel = new St.Label({
        text: 'Telihold',
        x_expand: true,
    });
    contentBox.add_child(phaseNameLabel);

    // Megvilágítottsági százalék
    const illuminationLabel = new St.Label({
        text: '100% megvilágítás',
        x_expand: true,
    });
    contentBox.add_child(illuminationLabel);

    // Elválasztó vonal
    const separator = new St.Widget({
        x_expand: true,
        style: 'height: 1px;',
    });
    contentBox.add_child(separator);

    // Következő fázisok konténere
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
        // k: -1 (újholdkor) ... 0 (félholdkor) ... +1 (teliholdkor)
        const k = 2 * fraction - 1;
        const steps = 60;

        // Teliholdnál (99%+ megvilágítás) nincs árnyék, tündököljön a teljes fotó:
        if (fraction >= 0.99) {
            ctx.$dispose();
            return;
        }

        ctx.save();
        ctx.newPath();

        // Mindig a Hold árnyékos (sötét) területét határoljuk körül:
        if (isWaxing) {
            // Növekvő hold: a jobb oldal világos, a bal oldal sötét.
            // Külső bal félkörív (fentről lefelé a bal peremen):
            ctx.arc(cx, cy, radius, -Math.PI / 2, Math.PI / 2);
            // Visszafelé alulról felfelé a terminátor (fény-árnyék határ) mentén:
            for (let i = 0; i <= steps; i++) {
                const angle = Math.PI / 2 - (i / steps) * Math.PI;
                const y = cy + radius * Math.sin(angle);
                const x = cx + radius * k * Math.cos(angle);
                ctx.lineTo(x, y);
            }
        } else {
            // Fogyó hold: a bal oldal világos, a jobb oldal sötét.
            // Külső jobb félkörív:
            ctx.arc(cx, cy, radius, Math.PI / 2, 3 * Math.PI / 2);
            // Visszafelé a terminátor mentén:
            for (let i = 0; i <= steps; i++) {
                const angle = 3 * Math.PI / 2 - (i / steps) * Math.PI;
                const y = cy + radius * Math.sin(angle);
                const x = cx + radius * k * Math.cos(angle);
                ctx.lineTo(x, y);
            }
        }

        ctx.closePath();
        // Árnyék sötétítése: szép mély árnyék enyhe földfénnyel
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
        scale = Math.min(currentWidth / REF_WIDTH_PX, currentHeight / REF_HEIGHT_PX);
        const px = (v) => Math.max(1, Math.round(v * scale));

        container.set_style(`${container.style || ''} padding: ${px(CONTAINER_PADDING_PX)}px;`);


        const canvasSize = px(MOON_CANVAS_SIZE_PX);
        moonCanvasBox.set_size(canvasSize, canvasSize);
        moonBgImage.set_size(canvasSize, canvasSize);
        moonCanvas.set_size(canvasSize, canvasSize);
        moonCanvasBox.style = `margin-right: ${px(14)}px;`;

        locationLabel.style = `${fontCss}font-size: ${px(SUBTITLE_FONT_SIZE_PX)}px; `
            + `color: ${textColor}; opacity: ${SECONDARY_OPACITY}; font-weight: 500;`;

        phaseNameLabel.style = `${fontCss}font-size: ${px(TITLE_FONT_SIZE_PX)}px; `
            + `color: ${textColor}; font-weight: bold;`;

        illuminationLabel.style = `${fontCss}font-size: ${px(SUBTITLE_FONT_SIZE_PX)}px; `
            + `color: ${textColor}; opacity: ${SECONDARY_OPACITY};`;

        separator.style = `height: 1px; background-color: ${textRgba(0.12)}; margin: ${px(4)}px 0;`;

        fullMoonBlock.lbl.style = `${fontCss}font-size: ${px(INFO_LABEL_FONT_SIZE_PX)}px; `
            + `color: ${textColor}; opacity: ${SECONDARY_OPACITY};`;
        fullMoonBlock.val.style = `${fontCss}font-size: ${px(INFO_VALUE_FONT_SIZE_PX)}px; `
            + `color: ${textColor}; font-weight: 600;`;

        newMoonBlock.lbl.style = `${fontCss}font-size: ${px(INFO_LABEL_FONT_SIZE_PX)}px; `
            + `color: ${textColor}; opacity: ${SECONDARY_OPACITY};`;
        newMoonBlock.val.style = `${fontCss}font-size: ${px(INFO_VALUE_FONT_SIZE_PX)}px; `
            + `color: ${textColor}; font-weight: 600;`;

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

    attachResponsiveScaler(container, REF_WIDTH_PX, REF_HEIGHT_PX, (_ratio, w, h) => {
        if (isActorDestroyed(container)) return;
        applyLayout(w, h);
    });

    // 10 percenkénti frissítés elegendő az égitest mozgásához
    const REFRESH_INTERVAL_MS = 600000;
    startPollingTimer(updateData, REFRESH_INTERVAL_MS, state);

    return container;
}