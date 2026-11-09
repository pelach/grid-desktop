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
    CAIRO_LINE_CAP_ROUND,
} from '../../utils/widgetUtils.js';
import { createWidgetContainer, registerWidgetCleanup, attachResponsiveScaler } from '../../shell/widgetUIUtils.js';
import { isActorDestroyed } from '../../utils/actorLifecycle.js';

// 4x2 alapon a referenciaméret (kb. 360 x 176 px)
const BASE_CONTAINER_WIDTH = 360;
const BASE_CONTAINER_HEIGHT = 176;

const RINGS = [
    { key: 'disk', label: 'Disk', rRatio: 1.00, color: '#fff59d', rgb: [1.00, 0.96, 0.62] },
    { key: 'ram',  label: 'RAM',  rRatio: 0.81, color: '#a5d6a7', rgb: [0.65, 0.84, 0.65] },
    { key: 'temp', label: 'Temp', rRatio: 0.62, color: '#ef9a9a', rgb: [0.94, 0.60, 0.60] },
    { key: 'cpu',  label: 'CPU',  rRatio: 0.43, color: '#90caf9', rgb: [0.56, 0.79, 0.98] },
];

export function createResourceWheelNode(config, width, height, xPosition, yPosition) {
    const fontFamily = resolveExplicitFontFamily(config);
    const fontCss = fontFamily ? `font-family: ${fontFamily}; ` : '';
    const textColor = resolveWidgetForegroundColor(config);
    const container = createWidgetContainer(config, width, height, xPosition, yPosition);

    let scale = Math.max(0.65, height / BASE_CONTAINER_HEIGHT);

    // ── 1. Rajzterület a köröknek (a teljes widget háttere) ──
    const drawingArea = new St.DrawingArea({
        x_expand: true,
        y_expand: true,
        x_align: Clutter.ActorAlign.FILL,
        y_align: Clutter.ActorAlign.FILL,
    });
    container.add_child(drawingArea);

    // ── 2. Fő réteg: vízszintes felosztás (Bal: szöveg + fejléc, Jobb: diagram területe) ──
    const mainLayout = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_expand: true,
        y_expand: true,
    });
    container.add_child(mainLayout);

    // Bal oldali függőleges oszlop
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
        icon_name: 'utilities-system-monitor-symbolic',
        style: `color: ${textColor}; margin-right: 6px; opacity: 0.85;`,
        y_align: Clutter.ActorAlign.CENTER,
    });
    const headerLabel = new St.Label({
        text: 'Resources',
        style: `${fontCss}color: ${textColor}; font-weight: bold; opacity: 0.9;`,
        y_align: Clutter.ActorAlign.CENTER,
    });
    headerLabel.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
    headerBox.add_child(headerIcon);
    headerBox.add_child(headerLabel);
    leftColumn.add_child(headerBox);

    // Kis térköz a fejléc és a sorok között
    const spacer = new St.Widget({ y_expand: true });
    leftColumn.add_child(spacer);

    // Lista a 4 mutatónak egymás alatt
    const statsList = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        y_align: Clutter.ActorAlign.CENTER,
    });
    leftColumn.add_child(statsList);

    const makeStatRow = (ring) => {
        const row = new St.BoxLayout({
            orientation: Clutter.Orientation.HORIZONTAL,
            y_align: Clutter.ActorAlign.CENTER,
            style: 'spacing: 8px;',
        });
        const dot = new St.Label({
            text: '●',
            style: `color: ${ring.color};`,
            y_align: Clutter.ActorAlign.CENTER,
        });
        const lbl = new St.Label({
            text: `${ring.label} --%`,
            style: `${fontCss}color: ${textColor}; font-weight: 500;`,
            y_align: Clutter.ActorAlign.CENTER,
        });
        lbl.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;

        row.add_child(dot);
        row.add_child(lbl);
        statsList.add_child(row);
        return { row, dot, lbl };
    };

    const diskStat = makeStatRow(RINGS.find(r => r.key === 'disk'));
    const ramStat  = makeStatRow(RINGS.find(r => r.key === 'ram'));
    const tempStat = makeStatRow(RINGS.find(r => r.key === 'temp'));
    const cpuStat  = makeStatRow(RINGS.find(r => r.key === 'cpu'));

    // Alsó térköz szimmetriához
    leftColumn.add_child(new St.Widget({ y_expand: true }));

    // Jobb oldal kitöltő (hogy a diagramnak fenntartsa a helyet a rajzolón)
    const rightAreaPlaceholder = new St.Widget({
        x_expand: true,
        y_expand: true,
    });
    mainLayout.add_child(rightAreaPlaceholder);

    const legendLabels = {
        disk: diskStat.lbl,
        ram: ramStat.lbl,
        temp: tempStat.lbl,
        cpu: cpuStat.lbl,
    };
    const allDots = [diskStat.dot, ramStat.dot, tempStat.dot, cpuStat.dot];
    const allRows = [diskStat.row, ramStat.row, tempStat.row, cpuStat.row];

    let currentMetrics = { cpu: 15, ram: 40, disk: 50, temp: 45 };
    let prevIdle = 0;
    let prevTotal = 0;
    let isDisposed = false;

    // ── Rajzolás a jobb oldalra igazítva ──
    drawingArea.connect('repaint', (area) => {
        const ctx = area.get_context();
        const [w, h] = area.get_surface_size();
        if (w <= 0 || h <= 0) return;

        ctx.setOperator(CAIRO_OPERATOR_CLEAR);
        ctx.paint();
        ctx.setOperator(CAIRO_OPERATOR_OVER);
        ctx.setLineCap(CAIRO_LINE_CAP_ROUND);

        // A kör középpontja a widget jobb felének közepére kerül
        const cx = w * 0.73;
        const cy = h / 2;

        const lineWidth = Math.max(4.0, 5.0 * scale);
        // A magassághoz skálázott sugár
        const maxRadius = (h / 2) * 0.78;
        const baseR = Math.max(14, maxRadius);

        RINGS.forEach(ring => {
            const r = baseR * ring.rRatio;
            if (r <= 2) return;
            const val = currentMetrics[ring.key] || 0;

            // Halvány háttérgyűrű
            ctx.setLineWidth(lineWidth);
            ctx.setSourceRGBA(ring.rgb[0], ring.rgb[1], ring.rgb[2], 0.16);
            ctx.newPath();
            ctx.arc(cx, cy, r, 0, Math.PI * 2);
            ctx.stroke();

            // Aktív ív
            const ratio = Math.max(0.015, Math.min(1.0, val / 100.0));
            ctx.setSourceRGBA(ring.rgb[0], ring.rgb[1], ring.rgb[2], 1.0);
            ctx.newPath();
            ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + (ratio * Math.PI * 2));
            ctx.stroke();
        });

        ctx.$dispose();
    });

    const readCpuDelta = () => {
        try {
            const file = Gio.File.new_for_path('/proc/stat');
            file.load_contents_async(null, (f, res) => {
                try {
                    const [, contents] = f.load_contents_finish(res);
                    if (isDisposed || !contents) return;

                    const text = new TextDecoder().decode(contents);
                    const cpuLine = text.split('\n').find(l => l.startsWith('cpu '));
                    if (!cpuLine) return;

                    const parts = cpuLine.trim().split(/\s+/).slice(1).map(Number);
                    const idle = parts[3] + (parts[4] || 0);
                    const total = parts.reduce((acc, n) => acc + n, 0);

                    if (prevTotal > 0) {
                        const deltaTotal = total - prevTotal;
                        const deltaIdle = idle - prevIdle;
                        const usage = deltaTotal > 0 ? Math.round(((deltaTotal - deltaIdle) / deltaTotal) * 100) : 0;
                        currentMetrics.cpu = Math.max(0, Math.min(100, usage));
                        if (legendLabels.cpu) {
                            legendLabels.cpu.set_text(`CPU ${currentMetrics.cpu}%`);
                        }
                        drawingArea.queue_repaint();
                    }

                    prevIdle = idle;
                    prevTotal = total;
                } catch (e) {}
            });
        } catch (e) {}
    };

    const readOtherStats = () => {
        // 1. RAM olvasása natívan /proc/meminfo-ból
        try {
            const memFile = Gio.File.new_for_path('/proc/meminfo');
            memFile.load_contents_async(null, (f, res) => {
                try {
                    const [, contents] = f.load_contents_finish(res);
                    if (isDisposed || !contents) return;
                    const text = new TextDecoder().decode(contents);
                    let total = 0, avail = 0;
                    for (const line of text.split('\n')) {
                        if (line.startsWith('MemTotal:')) total = parseInt(line.replace(/\D/g, ''), 10);
                        else if (line.startsWith('MemAvailable:')) avail = parseInt(line.replace(/\D/g, ''), 10);
                        if (total && avail) break;
                    }
                    if (total > 0) {
                        currentMetrics.ram = Math.round(((total - avail) / total) * 100);
                        if (legendLabels.ram) legendLabels.ram.set_text(`RAM ${currentMetrics.ram}%`);
                        drawingArea.queue_repaint();
                    }
                } catch (_) {}
            });
        } catch (_) {}

        // 2. Lemez olvasása natív GIO-val
        try {
            const rootFile = Gio.File.new_for_path('/');
            rootFile.query_filesystem_info_async('filesystem::size,filesystem::free', GLib.PRIORITY_LOW, null, (f, res) => {
                try {
                    const info = f.query_filesystem_info_finish(res);
                    if (isDisposed || !info) return;
                    const total = info.get_attribute_uint64('filesystem::size');
                    const free = info.get_attribute_uint64('filesystem::free');
                    if (total > 0) {
                        currentMetrics.disk = Math.round(((total - free) / total) * 100);
                        if (legendLabels.disk) legendLabels.disk.set_text(`Disk ${currentMetrics.disk}%`);
                        drawingArea.queue_repaint();
                    }
                } catch (_) {}
            });
        } catch (_) {}

        // 3. Hőmérséklet olvasása natívan
        try {
            const tempFile = Gio.File.new_for_path('/sys/class/thermal/thermal_zone0/temp');
            tempFile.load_contents_async(null, (f, res) => {
                try {
                    const [, contents] = f.load_contents_finish(res);
                    if (isDisposed || !contents) return;
                    const milliC = parseInt(new TextDecoder().decode(contents).trim(), 10);
                    if (!isNaN(milliC)) {
                        currentMetrics.temp = Math.round(milliC / 1000);
                        if (legendLabels.temp) legendLabels.temp.set_text(`Temp ${currentMetrics.temp}°`);
                        drawingArea.queue_repaint();
                    }
                } catch (_) {}
            });
        } catch (_) {}
    };

    const updateAll = () => {
        readCpuDelta();
        readOtherStats();
    };

    updateAll();

    const timeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 2, () => {
        if (isDisposed) return GLib.SOURCE_REMOVE;
        updateAll();
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
        const iconSize = Math.round(15 * scale);
        const statFontSize = Math.max(10, Math.round(11.5 * scale));
        const dotSize = Math.max(8, Math.round(9 * scale));
        const rowSpacing = Math.max(2, Math.round(3 * scale));

        mainLayout.style = `padding: ${pad}px;`;
        headerBox.style = `margin-bottom: ${Math.round(4 * scale)}px;`;
        headerIcon.icon_size = iconSize;
        headerLabel.style = `${fontCss}color: ${textColor}; font-size: ${titleFontSize}px; font-weight: bold; opacity: 0.9;`;

        allDots.forEach(d => {
            const c = d.style.match(/color:[^;]+;/)?.[0] || '';
            d.style = `${c} font-size: ${dotSize}px;`;
        });

        allRows.forEach(r => {
            r.style = `margin-bottom: ${rowSpacing}px; spacing: ${Math.round(6 * scale)}px;`;
        });

        Object.values(legendLabels).forEach(lbl => {
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