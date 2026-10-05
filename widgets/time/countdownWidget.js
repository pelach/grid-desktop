import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import { resolveWidgetForegroundColor, resolveExplicitFontFamily, cssColorToRgba } from '../../utils/widgetUtils.js';
import { drawCircularArc, createWidgetContainer, connectTimerCleanup, attachResponsiveScaler } from '../../shell/widgetUIUtils.js';

const COUNTDOWN_ARC_LINE_WIDTH_RATIO = 0.06;
const BASE_CONTAINER_SIZE = 220;
const BASE_ARC_MARGIN = 24;
const BASE_ARC_MIN_SIZE = 80;
const BORDER_ALPHA = 0.14;

export function createCountdownNode(config, width, height, xPosition, yPosition) {
    const fontFamily = resolveExplicitFontFamily(config);
    const fontCss = fontFamily ? `font-family: ${fontFamily}; ` : '';
    const textColor = resolveWidgetForegroundColor(config);
    const accentHex = config.globalAccentColor || '#3584e4';
    const container = createWidgetContainer(config, width, height, xPosition, yPosition);
    container.style += ` border: 1px solid ${cssColorToRgba(textColor, BORDER_ALPHA)};`;

    const eventTitle = config.eventName || 'Goal';
    // ISO dátum string a prefs-ből, pl. '2026-12-31T00:00:00'
    const targetIsoString = config.targetDate || '';
    const targetTimestamp = targetIsoString ? new Date(targetIsoString).getTime() : 0;
    // Opcionálisan megadható kezdődátum a progress arányhoz (alapértelmezetten a hozzáadás pillanata)
    const startTimestamp = config.startDate ? new Date(config.startDate).getTime() : Date.now();

    const state = {
        timerId: null,
        days: 0,
        subText: '',
        progress: 0,
    };

    let scale = Math.min(width, height) / BASE_CONTAINER_SIZE;
    let arcMargin = Math.round(BASE_ARC_MARGIN * scale);
    let arcSize = Math.max(BASE_ARC_MIN_SIZE, Math.min(width, height) - arcMargin);

    let titleFontSize = Math.max(1, Math.round(13 * scale));
    let mainFontSize = Math.max(1, Math.round(32 * scale));
    let subFontSize = Math.max(1, Math.round(11 * scale));

    const canvasActor = new St.DrawingArea({
        width: arcSize,
        height: arcSize,
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
    });

    canvasActor.connect('repaint', (area) => {
        const ctx = area.get_context();
        const [canvasWidth, canvasHeight] = area.get_surface_size();
        drawCircularArc(ctx, canvasWidth, canvasHeight, state.progress, accentHex, COUNTDOWN_ARC_LINE_WIDTH_RATIO);
        ctx.$dispose();
    });
   

    const labelsBox = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
        x_expand: true,
        y_expand: true,
    });

    const titleLabel = new St.Label({
        text: eventTitle,
        x_align: Clutter.ActorAlign.CENTER,
        style: `${fontCss}color: ${textColor}; font-size: ${titleFontSize}px; opacity: 0.6; margin-bottom: 2px;`,
    });

    const mainLabel = new St.Label({
        text: '0 nap',
        x_align: Clutter.ActorAlign.CENTER,
        style: `${fontCss}color: ${textColor}; font-size: ${mainFontSize}px; font-weight: 300;`,
    });

    const subLabel = new St.Label({
        text: '00:00:00',
        x_align: Clutter.ActorAlign.CENTER,
        style: `${fontCss}color: ${textColor}; font-size: ${subFontSize}px; opacity: 0.5; margin-top: 4px;`,
    });

    labelsBox.add_child(titleLabel);
    labelsBox.add_child(mainLabel);
    labelsBox.add_child(subLabel);
    const contentStack = new Clutter.Actor({
        layout_manager: new Clutter.BinLayout(),
        x_expand: true,
        y_expand: true,
    });

    contentStack.add_child(canvasActor);
    contentStack.add_child(labelsBox);

    container.set_child(contentStack);
    
    const calculateTimeRemaining = () => {
        if (!targetTimestamp) {
            mainLabel.set_text('Nincs cél');
            subLabel.set_text('Állítsd be a prefs-ben');
            state.progress = 0;
            canvasActor.queue_repaint();
            return;
        }

        const now = Date.now();
        const diffMs = targetTimestamp - now;

        if (diffMs <= 0) {
            mainLabel.set_text('Lejárt!');
            subLabel.set_text('00:00:00');
            state.progress = 1;
            canvasActor.queue_repaint();
            return;
        }

        const totalSeconds = Math.floor(diffMs / 1000);
        const days = Math.floor(totalSeconds / 86400);
        const hours = Math.floor((totalSeconds % 86400) / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;

        mainLabel.set_text(`${days} nap`);
        subLabel.set_text(
            `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
        );

        // Körív számítása a kezdő és célidőpont között (vagy ha nincs startDate, 30 napos alapértelmezett skálán)
        const totalSpan = targetTimestamp - startTimestamp;
        if (totalSpan > 0) {
            state.progress = Math.min(1, Math.max(0, 1 - (diffMs / totalSpan)));
        } else {
            state.progress = 0;
        }

        canvasActor.queue_repaint();
    };

    calculateTimeRemaining();

    // Másodpercenkénti frissítés a pontos számlálóhoz
    state.timerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
        calculateTimeRemaining();
        return GLib.SOURCE_CONTINUE;
    });

    connectTimerCleanup(container, state);

    function applyScale(newScale) {
        scale = newScale;
        arcMargin = Math.round(BASE_ARC_MARGIN * scale);
        arcSize = Math.max(BASE_ARC_MIN_SIZE, Math.min(container.width, container.height) - arcMargin);
        titleFontSize = Math.max(1, Math.round(13 * scale));
        mainFontSize = Math.max(1, Math.round(32 * scale));
        subFontSize = Math.max(1, Math.round(11 * scale));

        canvasActor.set_size(arcSize, arcSize);
        canvasActor.queue_repaint();
        titleLabel.style = `${fontCss}color: ${textColor}; font-size: ${titleFontSize}px; opacity: 0.6; margin-bottom: 2px;`;
        mainLabel.style = `${fontCss}color: ${textColor}; font-size: ${mainFontSize}px; font-weight: 300;`;
        subLabel.style = `${fontCss}color: ${textColor}; font-size: ${subFontSize}px; opacity: 0.5; margin-top: 4px;`;
    }

    attachResponsiveScaler(container, BASE_CONTAINER_SIZE, BASE_CONTAINER_SIZE, (_ratio, w, h) => {
        applyScale(Math.min(w, h) / BASE_CONTAINER_SIZE);
    });

    return container;
}