import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import { resolveWidgetForegroundColor, resolveExplicitFontFamily, cssColorToRgba } from '../../utils/widgetUtils.js';
import { drawCircularArc, createWidgetContainer, connectTimerCleanup, attachButtonFeedback, attachResponsiveScaler } from '../../shell/widgetUIUtils.js';
import { BUTTON_PRIMARY } from '../../desktopGrid/constants.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';
import Gio from 'gi://Gio';


const TIMER_ARC_LINE_WIDTH_RATIO = 0.06;
const BASE_CONTAINER_SIZE = 220;
const BASE_ARC_MARGIN = 24;
const BASE_ARC_MIN_SIZE = 80;
const BORDER_ALPHA = 0.14;

function formatTime(totalSeconds) {
    const s = Math.max(0, Math.floor(totalSeconds));
    const hours = Math.floor(s / 3600);
    const minutes = Math.floor((s % 3600) / 60);
    const seconds = s % 60;

    if (hours > 0) {
        return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function createTimerNode(config, width, height, xPosition, yPosition) {
    const fontFamily = resolveExplicitFontFamily(config);
    const fontCss = fontFamily ? `font-family: ${fontFamily}; ` : '';
    const textColor = resolveWidgetForegroundColor(config);
    const accentHex = config.globalAccentColor || '#3584e4';
    const container = createWidgetContainer(config, width, height, xPosition, yPosition);
    container.style += ` border: 1px solid ${cssColorToRgba(textColor, BORDER_ALPHA)};`;

    // Alapértelmezett időtartam (másodpercben, pl. prefs-ből: config.timerDurationSeconds vagy 5 perc)
    const initialDuration = Number(config.timerDurationSeconds) || 300;
    const timerTitle = config.timerLabel || 'Timer';

    const state = {
        totalDuration: initialDuration,
        secondsRemaining: initialDuration,
        isRunning: false,
        timerId: null,
    };

    let scale = Math.min(width, height) / BASE_CONTAINER_SIZE;
    let arcMargin = Math.round(BASE_ARC_MARGIN * scale);
    let arcSize = Math.max(BASE_ARC_MIN_SIZE, Math.min(width, height) - arcMargin);

    let titleFontSize = Math.max(1, Math.round(13 * scale));
    let timerFontSize = Math.max(1, Math.round(28 * scale));
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
        const progress = state.totalDuration > 0
            ? 1 - (state.secondsRemaining / state.totalDuration)
            : 0;
        drawCircularArc(ctx, canvasWidth, canvasHeight, progress, accentHex, TIMER_ARC_LINE_WIDTH_RATIO);
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
        text: timerTitle,
        x_align: Clutter.ActorAlign.CENTER,
        style: `${fontCss}color: ${textColor}; font-size: ${titleFontSize}px; opacity: 0.55; margin-bottom: 2px;`,
    });

    const timerLabel = new St.Label({
        text: formatTime(state.secondsRemaining),
        x_align: Clutter.ActorAlign.CENTER,
        style: `${fontCss}color: ${textColor}; font-size: ${timerFontSize}px; font-weight: 300;`,
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
    labelsBox.add_child(timerLabel);
    labelsBox.add_child(controlsRow);
    const contentStack = new Clutter.Actor({
        layout_manager: new Clutter.BinLayout(),
        x_expand: true,
        y_expand: true,
    });

    contentStack.add_child(canvasActor);
    contentStack.add_child(labelsBox);

    container.set_child(contentStack);

    const updateDisplay = () => {
        timerLabel.set_text(formatTime(state.secondsRemaining));
        canvasActor.queue_repaint();
    };

    const source = new MessageTray.Source({
        title: 'Timer',
        iconName: 'alarm-symbolic',
    });
    Main.messageTray.add(source);

    const stopTimer = () => {
        if (state.timerId) {
            GLib.source_remove(state.timerId);
            state.timerId = null;
        }
        state.isRunning = false;
        playPauseIcon.set_icon_name('media-playback-start-symbolic');
    };

    const startTimer = () => {
        if (state.isRunning) return;
        if (state.secondsRemaining <= 0) {
            state.secondsRemaining = state.totalDuration;
        }
        state.isRunning = true;
        playPauseIcon.set_icon_name('media-playback-pause-symbolic');

        state.timerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
            if (state.secondsRemaining > 0) {
                state.secondsRemaining--;
                updateDisplay();
                if (state.secondsRemaining === 0) {
                    stopTimer();

                    const notification = new MessageTray.Notification({
                        source: source,
                        title: 'Timer',
                        body: 'The timer has expired!',
                        gicon: new Gio.ThemedIcon({ name: 'alarm-symbolic' }),
                        isTransient: false, 
                    });

                    notification.urgency = MessageTray.Urgency.CRITICAL;

                    source.addNotification(notification);
                    
                    global.display.get_sound_player().play_from_theme(
                        'alarm-clock-elapsed',
                        'Timer',
                        null
                    );

                    return GLib.SOURCE_REMOVE;
                }
                return GLib.SOURCE_CONTINUE;
            }
            stopTimer();
            return GLib.SOURCE_REMOVE;
        });
    };

    const resetTimer = () => {
        stopTimer();
        state.secondsRemaining = state.totalDuration;
        updateDisplay();
    };

    playPauseBtn.connect('button-press-event', (_actor, event) => {
        if (event.get_button() !== BUTTON_PRIMARY || container.actionOverlay)
            return Clutter.EVENT_PROPAGATE;
        if (state.isRunning) stopTimer();
        else startTimer();
        return Clutter.EVENT_STOP;
    });

    resetBtn.connect('button-press-event', (_actor, event) => {
        if (event.get_button() !== BUTTON_PRIMARY || container.actionOverlay)
            return Clutter.EVENT_PROPAGATE;
        resetTimer();
        return Clutter.EVENT_STOP;
    });

    connectTimerCleanup(container, state);
    updateDisplay();

    container.connect('destroy', () => {
        stopTimer();
        source.destroy();
    });

    function applyScale(newScale) {
        scale = newScale;
        arcMargin = Math.round(BASE_ARC_MARGIN * scale);
        arcSize = Math.max(BASE_ARC_MIN_SIZE, Math.min(container.width, container.height) - arcMargin);
        titleFontSize = Math.max(1, Math.round(13 * scale));
        timerFontSize = Math.max(1, Math.round(28 * scale));
        playIconSize = Math.max(1, Math.round(24 * scale));
        secIconSize = Math.max(1, Math.round(20 * scale));

        canvasActor.set_size(arcSize, arcSize);
        canvasActor.queue_repaint();
        titleLabel.style = `${fontCss}color: ${textColor}; font-size: ${titleFontSize}px; opacity: 0.55; margin-bottom: 2px;`;
        timerLabel.style = `${fontCss}color: ${textColor}; font-size: ${timerFontSize}px; font-weight: 300;`;
        controlsRow.style = `margin-top: ${Math.round(8 * scale)}px;`;
        playPauseIcon.icon_size = playIconSize;
        resetIcon.icon_size = secIconSize;
    }

    attachResponsiveScaler(container, BASE_CONTAINER_SIZE, BASE_CONTAINER_SIZE, (_ratio, w, h) => {
        applyScale(Math.min(w, h) / BASE_CONTAINER_SIZE);
    });

    return container;
}