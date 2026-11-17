import St from 'gi://St';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import { resolveWidgetForegroundColor, resolveExplicitFontFamily, resolveUse24h, SECONDARY_OPACITY } from '../../utils/widgetUtils.js';
import { attachResponsiveScaler, connectTimerCleanup, createWidgetContainer, formatTimeParts, startMinuteAlignedTimer, registerWidgetCleanup } from '../../shell/widgetUIUtils.js';
import { isActorDestroyed } from '../../utils/actorLifecycle.js';

const BASE_CONTAINER_SIZE = 200;
const BASE_TIME_FONT_SIZE = 42;
const BASE_AMPM_FONT_SIZE = 14;
const BASE_DATE_FONT_SIZE = 14;
const TIME_MARGIN_RIGHT_PX = 4;
const AMPM_MARGIN_BOTTOM_PX = 6;

function updateTimeAndDate(elements, is24h) {
    if (!elements || !elements.timeLabel) return;
    const now = GLib.DateTime.new_now_local();
    const { time, ampm } = formatTimeParts(now, is24h);

    elements.timeLabel.set_text(time);

    if (elements.ampmLabel) {
        elements.ampmLabel.set_text(ampm || '');
        elements.ampmLabel.visible = (!is24h && ampm !== '');
    }

    elements.dateLabel.set_text(now.format('%A, %b %d'));
}

export function createDigitalTimeNode(widgetData, width, height, xPosition, yPosition) {
    const fontFamily = resolveExplicitFontFamily(widgetData);
    const fontCss = fontFamily ? `font-family: ${fontFamily}; ` : '';
    const textColor = resolveWidgetForegroundColor(widgetData);

    const widgetNode = createWidgetContainer(widgetData, width, height, xPosition, yPosition);

    const textLayout = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
    });
    widgetNode.add_child(textLayout);

    const timeRow = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        y_align: Clutter.ActorAlign.END,
        x_align: Clutter.ActorAlign.CENTER,
    });

    const timeLabel = new St.Label({ text: '00:00' });
    timeRow.add_child(timeLabel);

    const ampmLabel = new St.Label({ text: '' });
    timeRow.add_child(ampmLabel);

    const dateLabel = new St.Label({
        text: 'Monday, Jan 1',
        x_align: Clutter.ActorAlign.CENTER,
    });

    textLayout.add_child(timeRow);
    textLayout.add_child(dateLabel);

    const timeElements = { timeRow, timeLabel, ampmLabel, dateLabel };

    const applyScale = (scale) => {
        const s = Math.max(0.65, scale);
        const scaled = (base) => Math.max(1, Math.round(base * s));

        timeLabel.style = `${fontCss}color: ${textColor}; font-weight: 300; font-size: ${scaled(BASE_TIME_FONT_SIZE)}px; margin-right: ${scaled(TIME_MARGIN_RIGHT_PX)}px;`;
        ampmLabel.style = `${fontCss}color: ${textColor}; font-size: ${scaled(BASE_AMPM_FONT_SIZE)}px; opacity: ${SECONDARY_OPACITY}; margin-bottom: ${scaled(AMPM_MARGIN_BOTTOM_PX)}px;`;
        dateLabel.style = `${fontCss}color: ${textColor}; font-size: ${scaled(BASE_DATE_FONT_SIZE)}px; opacity: ${SECONDARY_OPACITY}; margin-top: ${scaled(4)}px;`;
    };

    const state = { timerId: null };

    const updateDisplay = () => {
        if (isActorDestroyed(widgetNode)) return GLib.SOURCE_REMOVE;
        updateTimeAndDate(timeElements, resolveUse24h(widgetData));
        return GLib.SOURCE_CONTINUE;
    };

    applyScale(Math.min(width, height) / BASE_CONTAINER_SIZE);
    updateDisplay();
    startMinuteAlignedTimer(state, widgetNode, updateDisplay);
    connectTimerCleanup(widgetNode, state);

    attachResponsiveScaler(widgetNode, BASE_CONTAINER_SIZE, BASE_CONTAINER_SIZE, (scale) => {
        if (isActorDestroyed(widgetNode)) return;
        applyScale(scale);
    });

    if (widgetData.settings && typeof widgetData.settings.connect === 'function') {
        const changeId = widgetData.settings.connect('changed', () => {
            if (!isActorDestroyed(widgetNode)) {
                updateDisplay();
            }
        });
        registerWidgetCleanup(widgetNode, () => {
            try {
                widgetData.settings.disconnect(changeId);
            } catch (_e) {}
        });
    }

    return widgetNode;
}