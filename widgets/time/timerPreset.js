import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {
    resolveExplicitFontFamily,
    resolveWidgetForegroundColor,
    resolveWidgetBackgroundColor,
    cssColorToRgba,
    isDarkBackgroundColor,
} from '../../utils/widgetUtils.js';

import {
    createWidgetContainer,
    attachResponsiveScaler,
    attachButtonFeedback,
    registerWidgetCleanup,
} from '../../shell/widgetUIUtils.js';

import { BUTTON_PRIMARY } from '../../desktopGrid/constants.js';
import { isActorDestroyed } from '../../utils/actorLifecycle.js';

const BASE_CONTAINER_WIDTH = 400;
const BASE_CONTAINER_HEIGHT = 200;

const CARD_BG_DARK_ALPHA = 0.05;
const CARD_BG_LIGHT_ALPHA = 0.04;
const CARD_BORDER_DARK_ALPHA = 0.06;
const CARD_BORDER_LIGHT_ALPHA = 0.10;

export function createTimerPresetNode(config, width, height, xPosition, yPosition) {
    const fontFamily = resolveExplicitFontFamily(config);
    const fontCss = fontFamily ? `font-family: ${fontFamily}; ` : '';
    const tnumCss = `${fontCss}font-feature-settings: 'tnum'; `;
    const textColor = resolveWidgetForegroundColor(config);
    const accentHex = config.globalAccentColor || '#3584e4';
    const container = createWidgetContainer(config, width, height, xPosition, yPosition);

    const isDarkSurface = isDarkBackgroundColor(resolveWidgetBackgroundColor(config));
    const cardBgAlpha = isDarkSurface ? CARD_BG_DARK_ALPHA : CARD_BG_LIGHT_ALPHA;
    const cardBorderAlpha = isDarkSurface ? CARD_BORDER_DARK_ALPHA : CARD_BORDER_LIGHT_ALPHA;

    let scale = Math.max(0.65, Math.min(width / BASE_CONTAINER_WIDTH, height / BASE_CONTAINER_HEIGHT));

    const state = {
        selectedMinutes: 2,
        selectedSeconds: 50,
        remainingMs: 170000,
        isRunning: false,
        timerId: null,
        hasNotified: false,
    };

    const mainLayout = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_expand: true,
        y_expand: true,
    });
    container.set_child(mainLayout);

    // ── Bal oldal: Presets ──
    const leftBox = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
    });

    const presetHeader = new St.Label({ text: 'Presets' });
    leftBox.add_child(presetHeader);

    const scrollView = new St.ScrollView({
        hscrollbar_policy: St.PolicyType.NEVER,
        vscrollbar_policy: St.PolicyType.EXTERNAL,
        overlay_scrollbars: false,
        x_expand: true,
        y_expand: true,
    });
    leftBox.add_child(scrollView);

    const presetList = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
    });
    scrollView.set_child(presetList);

    const presets = [
        { label: '1 min', mins: 1, secs: 0 },
        { label: '2 min', mins: 2, secs: 0 },
        { label: '3 min', mins: 3, secs: 0 },
        { label: '5 min', mins: 5, secs: 0 },
        { label: '10 min', mins: 10, secs: 0 },
        { label: '15 min', mins: 15, secs: 0 },
    ];

    const presetButtons = [];
    const presetLabels = [];
    let messageSource = null;

    function getMessageSource() {
        if (!messageSource || messageSource.is_destroyed?.() || messageSource._disposed) {
            messageSource = new MessageTray.Source({
                title: 'Timer',
                iconName: 'alarm-symbolic',
            });
            messageSource.connect('destroy', () => {
                messageSource = null;
            });
            Main.messageTray.add(messageSource);
        }
        return messageSource;
    }

    function updatePresetHighlights() {
        const radius = Math.max(5, Math.round(8 * scale));
        const padV = Math.max(4, Math.round(6 * scale));
        const padH = Math.max(8, Math.round(12 * scale));
        const gap = Math.max(4, Math.round(6 * scale));
        const itemFontSize = Math.max(10, Math.round(13 * scale));

        presets.forEach((p, idx) => {
            const btn = presetButtons[idx];
            const lbl = presetLabels[idx];
            if (!btn) return;
            const isSelected = (state.selectedMinutes === p.mins && state.selectedSeconds === p.secs);
            const bg = isSelected ? cssColorToRgba(textColor, 0.18) : cssColorToRgba(textColor, cardBgAlpha);
            const border = isSelected ? cssColorToRgba(textColor, 0.35) : cssColorToRgba(textColor, cardBorderAlpha);
            const btnOpacity = state.isRunning ? 'opacity: 0.45; ' : 'opacity: 1.0; ';

            btn.style = `background-color: ${bg}; border: 1px solid ${border}; border-radius: ${radius}px; padding: ${padV}px ${padH}px; margin-bottom: ${gap}px; ${btnOpacity}`;
            if (lbl) {
                lbl.style = `${fontCss}color: ${textColor}; font-size: ${itemFontSize}px; font-weight: 500;`;
            }
        });
    }

    presets.forEach((preset) => {
        const btn = new St.Button({
            reactive: true,
            can_focus: true,
            x_expand: true,
        });

        const lbl = new St.Label({
            text: preset.label,
            y_align: Clutter.ActorAlign.CENTER,
            x_align: Clutter.ActorAlign.CENTER,
        });
        btn.set_child(lbl);

        btn.connect('clicked', () => {
            if (state.isRunning) return;
            state.selectedMinutes = preset.mins;
            state.selectedSeconds = preset.secs;
            state.remainingMs = (preset.mins * 60 + preset.secs) * 1000;
            updatePickerDisplay();
            updatePresetHighlights();
        });

        presetButtons.push(btn);
        presetLabels.push(lbl);
        presetList.add_child(btn);
    });

    mainLayout.add_child(leftBox);

    // ── Jobb oldal: Picker + Play gomb ──
    const rightBox = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
        x_expand: true,
    });

    const pickerRow = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
    });

    const minCol = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        reactive: true,
        x_align: Clutter.ActorAlign.CENTER,
    });
    const minUp = new St.Label({ text: '01', x_align: Clutter.ActorAlign.CENTER });
    const minMid = new St.Label({ text: '02', x_align: Clutter.ActorAlign.CENTER });
    const minDown = new St.Label({ text: '03', x_align: Clutter.ActorAlign.CENTER });
    minCol.add_child(minUp);
    minCol.add_child(minMid);
    minCol.add_child(minDown);

    const minLabel = new St.Label({
        text: 'min',
        y_align: Clutter.ActorAlign.CENTER,
    });

    const secCol = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        reactive: true,
        x_align: Clutter.ActorAlign.CENTER,
    });
    const secUp = new St.Label({ text: '49', x_align: Clutter.ActorAlign.CENTER });
    const secMid = new St.Label({ text: '50', x_align: Clutter.ActorAlign.CENTER });
    const secDown = new St.Label({ text: '51', x_align: Clutter.ActorAlign.CENTER });
    secCol.add_child(secUp);
    secCol.add_child(secMid);
    secCol.add_child(secDown);

    const secLabel = new St.Label({
        text: 'sec',
        y_align: Clutter.ActorAlign.CENTER,
    });

    pickerRow.add_child(minCol);
    pickerRow.add_child(minLabel);
    pickerRow.add_child(secCol);
    pickerRow.add_child(secLabel);
    rightBox.add_child(pickerRow);

    function handleScroll(actor, isMin) {
        actor.connect('scroll-event', (_a, event) => {
            if (state.isRunning) return Clutter.EVENT_PROPAGATE;
            const dir = event.get_scroll_direction();
            let delta = 0;
            if (dir === Clutter.ScrollDirection.UP) delta = -1;
            else if (dir === Clutter.ScrollDirection.DOWN) delta = 1;

            if (isMin) {
                state.selectedMinutes = Math.max(0, Math.min(99, state.selectedMinutes + delta));
            } else {
                state.selectedSeconds = (state.selectedSeconds + delta + 60) % 60;
            }
            state.remainingMs = (state.selectedMinutes * 60 + state.selectedSeconds) * 1000;
            updatePickerDisplay();
            updatePresetHighlights();
            return Clutter.EVENT_STOP;
        });
    }
    handleScroll(minCol, true);
    handleScroll(secCol, false);

    const playPauseBtn = new St.Button({
        reactive: true,
        can_focus: true,
        x_align: Clutter.ActorAlign.CENTER,
    });
    const playPauseIcon = new St.Icon({
        icon_name: 'media-playback-start-symbolic',
        style: `color: ${textColor};`,
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
    });
    playPauseBtn.set_child(playPauseIcon);
    attachButtonFeedback(playPauseBtn);
    rightBox.add_child(playPauseBtn);

    mainLayout.add_child(rightBox);

    function formatTwoDigits(n) {
        return String(n).padStart(2, '0');
    }

    function updatePickerDisplay() {
        const totalSecs = Math.ceil(state.remainingMs / 1000);
        const curM = Math.floor(totalSecs / 60);
        const curS = totalSecs % 60;

        minMid.set_text(formatTwoDigits(curM));
        minUp.set_text(formatTwoDigits(curM > 0 ? curM - 1 : 99));
        minDown.set_text(formatTwoDigits(curM < 99 ? curM + 1 : 0));

        secMid.set_text(formatTwoDigits(curS));
        secUp.set_text(formatTwoDigits((curS - 1 + 60) % 60));
        secDown.set_text(formatTwoDigits((curS + 1) % 60));
    }

    function stopTimer() {
        if (state.timerId) {
            GLib.source_remove(state.timerId);
            state.timerId = null;
        }
        state.isRunning = false;
        if (!isActorDestroyed(container)) {
            playPauseIcon.set_icon_name('media-playback-start-symbolic');
            updatePresetHighlights();
        }
    }

    function startTimer() {
        if (state.remainingMs <= 0) {
            state.remainingMs = (state.selectedMinutes * 60 + state.selectedSeconds) * 1000;
        }
        if (state.remainingMs <= 0) return;
        state.hasNotified = false;
        state.isRunning = true;
        playPauseIcon.set_icon_name('media-playback-pause-symbolic');
        updatePresetHighlights();

        const endTime = Date.now() + state.remainingMs;

        state.timerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
            if (isActorDestroyed(container)) {
                state.timerId = null;
                return GLib.SOURCE_REMOVE;
            }
            state.remainingMs = Math.max(0, endTime - Date.now());
            updatePickerDisplay();

            if (state.remainingMs <= 0) {
                stopTimer();
                if (!state.hasNotified) {
                    state.hasNotified = true;
                    try {
                        const src = getMessageSource();
                        const notification = new MessageTray.Notification({
                            source: src,
                            title: 'Timer',
                            body: 'The timer has expired!',
                            gicon: new Gio.ThemedIcon({ name: 'alarm-symbolic' }),
                            isTransient: false,
                        });
                        notification.urgency = MessageTray.Urgency.CRITICAL;
                        src.addNotification(notification);
                    } catch (_e) {}

                    try {
                        global.display.get_sound_player().play_from_theme(
                            'alarm-clock-elapsed',
                            'Timer',
                            null
                        );
                    } catch (_e) {}
                }
                return GLib.SOURCE_REMOVE;
            }
            return GLib.SOURCE_CONTINUE;
        });
    }

    function applyScale(newScale) {
        scale = newScale;
        const pad = Math.max(8, Math.round(12 * scale));
        const colW = Math.max(36, Math.round(50 * scale));
        const sideFont = Math.max(10, Math.round(13 * scale));
        const midFont = Math.max(18, Math.round(26 * scale));
        const unitFont = Math.max(9, Math.round(11 * scale));
        const btnSize = Math.max(32, Math.round(44 * scale));
        const iconSize = Math.max(14, Math.round(18 * scale));

        mainLayout.style = `padding: ${pad}px;`;
        leftBox.style = `margin-right: ${Math.round(14 * scale)}px;`;
        presetHeader.style = `${fontCss}color: ${textColor}; font-size: ${Math.max(10, Math.round(13 * scale))}px; font-weight: bold; opacity: 0.8; margin-bottom: ${Math.round(6 * scale)}px;`;

        pickerRow.style = `margin-bottom: ${Math.round(14 * scale)}px;`;
        minCol.width = colW;
        secCol.width = colW;

        const sideStyle = `${tnumCss}color: ${textColor}; opacity: 0.35; font-size: ${sideFont}px; text-align: center;`;
        const midStyle = `${tnumCss}color: ${textColor}; font-size: ${midFont}px; font-weight: bold; border-top: 1px solid ${cssColorToRgba(textColor, 0.25)}; border-bottom: 1px solid ${cssColorToRgba(textColor, 0.25)}; padding: 2px 0px; text-align: center;`;

        minUp.style = sideStyle;
        minMid.style = midStyle;
        minDown.style = sideStyle;

        secUp.style = sideStyle;
        secMid.style = midStyle;
        secDown.style = sideStyle;

        minLabel.style = `${fontCss}color: ${textColor}; font-size: ${unitFont}px; opacity: 0.6; margin: 0 ${Math.round(6 * scale)}px;`;
        secLabel.style = `${fontCss}color: ${textColor}; font-size: ${unitFont}px; opacity: 0.6; margin-left: ${Math.round(6 * scale)}px;`;

        playPauseBtn.style = `background-color: ${cssColorToRgba(accentHex, 0.25)}; border-radius: 99px; width: ${btnSize}px; height: ${btnSize}px;`;
        playPauseIcon.icon_size = iconSize;

        updatePresetHighlights();
    }

    playPauseBtn.connect('button-press-event', (_actor, event) => {
        if (event.get_button() !== BUTTON_PRIMARY || container.actionOverlay)
            return Clutter.EVENT_PROPAGATE;
        if (state.isRunning) stopTimer();
        else startTimer();
        return Clutter.EVENT_STOP;
    });

    registerWidgetCleanup(container, () => {
        stopTimer();
        messageSource = null;
    });

    applyScale(scale);
    updatePickerDisplay();

    attachResponsiveScaler(container, BASE_CONTAINER_WIDTH, BASE_CONTAINER_HEIGHT, (_ratio, w, h) => {
        if (isActorDestroyed(container)) return;
        applyScale(Math.max(0.65, Math.min(w / BASE_CONTAINER_WIDTH, h / BASE_CONTAINER_HEIGHT)));
    });

    return container;
}