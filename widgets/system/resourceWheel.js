import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import PangoCairo from 'gi://PangoCairo';
import {
    resolveWidgetForegroundColor,
    resolveExplicitFontFamily,
    parseCssColor,
    cssColorToRgba,
    CAIRO_OPERATOR_CLEAR,
    CAIRO_OPERATOR_OVER,
    CAIRO_LINE_CAP_ROUND,
} from '../../utils/widgetUtils.js';
import { createWidgetContainer, registerWidgetCleanup } from '../../shell/widgetUIUtils.js';

const BORDER_ALPHA = 0.14;
const BASE_CONTAINER_WIDTH_PX = 270;
const BASE_CONTAINER_HEIGHT_PX = 210;

// Kívülről befelé haladva: Disk -> RAM -> Temp -> CPU (legbelül a kék CPU)
const RINGS = [
    { key: 'disk', label: 'Disk', rRatio: 1.0,  color: '#fff59d', rgb: [1.00, 0.96, 0.62] },
    { key: 'ram',  label: 'RAM',  rRatio: 0.80, color: '#a5d6a7', rgb: [0.65, 0.84, 0.65] },
    { key: 'temp', label: 'Temp', rRatio: 0.60, color: '#ef9a9a', rgb: [0.94, 0.60, 0.60] },
    { key: 'cpu',  label: 'CPU',  rRatio: 0.40, color: '#90caf9', rgb: [0.56, 0.79, 0.98] },
];

