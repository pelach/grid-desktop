import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Cairo from 'cairo';

import { createBackgroundLayer, buildControlsColumn, updateControlButtonScaling, handlePlayPauseAction, connectControlButton } from './controls.js';
import { resolveWidgetForegroundColor, resolveExplicitFontFamily } from '../../utils/widgetUtils.js';
import { attachResponsiveScaler } from '../../shell/widgetUIUtils.js';
import { isActorDestroyed } from '../../utils/actorLifecycle.js';

const BASE_CONTAINER_WIDTH = 240;
const BASE_CONTAINER_HEIGHT = 140;

const BASE_CONTAINER_MARGIN_PX = 12;
const MIN_CONTAINER_MARGIN_PX = 4;
const NUM_BARS = 16;

// Vinyl méretek a kompakt 4x4-es widgethez (140px magasságra skálázva)
const BASE_VINYL_SIZE = 145;
const BASE_CENTER_LABEL_SIZE = 64;
const BASE_ARM_WIDTH = 38;
const BASE_ARM_HEIGHT = 120;

function getAssetPath(filename) {
    const currentFilePath = Gio.File.new_for_uri(import.meta.url).get_path();
    const currentDir = GLib.path_get_dirname(currentFilePath);
    return GLib.build_filenamev([currentDir, filename]);
}

function findCava() {
    let path = GLib.find_program_in_path('cava');
    if (path) return path;

    const fallbacks = [
        '/snap/bin/cava',
        GLib.build_filenamev([GLib.get_home_dir(), '.local', 'bin', 'cava']),
        '/usr/local/bin/cava'
    ];

    for (const fb of fallbacks) {
        if (GLib.file_test(fb, GLib.FileTest.IS_EXECUTABLE)) return fb;
    }
    return null;
}

