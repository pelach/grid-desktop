import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Cairo from 'cairo';

import { createBackgroundLayer, buildControlsColumn, updateControlButtonScaling } from './controls.js';
import { resolveWidgetForegroundColor, resolveExplicitFontFamily, parseCssColor } from '../../utils/widgetUtils.js';
import { attachResponsiveScaler, registerWidgetCleanup } from '../../shell/widgetUIUtils.js';
import { isActorDestroyed } from '../../utils/actorLifecycle.js';
import { isCavaAvailable, subscribeCava } from './cavaService.js';
import { createVinylTurntable } from './vinyl.js';

const BASE_CONTAINER_WIDTH = 200;
const BASE_CONTAINER_HEIGHT = 200;

const BASE_CONTAINER_MARGIN_PX = 10;
const MIN_CONTAINER_MARGIN_PX = 4;
const NUM_BARS = 16;

export function buildSmallLayout(config, state) {
    const isVinyl = config.vinylStyle === true;
    const isVisualizer = !isVinyl && (config.showVisualizer === true || config.layoutType === 'visualizer');

    const backgroundLayer = createBackgroundLayer(config);
    if (isVinyl)
        backgroundLayer.style = 'background-color: transparent;';

    state.backgroundLayer = backgroundLayer;
    state.container.add_child(backgroundLayer);

    state.titleLabel = null;
    state.artistLabel = null;
    state.albumLabel = null;

    let updateVinylLayout = null;
    let gradientOverlay = null;
    let visualizerCanvas = null;

    // --- ÁG 1: VINYL MÓD ---
    if (isVinyl) {
        updateVinylLayout = createVinylTurntable(state, state.container, {
            baseVinylSize: 120,
            baseCenterSize: 53,
            baseArmWidth: 32,
            baseArmHeight: 100,
            armAngleStart: 11,
            armAngleEnd: 28,
            positionElements: (scale, w, _h, vinylSize) => {
                const vinylX = Math.round((w - vinylSize) / 2);
                const vinylY = Math.max(6, Math.round(10 * scale));
                return {
                    vinylX,
                    vinylY,
                    armX: vinylX + Math.round(vinylSize * 0.94),
                    armY: Math.max(0, vinylY + Math.round(6 * scale)),
                };
            },
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

            const hasCava = isCavaAvailable();
            let barValues = new Uint8Array(32);
            let unsubscribeCava = null;
            let fallbackTimerId = null;
            let wavePhase = 0;

            const syncCavaSubscription = (playing) => {
                if (!hasCava) return;
                if (playing && !unsubscribeCava) {
                    unsubscribeCava = subscribeCava((bars) => {
                        barValues = bars;
                        if (state.playbackStatus === 'Playing' && !isActorDestroyed(visualizerCanvas))
                            visualizerCanvas.queue_repaint();
                    });
                } else if (!playing && unsubscribeCava) {
                    unsubscribeCava();
                    unsubscribeCava = null;
                    barValues = new Uint8Array(32);
                    if (!isActorDestroyed(visualizerCanvas))
                        visualizerCanvas.queue_repaint();
                }
            };

            state.onPlaybackStatusChanged = (status) => syncCavaSubscription(status === 'Playing');
            if (state.playbackStatus === 'Playing')
                syncCavaSubscription(true);

            visualizerCanvas.connect('repaint', (area) => {
                const cr = area.get_context();
                const [w, h] = area.get_surface_size();
                if (w === 0 || h === 0 || state.playbackStatus !== 'Playing')
                    return;

                const radius = config.appliedBorderRadius || 12;
                cr.save();
                cr.newSubPath();
                cr.arc(w - radius, radius, radius, -Math.PI / 2, 0);
                cr.arc(w - radius, h - radius, radius, 0, Math.PI / 2);
                cr.arc(radius, h - radius, radius, Math.PI / 2, Math.PI);
                cr.arc(radius, radius, radius, Math.PI, 3 * Math.PI / 2);
                cr.closePath();
                cr.clip();

                const { r, g, b } = parseCssColor(resolveWidgetForegroundColor(config));
                cr.setSourceRGBA(r, g, b, 0.85);

                const mode = config.visualizerMode || 'bars';
                const baselineY = Math.round(h * 0.50);
                const availableHeight = Math.max(10, baselineY - 14);

                const heights = [];
                for (let i = 0; i < NUM_BARS; i++) {
                    if (hasCava && unsubscribeCava) {
                        heights.push(Math.max(3, (barValues[i * 2] / 255.0) * availableHeight));
                    } else {
                        const v1 = Math.sin(wavePhase + i * 0.45) * 0.5 + 0.5;
                        const v2 = Math.cos(wavePhase * 1.3 + i * 0.3) * 0.3 + 0.3;
                        heights.push(Math.max(4, (v1 * 0.7 + v2 * 0.3) * availableHeight));
                    }
                }

                if (mode === 'bars') {
                    const baseBarY = h;
                    const maxBarH = Math.min(46, Math.round(h * 0.35));
                    const totalBarW = w / NUM_BARS;
                    const barWidth = Math.max(3, Math.round(totalBarW * 0.58));
                    const barRadius = barWidth / 2;

                    const barGrad = new Cairo.LinearGradient(0, baseBarY, 0, baseBarY - maxBarH);
                    barGrad.addColorStopRGBA(0.0, r, g, b, 0.45);
                    barGrad.addColorStopRGBA(1.0, r, g, b, 0.15);
                    cr.setSource(barGrad);

                    for (let i = 0; i < NUM_BARS; i++) {
                        const rawH = Math.min(maxBarH, Math.max(barWidth, heights[i] * 0.6));
                        const bx = Math.round(i * totalBarW + (totalBarW - barWidth) / 2);
                        const by = baseBarY - rawH;

                        cr.newSubPath();
                        cr.arc(bx + barRadius, by + barRadius, barRadius, Math.PI, 0);
                        cr.lineTo(bx + barWidth, baseBarY);
                        cr.lineTo(bx, baseBarY);
                        cr.closePath();
                    }

                    cr.fillPreserve();
                    cr.setSourceRGBA(r, g, b, 0.6);
                    cr.setLineWidth(1.0);
                    cr.stroke();
                } else {
                    const baseWaveY = h;
                    const maxWaveH = Math.min(48, Math.round(h * 0.35));
                    const stepX = w / (NUM_BARS - 1);
                    const points = [];
                    for (let i = 0; i < NUM_BARS; i++) {
                        points.push({ x: i * stepX, y: baseWaveY - Math.min(maxWaveH, heights[i] * 0.6) });
                    }

                    cr.moveTo(points[0].x, points[0].y);
                    for (let i = 0; i < NUM_BARS - 1; i++) {
                        const pCurrent = points[i];
                        const pNext = points[i + 1];
                        const cx = (pCurrent.x + pNext.x) / 2;
                        const cy = (pCurrent.y + pNext.y) / 2;
                        cr.curveTo(pCurrent.x, pCurrent.y, cx, cy, cx, cy);
                    }
                    const lastPt = points[points.length - 1];
                    cr.lineTo(lastPt.x, lastPt.y);

                    cr.setSourceRGBA(r, g, b, 0.45);
                    cr.setLineWidth(1.2);
                    cr.strokePreserve();

                    cr.lineTo(w, baseWaveY);
                    cr.lineTo(0, baseWaveY);
                    cr.closePath();

                    const grad = new Cairo.LinearGradient(0, baseWaveY, 0, baseWaveY - maxWaveH);
                    grad.addColorStopRGBA(0.0, r, g, b, 0.35);
                    grad.addColorStopRGBA(1.0, r, g, b, 0.0);

                    cr.setSource(grad);
                    cr.fill();
                }
                cr.restore();
            });

            if (!hasCava) {
                fallbackTimerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => {
                    if (isActorDestroyed(state.container)) return GLib.SOURCE_REMOVE;
                    if (state.playbackStatus === 'Playing') {
                        wavePhase = (wavePhase + 0.12) % (Math.PI * 2);
                        visualizerCanvas.queue_repaint();
                    }
                    return GLib.SOURCE_CONTINUE;
                });
            }

            registerWidgetCleanup(state.container, () => {
                if (fallbackTimerId) GLib.Source.remove(fallbackTimerId);
                syncCavaSubscription(false);
            });
        }
    }

    const controlsBox = buildControlsColumn(config, state);
    if (controlsBox) state.container.add_child(controlsBox);

    const cornerRadius = config.appliedBorderRadius || 0;

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

        if (updateVinylLayout)
            updateVinylLayout(scale, w, h);
    });
}