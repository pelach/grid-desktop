import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import GLib from 'gi://GLib';
import {
    resolveWidgetForegroundColor,
    resolveExplicitFontFamily,
    cssColorToRgba,
    SECONDARY_OPACITY,
} from '../../utils/widgetUtils.js';
import { createWidgetContainer, registerWidgetCleanup, attachResponsiveScaler } from '../../shell/widgetUIUtils.js';
import { storageEngine } from '../../utils/storageEngine.js';
import { isActorDestroyed } from '../../utils/actorLifecycle.js';

const BASE_CONTAINER_WIDTH = 400;
const BASE_CONTAINER_HEIGHT = 200;
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

    let scale = Math.max(0.65, Math.min(width / BASE_CONTAINER_WIDTH, height / BASE_CONTAINER_HEIGHT));

    // A fő doboz, függőlegesen középre igazítva a kártyán belül
    const mainBox = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
        y_align: Clutter.ActorAlign.CENTER,
    });
    container.add_child(mainBox);

    // ── 1. Fejléc ──
    const topRow = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_expand: true,
        y_align: Clutter.ActorAlign.CENTER,
    });

    const textColumn = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
    });

    const valueRow = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_align: Clutter.ActorAlign.START,
        y_align: Clutter.ActorAlign.END,
    });

    const valueLabel = new St.Label({ text: '--' });
    valueLabel.clutter_text.set_ellipsize(Pango.EllipsizeMode.NONE);

    const unitLabel = new St.Label({ text: 'free' });
    unitLabel.clutter_text.set_ellipsize(Pango.EllipsizeMode.NONE);

    valueRow.add_child(valueLabel);
    valueRow.add_child(unitLabel);

    const totalLabel = new St.Label({ text: 'Total: --' });
    totalLabel.clutter_text.set_ellipsize(Pango.EllipsizeMode.END);

    textColumn.add_child(valueRow);
    textColumn.add_child(totalLabel);

    const iconContainer = new St.BoxLayout({
        x_expand: false,
        y_expand: false,
        y_align: Clutter.ActorAlign.CENTER,
    });

    const icon = new St.Icon({
        icon_name: 'drive-harddisk-symbolic',
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
        x_expand: true,
        y_expand: true,
    });
    iconContainer.add_child(icon);

    topRow.add_child(textColumn);
    topRow.add_child(iconContainer);
    mainBox.add_child(topRow);

    // ── 2. Középső sáv ──
    let currentData = null;

    const drawingArea = new St.DrawingArea({
        x_expand: true,
    });

    drawingArea.connect('repaint', (area) => {
        const cr = area.get_context();
        const [w, h] = area.get_surface_size();
        if (w <= 0 || h <= 0) {
            cr.$dispose();
            return;
        }
        const r = h / 2;

        drawRoundedRect(cr, 0, 0, w, h, r);
        cr.setSourceRGBA(1.0, 1.0, 1.0, 0.08);
        cr.fill();

        if (!currentData || !currentData.total) {
            cr.$dispose();
            return;
        }

        cr.save();
        drawRoundedRect(cr, 0, 0, w, h, r);
        cr.clip();

        const segments = [
            { key: 'system',  color: [0.21, 0.52, 0.89] },
            { key: 'media',   color: [0.57, 0.25, 0.67] },
            { key: 'archive', color: [0.90, 0.38, 0.00] },
            { key: 'image',   color: [0.20, 0.82, 0.48] },
            { key: 'docs',    color: [0.96, 0.83, 0.18] },
            { key: 'other',   color: [0.50, 0.50, 0.55] },
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

    // ── 3. Alsó legendák ──
    const legendRow1 = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_expand: true,
    });
    const legendRow2 = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_expand: true,
    });

    const legendWidgets = [];

    function createLegendItem(colorHex, text) {
        const itemBox = new St.BoxLayout({
            orientation: Clutter.Orientation.HORIZONTAL,
            y_align: Clutter.ActorAlign.CENTER,
        });

        const dot = new St.Widget({
            y_align: Clutter.ActorAlign.CENTER,
            style: `border-radius: 99px; background-color: ${colorHex}; margin-right: 4px;`,
        });

        const label = new St.Label({ text });
        label.clutter_text.set_ellipsize(Pango.EllipsizeMode.NONE);

        itemBox.add_child(dot);
        itemBox.add_child(label);
        legendWidgets.push({ dot, label, itemBox });
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

    const targetPath = config.storagePath || '/';
    let locationName = 'Root';
    if (targetPath !== '/') {
        const base = GLib.path_get_basename(targetPath);
        locationName = (base && base !== '.') ? base : targetPath;
    }

    function applyScale(newScale) {
        scale = newScale;
        const padH = Math.max(12, Math.round(PADDING_PX * scale * 1.2));
        const padV = Math.max(10, Math.round(PADDING_PX * scale));
        const valueFontSize = Math.max(18, Math.round(30 * scale)); // Nagyobb, markánsabb
        const labelFontSize = Math.max(10, Math.round(12.5 * scale));
        const legendFontSize = Math.max(9, Math.round(11 * scale));
        const iconBoxSize = Math.max(26, Math.round(34 * scale));
        const iconSize = Math.max(14, Math.round(18 * scale));
        const barHeight = Math.max(10, Math.round(14 * scale));
        const dotSize = Math.max(5, Math.round(7 * scale));

        mainBox.style = `padding: ${padV}px ${padH}px;`;

        valueLabel.style = `${fontCss}color: ${textColor}; font-size: ${valueFontSize}px; font-weight: 600; line-height: 1.0;`;
        unitLabel.style = `${fontCss}color: ${textColor}; opacity: ${SECONDARY_OPACITY}; `
            + `font-size: ${Math.round(valueFontSize * 0.42)}px; font-weight: 400; `
            + `margin-left: 5px; margin-bottom: 2px;`;
        totalLabel.style = `${fontCss}color: ${textColor}; font-size: ${labelFontSize}px; opacity: ${SECONDARY_OPACITY}; margin-top: 3px;`;

        iconContainer.style = `width: ${iconBoxSize}px; height: ${iconBoxSize}px; `
            + `background-color: ${cssColorToRgba(textColor, ICON_CONTAINER_BG_ALPHA)}; `
            + `border: 1px solid ${cssColorToRgba(textColor, ICON_CONTAINER_BORDER_ALPHA)}; `
            + `border-radius: ${Math.round(8 * scale)}px;`;
        icon.icon_size = iconSize;
        icon.style = `color: ${textColor}; opacity: ${SECONDARY_OPACITY};`;

        drawingArea.set_height(barHeight);
        drawingArea.style = `margin-top: ${Math.round(12 * scale)}px; margin-bottom: ${Math.round(12 * scale)}px;`;

        legendRow2.style = `margin-top: ${Math.round(5 * scale)}px;`;

        legendWidgets.forEach(({ dot, label, itemBox }) => {
            itemBox.style = `margin-right: ${Math.round(12 * scale)}px;`;
            dot.style = `${dot.style} width: ${dotSize}px; height: ${dotSize}px;`;
            label.style = `${fontCss}color: ${textColor}; font-size: ${legendFontSize}px; opacity: 0.8; font-weight: 500;`;
        });

        drawingArea.queue_repaint();
    }

    const onDataUpdate = (data) => {
        if (!data || isActorDestroyed(container)) return;
        currentData = data;

        if (data.isUnmounted) {
            valueLabel.set_text('--');
            totalLabel.set_text(`${locationName}: Offline`);
            legSys.label.set_text('System: --');
            legMed.label.set_text('Media: --');
            legArc.label.set_text('Archive: --');
            legDoc.label.set_text('Docs: --');
            legFree.label.set_text('Free: --');
            drawingArea.queue_repaint();
            return;
        }
        
        valueLabel.set_text(formatBytes(data.free).replace(' ', ''));
        totalLabel.set_text(`${locationName} total: ${formatBytes(data.total)}`);

        legSys.label.set_text(`System: ${formatLegendBytes(data.categories.system)}`);
        legMed.label.set_text(`Media: ${formatLegendBytes(data.categories.media)}`);
        legArc.label.set_text(`Archive: ${formatLegendBytes(data.categories.archive)}`);
        legDoc.label.set_text(`Docs: ${formatLegendBytes(data.categories.docs)}`);
        legFree.label.set_text(`Free: ${formatLegendBytes(data.free)}`);

        drawingArea.queue_repaint();
    };

    applyScale(scale);

    attachResponsiveScaler(container, BASE_CONTAINER_WIDTH, BASE_CONTAINER_HEIGHT, (_ratio, w, h) => {
        if (isActorDestroyed(container)) return;
        applyScale(Math.max(0.65, Math.min(w / BASE_CONTAINER_WIDTH, h / BASE_CONTAINER_HEIGHT)));
    });

    const unsubscribe = storageEngine.subscribe(targetPath, onDataUpdate);
    registerWidgetCleanup(container, unsubscribe);

    return container;
}