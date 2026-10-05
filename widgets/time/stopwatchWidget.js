import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import { resolveWidgetForegroundColor, resolveExplicitFontFamily, cssColorToRgba } from '../../utils/widgetUtils.js';
import { drawCircularArc, createWidgetContainer, connectTimerCleanup, attachButtonFeedback, attachResponsiveScaler } from '../../shell/widgetUIUtils.js';
import { BUTTON_PRIMARY } from '../../desktopGrid/constants.js';

const STOPWATCH_ARC_LINE_WIDTH_RATIO = 0.06;
const BASE_CONTAINER_SIZE = 220;
const BASE_ARC_MARGIN = 24;
const BASE_ARC_MIN_SIZE = 80;
const BORDER_ALPHA = 0.14;

function formatStopwatchTime(elapsedMs) {
    const totalSeconds = Math.floor(elapsedMs / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    const tenths = Math.floor((elapsedMs % 1000) / 100);

    const mStr = String(minutes).padStart(2, '0');
    const sStr = String(seconds).padStart(2, '0');

    return `${mStr}:${sStr}.${tenths}`;
}

export function createStopwatchNode(config, width, height, xPosition, yPosition) {
    const fontFamily = resolveExplicitFontFamily(config);
    const fontCss = fontFamily ? `font-family: ${fontFamily}; ` : '';
    const textColor = resolveWidgetForegroundColor(config);
    const accentHex = config.globalAccentColor || '#3584e4';
    const container = createWidgetContainer(config, width, height, xPosition, yPosition);
    container.style += ` border: 1px solid ${cssColorToRgba(textColor, BORDER_ALPHA)};`;

    const widgetTitle = config.stopwatchLabel || 'Stopper';

    const state = {
        elapsedMs: 0,
        startTime: 0,
        isRunning: false,
        timerId: null,
    };

    let scale = Math.min(width, height) / BASE_CONTAINER_SIZE;
    let arcMargin = Math.round(BASE_ARC_MARGIN * scale);
    let arcSize = Math.max(BASE_ARC_MIN_SIZE, Math.min(width, height) - arcMargin);

    let titleFontSize = Math.max(1, Math.round(13 * scale));
    let timeFontSize = Math.max(1, Math.round(28 * scale));
    let playIconSize = Math.max(1, Math.round(24 * scale));
    let secIconSize = Math.max(1, Math.round(20 * scale));

    const canvasActor = new St.DrawingArea({
        width: arcSize,
        height: arcSize,
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
    });

    canvasActor.connect('repaint', (area) => {
        const ctx = area.get_context();
        const [canvasWidth, canvasHeight] = area.get_surface_size();
        // A körív 60 másodpercenként fordul körbe teljesen
        const progress = ((state.elapsedMs % 60000) / 60000);
        drawCircularArc(ctx, canvasWidth, canvasHeight, progress, accentHex, STOPWATCH_ARC_LINE_WIDTH_RATIO);
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
        text: widgetTitle,
        x_align: Clutter.ActorAlign.CENTER,
        style: `${fontCss}color: ${textColor}; font-size: ${titleFontSize}px; opacity: 0.55; margin-bottom: 2px;`,
    });

    const timeLabel = new St.Label({
        text: formatStopwatchTime(0),
        x_align: Clutter.ActorAlign.CENTER,
        style: `${fontCss}color: ${textColor}; font-size: ${timeFontSize}px; font-weight: 300;`,
    });

    const controlsRow = new St.BoxLayout({
        x_align: Clutter.ActorAlign.CENTER,
        style: `margin-top: ${Math.round(8 * scale)}px;`,
    });

    const resetBtn = new St.Button({ reactive: true, can_focus: true, style: 'border-radius: 99px; margin: 0px 4px;' });
    const resetIcon = new St.Icon({ icon_name: 'view-refresh-symbolic', icon_size: secIconSize, style: `color: ${textColor}; opacity: 0.7;` });
    resetBtn.set_child(resetIcon);

    const playPauseBtn = new St.Button({ reactive: true, can_focus: true, style: 'border-radius: 99px; margin: 0px 4px;' });
    const playPauseIcon = new St.Icon({ icon_name: 'media-playback-start-symbolic', icon_size: playIconSize, style: `color: ${textColor};` });
    playPauseBtn.set_child(playPauseIcon);

    controlsRow.add_child(resetBtn);
    controlsRow.add_child(playPauseBtn);

    attachButtonFeedback(playPauseBtn);
    attachButtonFeedback(resetBtn);

    labelsBox.add_child(titleLabel);
    labelsBox.add_child(timeLabel);
    labelsBox.add_child(controlsRow);

    // Közös rétegezés (Stack) a rajzterületnek és a feliratoknak
    const contentStack = new Clutter.Actor({
        layout_manager: new Clutter.BinLayout(),
        x_expand: true,
        y_expand: true,
    });
    contentStack.add_child(canvasActor);
    contentStack.add_child(labelsBox);
    container.set_child(contentStack);

    const updateDisplay = () => {
        timeLabel.set_text(formatStopwatchTime(state.elapsedMs));
        canvasActor.queue_repaint();
    };

    const stopStopwatch = () => {
        if (state.timerId) {
            GLib.source_remove(state.timerId);
            state.timerId = null;
        }
        state.isRunning = false;
        playPauseIcon.set_icon_name('media-playback-start-symbolic');
    };

    const startStopwatch = () => {
        if (state.isRunning) return;
        state.isRunning = true;
        state.startTime = Date.now() - state.elapsedMs;
        playPauseIcon.set_icon_name('media-playback-pause-symbolic');

        // ~50 ms-os frissítés a sima tizedmásodperces pörgéshez
        state.timerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => {
            state.elapsedMs = Date.now() - state.startTime;
            updateDisplay();
            return GLib.SOURCE_CONTINUE;
        });
    };

    const resetStopwatch = () => {
        stopStopwatch();
        state.elapsedMs = 0;
        updateDisplay();
    };

    playPauseBtn.connect('button-press-event', (_actor, event) => {
        if (event.get_button() !== BUTTON_PRIMARY || container.actionOverlay)
            return Clutter.EVENT_PROPAGATE;
        if (state.isRunning) stopStopwatch();
        else startStopwatch();
        return Clutter.EVENT_STOP;
    });

    resetBtn.connect('button-press-event', (_actor, event) => {
        if (event.get_button() !== BUTTON_PRIMARY || container.actionOverlay)
            return Clutter.EVENT_PROPAGATE;
        resetStopwatch();
        return Clutter.EVENT_STOP;
    });

    connectTimerCleanup(container, state);
    updateDisplay();

    function applyScale(newScale) {
        scale = newScale;
        arcMargin = Math.round(BASE_ARC_MARGIN * scale);
        arcSize = Math.max(BASE_ARC_MIN_SIZE, Math.min(container.width, container.height) - arcMargin);
        titleFontSize = Math.max(1, Math.round(13 * scale));
        timeFontSize = Math.max(1, Math.round(28 * scale));
        playIconSize = Math.max(1, Math.round(24 * scale));
        secIconSize = Math.max(1, Math.round(20 * scale));

        canvasActor.set_size(arcSize, arcSize);
        canvasActor.queue_repaint();
        titleLabel.style = `${fontCss}color: ${textColor}; font-size: ${titleFontSize}px; opacity: 0.55; margin-bottom: 2px;`;
        timeLabel.style = `${fontCss}color: ${textColor}; font-size: ${timeFontSize}px; font-weight: 300;`;
        controlsRow.style = `margin-top: ${Math.round(8 * scale)}px;`;
        playPauseIcon.icon_size = playIconSize;
        resetIcon.icon_size = secIconSize;
    }

    attachResponsiveScaler(container, BASE_CONTAINER_SIZE, BASE_CONTAINER_SIZE, (_ratio, w, h) => {
        applyScale(Math.min(w, h) / BASE_CONTAINER_SIZE);
    });

    return container;
}