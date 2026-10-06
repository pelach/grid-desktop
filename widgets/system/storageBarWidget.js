import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import Cairo from 'gi://cairo';
import {
    resolveWidgetForegroundColor,
    resolveExplicitFontFamily,
    cssColorToRgba,
    SECONDARY_OPACITY,
} from '../../utils/widgetUtils.js';
import { createWidgetContainer, registerWidgetCleanup } from '../../shell/widgetUIUtils.js';
import { storageEngine } from '../../utils/storageEngine.js';

const BASE_CONTAINER_WIDTH = 260;
const BASE_CONTAINER_HEIGHT = 130;
const PADDING_PX = 14;
const ICON_CONTAINER_BG_ALPHA = 0.08;
const ICON_CONTAINER_BORDER_ALPHA = 0.08;

function formatBytes(bytes) {
    if (!bytes || bytes <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    const val = (bytes / Math.pow(1024, i)).toFixed(i >= 3 ? 1 : 0);
    return `${val} ${units[i]}`;
}

function formatLegendBytes(bytes) {
    if (!bytes || bytes <= 0) return '0 GB';
    const gb = bytes / (1024 * 1024 * 1024);
    if (gb >= 1) return `${Math.round(gb)} GB`;
    const mb = bytes / (1024 * 1024);
    return `${Math.round(mb)} MB`;
}

// Segédfüggvény lekerekített téglalap útvonalhoz Cairoban
function drawRoundedRect(cr, x, y, width, height, radius) {
    cr.newSubPath();
    cr.arc(x + width - radius, y + radius, radius, -Math.PI / 2, 0);
    cr.arc(x + width - radius, y + height - radius, radius, 0, Math.PI / 2);
    cr.arc(x + radius, y + height - radius, radius, Math.PI / 2, Math.PI);
    cr.arc(x + radius, y + radius, radius, Math.PI, 3 * Math.PI / 2);
    cr.closePath();
}

export function createStorageBarNode(config, width, height, xPosition, yPosition) {
    const textColor = resolveWidgetForegroundColor(config);
    const fontFamily = resolveExplicitFontFamily(config);
    const fontCss = fontFamily ? `font-family: ${fontFamily}; ` : '';
    const container = createWidgetContainer(config, width, height, xPosition, yPosition);

    const scale = Math.min(width / BASE_CONTAINER_WIDTH, height / BASE_CONTAINER_HEIGHT);
    const pad = Math.max(8, Math.round(PADDING_PX * scale));
    const valueFontSize = Math.max(16, Math.round(24 * scale));
    const labelFontSize = Math.max(9, Math.round(11 * scale));
    const legendFontSize = Math.max(8, Math.round(9 * scale));
    const iconBoxSize = Math.max(22, Math.round(26 * scale));
    const iconSize = Math.max(12, Math.round(14 * scale));

    const mainBox = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
        style: `padding: ${pad}px;`,
    });

    // ── 1. Fejléc: Szabad hely balra, HDD ikon doboz jobbra ──────────────────
    const topRow = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_expand: true,
        y_align: Clutter.ActorAlign.START,
    });

    const textColumn = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
    });

    const valueRow = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_align: Clutter.ActorAlign.START,
        y_align: Clutter.ActorAlign.CENTER,
    });

    const valueLabel = new St.Label({
        text: '--',
        style: `${fontCss}color: ${textColor}; font-size: ${valueFontSize}px; font-weight: 600;`,
    });
    valueLabel.clutter_text.set_ellipsize(Pango.EllipsizeMode.NONE);

    const unitLabel = new St.Label({
        text: 'free',
        style: `${fontCss}color: ${textColor}; opacity: ${SECONDARY_OPACITY}; `
            + `font-size: ${Math.round(valueFontSize * 0.42)}px; font-weight: 400; `
            + `margin-left: ${Math.round(4 * scale)}px; margin-top: ${Math.round(4 * scale)}px;`,
    });
    unitLabel.clutter_text.set_ellipsize(Pango.EllipsizeMode.NONE);

    valueRow.add_child(valueLabel);
    valueRow.add_child(unitLabel);

    const totalLabel = new St.Label({
        text: 'Összesen: --',
        style: `${fontCss}color: ${textColor}; font-size: ${labelFontSize}px; opacity: ${SECONDARY_OPACITY}; margin-top: 1px;`,
    });
    totalLabel.clutter_text.set_ellipsize(Pango.EllipsizeMode.END);

    textColumn.add_child(valueRow);
    textColumn.add_child(totalLabel);

    const iconContainer = new St.BoxLayout({
        width: iconBoxSize,
        height: iconBoxSize,
        x_expand: false,
        y_expand: false,
        y_align: Clutter.ActorAlign.START,
        style: `background-color: ${cssColorToRgba(textColor, ICON_CONTAINER_BG_ALPHA)}; `
            + `border: 1px solid ${cssColorToRgba(textColor, ICON_CONTAINER_BORDER_ALPHA)}; `
            + `border-radius: ${Math.round(6 * scale)}px;`,
    });

    const icon = new St.Icon({
        icon_name: 'drive-harddisk-symbolic',
        icon_size: iconSize,
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
        x_expand: true,
        y_expand: true,
        style: `color: ${textColor}; opacity: ${SECONDARY_OPACITY};`,
    });
    iconContainer.add_child(icon);

    topRow.add_child(textColumn);
    topRow.add_child(iconContainer);
    mainBox.add_child(topRow);

    // ── 2. Középső sáv: Szegmentált Cairo Bar ────────────────────────────────
    let currentData = null;
    const barHeight = Math.max(8, Math.round(12 * scale));

    const drawingArea = new St.DrawingArea({
        x_expand: true,
        height: barHeight,
        style: `margin-top: ${Math.round(5 * scale)}px; margin-bottom: ${Math.round(8 * scale)}px;`,
    });

    drawingArea.connect('repaint', (area) => {
        const cr = area.get_context();
        const [w, h] = area.get_surface_size();
        const r = h / 2;

        // Háttér tálca (szabad hely területe)
        drawRoundedRect(cr, 0, 0, w, h, r);
        cr.setSourceRGBA(1.0, 1.0, 1.0, 0.08);
        cr.fill();

        if (!currentData || !currentData.total) {
            cr.$dispose();
            return;
        }

        // Maszkoljuk a teljes kerek sávot, így a szegmensek belül maradnak
        cr.save();
        drawRoundedRect(cr, 0, 0, w, h, r);
        cr.clip();

        const segments = [
            { key: 'system',  color: [0.21, 0.52, 0.89] }, // Kék (#3584e4)
            { key: 'media',   color: [0.57, 0.25, 0.67] }, // Lila (#9141ac)
            { key: 'archive', color: [0.90, 0.38, 0.00] }, // Narancs (#e66100)
            { key: 'image',   color: [0.20, 0.82, 0.48] }, // Zöld (#33d17a)
            { key: 'docs',    color: [0.96, 0.83, 0.18] }, // Sárga (#f6d32d)
            { key: 'other',   color: [0.50, 0.50, 0.55] }, // Szürke
        ];

        let startX = 0;
        for (const seg of segments) {
            const bytes = currentData.categories[seg.key] || 0;
            if (bytes <= 0) continue;

            const segWidth = (bytes / currentData.total) * w;
            cr.setSourceRGB(seg.color[0], seg.color[1], seg.color[2]);
            cr.rectangle(startX, 0, segWidth, h);
            cr.fill();
            startX += segWidth;
        }

        cr.restore();
        cr.$dispose();
    });

    mainBox.add_child(drawingArea);

    // ── 3. Alsó rész: Legend címkék ──────────────────────────────────────────
    const legendRow1 = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_expand: true,
    });
    const legendRow2 = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_expand: true,
        style: `margin-top: ${Math.round(2 * scale)}px;`,
    });

    function createLegendItem(colorHex, text) {
        const itemBox = new St.BoxLayout({
            orientation: Clutter.Orientation.HORIZONTAL,
            y_align: Clutter.ActorAlign.CENTER,
            style: `margin-right: ${Math.round(6 * scale)}px;`,
        });

        const dot = new St.Widget({
            width: Math.round(5 * scale),
            height: Math.round(5 * scale),
            y_align: Clutter.ActorAlign.CENTER,
            style: `width: ${Math.round(5 * scale)}px; height: ${Math.round(5 * scale)}px; `
                + `border-radius: 99px; background-color: ${colorHex}; margin-right: 3px;`,
        });

        const label = new St.Label({
            text: text,
            style: `${fontCss}color: ${textColor}; font-size: ${legendFontSize}px; opacity: 0.75;`,
        });
        // Ne pontozza le!
        label.clutter_text.set_ellipsize(Pango.EllipsizeMode.NONE);

        itemBox.add_child(dot);
        itemBox.add_child(label);
        return { box: itemBox, label };
    }

    const legSys = createLegendItem('#3584e4', 'System: --');
    const legMed = createLegendItem('#9141ac', 'Media: --');
    const legArc = createLegendItem('#e66100', 'Archive: --');
    const legDoc = createLegendItem('#f6d32d', 'Docs: --');
    const legFree = createLegendItem('rgba(255,255,255,0.3)', 'Free: --');

    legendRow1.add_child(legSys.box);
    legendRow1.add_child(legMed.box);
    legendRow1.add_child(legArc.box);

    legendRow2.add_child(legDoc.box);
    legendRow2.add_child(legFree.box);

    mainBox.add_child(legendRow1);
    mainBox.add_child(legendRow2);

    container.add_child(mainBox);

    // ── 4. Adatfrissítés bekötése ────────────────────────────────────────────
    const onDataUpdate = (data) => {
        if (!data) return;
        currentData = data;

        valueLabel.set_text(formatBytes(data.free).replace(' ', ''));
        totalLabel.set_text(`Total: ${formatBytes(data.total)}`);

        legSys.label.set_text(`System: ${formatLegendBytes(data.categories.system)}`);
        legMed.label.set_text(`Media: ${formatLegendBytes(data.categories.media)}`);
        legArc.label.set_text(`Archive: ${formatLegendBytes(data.categories.archive)}`);
        legDoc.label.set_text(`Docs: ${formatLegendBytes(data.categories.docs)}`);
        legFree.label.set_text(`Free: ${formatLegendBytes(data.free)}`);

        drawingArea.queue_repaint();
    };

    const unsubscribe = storageEngine.subscribe(onDataUpdate);
    registerWidgetCleanup(container, unsubscribe);

    return container;
}