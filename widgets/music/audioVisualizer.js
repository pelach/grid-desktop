import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Cairo from 'cairo';

import {
    resolveWidgetForegroundColor,
    resolveExplicitFontFamily,
    parseCssColor,
} from '../../utils/widgetUtils.js';
import { createWidgetContainer, registerWidgetCleanup, attachResponsiveScaler } from '../../shell/widgetUIUtils.js';
import { isActorDestroyed } from '../../utils/actorLifecycle.js';
import { subscribeMusicData } from './playbackState.js';
import { extractTrackMetadata, unpackVariantValue } from './mpris.js';
import { isCavaAvailable, subscribeCava } from './cavaService.js';

const BASE_WIDTH = 400;
const BASE_HEIGHT = 200;
const NUM_BARS = 32;

export function createAudioVisualizerNode(config, width, height, xPosition, yPosition) {
    const fontFamily = resolveExplicitFontFamily(config);
    const fontCss = fontFamily ? `font-family: ${fontFamily}; ` : '';
    const textColor = resolveWidgetForegroundColor(config);
    const accentHex = config.globalAccentColor || '#3584e4';
    const container = createWidgetContainer(config, width, height, xPosition, yPosition);

    let scale = Math.max(0.65, Math.min(width / BASE_WIDTH, height / BASE_HEIGHT));
    let isDisposed = false;
    let isPlaying = false;

    const mainBox = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
    });
    container.add_child(mainBox);

    const headerBox = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_expand: true,
        y_align: Clutter.ActorAlign.START,
    });
    mainBox.add_child(headerBox);

    const headerIcon = new St.Icon({
        icon_name: 'audio-volume-high-symbolic',
        style: `color: ${accentHex}; margin-right: 8px;`,
        y_align: Clutter.ActorAlign.CENTER,
    });
    headerBox.add_child(headerIcon);

    const titleLabel = new St.Label({
        text: 'Audio Spectrum',
        y_align: Clutter.ActorAlign.CENTER,
        style: `${fontCss}color: ${textColor}; font-weight: bold; opacity: 0.9;`,
    });
    headerBox.add_child(titleLabel);

    headerBox.add_child(new St.Widget({ x_expand: true }));

    const statusLabel = new St.Label({
        text: 'IDLE',
        y_align: Clutter.ActorAlign.CENTER,
        style: `${fontCss}color: ${accentHex}; font-size: 10px; font-weight: 800; opacity: 0.7; letter-spacing: 1px;`,
    });
    statusLabel.clutter_text.set_ellipsize(0);
    headerBox.add_child(statusLabel);

    const canvas = new St.DrawingArea({
        x_expand: true,
        y_expand: true,
        x_align: Clutter.ActorAlign.FILL,
        y_align: Clutter.ActorAlign.FILL,
    });
    mainBox.add_child(canvas);

    const hasCava = isCavaAvailable();
    let barValues = new Uint8Array(NUM_BARS);
    let unsubscribeCava = null;
    let wavePhase = 0;

    const enableLiveCava = () => {
        if (!hasCava || unsubscribeCava || isDisposed)
            return;
        unsubscribeCava = subscribeCava((bars) => {
            barValues = bars;
            if (!isDisposed && !isActorDestroyed(canvas))
                canvas.queue_repaint();
        });
    };

    const disableLiveCava = () => {
        if (unsubscribeCava) {
            unsubscribeCava();
            unsubscribeCava = null;
        }
        barValues = new Uint8Array(NUM_BARS);
        if (!isDisposed && !isActorDestroyed(canvas))
            canvas.queue_repaint();
    };

    canvas.connect('repaint', (area) => {
        const cr = area.get_context();
        const [w, h] = area.get_surface_size();
        if (w === 0 || h === 0)
            return;

        const { r, g, b } = parseCssColor(accentHex);
        const mode = config.visualizerMode || 'bars';
        const maxH = Math.max(20, h - 8);
        const heights = [];

        for (let i = 0; i < NUM_BARS; i++) {
            if (isPlaying && unsubscribeCava) {
                heights.push(Math.max(4, (barValues[i] / 255.0) * maxH));
            } else {
                const v1 = Math.sin(wavePhase + i * 0.22) * 0.5 + 0.5;
                const v2 = Math.cos(wavePhase * 1.1 + i * 0.18) * 0.3 + 0.3;
                heights.push(Math.max(4, (v1 * 0.6 + v2 * 0.4) * (maxH * 0.25)));
            }
        }

        if (mode === 'bars') {
            const baseBarY = h;
            const totalBarW = w / NUM_BARS;
            const barWidth = Math.max(4, Math.round(totalBarW * 0.65));
            const barRadius = barWidth / 2;

            const barGrad = new Cairo.LinearGradient(0, h, 0, 0);
            barGrad.addColorStopRGBA(0.0, r, g, b, 0.25);
            barGrad.addColorStopRGBA(1.0, r, g, b, 0.95);
            cr.setSource(barGrad);

            for (let i = 0; i < NUM_BARS; i++) {
                const rawH = Math.min(maxH, heights[i]);
                const bx = Math.round(i * totalBarW + (totalBarW - barWidth) / 2);
                const by = baseBarY - rawH;

                cr.newSubPath();
                cr.arc(bx + barRadius, by + barRadius, barRadius, Math.PI, 0);
                cr.lineTo(bx + barWidth, baseBarY);
                cr.lineTo(bx, baseBarY);
                cr.closePath();
            }
            cr.fillPreserve();
            cr.setSourceRGBA(r, g, b, 0.7);
            cr.setLineWidth(1.0);
            cr.stroke();
        } else {
            const baseWaveY = h;
            const stepX = w / (NUM_BARS - 1);
            const points = [];

            for (let i = 0; i < NUM_BARS; i++) {
                points.push({ x: i * stepX, y: baseWaveY - heights[i] });
            }

            cr.moveTo(points[0].x, points[0].y);
            for (let i = 0; i < NUM_BARS - 1; i++) {
                const p0 = points[i];
                const p1 = points[i + 1];
                const cx = (p0.x + p1.x) / 2;
                const cy = (p0.y + p1.y) / 2;
                cr.curveTo(p0.x, p0.y, cx, cy, cx, cy);
            }
            cr.lineTo(points[points.length - 1].x, points[points.length - 1].y);

            cr.setSourceRGBA(r, g, b, isPlaying ? 0.9 : 0.5);
            cr.setLineWidth(2.0);
            cr.strokePreserve();

            cr.lineTo(w, baseWaveY);
            cr.lineTo(0, baseWaveY);
            cr.closePath();

            const waveGrad = new Cairo.LinearGradient(0, baseWaveY, 0, baseWaveY - maxH);
            waveGrad.addColorStopRGBA(0.0, r, g, b, isPlaying ? 0.45 : 0.2);
            waveGrad.addColorStopRGBA(1.0, r, g, b, isPlaying ? 0.05 : 0.0);

            cr.setSource(waveGrad);
            cr.fill();
        }
    });

    const idleAnimTimerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
        if (isDisposed) return GLib.SOURCE_REMOVE;
        if (!isPlaying || !hasCava) {
            wavePhase = (wavePhase + 0.05) % (Math.PI * 2);
            canvas.queue_repaint();
        }
        return GLib.SOURCE_CONTINUE;
    });

    const releaseMusicPoll = subscribeMusicData(config, ({ properties }) => {
        if (isDisposed) return;

        const playbackStatus = properties ? (unpackVariantValue(properties['PlaybackStatus']) || 'Stopped') : 'Stopped';
        const currentlyPlaying = playbackStatus === 'Playing';

        if (currentlyPlaying !== isPlaying) {
            isPlaying = currentlyPlaying;
            if (isPlaying) {
                statusLabel.set_text('LIVE');
                enableLiveCava();
            } else {
                statusLabel.set_text('IDLE');
                disableLiveCava();
            }
        }

        if (isPlaying && properties) {
            const track = extractTrackMetadata(properties);
            if (track?.title && track.title !== 'Unknown Title') {
                titleLabel.set_text(track.title);
            }
        } else {
            titleLabel.set_text('Audio Spectrum');
        }
    });

    function applyScale(newScale) {
        scale = newScale;
        const pad = Math.round(14 * scale);
        mainBox.style = `padding: ${pad}px;`;
        headerBox.style = `margin-bottom: ${Math.round(8 * scale)}px;`;
        headerIcon.icon_size = Math.round(16 * scale);
        titleLabel.style = `${fontCss}color: ${textColor}; font-size: ${Math.round(12 * scale)}px; font-weight: bold; opacity: 0.9;`;
        statusLabel.style = `${fontCss}color: ${accentHex}; font-size: ${Math.round(10 * scale)}px; font-weight: 800; opacity: 0.8; letter-spacing: 1px;`;
        canvas.queue_repaint();
    }

    applyScale(scale);

    attachResponsiveScaler(container, BASE_WIDTH, BASE_HEIGHT, (_ratio, w, h) => {
        applyScale(Math.max(0.65, Math.min(w / BASE_WIDTH, h / BASE_HEIGHT)));
    });

    registerWidgetCleanup(container, () => {
        isDisposed = true;
        if (idleAnimTimerId) GLib.Source.remove(idleAnimTimerId);
        releaseMusicPoll();
        disableLiveCava();
    });

    return container;
}