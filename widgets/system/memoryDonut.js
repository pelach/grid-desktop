import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import {
    resolveWidgetForegroundColor,
    resolveExplicitFontFamily,
    CAIRO_OPERATOR_CLEAR,
    CAIRO_OPERATOR_OVER,
} from '../../utils/widgetUtils.js';
import { createWidgetContainer, registerWidgetCleanup, attachResponsiveScaler } from '../../shell/widgetUIUtils.js';
import { isActorDestroyed } from '../../utils/actorLifecycle.js';

const BASE_CONTAINER_WIDTH = 360;
const BASE_CONTAINER_HEIGHT = 176;

// A 3 kategória a fánkdiagramhoz (a TrueNAS stílusú színekkel)
const MEM_SEGMENTS = [
    { key: 'services', label: 'Services', color: '#ff9800', rgb: [1.00, 0.60, 0.00] },
    { key: 'cache',    label: 'Cache',    color: '#ab47bc', rgb: [0.67, 0.28, 0.74] },
    { key: 'free',     label: 'Free',     color: '#29b6f6', rgb: [0.16, 0.71, 0.96] },
];

export function createMemoryDonutNode(config, width, height, xPosition, yPosition) {
    const fontFamily = resolveExplicitFontFamily(config);
    const fontCss = fontFamily ? `font-family: ${fontFamily}; ` : '';
    const textColor = resolveWidgetForegroundColor(config);
    const container = createWidgetContainer(config, width, height, xPosition, yPosition);

    let scale = Math.max(0.65, height / BASE_CONTAINER_HEIGHT);

    // ── 1. Rajzterület a fánkdiagramnak ──
    const drawingArea = new St.DrawingArea({
        x_expand: true,
        y_expand: true,
        x_align: Clutter.ActorAlign.FILL,
        y_align: Clutter.ActorAlign.FILL,
    });
    container.add_child(drawingArea);

    // ── 2. Réteg a szövegekhez és legendához ──
    const mainLayout = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_expand: true,
        y_expand: true,
    });
    container.add_child(mainLayout);

    // Bal oldali oszlop
    const leftColumn = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        y_expand: true,
        y_align: Clutter.ActorAlign.FILL,
    });
    mainLayout.add_child(leftColumn);

    // Fejléc
    const headerBox = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_align: Clutter.ActorAlign.START,
        y_align: Clutter.ActorAlign.CENTER,
    });
    const headerIcon = new St.Icon({
        icon_name: 'drive-harddisk-symbolic',
        style: `color: ${textColor}; margin-right: 6px; opacity: 0.85;`,
        y_align: Clutter.ActorAlign.CENTER,
    });
    const headerLabel = new St.Label({
        text: 'Memory',
        style: `${fontCss}color: ${textColor}; font-weight: bold; opacity: 0.9;`,
        y_align: Clutter.ActorAlign.CENTER,
    });
    headerLabel.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
    headerBox.add_child(headerIcon);
    headerBox.add_child(headerLabel);
    leftColumn.add_child(headerBox);

    // Teljes kapacitás felirat (pl. "16.0 GB total")
    const totalLabel = new St.Label({
        text: '-- GB total',
        style: `${fontCss}color: ${textColor}; font-weight: 500; opacity: 0.6; margin-left: 2px;`,
        y_align: Clutter.ActorAlign.CENTER,
    });
    totalLabel.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
    leftColumn.add_child(totalLabel);

    // Térkitöltő a fejléc és adatok közé
    leftColumn.add_child(new St.Widget({ y_expand: true }));

    // A 3 soros lista
    const statsList = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        y_align: Clutter.ActorAlign.CENTER,
    });
    leftColumn.add_child(statsList);

    const makeStatRow = (seg) => {
        const row = new St.BoxLayout({
            orientation: Clutter.Orientation.HORIZONTAL,
            y_align: Clutter.ActorAlign.CENTER,
            style: 'spacing: 8px;',
        });
        const dot = new St.Label({
            text: '●',
            style: `color: ${seg.color};`,
            y_align: Clutter.ActorAlign.CENTER,
        });
        const lbl = new St.Label({
            text: `${seg.label}: -- GB`,
            style: `${fontCss}color: ${textColor}; font-weight: 500;`,
            y_align: Clutter.ActorAlign.CENTER,
        });
        lbl.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;

        row.add_child(dot);
        row.add_child(lbl);
        statsList.add_child(row);
        return { row, dot, lbl };
    };

    const statRows = {};
    const allDots = [];
    const allRows = [];

    MEM_SEGMENTS.forEach(seg => {
        const item = makeStatRow(seg);
        statRows[seg.key] = item.lbl;
        allDots.push(item.dot);
        allRows.push(item.row);
    });

    // Alsó térkitöltő
    leftColumn.add_child(new St.Widget({ y_expand: true }));

    // Jobb oldal térkitöltő a rajznak
    const rightAreaPlaceholder = new St.Widget({
        x_expand: true,
        y_expand: true,
    });
    mainLayout.add_child(rightAreaPlaceholder);

    // Memória állapot kB-ban
    let memoryData = {
        total: 16 * 1024 * 1024,
        free: 4 * 1024 * 1024,
        cache: 6 * 1024 * 1024,
        services: 6 * 1024 * 1024,
    };
    let isDisposed = false;

    // ── Fánkdiagram kirajzolása (vastagabb sáv, egymásba csatlakozó ívek) ──
    drawingArea.connect('repaint', (area) => {
        const ctx = area.get_context();
        const [w, h] = area.get_surface_size();
        if (w <= 0 || h <= 0) return;

        ctx.setOperator(CAIRO_OPERATOR_CLEAR);
        ctx.paint();
        ctx.setOperator(CAIRO_OPERATOR_OVER);

        // A kör középpontja
        const cx = w * 0.73;
        const cy = h / 2;

        // Mivel 1 db összefüggő fánk van (nem 4 koncentrikus kör), jó vastagra vesszük
        const lineWidth = Math.max(14, 18 * scale);
        const radius = Math.max(20, (h / 2) * 0.65);

        // Szeletekhez BUTT cap kell, hogy pontosan illeszkedjenek egymáshoz
        ctx.setLineWidth(lineWidth);
        ctx.setLineCap(0); // CAIRO_LINE_CAP_BUTT

        // Halvány teljes háttérkarika
        ctx.setSourceRGBA(1, 1, 1, 0.08);
        ctx.newPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.stroke();

        const total = memoryData.total || 1;
        let currentAngle = -Math.PI / 2; // Fentről, 12 órától indul

        MEM_SEGMENTS.forEach(seg => {
            const val = memoryData[seg.key] || 0;
            if (val <= 0) return;

            const sweep = (val / total) * (Math.PI * 2);
            const endAngle = currentAngle + sweep;

            ctx.setSourceRGBA(seg.rgb[0], seg.rgb[1], seg.rgb[2], 0.95);
            ctx.newPath();
            ctx.arc(cx, cy, radius, currentAngle, endAngle);
            ctx.stroke();

            currentAngle = endAngle;
        });

        ctx.$dispose();
    });

    const formatGb = (kb) => {
        const gb = kb / (1024 * 1024);
        return `${gb.toFixed(1)} GB`;
    };

    // ── Adatok beolvasása közvetlenül a /proc/meminfo-ból ──
    const readMemInfo = () => {
        try {
            const file = Gio.File.new_for_path('/proc/meminfo');
            file.load_contents_async(null, (f, res) => {
                try {
                    const [, contents] = f.load_contents_finish(res);
                    if (isDisposed || !contents) return;

                    const text = new TextDecoder().decode(contents);
                    const map = {};
                    text.split('\n').forEach(line => {
                        const parts = line.split(':');
                        if (parts.length >= 2) {
                            const val = parseInt(parts[1].trim(), 10);
                            if (!isNaN(val)) map[parts[0].trim()] = val;
                        }
                    });

                    const total = map['MemTotal'] || 1;
                    const free = map['MemFree'] || 0;
                    const buffers = map['Buffers'] || 0;
                    const cached = map['Cached'] || 0;
                    const sReclaim = map['SReclaimable'] || 0;
                    
                    const cache = buffers + cached + sReclaim;
                    const services = Math.max(0, total - free - cache);

                    memoryData = { total, free, cache, services };

                    totalLabel.set_text(`${formatGb(total)} total`);
                    if (statRows.services) statRows.services.set_text(`Services: ${formatGb(services)}`);
                    if (statRows.cache) statRows.cache.set_text(`Cache: ${formatGb(cache)}`);
                    if (statRows.free) statRows.free.set_text(`Free: ${formatGb(free)}`);

                    drawingArea.queue_repaint();
                } catch (e) {}
            });
        } catch (e) {}
    };

    readMemInfo();

    const timeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 2, () => {
        if (isDisposed) return GLib.SOURCE_REMOVE;
        readMemInfo();
        return GLib.SOURCE_CONTINUE;
    });

    registerWidgetCleanup(container, () => {
        isDisposed = true;
        if (timeoutId) GLib.source_remove(timeoutId);
    });

    function applyScale(newScale) {
        scale = newScale;
        const pad = Math.max(10, Math.round(14 * scale));
        const titleFontSize = Math.max(11, Math.round(13 * scale));
        const subFontSize = Math.max(9, Math.round(10.5 * scale));
        const statFontSize = Math.max(10, Math.round(11.5 * scale));
        const dotSize = Math.max(8, Math.round(9 * scale));
        const iconSize = Math.round(15 * scale);
        const rowSpacing = Math.max(3, Math.round(4 * scale));

        mainLayout.style = `padding: ${pad}px;`;
        headerBox.style = `margin-bottom: ${Math.round(2 * scale)}px;`;
        headerIcon.icon_size = iconSize;
        headerLabel.style = `${fontCss}color: ${textColor}; font-size: ${titleFontSize}px; font-weight: bold; opacity: 0.9;`;
        totalLabel.style = `${fontCss}color: ${textColor}; font-size: ${subFontSize}px; font-weight: 500; opacity: 0.6;`;

        allDots.forEach(d => {
            const c = d.style.match(/color:[^;]+;/)?.[0] || '';
            d.style = `${c} font-size: ${dotSize}px;`;
        });

        allRows.forEach(r => {
            r.style = `margin-bottom: ${rowSpacing}px; spacing: ${Math.round(6 * scale)}px;`;
        });

        Object.values(statRows).forEach(lbl => {
            lbl.style = `${fontCss}color: ${textColor}; font-size: ${statFontSize}px; font-weight: 500; opacity: 0.9;`;
        });

        drawingArea.queue_repaint();
    }

    applyScale(scale);

    attachResponsiveScaler(container, BASE_CONTAINER_WIDTH, BASE_CONTAINER_HEIGHT, (_ratio, w, h) => {
        if (isActorDestroyed(container)) return;
        applyScale(Math.max(0.65, h / BASE_CONTAINER_HEIGHT));
    });

    return container;
}