export function createResourceWheelNode(config, width, height, xPosition, yPosition) {
    const fontFamily = resolveExplicitFontFamily(config) || 'Sans';
    const fontCss = fontFamily ? `font-family: ${fontFamily}; ` : '';
    const textColor = resolveWidgetForegroundColor(config);
    const parsedText = parseCssColor(textColor);
    const container = createWidgetContainer(config, width, height, xPosition, yPosition);
    container.style += ` border: 1px solid ${cssColorToRgba(textColor, BORDER_ALPHA)};`;

    const scale = Math.max(0.65, Math.min(width / BASE_CONTAINER_WIDTH_PX, height / BASE_CONTAINER_HEIGHT_PX));
    const padding = Math.max(10, Math.round(14 * scale));

    const mainLayout = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
        style: `padding: ${padding}px; spacing: ${Math.round(6 * scale)}px;`,
    });

    const titleFontSize = Math.max(11, Math.round(13 * scale));

    const headerBox = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_expand: true,
        style: `margin-bottom: ${Math.round(4 * scale)}px;`,
    });
    const headerIcon = new St.Icon({
        icon_name: 'utilities-system-monitor-symbolic',
        icon_size: Math.round(16 * scale),
        style: `color: ${textColor}; margin-right: 6px;`,
        y_align: Clutter.ActorAlign.CENTER,
    });
    const headerLabel = new St.Label({
        text: 'Resource Wheel',
        style: `${fontCss}color: ${textColor}; font-size: ${titleFontSize}px; font-weight: bold; opacity: 0.9;`,
        y_align: Clutter.ActorAlign.CENTER,
    });
    headerLabel.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;

    headerBox.add_child(headerIcon);
    headerBox.add_child(headerLabel);
    mainLayout.add_child(headerBox);

    // ── Középső blokk: 2:3 arány a keréknek, 1:3 a legendának ──
    const middleRow = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_expand: true,
        y_expand: true,
        y_align: Clutter.ActorAlign.FILL,
    });

    const drawingArea = new St.DrawingArea({
        x_expand: true,
        y_expand: true,
        x_align: Clutter.ActorAlign.FILL,
        y_align: Clutter.ActorAlign.FILL,
    });
    middleRow.add_child(drawingArea);

    const legendCol = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        y_align: Clutter.ActorAlign.CENTER,
        x_align: Clutter.ActorAlign.END,
        style: `spacing: ${Math.max(4, Math.round(6 * scale))}px; margin-left: ${Math.round(10 * scale)}px;`,
    });

    const legendLabels = {};
    // A legendában a megszokott sorrendben írjuk ki: CPU, RAM, Disk, Temp
    const legendOrder = ['cpu', 'ram', 'disk', 'temp'];
    legendOrder.forEach(key => {
        const ring = RINGS.find(r => r.key === key);
        const row = new St.BoxLayout({
            orientation: Clutter.Orientation.HORIZONTAL,
            y_align: Clutter.ActorAlign.CENTER,
            style: 'spacing: 6px;',
        });
        const dot = new St.Label({
            text: '●',
            style: `color: ${ring.color}; font-size: ${Math.round(9 * scale)}px;`,
            y_align: Clutter.ActorAlign.CENTER,
        });
        const lbl = new St.Label({
            text: `${ring.label}: --%`,
            style: `${fontCss}color: ${textColor}; font-size: ${Math.round(11 * scale)}px; font-weight: 500;`,
            y_align: Clutter.ActorAlign.CENTER,
        });
        lbl.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
        row.add_child(dot);
        row.add_child(lbl);
        legendCol.add_child(row);
        legendLabels[ring.key] = lbl;
    });

    middleRow.add_child(legendCol);
    mainLayout.add_child(middleRow);

    // ── Alsó footer ───────────────────────────────────────────
    const footerLabel = new St.Label({
        text: 'Hardware telemetry updated in real time',
        style: `${fontCss}color: ${textColor}; font-size: ${Math.round(9 * scale)}px; opacity: 0.5;`,
        x_align: Clutter.ActorAlign.START,
    });
    footerLabel.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
    mainLayout.add_child(footerLabel);

    container.add_child(mainLayout);

    // ── Állapotváltozók ───────────────────────────────────────
    let currentMetrics = { cpu: 15, ram: 40, disk: 50, temp: 45 };
    let prevIdle = 0;
    let prevTotal = 0;
    let isDisposed = false;

    // ── Cairo Rajzolás ────────────────────────────────────────
    drawingArea.connect('repaint', (area) => {
        const ctx = area.get_context();
        const [w, h] = area.get_surface_size();
        if (w <= 0 || h <= 0) return;

        ctx.setOperator(CAIRO_OPERATOR_CLEAR);
        ctx.paint();
        ctx.setOperator(CAIRO_OPERATOR_OVER);
        ctx.setLineCap(CAIRO_LINE_CAP_ROUND);

        const cx = w / 2;
        const cy = h / 2;

        const maxRadius = (Math.min(w, h) / 2) - (6 * scale);
        const lineWidth = Math.max(3.5, 4.8 * scale);
        const baseR = maxRadius - lineWidth;

        // 1. Gyűrűk kirajzolása
        RINGS.forEach(ring => {
            const r = baseR * ring.rRatio;
            if (r <= 2) return;
            const val = currentMetrics[ring.key] || 0;

            // Halvány sáv
            ctx.setLineWidth(lineWidth);
            ctx.setSourceRGBA(ring.rgb[0], ring.rgb[1], ring.rgb[2], 0.15);
            ctx.newPath();
            ctx.arc(cx, cy, r, 0, Math.PI * 2);
            ctx.stroke();

            // Színes ív
            const ratio = Math.max(0.02, Math.min(1.0, val / 100.0));
            ctx.setSourceRGBA(ring.rgb[0], ring.rgb[1], ring.rgb[2], 1.0);
            ctx.newPath();
            ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + (ratio * Math.PI * 2));
            ctx.stroke();
        });

        // 2. Középső szöveg kirajzolása Pango-val
        const pangoLayout = PangoCairo.create_layout(ctx);
        const pangoDesc = Pango.FontDescription.from_string(fontFamily);

        // Százalék
        pangoDesc.set_size(Math.round(13 * scale * Pango.SCALE));
        pangoDesc.set_weight(Pango.Weight.BOLD);
        pangoLayout.set_font_description(pangoDesc);
        pangoLayout.set_text(`${currentMetrics.cpu}%`, -1);

        const [vW, vH] = pangoLayout.get_pixel_size();
        ctx.setSourceRGBA(parsedText.r, parsedText.g, parsedText.b, 1.0);
        ctx.moveTo(cx - (vW / 2), cy - vH + (2 * scale));
        PangoCairo.show_layout(ctx, pangoLayout);

        // CPU címke (kékkel, ahogy a legbelső kör)
        pangoDesc.set_size(Math.round(8 * scale * Pango.SCALE));
        pangoDesc.set_weight(Pango.Weight.BOLD);
        pangoLayout.set_font_description(pangoDesc);
        pangoLayout.set_text('CPU', -1);

        const [sW, sH] = pangoLayout.get_pixel_size();
        ctx.setSourceRGBA(0.56, 0.79, 0.98, 1.0); // kék
        ctx.moveTo(cx - (sW / 2), cy + (2 * scale));
        PangoCairo.show_layout(ctx, pangoLayout);

        ctx.$dispose();
    });

    // ── Valós idejű adatok lekérése ───────────────────────────
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
                            legendLabels.cpu.set_text(`CPU: ${currentMetrics.cpu}%`);
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
        const scriptCmd = `
mem=$(free | awk '/Mem:/ {if($2>0) print int($3*100/$2); else print 40}')
disk=$(df / 2>/dev/null | awk 'NR==2 {gsub("%","",$5); print $5}')
temp=$(awk '{print int($1/1000)}' /sys/class/thermal/thermal_zone0/temp 2>/dev/null)
echo "\${mem:-40};;\${disk:-50};;\${temp:-45}"
        `.trim();

        try {
            const proc = new Gio.Subprocess({
                argv: ['sh', '-c', scriptCmd],
                flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE,
            });
            proc.init(null);
            proc.communicate_utf8_async(null, null, (p, res) => {
                try {
                    const [, stdout] = p.communicate_utf8_finish(res);
                    if (isDisposed || !stdout) return;

                    const parts = stdout.trim().split(';;');
                    if (parts.length >= 3) {
                        currentMetrics.ram = parseInt(parts[0], 10) || 0;
                        currentMetrics.disk = parseInt(parts[1], 10) || 0;
                        currentMetrics.temp = parseInt(parts[2], 10) || 0;

                        if (legendLabels.ram) legendLabels.ram.set_text(`RAM: ${currentMetrics.ram}%`);
                        if (legendLabels.disk) legendLabels.disk.set_text(`Disk: ${currentMetrics.disk}%`);
                        if (legendLabels.temp) legendLabels.temp.set_text(`Temp: ${currentMetrics.temp}°`);

                        drawingArea.queue_repaint();
                    }
                } catch (e) {}
            });
        } catch (e) {}
    };

    const updateAll = () => {
        readCpuDelta();
        readOtherStats();
    };

    // Első futás
    updateAll();

    // 2 másodpercenkénti pontos frissítés
    const timeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 2, () => {
        if (isDisposed) return GLib.SOURCE_REMOVE;
        updateAll();
        return GLib.SOURCE_CONTINUE;
    });

    registerWidgetCleanup(container, () => {
        isDisposed = true;
        if (timeoutId) GLib.source_remove(timeoutId);
    });

    return container;
}