function getThemeAccentRgba(cfg) {
    const colorStr = resolveWidgetForegroundColor(cfg);
    const rgbMatch = colorStr?.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
    if (rgbMatch) {
        return [
            parseInt(rgbMatch[1], 10) / 255,
            parseInt(rgbMatch[2], 10) / 255,
            parseInt(rgbMatch[3], 10) / 255,
            0.85
        ];
    }
    const hexMatch = colorStr?.match(/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
    if (hexMatch) {
        return [
            parseInt(hexMatch[1], 16) / 255,
            parseInt(hexMatch[2], 16) / 255,
            parseInt(hexMatch[3], 16) / 255,
            0.85
        ];
    }
    return [0.208, 0.518, 0.894, 0.85];
}

export function buildSmallLayout(config, state) {
    const isVinyl = config.vinylStyle === true;
    const isVisualizer = !isVinyl && (config.showVisualizer === true || config.layoutType === 'visualizer');

    // 1. Háttér réteg
    const backgroundLayer = createBackgroundLayer(config);
    if (isVinyl) {
        backgroundLayer.style = 'background-color: transparent;';
    }
    state.backgroundLayer = backgroundLayer;
    state.container.add_child(backgroundLayer);

    // Szövegcímkék a kis nézetben nincsenek
    state.titleLabel = null;
    state.artistLabel = null;
    state.albumLabel = null;

    let turntableBox = null;
    let discActor = null;
    let vinylCoverActor = null;
    let vinylTexture = null;
    let sheenActor = null;
    let armActor = null;

    let gradientOverlay = null;
    let visualizerCanvas = null;

    // --- ÁG 1: VINYL MÓD ---
    if (isVinyl) {
        turntableBox = new St.Widget({ x_expand: true, y_expand: true });

        discActor = new St.Widget({
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            reactive: true,       // <-- Kattinthatóvá tesszük
            can_focus: true,
            track_hover: true,
        });
        discActor.set_pivot_point(0.5, 0.5);

        vinylCoverActor = new St.Widget({
            style: 'border-radius: 999px; background-color: #1a1a1a;',
        });
        state.vinylCoverActor = vinylCoverActor;

        const vinylSvgPath = getAssetPath('vinyl/vinyl.svg');
        vinylTexture = new St.Icon({
            gicon: Gio.FileIcon.new(Gio.File.new_for_path(vinylSvgPath)),
        });

        discActor.add_child(vinylCoverActor);
        discActor.add_child(vinylTexture);

        const sheenSvgPath = getAssetPath('vinyl/vinyl_sheen.svg');
        sheenActor = new St.Icon({
            gicon: Gio.FileIcon.new(Gio.File.new_for_path(sheenSvgPath)),
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            reactive: false,
        });

        state.sheenActor = sheenActor;
        sheenActor.hide();
        
        const armSvgPath = getAssetPath('vinyl/tonearm.svg');
        const armUrl = Gio.File.new_for_path(armSvgPath).get_uri();
        armActor = new St.Widget({
            style: `background-image: url("${armUrl}"); background-size: contain; background-repeat: no-repeat;`,
            reactive: false,
        });
        armActor.set_pivot_point(25 / 70, 25 / 220);
        armActor.rotation_angle_z = 0;

        turntableBox.add_child(discActor);
        turntableBox.add_child(sheenActor);
        turntableBox.add_child(armActor);
        state.container.add_child(turntableBox);

        let spinTimerId = null;
        const startSpinning = () => {
            if (spinTimerId) return;
            spinTimerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 33, () => {
                if (!discActor || isActorDestroyed(discActor)) {
                    spinTimerId = null;
                    return GLib.SOURCE_REMOVE;
                }
                discActor.rotation_angle_z = (discActor.rotation_angle_z + 2.0) % 360;
                return GLib.SOURCE_CONTINUE;
            });
        };

        const stopSpinning = () => {
            if (spinTimerId) {
                GLib.Source.remove(spinTimerId);
                spinTimerId = null;
            }
        };

        discActor.connect('destroy', () => stopSpinning());
        state.stopSpinning = stopSpinning;

        const ARM_ANGLE_REST = 0;
        const ARM_ANGLE_START = 14;
        const ARM_ANGLE_END = 30;

        const calculateArmAngle = (progress) => {
            const p = Math.max(0, Math.min(1, progress || 0));
            return ARM_ANGLE_START + (ARM_ANGLE_END - ARM_ANGLE_START) * p;
        };

        state.updateArmProgress = (progress) => {
            if (!armActor || isActorDestroyed(armActor)) return;
            if (state.playbackStatus !== 'Playing') return;

            const targetAngle = calculateArmAngle(progress);
            const currentAngle = armActor.rotation_angle_z;
            const diff = Math.abs(targetAngle - currentAngle);

            if (diff > 1.0) {
                const isMapped = discActor && discActor.is_mapped() && discActor.get_stage() !== null;
                if (isMapped) {
                    armActor.remove_all_transitions();
                    armActor.ease({
                        rotation_angle_z: targetAngle,
                        duration: 350,
                        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                    });
                    return;
                }
            }
            armActor.rotation_angle_z = targetAngle;
        };

        state.onPlaybackStatusChanged = (status) => {
            if (!discActor || isActorDestroyed(discActor)) return;
            const isMapped = discActor.is_mapped() && discActor.get_stage() !== null;

            if (status === 'Playing') {
                const pos = state.currentPositionMicro || 0;
                const len = state.trackLengthMicro || 0;
                const currentRatio = len > 0 ? (pos / len) : 0;
                const startAngle = calculateArmAngle(currentRatio);

                if (isMapped) {
                    startSpinning();
                    if (armActor) {
                        armActor.remove_all_transitions();
                        armActor.ease({
                            rotation_angle_z: startAngle,
                            duration: 500,
                            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                        });
                    }
                } else {
                    if (armActor) armActor.rotation_angle_z = startAngle;
                }
            } else {
                stopSpinning();
                if (isMapped) {
                    if (armActor) {
                        armActor.remove_all_transitions();
                        armActor.ease({
                            rotation_angle_z: ARM_ANGLE_REST,
                            duration: 500,
                            mode: Clutter.AnimationMode.EASE_IN_QUAD,
                        });
                    }
                } else {
                    if (armActor) armActor.rotation_angle_z = ARM_ANGLE_REST;
                }
            }
        };

        discActor.connect('notify::mapped', () => {
            if (discActor.is_mapped() && discActor.get_stage() !== null) {
                if (state.playbackStatus === 'Playing') startSpinning();
            } else {
                stopSpinning();
            }
        });
        connectControlButton(discActor, state, () => {
            handlePlayPauseAction(state);
        });
    }

    // --- ÁG 2: BORÍTÓ MÓD (OPCIONÁLIS VIZUALIZÁTORRAL) ---
    if (!isVinyl) {
        gradientOverlay = new St.Widget({
            style: isVisualizer
                ? 'background-gradient-direction: vertical; background-gradient-start: rgba(0,0,0,0.15); background-gradient-end: rgba(0,0,0,0.85);'
                : 'background-gradient-direction: vertical; background-gradient-start: rgba(0,0,0,0); background-gradient-end: rgba(0,0,0,0.75);',
            x_expand: true,
            y_expand: true,
            x_align: Clutter.ActorAlign.FILL,
            y_align: Clutter.ActorAlign.FILL,
        });
        state.container.add_child(gradientOverlay);

        if (isVisualizer) {
            state.container.clip_to_allocation = true;
            visualizerCanvas = new St.DrawingArea({
                x_expand: true,
                y_expand: true,
                x_align: Clutter.ActorAlign.FILL,
                y_align: Clutter.ActorAlign.FILL,
            });
            state.container.add_child(visualizerCanvas);

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

            const initCavaConfig = () => {
                const confContent = `[general]\nbars = ${NUM_BARS}\nframerate = 30\n[input]\nmethod = pulse\nsource = auto\n[output]\nmethod = raw\nraw_target = ${fifoPath}\ndata_format = binary\nbit_format = 8bit\n`;
                GLib.file_set_contents(confPath, confContent);
            };

            const readCavaStream = () => {
                if (!inputStream || !cavaCancellable || cavaCancellable.is_cancelled()) return;
                inputStream.read_bytes_async(NUM_BARS, GLib.PRIORITY_DEFAULT, cavaCancellable, (stream, res) => {
                    try {
                        const gBytes = stream.read_bytes_finish(res);
                        const data = gBytes ? gBytes.get_data() : null;
                        if (data && data.length === NUM_BARS) {
                            barValues = data;
                            if (state.playbackStatus === 'Playing') visualizerCanvas.queue_repaint();
                        }
                        if (!cavaCancellable.is_cancelled()) readCavaStream();
                    } catch (e) {}
                });
            };

            const stopCava = () => {
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
                if (visualizerCanvas && !isActorDestroyed(visualizerCanvas)) {
                    visualizerCanvas.queue_repaint();
                }
            };

            const startCava = () => {
                if (!hasCava || cavaSubproc) return;
                try {
                    initCavaConfig();
                    if (!GLib.file_test(fifoPath, GLib.FileTest.EXISTS)) {
                        GLib.spawn_command_line_async(`mkfifo "${fifoPath}"`);
                    }
                    cavaCancellable = new Gio.Cancellable();
                    cavaSubproc = Gio.Subprocess.new([cavaPath, '-p', confPath], Gio.SubprocessFlags.NONE);
                    const fifoFile = Gio.File.new_for_path(fifoPath);
                    fifoFile.read_async(GLib.PRIORITY_DEFAULT, cavaCancellable, (_f, res) => {
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
            };

            visualizerCanvas.connect('repaint', (area) => {
                const cr = area.get_context();
                const [w, h] = area.get_surface_size();
                if (w === 0 || h === 0 || state.playbackStatus !== 'Playing') {
                    cr.$dispose();
                    return;
                }
                
                const radius = config.appliedBorderRadius || 12;
                cr.save();
                cr.newSubPath();
                cr.arc(w - radius, radius, radius, -Math.PI / 2, 0);
                cr.arc(w - radius, h - radius, radius, 0, Math.PI / 2);
                cr.arc(radius, h - radius, radius, Math.PI / 2, Math.PI);
                cr.arc(radius, radius, radius, Math.PI, 3 * Math.PI / 2);
                cr.closePath();
                cr.clip();

                const [r, g, b, a] = getThemeAccentRgba(config);
                cr.setSourceRGBA(r, g, b, a);

                const mode = config.visualizerMode || 'bars';
                const baselineY = Math.round(h * 0.50);
                const availableHeight = Math.max(10, baselineY - 14);
                const gap = Math.max(2, Math.round(w * 0.015));
                const barW = (w - (NUM_BARS - 1) * gap - 24) / NUM_BARS;
                const offsetX = 12;

                const heights = [];
                for (let i = 0; i < NUM_BARS; i++) {
                    if (hasCava && cavaSubproc) {
                        heights.push(Math.max(3, (barValues[i] / 255.0) * availableHeight));
                    } else {
                        const v1 = Math.sin(wavePhase + i * 0.45) * 0.5 + 0.5;
                        const v2 = Math.cos(wavePhase * 1.3 + i * 0.3) * 0.3 + 0.3;
                        heights.push(Math.max(4, (v1 * 0.7 + v2 * 0.3) * availableHeight));
                    }
                }

                if (mode === 'bars') {
                    const baseBarY = h;
                    const maxBarH = Math.min(46, Math.round(h * 0.35));

                    // Margó nélkül, a teljes szélességhez igazítva
                    const totalBarW = w / NUM_BARS;
                    const barWidth = Math.max(3, Math.round(totalBarW * 0.58));
                    const barRadius = barWidth / 2;

                    for (let i = 0; i < NUM_BARS; i++) {
                        const rawH = Math.min(maxBarH, Math.max(barWidth, heights[i] * 0.6));
                        const bx = Math.round(i * totalBarW + (totalBarW - barWidth) / 2);
                        const by = baseBarY - rawH;

                        // Kapszula alakú oszlop (felül lekerekített ívvel)
                        cr.newSubPath();
                        cr.arc(bx + barRadius, by + barRadius, barRadius, Math.PI, 0); // Felső félkör
                        cr.lineTo(bx + barWidth, baseBarY); // Jobb oldal le az aljáig
                        cr.lineTo(bx, baseBarY);             // Bal oldal
                        cr.closePath();

                        // Lágy függőleges átmenet oszloponként (alul lágyabb derengés)
                        const barGrad = new Cairo.LinearGradient(0, baseBarY, 0, by);
                        barGrad.addColorStopRGBA(0.0, r, g, b, 0.45);
                        barGrad.addColorStopRGBA(1.0, r, g, b, 0.15);

                        cr.setSource(barGrad);
                        cr.fillPreserve();

                        // Finom felső körvonalfény
                        cr.setSourceRGBA(r, g, b, 0.6);
                        cr.setLineWidth(1.0);
                        cr.stroke();
                    }
                } else {
                    const baseWaveY = h;
                    const maxWaveH = Math.min(48, Math.round(h * 0.35));

                    const stepX = w / (NUM_BARS - 1);
                    const points = [];
                    for (let i = 0; i < NUM_BARS; i++) {
                        const px = i * stepX;
                        const py = baseWaveY - Math.min(maxWaveH, heights[i] * 0.6);
                        points.push({ x: px, y: py });
                    }

                    cr.moveTo(points[0].x, points[0].y);
                    for (let i = 0; i < NUM_BARS - 1; i++) {
                        const pCurrent = points[i];
                        const pNext = points[i + 1];
                        const cx = (pCurrent.x + pNext.x) / 2;
                        const cy = (pCurrent.y + pNext.y) / 2;

                        cr.quadTo ? cr.quadTo(pCurrent.x, pCurrent.y, cx, cy) : cr.curveTo(pCurrent.x, pCurrent.y, cx, cy, cx, cy);
                    }
                    const lastPt = points[points.length - 1];
                    cr.lineTo(lastPt.x, lastPt.y);

                    // Felső finom él megrajzolása
                    cr.setSourceRGBA(r, g, b, 0.45);
                    cr.setLineWidth(1.2);
                    cr.strokePreserve();

                    // Formazárás a sarkokhoz
                    cr.lineTo(w, baseWaveY);
                    cr.lineTo(0, baseWaveY);
                    cr.closePath();

                    // Felfelé halványuló lágy átmenet
                    const grad = new Cairo.LinearGradient(0, baseWaveY, 0, baseWaveY - maxWaveH);
                    grad.addColorStopRGBA(0.0, r, g, b, 0.35);
                    grad.addColorStopRGBA(1.0, r, g, b, 0.0);

                    cr.setSource(grad);
                    cr.fill();
                }
                cr.restore();
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
                    if (state.playbackStatus === 'Playing' && !cavaSubproc) startCava();
                    else if (state.playbackStatus !== 'Playing' && cavaSubproc) stopCava();
                }
                return GLib.SOURCE_CONTINUE;
            });

            state.container.connect('destroy', () => {
                if (stateWatcherTimerId) GLib.source_remove(stateWatcherTimerId);
                if (fallbackTimerId) GLib.source_remove(fallbackTimerId);
                stopCava();
                try {
                    Gio.File.new_for_path(fifoPath).delete(null);
                } catch (e) {}
            });
        }
    }

    // Vezérlők rétege (mindig a legfelső réteg)
    const controlsBox = buildControlsColumn(config, state);
    if (controlsBox) state.container.add_child(controlsBox);

    const cornerRadius = config.appliedBorderRadius || 0;

    // Reszponzív skálázás
    attachResponsiveScaler(state.container, BASE_CONTAINER_WIDTH, BASE_CONTAINER_HEIGHT, (scale, w, h) => {
        const textColor = resolveWidgetForegroundColor(config);
        const fontFamily = resolveExplicitFontFamily(config);
        updateControlButtonScaling(state, scale, fontFamily, textColor);

        const marginX = Math.round(16 * scale);
        const marginY = Math.max(MIN_CONTAINER_MARGIN_PX, Math.round(BASE_CONTAINER_MARGIN_PX * scale));

        if (state.controlsColumn) {
            state.controlsColumn.style = `margin-left: ${marginX}px; margin-right: ${marginX}px; margin-bottom: ${marginY}px; margin-top: 0px;`;
        }

        if (gradientOverlay) {
            const startAlpha = isVisualizer ? '0.15' : '0';
            const endAlpha = isVisualizer ? '0.85' : '0.75';
            gradientOverlay.style = `background-gradient-direction: vertical; `
                + `background-gradient-start: rgba(0,0,0,${startAlpha}); `
                + `background-gradient-end: rgba(0,0,0,${endAlpha}); `
                + `border-radius: ${cornerRadius}px;`;
        }

        if (turntableBox) {
            turntableBox.set_size(w, h);
            const vinylSize = Math.round(BASE_VINYL_SIZE * scale);
            const centerSize = Math.round(BASE_CENTER_LABEL_SIZE * scale);
            const armW = Math.round(BASE_ARM_WIDTH * scale);
            const armH = Math.round(BASE_ARM_HEIGHT * scale);

            // Vízszintesen hajszálpontosan KÖZÉPRE rendezve:
            const vinylX = Math.round((w - vinylSize) / 2);
            // Függőlegesen enyhén felhúzva, hogy az alsó vezérlősávnak helyet hagyjon:
            const vinylY = Math.max(0, Math.round((h - vinylSize) * 0.25));

            discActor.set_size(vinylSize, vinylSize);
            discActor.set_position(vinylX, vinylY);

            vinylTexture.set_icon_size(vinylSize);
            vinylTexture.set_size(vinylSize, vinylSize);

            vinylCoverActor.set_size(centerSize, centerSize);
            vinylCoverActor.set_position(
                Math.round((vinylSize - centerSize) / 2),
                Math.round((vinylSize - centerSize) / 2)
            );

            sheenActor.set_icon_size(vinylSize);
            sheenActor.set_size(vinylSize, vinylSize);
            sheenActor.set_position(vinylX, vinylY);

            // A kar pontosan a lemez széléhez képest marad, ahogy jól működött:
            const armX = vinylX + Math.round(vinylSize * 0.94);
            const armY = Math.max(0, vinylY + Math.round(6 * scale));

            armActor.set_size(armW, armH);
            armActor.set_position(armX, armY);
        }
    });
}