import Cairo from 'cairo';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

import { createBackgroundLayer, buildControlsColumn, updateControlButtonScaling } from './controls.js';
import { resolveWidgetForegroundColor, resolveExplicitFontFamily } from '../../utils/widgetUtils.js';
import { attachResponsiveScaler } from '../../shell/widgetUIUtils.js';

const BASE_CONTAINER_WIDTH = 240;
const BASE_CONTAINER_HEIGHT = 140;
const BASE_CONTAINER_MARGIN_PX = 12;
const MIN_CONTAINER_MARGIN_PX = 4;
const NUM_BARS = 16;

export function buildVisualizerLayout(config, state) {

    function findCava() {
        // 1. Keresés a GNOME Shell aktuális PATH-jában
        let path = GLib.find_program_in_path('cava');
        if (path) return path;

        // 2. Tartalék útvonalak (Snap, Flatpak export, vagy egyéni binárisok)
        const fallbacks = [
            '/snap/bin/cava',
            GLib.build_filenamev([GLib.get_home_dir(), '.local', 'bin', 'cava']),
            '/usr/local/bin/cava'
        ];

        for (const fb of fallbacks) {
            if (GLib.file_test(fb, GLib.FileTest.IS_EXECUTABLE)) {
                return fb;
            }
        }

        return null;
    }


    // 1. Háttér albumborító
    const backgroundLayer = createBackgroundLayer(config);
    state.backgroundLayer = backgroundLayer;
    state.container.add_child(backgroundLayer);

    // 2. Sötétítő réteg
    const gradientOverlay = new St.Widget({
        style: 'background-gradient-direction: vertical; background-gradient-start: rgba(0,0,0,0.15); background-gradient-end: rgba(0,0,0,0.85);',
        x_expand: true,
        y_expand: true,
        x_align: Clutter.ActorAlign.FILL,
        y_align: Clutter.ActorAlign.FILL,
    });
    state.container.add_child(gradientOverlay);

    // 3. Cairo Canvas a visualizerhez (MÖGÉ KERÜL)
    const visualizerCanvas = new St.DrawingArea({
        x_expand: true,
        y_expand: true,
        x_align: Clutter.ActorAlign.FILL,
        y_align: Clutter.ActorAlign.FILL,
    });
    state.container.add_child(visualizerCanvas);

    // 4. Vezérlők (ELŐTÉRBE KERÜL)
    const controlsBox = buildControlsColumn(config, state);
    if (controlsBox) state.container.add_child(controlsBox);

    // --- Cava / Fallback állapotok ---
    //const hasCava = Boolean(GLib.find_program_in_path('cava'));

    const cavaPath = findCava();   
    const hasCava = Boolean(cavaPath);

    let barValues = new Uint8Array(NUM_BARS);
    let cavaSubproc = null;
    let cavaCancellable = null;
    let inputStream = null;
    let fallbackTimerId = null;
    let wavePhase = 0;

    const runtimeDir = GLib.get_user_runtime_dir();
    const fifoPath = GLib.build_filenamev([runtimeDir, `gridgets_cava_${GLib.get_user_name()}.fifo`]);
    const confPath = GLib.build_filenamev([runtimeDir, `gridgets_cava_${GLib.get_user_name()}.conf`]);

    function initCavaConfig() {
        const confContent = `[general]
bars = ${NUM_BARS}
framerate = 30

[input]
method = pipewire
source = auto

[output]
method = raw
raw_target = ${fifoPath}
data_format = binary
bit_format = 8bit
`;
        GLib.file_set_contents(confPath, confContent);
    }

    function startCava() {
        if (!hasCava || cavaSubproc) return;

        try {
            initCavaConfig();

            if (!GLib.file_test(fifoPath, GLib.FileTest.EXISTS)) {
                GLib.spawn_command_line_async(`mkfifo "${fifoPath}"`);
            }

            cavaCancellable = new Gio.Cancellable();

            cavaSubproc = Gio.Subprocess.new(
                ['cava', '-p', confPath],
                Gio.SubprocessFlags.NONE
            );

            const fifoFile = Gio.File.new_for_path(fifoPath);
            fifoFile.read_async(GLib.PRIORITY_DEFAULT, cavaCancellable, (f, res) => {
                try {
                    inputStream = fifoFile.read_finish(res);
                    readCavaStream();
                } catch (e) {
                    stopCava();
                }
            });
        } catch (e) {
            stopCava();
        }
    }

    function getThemeAccentRgba(cfg) {
        const colorStr = resolveWidgetForegroundColor(cfg);
        // 1. rgb(...) vagy rgba(...) értelmezése
        const rgbMatch = colorStr?.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
        if (rgbMatch) {
            return [
                parseInt(rgbMatch[1], 10) / 255,
                parseInt(rgbMatch[2], 10) / 255,
                parseInt(rgbMatch[3], 10) / 255,
                0.85
            ];
        }

        // 2. Hex (#RRGGBB) értelmezése
        const hexMatch = colorStr?.match(/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
        if (hexMatch) {
            return [
                parseInt(hexMatch[1], 16) / 255,
                parseInt(hexMatch[2], 16) / 255,
                parseInt(hexMatch[3], 16) / 255,
                0.85
            ];
        }

        // 3. Biztonsági tartalék (GNOME kék)
        return [0.208, 0.518, 0.894, 0.85];
    }

    function readCavaStream() {
        if (!inputStream || !cavaCancellable || cavaCancellable.is_cancelled()) return;

        inputStream.read_bytes_async(NUM_BARS, GLib.PRIORITY_DEFAULT, cavaCancellable, (stream, res) => {
            try {
                const gBytes = stream.read_bytes_finish(res);
                const data = gBytes ? gBytes.get_data() : null;

                if (data && data.length === NUM_BARS) {
                    barValues = data;
                    if (state.playbackStatus === 'Playing') {
                        visualizerCanvas.queue_repaint();
                    }
                }

                if (!cavaCancellable.is_cancelled()) {
                    readCavaStream();
                }
            } catch (e) {
                // Stream bezárás
            }
        });
    }

    function stopCava() {
        if (cavaCancellable) {
            cavaCancellable.cancel();
            cavaCancellable = null;
        }
        if (inputStream) {
            try { inputStream.close(null); } catch (e) {}
            inputStream = null;
        }
        if (cavaSubproc) {
            try { cavaSubproc.force_exit(); } catch (e) {}
            cavaSubproc = null;
        }
        barValues.fill(0);
        visualizerCanvas.queue_repaint();
    }

    // --- Repaint függvény ---
    visualizerCanvas.connect('repaint', (area) => {
        const cr = area.get_context();
        const [w, h] = area.get_surface_size();
        if (w === 0 || h === 0) {
            cr.$dispose();
            return;
        }

        const isPlaying = state.playbackStatus === 'Playing';
        if (!isPlaying) {
            cr.$dispose();
            return;
        }

        const [r, g, b, a] = getThemeAccentRgba(config, state.settings);
        cr.setSourceRGBA(r, g, b, a);

        const mode = config.visualizerMode || 'bars';
        const baselineY = Math.round(h * 0.50);
        const availableHeight = Math.max(10, baselineY - 14);
        const gap = Math.max(2, Math.round(w * 0.015));
        const barW = (w - (NUM_BARS - 1) * gap - 24) / NUM_BARS;
        const offsetX = 12;

        // 1. Értékek előkészítése (Cava valós adatok vagy matematikai szimuláció)
        const heights = [];
        for (let i = 0; i < NUM_BARS; i++) {
            if (hasCava && cavaSubproc) {
                const norm = barValues[i] / 255.0;
                heights.push(Math.max(3, norm * availableHeight));
            } else {
                const v1 = Math.sin(wavePhase + i * 0.45) * 0.5 + 0.5;
                const v2 = Math.cos(wavePhase * 1.3 + i * 0.3) * 0.3 + 0.3;
                heights.push(Math.max(4, (v1 * 0.7 + v2 * 0.3) * availableHeight));
            }
        }

        // 2. Rajzolás az aktív mód szerint
        if (mode === 'bars') {
            // Oszlopos Equalizer
            for (let i = 0; i < NUM_BARS; i++) {
                const barH = heights[i];
                const x = offsetX + i * (barW + gap);
                const y = baselineY - barH;

                cr.rectangle(x, y, barW, barH);
                cr.fill();
            }
        } else {
            // Folyékony hullám (Fluid Wave)
            cr.setLineWidth(3);
            cr.moveTo(offsetX, baselineY - heights[0]);

            for (let i = 0; i < NUM_BARS - 1; i++) {
                const x1 = offsetX + i * (barW + gap) + barW / 2;
                const y1 = baselineY - heights[i];
                const x2 = offsetX + (i + 1) * (barW + gap) + barW / 2;
                const y2 = baselineY - heights[i + 1];

                const cx = (x1 + x2) / 2;
                const cy = (y1 + y2) / 2;

                cr.quadTo ? cr.quadTo(x1, y1, cx, cy) : cr.curveTo(x1, y1, cx, cy, cx, cy);
            }

            cr.stroke();
        }

        cr.$dispose();
    });

    if (!hasCava) {
        fallbackTimerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 35, () => {
            if (state.playbackStatus === 'Playing') {
                wavePhase = (wavePhase + 0.12) % (Math.PI * 2);
                visualizerCanvas.queue_repaint();
            }
            return GLib.SOURCE_CONTINUE;
        });
    }

    const stateWatcherTimerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
        if (hasCava) {
            if (state.playbackStatus === 'Playing' && !cavaSubproc) {
                startCava();
            } else if (state.playbackStatus !== 'Playing' && cavaSubproc) {
                stopCava();
            }
        }
        return GLib.SOURCE_CONTINUE;
    });

    state.container.connect('destroy', () => {
        if (stateWatcherTimerId) GLib.source_remove(stateWatcherTimerId);
        if (fallbackTimerId) GLib.source_remove(fallbackTimerId);
        stopCava();
        try {
            const f = Gio.File.new_for_path(fifoPath);
            f.delete(null);
        } catch (e) {}
    });

    const cornerRadius = config.appliedBorderRadius || 0;
    attachResponsiveScaler(state.container, BASE_CONTAINER_WIDTH, BASE_CONTAINER_HEIGHT, (scale, w, h) => {
        const textColor = resolveWidgetForegroundColor(config);
        const fontFamily = resolveExplicitFontFamily(config);
        updateControlButtonScaling(state, scale, fontFamily, textColor);

        const containerMargin = Math.max(MIN_CONTAINER_MARGIN_PX, Math.round(BASE_CONTAINER_MARGIN_PX * scale));
        if (state.controlsColumn) {
            state.controlsColumn.style = `margin: ${containerMargin}px;`;
        }

        gradientOverlay.style = `background-gradient-direction: vertical; `
            + `background-gradient-start: rgba(0,0,0,0.15); `
            + `background-gradient-end: rgba(0,0,0,0.85); `
            + `border-radius: ${cornerRadius}px;`;
    });
}