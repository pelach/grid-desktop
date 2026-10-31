import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import { resolveWidgetForegroundColor, resolveExplicitFontFamily } from '../../utils/widgetUtils.js';
import { drawCircularArc, createWidgetContainer, connectTimerCleanup, attachResponsiveScaler } from '../../shell/widgetUIUtils.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';
import Gio from 'gi://Gio';

const COUNTDOWN_ARC_LINE_WIDTH_RATIO = 0.06;
const BASE_CONTAINER_SIZE = 200;
const BASE_ARC_MARGIN = 20;
const BASE_ARC_MIN_SIZE = 80;

export function createCountdownNode(config, width, height, xPosition, yPosition) {
    const fontFamily = resolveExplicitFontFamily(config);
    const fontCss = fontFamily ? `font-family: ${fontFamily}; ` : '';
    const textColor = resolveWidgetForegroundColor(config);
    const accentHex = config.globalAccentColor || '#3584e4';
    const container = createWidgetContainer(config, width, height, xPosition, yPosition);

    const eventTitle = config.eventName || 'Goal';
    const targetIsoString = config.targetDate || '';
    const targetTimestamp = targetIsoString ? new Date(targetIsoString).getTime() : 0;
    const startTimestamp = config.startDate ? new Date(config.startDate).getTime() : Date.now();

    const state = {
        timerId: null,
        days: 0,
        subText: '',
        progress: 0,
        hasNotified: false,
    };

    let scale = Math.max(0.65, Math.min(width, height) / BASE_CONTAINER_SIZE);
    let arcMargin = Math.round(BASE_ARC_MARGIN * scale);
    let arcSize = Math.max(BASE_ARC_MIN_SIZE, Math.min(width, height) - arcMargin);

    let titleFontSize = Math.max(10, Math.round(12 * scale));
    let mainFontSize = Math.max(20, Math.round(28 * scale));
    let subFontSize = Math.max(9, Math.round(11 * scale));

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
        text: '0 day',
        x_align: Clutter.ActorAlign.CENTER,
        style: `${fontCss}color: ${textColor}; font-size: ${mainFontSize}px; font-weight: 300;`,
    });

    const subLabel = new St.Label({
        text: '00:00:00',
        x_align: Clutter.ActorAlign.CENTER,
        style: `${fontCss}color: ${textColor}; font-size: ${subFontSize}px; opacity: 0.5; margin-top: 3px;`,
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

    let messageSource = null;

    function getMessageSource() {
        if (!messageSource || messageSource.is_destroyed?.() || messageSource._disposed) {
            messageSource = new MessageTray.Source({
                title: 'Countdown',
                iconName: 'alarm-symbolic',
            });
            messageSource.connect('destroy', () => {
                messageSource = null;
            });
            Main.messageTray.add(messageSource);
        }
        return messageSource;
    }
    
    const calculateTimeRemaining = () => {
        if (!targetTimestamp) {
            mainLabel.set_text('No goal');
            subLabel.set_text('Set of preferences');
            state.progress = 0;
            state.hasNotified = false;
            canvasActor.queue_repaint();
            return;
        }

        const now = Date.now();
        const diffMs = targetTimestamp - now;

        if (diffMs <= 0) {
            mainLabel.set_text('Ending!');
            subLabel.set_text('00:00:00');
            state.progress = 1;
            canvasActor.queue_repaint();

            if (!state.hasNotified) {
                state.hasNotified = true;
                try {
                    const src = getMessageSource();
                    const notification = new MessageTray.Notification({
                        source: src,
                        title: 'Countdown',
                        body: eventTitle + ' has ended!',
                        gicon: new Gio.ThemedIcon({ name: 'alarm-symbolic' }),
                        isTransient: false, 
                    });
                    notification.urgency = MessageTray.Urgency.CRITICAL;
                    src.addNotification(notification);
                } catch (e) {}
                
                global.display.get_sound_player().play_from_theme(
                    'alarm-clock-elapsed',
                    'Countdown',
                    null
                );
            }
            return;
        }

        const totalSeconds = Math.floor(diffMs / 1000);
        const days = Math.floor(totalSeconds / 86400);
        const hours = Math.floor((totalSeconds % 86400) / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;

        mainLabel.set_text(`${days} day`);
        subLabel.set_text(
            `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
        );

        const totalSpan = targetTimestamp - startTimestamp;
        state.progress = totalSpan > 0 ? Math.min(1, Math.max(0, 1 - (diffMs / totalSpan))) : 0;
        canvasActor.queue_repaint();
    };

    calculateTimeRemaining();

    state.timerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
        calculateTimeRemaining();
        if (targetTimestamp && Date.now() >= targetTimestamp) {
            state.timerId = null;
            return GLib.SOURCE_REMOVE;
        }
        return GLib.SOURCE_CONTINUE;
    });

    connectTimerCleanup(container, state);

    container.connect('destroy', () => {
        messageSource = null;
    });

    function applyScale(newScale) {
        scale = newScale;
        arcMargin = Math.round(BASE_ARC_MARGIN * scale);
        arcSize = Math.max(BASE_ARC_MIN_SIZE, Math.min(container.width, container.height) - arcMargin);
        titleFontSize = Math.max(10, Math.round(12 * scale));
        mainFontSize = Math.max(20, Math.round(28 * scale));
        subFontSize = Math.max(9, Math.round(11 * scale));

        canvasActor.set_size(arcSize, arcSize);
        canvasActor.queue_repaint();
        titleLabel.style = `${fontCss}color: ${textColor}; font-size: ${titleFontSize}px; opacity: 0.6; margin-bottom: 2px;`;
        mainLabel.style = `${fontCss}color: ${textColor}; font-size: ${mainFontSize}px; font-weight: 300;`;
        subLabel.style = `${fontCss}color: ${textColor}; font-size: ${subFontSize}px; opacity: 0.5; margin-top: 3px;`;
    }

    attachResponsiveScaler(container, BASE_CONTAINER_SIZE, BASE_CONTAINER_SIZE, (_ratio, w, h) => {
        applyScale(Math.max(0.65, Math.min(w, h) / BASE_CONTAINER_SIZE));
    });

    return container;
}