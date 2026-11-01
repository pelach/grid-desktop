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
import { createWidgetContainer, registerWidgetCleanup, attachResponsiveScaler } from '../../shell/widgetUIUtils.js';

const BASE_CONTAINER_WIDTH = 200;
const BASE_CONTAINER_HEIGHT = 200;

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

    let scale = Math.max(0.65, Math.min(width / BASE_CONTAINER_WIDTH, height / BASE_CONTAINER_HEIGHT));

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
    } else if (monitorType === 'disk-io' || monitorType === 'disk_io') {
        iconName = 'drive-multidisk-symbolic';
        defaultLabel = 'Disk I/O';
    } else if (monitorType === 'thermal') {
        iconName = 'sensors-temperature-symbolic';
        defaultLabel = 'Thermal';
    } else if (monitorType === 'gpu') {
        iconName = 'video-display-symbolic';
        defaultLabel = 'GPU';
    }

    const isDarkSurface = isDarkBackgroundColor(resolveWidgetBackgroundColor(config));

    const mainLayout = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
    });
    container.add_child(mainLayout);

    // ── 1. Egységes Fejléc ──
    const headerBox = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_expand: true,
        y_align: Clutter.ActorAlign.START,
    });

    const headerIcon = new St.Icon({
        icon_name: iconName,
        style: `color: ${textColor};`,
        y_align: Clutter.ActorAlign.CENTER,
    });

    const headerLabel = new St.Label({
        text: defaultLabel,
        y_align: Clutter.ActorAlign.CENTER,
    });
    headerLabel.clutter_text.set_ellipsize(0);

    headerBox.add_child(headerIcon);
    headerBox.add_child(headerLabel);
    mainLayout.add_child(headerBox);

    let percentLabel;
    let chartArea = null;
    let chartCard = null;
    let centerBox = null;
    let samples = [];

    if (!showChart) {
        centerBox = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
            y_expand: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });

        percentLabel = new St.Label({
            text: (monitorType === 'disk-io' || monitorType === 'disk_io') ? '0 MB/s' : '--%',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });

        centerBox.add_child(percentLabel);
        mainLayout.add_child(centerBox);
    } else {
        percentLabel = new St.Label({
            text: (monitorType === 'disk-io' || monitorType === 'disk_io') ? '0 MB/s' : '--%',
            x_expand: true,
            x_align: Clutter.ActorAlign.START,
            y_align: Clutter.ActorAlign.CENTER,
        });
        mainLayout.add_child(percentLabel);

        const cardBg = cssColorToRgba(textColor, isDarkSurface ? CARD_BG_DARK_ALPHA : CARD_BG_LIGHT_ALPHA);
        const cardBorderAlpha = isDarkSurface ? CARD_BORDER_DARK_ALPHA : CARD_BORDER_LIGHT_ALPHA;

        chartCard = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
            y_expand: true,
            style: `background-color: ${cardBg}; border: 1px solid ${cssColorToRgba(textColor, cardBorderAlpha)}; border-radius: 10px; padding: 6px; margin-top: 4px;`,
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

    function applyScale(newScale) {
        scale = newScale;
        const titleFontSize = Math.max(11, Math.round(13 * scale));
        const iconSize = Math.round(16 * scale);

        mainLayout.style = `padding: ${Math.max(8, Math.round(10 * scale))}px;`;
        headerBox.style = `margin-bottom: ${Math.round(6 * scale)}px;`;
        headerIcon.icon_size = iconSize;
        headerIcon.style = `color: ${textColor}; margin-right: 6px;`;
        headerLabel.style = `${fontCss}color: ${textColor}; font-size: ${titleFontSize}px; font-weight: bold; opacity: 0.9;`;

        if (!showChart) {
            // Ha Disk I/O (ahol hosszabb a szöveg: pl. "12.4 MB/s"), kicsit finomabb fontméret
            const isDiskIo = (monitorType === 'disk-io' || monitorType === 'disk_io');
            const valSize = isDiskIo 
                ? Math.max(24, Math.round(32 * scale))
                : Math.max(32, Math.round(44 * scale));
            percentLabel.style = `${fontCss}color: ${textColor}; font-size: ${valSize}px; font-weight: bold; line-height: 1.0;`;
        } else {
            const valSize = Math.max(15, Math.round(18 * scale));
            percentLabel.style = `${fontCss}color: ${textColor}; font-size: ${valSize}px; font-weight: bold; line-height: 1.1; margin-bottom: 2px;`;
            if (chartCard) {
                const cardBg = cssColorToRgba(textColor, isDarkSurface ? CARD_BG_DARK_ALPHA : CARD_BG_LIGHT_ALPHA);
                const cardBorderAlpha = isDarkSurface ? CARD_BORDER_DARK_ALPHA : CARD_BORDER_LIGHT_ALPHA;
                const cardRadius = Math.max(6, Math.round(10 * scale));
                const cardPad = Math.max(4, Math.round(6 * scale));
                const cardMargin = Math.max(4, Math.round(6 * scale));

                chartCard.style = `background-color: ${cardBg}; border: 1px solid ${cssColorToRgba(textColor, cardBorderAlpha)}; border-radius: ${cardRadius}px; padding: ${cardPad}px; margin-top: ${cardMargin}px;`;
            }
        }
    }

    applyScale(scale);

    attachResponsiveScaler(container, BASE_CONTAINER_WIDTH, BASE_CONTAINER_HEIGHT, (_ratio, w, h) => {
        applyScale(Math.max(0.65, Math.min(w / BASE_CONTAINER_WIDTH, h / BASE_CONTAINER_HEIGHT)));
    });

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

    // --- Disk I/O állapotváltozók ---
    let prevDiskSectors = -1;
    let prevDiskTimeMs = 0;

    // --- GPU Szenzor felderítés ---
    let gpuHwmonTempPath = null;
    let hasNvidiaSmi = false;
    let gpuDetectionStarted = false;

    const detectGpuSource = () => {
        if (gpuDetectionStarted) return;
        gpuDetectionStarted = true;

        try {
            const hwmonDir = Gio.File.new_for_path('/sys/class/hwmon');
            hwmonDir.enumerate_children_async(
                'standard::name',
                Gio.FileQueryInfoFlags.NONE,
                GLib.PRIORITY_LOW,
                null,
                (file, res) => {
                    try {
                        const enumerator = file.enumerate_children_finish(res);
                        const gpuNames = ['amdgpu', 'radeon', 'nouveau', 'i915', 'xe'];

                        const checkNextFile = () => {
                            if (isDisposed) return;
                            enumerator.next_files_async(1, GLib.PRIORITY_LOW, null, (e, nRes) => {
                                try {
                                    const files = e.next_files_finish(nRes);
                                    if (!files || files.length === 0) {
                                        if (!gpuHwmonTempPath) {
                                            hasNvidiaSmi = GLib.find_program_in_path('nvidia-smi') !== null;
                                        }
                                        return;
                                    }

                                    const info = files[0];
                                    const dirName = info.get_name();
                                    const nameFile = Gio.File.new_for_path(`/sys/class/hwmon/${dirName}/name`);

                                    nameFile.load_contents_async(null, (nf, cRes) => {
                                        try {
                                            const [, nameBytes] = nf.load_contents_finish(cRes);
                                            const devName = new TextDecoder().decode(nameBytes).trim().toLowerCase();
                                            if (gpuNames.includes(devName)) {
                                                const tempPath = `/sys/class/hwmon/${dirName}/temp1_input`;
                                                if (GLib.file_test(tempPath, GLib.FileTest.EXISTS)) {
                                                    gpuHwmonTempPath = tempPath;
                                                    return;
                                                }
                                            }
                                        } catch (_) {}
                                        checkNextFile();
                                    });
                                } catch (_) {}
                            });
                        };

                        checkNextFile();
                    } catch (_) {
                        hasNvidiaSmi = GLib.find_program_in_path('nvidia-smi') !== null;
                    }
                }
            );
        } catch (_) {
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

    const readDiskIo = () => {
        try {
            const file = Gio.File.new_for_path('/proc/diskstats');
            file.load_contents_async(null, (f, res) => {
                try {
                    const [, contents] = f.load_contents_finish(res);
                    if (isDisposed || !contents) return;

                    const text = new TextDecoder().decode(contents);
                    let totalSectors = 0;

                    // Csak a fizikai lemezeket számoljuk össze (nvme0n1, sda, sdb stb., loop és ram kizárva)
                    for (const line of text.split('\n')) {
                        const parts = line.trim().split(/\s+/);
                        if (parts.length >= 14) {
                            const devName = parts[2];
                            // Kizárjuk a partíciókat (pl. sda1, nvme0n1p1) és virtuális eszközöket
                            const isPhysicalDisk = (/^(sd[a-z]|nvme[0-9]+n[0-9]+|vd[a-z]|xvd[a-z]|mmcblk[0-9]+)$/.test(devName));
                            if (isPhysicalDisk) {
                                const sectorsRead = Number(parts[5]) || 0;
                                const sectorsWritten = Number(parts[9]) || 0;
                                totalSectors += (sectorsRead + sectorsWritten);
                            }
                        }
                    }

                    const nowMs = GLib.get_monotonic_time() / 1000;

                    if (prevDiskSectors >= 0 && prevDiskTimeMs > 0) {
                        const deltaSectors = Math.max(0, totalSectors - prevDiskSectors);
                        const deltaSec = Math.max(0.1, (nowMs - prevDiskTimeMs) / 1000);

                        // 1 szektor = 512 bájt
                        const bytesPerSec = (deltaSectors * 512) / deltaSec;
                        const mbPerSec = bytesPerSec / (1024 * 1024);

                        let textVal = '';
                        if (mbPerSec >= 100) {
                            textVal = `${Math.round(mbPerSec)} MB/s`;
                        } else if (mbPerSec >= 1) {
                            textVal = `${mbPerSec.toFixed(1)} MB/s`;
                        } else {
                            const kbPerSec = bytesPerSec / 1024;
                            textVal = `${Math.round(kbPerSec)} KB/s`;
                        }

                        percentLabel.set_text(textVal);

                        // Chart mintavétel: 0 és 50 MB/s közé skálázva
                        const ratio = Math.min(1, mbPerSec / 50);
                        pushSample(ratio);
                    }

                    prevDiskSectors = totalSectors;
                    prevDiskTimeMs = nowMs;
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

        readThermal();
    };

    const updateData = () => {
        if (monitorType === 'ram') readRam();
        else if (monitorType === 'disk') readDisk();
        else if (monitorType === 'disk-io' || monitorType === 'disk_io') readDiskIo();
        else if (monitorType === 'thermal') readThermal();
        else if (monitorType === 'gpu') readGpu();
        else readCpu();
    };

    updateData();

    const intervalSec = (monitorType === 'cpu' || monitorType === 'gpu' || monitorType === 'disk-io' || monitorType === 'disk_io') ? 2 : 5;
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