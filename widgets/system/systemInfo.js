import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {
    resolveWidgetForegroundColor,
    resolveExplicitFontFamily,
    cssColorToRgba,
    isDarkBackgroundColor,
    resolveWidgetBackgroundColor,
    parseCssColor,
    CAIRO_OPERATOR_CLEAR,
    CAIRO_OPERATOR_OVER,
} from '../../utils/widgetUtils.js';
import { createWidgetContainer, registerWidgetCleanup } from '../../shell/widgetUIUtils.js';

const BORDER_ALPHA = 0.14;
const BADGE_BG_ALPHA = 0.12;
const SUB_LABEL_OPACITY = 0.65;
const CARD_BG_DARK_ALPHA = 0.05;
const CARD_BG_LIGHT_ALPHA = 0.04;
const CARD_BORDER_DARK_ALPHA = 0.06;
const CARD_BORDER_LIGHT_ALPHA = 0.10;

const CHART_MAX_SAMPLES = 45;
const CHART_LINE_WIDTH = 2;
const CHART_FILL_ALPHA = 0.18;
const CHART_PAD = 4;

function drawTrendChart(ctx, w, h, samples, accentHex) {
    if (w === 0 || h === 0) return;

    ctx.setOperator(CAIRO_OPERATOR_CLEAR);
    ctx.paint();
    ctx.setOperator(CAIRO_OPERATOR_OVER);

    if (samples.length < 2) return;

    const innerW = w - (CHART_PAD * 2);
    const innerH = h - (CHART_PAD * 2);

    const pointAt = (index) => {
        const ratio = index / (samples.length - 1);
        const value = Math.max(0, Math.min(1, samples[index]));
        return [
            CHART_PAD + ratio * innerW,
            CHART_PAD + (1 - value) * innerH,
        ];
    };

    const { r, g, b } = parseCssColor(accentHex);

    ctx.setLineWidth(CHART_LINE_WIDTH);
    ctx.setSourceRGBA(r, g, b, 1);
    ctx.newPath();
    const [startX, startY] = pointAt(0);
    ctx.moveTo(startX, startY);
    for (let i = 1; i < samples.length; i++) {
        const [x, y] = pointAt(i);
        ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.lineTo(w - CHART_PAD, CHART_PAD + innerH);
    ctx.lineTo(CHART_PAD, CHART_PAD + innerH);
    ctx.closePath();
    ctx.setSourceRGBA(r, g, b, CHART_FILL_ALPHA);
    ctx.fill();
}

export function createSystemInfoNode(config, width, height, xPosition, yPosition) {
    const fontFamily = resolveExplicitFontFamily(config);
    const fontCss = fontFamily ? `font-family: ${fontFamily}; ` : '';
    const textColor = resolveWidgetForegroundColor(config);
    const accentHex = config.globalAccentColor || '#3584e4';
    const container = createWidgetContainer(config, width, height, xPosition, yPosition);
    container.style += ` border: 1px solid ${cssColorToRgba(textColor, BORDER_ALPHA)};`;

    const scale = Math.max(0.65, Math.min(width / 110, height / 110));
    const padding = Math.max(8, Math.round(12 * scale));
    const badgeIconSize = Math.max(13, Math.round(15 * scale));
    const badgePadding = Math.max(3, Math.round(5 * scale));
    const badgeRadius = Math.max(6, Math.round(7 * scale));

    const monitorType = (config.systemInfoType || 'cpu').toLowerCase();
    const showChart = config.showChart === true;

    let iconName = 'utilities-system-monitor-symbolic';
    let defaultLabel = 'CPU';

    if (monitorType === 'ram') {
        iconName = 'media-memory-symbolic';
        defaultLabel = 'RAM';
    } else if (monitorType === 'disk') {
        iconName = 'drive-harddisk-symbolic';
        defaultLabel = 'Disk';
    } else if (monitorType === 'thermal') {
        iconName = 'sensors-temperature-symbolic';
        defaultLabel = 'Thermal';
    } else if (monitorType === 'gpu') {
        iconName = 'video-display-symbolic';
        defaultLabel = 'GPU';
    }

    const mainLayout = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
        style: `padding: ${padding}px; spacing: ${Math.round(6 * scale)}px;`,
    });

    const isDarkSurface = isDarkBackgroundColor(resolveWidgetBackgroundColor(config));
    const badgeBg = cssColorToRgba(textColor, BADGE_BG_ALPHA);
    const iconBadge = new St.Bin({
        style: `background-color: ${badgeBg}; border-radius: ${badgeRadius}px; padding: ${badgePadding}px;`,
        y_align: Clutter.ActorAlign.CENTER,
    });
    const topIcon = new St.Icon({
        icon_name: iconName,
        icon_size: badgeIconSize,
        style: `color: ${textColor}; opacity: 0.9;`,
    });
    iconBadge.set_child(topIcon);

    let percentLabel;
    let typeLabel;
    let chartArea = null;
    let samples = [];

    if (!showChart) {
        // --- NORMÁL NÉZET: Fent a badge ikon, legalul a nagy szám és felirat ---
        const topBox = new St.BoxLayout({
            orientation: Clutter.Orientation.HORIZONTAL,
            x_align: Clutter.ActorAlign.END,
            x_expand: true,
        });
        topBox.add_child(iconBadge);
        mainLayout.add_child(topBox);

        const bottomBox = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            y_align: Clutter.ActorAlign.END,
            y_expand: true,
        });

        const percentFontSize = Math.max(16, Math.round(22 * scale));
        const labelFontSize = Math.max(10, Math.round(12 * scale));

        percentLabel = new St.Label({
            text: '--%',
            style: `${fontCss}color: ${textColor}; font-size: ${percentFontSize}px; font-weight: bold; line-height: 1.1;`,
        });

        typeLabel = new St.Label({
            text: defaultLabel,
            style: `${fontCss}color: ${textColor}; font-size: ${labelFontSize}px; opacity: ${SUB_LABEL_OPACITY}; font-weight: 500;`,
        });

        bottomBox.add_child(percentLabel);
        bottomBox.add_child(typeLabel);
        mainLayout.add_child(bottomBox);
    } else {
        // --- CHART NÉZET: Kompakt fejléc felül (érték + címke balra, badge jobbra), alatta kártya ---
        const headerBox = new St.BoxLayout({
            orientation: Clutter.Orientation.HORIZONTAL,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });

        const textInfoBox = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });

        const percentFontSize = Math.max(15, Math.round(18 * scale));
        const labelFontSize = Math.max(9, Math.round(11 * scale));

        percentLabel = new St.Label({
            text: '--%',
            style: `${fontCss}color: ${textColor}; font-size: ${percentFontSize}px; font-weight: bold; line-height: 1.0;`,
        });

        typeLabel = new St.Label({
            text: defaultLabel,
            style: `${fontCss}color: ${textColor}; font-size: ${labelFontSize}px; opacity: ${SUB_LABEL_OPACITY}; font-weight: 500;`,
        });

        textInfoBox.add_child(percentLabel);
        textInfoBox.add_child(typeLabel);

        headerBox.add_child(textInfoBox);
        headerBox.add_child(iconBadge);
        mainLayout.add_child(headerBox);

        const cardBg = cssColorToRgba(textColor, isDarkSurface ? CARD_BG_DARK_ALPHA : CARD_BG_LIGHT_ALPHA);
        const cardBorderAlpha = isDarkSurface ? CARD_BORDER_DARK_ALPHA : CARD_BORDER_LIGHT_ALPHA;
        const cardRadius = Math.max(8, Math.round(10 * scale));
        const cardPadding = Math.max(4, Math.round(6 * scale));

        const chartCard = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
            y_expand: true,
            style: `background-color: ${cardBg}; border: 1px solid ${cssColorToRgba(textColor, cardBorderAlpha)}; border-radius: ${cardRadius}px; padding: ${cardPadding}px;`,
        });

        chartArea = new St.DrawingArea({
            x_expand: true,
            y_expand: true,
            x_align: Clutter.ActorAlign.FILL,
            y_align: Clutter.ActorAlign.FILL,
        });

        chartArea.connect('repaint', (area) => {
            const ctx = area.get_context();
            const [w, h] = area.get_surface_size();
            drawTrendChart(ctx, w, h, samples, accentHex);
            ctx.$dispose();
        });

        chartCard.add_child(chartArea);
        mainLayout.add_child(chartCard);
    }

    container.add_child(mainLayout);

    const pushSample = (ratio) => {
        if (!showChart || !chartArea) return;
        samples.push(Math.max(0, Math.min(1, ratio)));
        if (samples.length > CHART_MAX_SAMPLES) {
            samples.shift();
        }
        chartArea.queue_repaint();
    };

    let isDisposed = false;
    let prevIdle = 0;
    let prevTotal = 0;

    // --- GPU Szenzor felderítés ---
    let gpuHwmonTempPath = null;
    let hasNvidiaSmi = false;
    let gpuDetectionDone = false;

    const detectGpuSource = () => {
        if (gpuDetectionDone) return;
        gpuDetectionDone = true;

        try {
            const hwmonDir = Gio.File.new_for_path('/sys/class/hwmon');
            if (hwmonDir.query_exists(null)) {
                const enumerator = hwmonDir.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
                let info;
                const gpuNames = ['amdgpu', 'radeon', 'nouveau', 'i915', 'xe'];

                while ((info = enumerator.next_file(null)) !== null) {
                    const dirName = info.get_name();
                    const nameFilePath = `/sys/class/hwmon/${dirName}/name`;
                    const nameFile = Gio.File.new_for_path(nameFilePath);
                    if (nameFile.query_exists(null)) {
                        const [, nameBytes] = nameFile.load_contents(null);
                        const devName = new TextDecoder().decode(nameBytes).trim().toLowerCase();
                        if (gpuNames.includes(devName)) {
                            // Találtunk dGPU hwmon szenzort!
                            const tempPath = `/sys/class/hwmon/${dirName}/temp1_input`;
                            if (Gio.File.new_for_path(tempPath).query_exists(null)) {
                                gpuHwmonTempPath = tempPath;
                                break;
                            }
                        }
                    }
                }
            }
        } catch (e) {}

        // Ha nincs szabványos sysfs GPU szenzor, megnézzük van-e nvidia-smi
        if (!gpuHwmonTempPath) {
            hasNvidiaSmi = GLib.find_program_in_path('nvidia-smi') !== null;
        }
    };

    const readCpu = () => {
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
                        const safeUsage = Math.max(0, Math.min(100, usage));
                        percentLabel.set_text(`${safeUsage}%`);
                        pushSample(safeUsage / 100);
                    }

                    prevIdle = idle;
                    prevTotal = total;
                } catch (e) {}
            });
        } catch (e) {}
    };

    const readRam = () => {
        try {
            const file = Gio.File.new_for_path('/proc/meminfo');
            file.load_contents_async(null, (f, res) => {
                try {
                    const [, contents] = f.load_contents_finish(res);
                    if (isDisposed || !contents) return;

                    const text = new TextDecoder().decode(contents);
                    let total = 0;
                    let avail = 0;

                    for (const line of text.split('\n')) {
                        if (line.startsWith('MemTotal:')) {
                            total = parseInt(line.replace(/\D/g, ''), 10);
                        } else if (line.startsWith('MemAvailable:')) {
                            avail = parseInt(line.replace(/\D/g, ''), 10);
                        }
                        if (total && avail) break;
                    }

                    if (total > 0) {
                        const usage = Math.round(((total - avail) / total) * 100);
                        percentLabel.set_text(`${usage}%`);
                        pushSample(usage / 100);
                    }
                } catch (e) {}
            });
        } catch (e) {}
    };

    const readDisk = () => {
        try {
            const proc = new Gio.Subprocess({
                argv: ['sh', '-c', "df -k / | tail -1 | awk '{print $5}'"],
                flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE,
            });
            proc.init(null);
            proc.communicate_utf8_async(null, null, (p, res) => {
                try {
                    const [, stdout] = p.communicate_utf8_finish(res);
                    if (isDisposed || !stdout) return;
                    const clean = stdout.trim();
                    if (clean) {
                        percentLabel.set_text(clean.includes('%') ? clean : `${clean}%`);
                        const val = parseInt(clean.replace('%', ''), 10);
                        if (!isNaN(val)) pushSample(val / 100);
                    }
                } catch (e) {}
            });
        } catch (e) {}
    };

    const readThermal = () => {
        try {
            const file = Gio.File.new_for_path('/sys/class/thermal/thermal_zone0/temp');
            file.load_contents_async(null, (f, res) => {
                try {
                    const [, contents] = f.load_contents_finish(res);
                    if (isDisposed || !contents) return;

                    const raw = new TextDecoder().decode(contents).trim();
                    const milliC = parseInt(raw, 10);
                    if (!isNaN(milliC)) {
                        const tempC = Math.round(milliC / 1000);
                        percentLabel.set_text(`${tempC}°C`);
                        pushSample(tempC / 100);
                    }
                } catch (e) {}
            });
        } catch (e) {}
    };

    const readGpu = () => {
        detectGpuSource();

        // 1. AMD / Intel dGPU hwmon közvetlen olvasás
        if (gpuHwmonTempPath) {
            try {
                const file = Gio.File.new_for_path(gpuHwmonTempPath);
                file.load_contents_async(null, (f, res) => {
                    try {
                        const [, contents] = f.load_contents_finish(res);
                        if (isDisposed || !contents) return;
                        const milliC = parseInt(new TextDecoder().decode(contents).trim(), 10);
                        if (!isNaN(milliC)) {
                            const tempC = Math.round(milliC / 1000);
                            percentLabel.set_text(`${tempC}°C`);
                            pushSample(tempC / 100);
                        }
                    } catch (e) {}
                });
            } catch (e) {}
            return;
        }

        // 2. Nvidia SMI segédprogram
        if (hasNvidiaSmi) {
            try {
                const proc = new Gio.Subprocess({
                    argv: ['nvidia-smi', '--query-gpu=temperature.gpu', '--format=csv,noheader,nounits'],
                    flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE,
                });
                proc.init(null);
                proc.communicate_utf8_async(null, null, (p, res) => {
                    try {
                        const [, stdout] = p.communicate_utf8_finish(res);
                        if (isDisposed || !stdout) return;
                        const tempC = parseInt(stdout.trim(), 10);
                        if (!isNaN(tempC)) {
                            percentLabel.set_text(`${tempC}°C`);
                            pushSample(tempC / 100);
                        }
                    } catch (e) {}
                });
            } catch (e) {}
            return;
        }

        // 3. Fallback integrált grafikára (SoC / CPU csomag hőmérséklet)
        readThermal();
    };

    const updateData = () => {
        if (monitorType === 'ram') readRam();
        else if (monitorType === 'disk') readDisk();
        else if (monitorType === 'thermal') readThermal();
        else if (monitorType === 'gpu') readGpu();
        else readCpu();
    };

    updateData();

    const intervalSec = (monitorType === 'cpu' || monitorType === 'gpu') ? 2 : 5;
    const timeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, intervalSec, () => {
        if (isDisposed) return GLib.SOURCE_REMOVE;
        updateData();
        return GLib.SOURCE_CONTINUE;
    });

    registerWidgetCleanup(container, () => {
        isDisposed = true;
        if (timeoutId) GLib.source_remove(timeoutId);
    });

    return container;
}