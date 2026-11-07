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
    attachButtonFeedback 
} from '../../shell/widgetUIUtils.js';

import { BUTTON_PRIMARY } from '../../desktopGrid/constants.js';

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
        style: 'padding: 12px;',
    });
    container.set_child(mainLayout);

    // ==========================================
    // BAL OLDAL: PRESETS (REJTETT GÖRDÍTŐSÁVVAPAL)
    // ==========================================
    const leftBox = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
        style: 'margin-right: 14px;',
    });

    const presetHeader = new St.Label({
        text: 'Presets',
        style: `${fontCss}color: ${textColor}; font-size: 13px; font-weight: bold; opacity: 0.8; margin-bottom: 6px;`,
    });
    leftBox.add_child(presetHeader);

    // St.PolicyType.EXTERNAL elrejti a vizuális sávot, de a görgethetőség megmarad
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
        presets.forEach((p, idx) => {
            const btn = presetButtons[idx];
            if (!btn) return;
            const isSelected = (state.selectedMinutes === p.mins && state.selectedSeconds === p.secs);
            const bg = isSelected ? cssColorToRgba(textColor, 0.18) : cssColorToRgba(textColor, cardBgAlpha);
            const border = isSelected ? cssColorToRgba(textColor, 0.35) : cssColorToRgba(textColor, cardBorderAlpha);
            const btnOpacity = state.isRunning ? 'opacity: 0.45; ' : 'opacity: 1.0; ';
            
            btn.style = `background-color: ${bg}; border: 1px solid ${border}; border-radius: 8px; padding: 6px 12px; margin-bottom: 6px; ${btnOpacity}`;
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
            style: `${fontCss}color: ${textColor}; font-size: 13px; font-weight: 500;`,
            y_align: Clutter.ActorAlign.CENTER,
            x_align: Clutter.ActorAlign.CENTER,
        });
        btn.set_child(lbl);

        btn.connect('clicked', () => {
            // Futás közben tiltva: csak álló helyzetben választható preset
            if (state.isRunning) return;

            state.selectedMinutes = preset.mins;
            state.selectedSeconds = preset.secs;
            state.remainingMs = (preset.mins * 60 + preset.secs) * 1000;
            updatePickerDisplay();
            updatePresetHighlights();
        });

        presetButtons.push(btn);
        presetList.add_child(btn);
    });

    mainLayout.add_child(leftBox);

    // ==========================================
    // JOBB OLDAL: FIX SZÉLESSÉGŰ PICKER + PLAY GOMB
    // ==========================================
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
        style: 'margin-bottom: 14px;',
    });

    const DIGIT_COL_WIDTH = 50;

    // Perc oszlop
    const minCol = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        reactive: true,
        width: DIGIT_COL_WIDTH,
        x_align: Clutter.ActorAlign.CENTER,
    });
    const minUp = new St.Label({ text: '01', x_align: Clutter.ActorAlign.CENTER, style: `${tnumCss}color: ${textColor}; opacity: 0.35; font-size: 13px; text-align: center;` });
    const minMid = new St.Label({ text: '02', x_align: Clutter.ActorAlign.CENTER, style: `${tnumCss}color: ${textColor}; font-size: 26px; font-weight: bold; border-top: 1px solid ${cssColorToRgba(textColor, 0.25)}; border-bottom: 1px solid ${cssColorToRgba(textColor, 0.25)}; padding: 2px 0px; text-align: center;` });
    const minDown = new St.Label({ text: '03', x_align: Clutter.ActorAlign.CENTER, style: `${tnumCss}color: ${textColor}; opacity: 0.35; font-size: 13px; text-align: center;` });
    minCol.add_child(minUp);
    minCol.add_child(minMid);
    minCol.add_child(minDown);

    const minLabel = new St.Label({
        text: 'min',
        y_align: Clutter.ActorAlign.CENTER,
        style: `${fontCss}color: ${textColor}; font-size: 11px; opacity: 0.6; margin: 0 6px;`,
    });

    // Másodperc oszlop
    const secCol = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        reactive: true,
        width: DIGIT_COL_WIDTH,
        x_align: Clutter.ActorAlign.CENTER,
    });
    const secUp = new St.Label({ text: '49', x_align: Clutter.ActorAlign.CENTER, style: `${tnumCss}color: ${textColor}; opacity: 0.35; font-size: 13px; text-align: center;` });
    const secMid = new St.Label({ text: '50', x_align: Clutter.ActorAlign.CENTER, style: `${tnumCss}color: ${textColor}; font-size: 26px; font-weight: bold; border-top: 1px solid ${cssColorToRgba(textColor, 0.25)}; border-bottom: 1px solid ${cssColorToRgba(textColor, 0.25)}; padding: 2px 0px; text-align: center;` });
    const secDown = new St.Label({ text: '51', x_align: Clutter.ActorAlign.CENTER, style: `${tnumCss}color: ${textColor}; opacity: 0.35; font-size: 13px; text-align: center;` });
    secCol.add_child(secUp);
    secCol.add_child(secMid);
    secCol.add_child(secDown);

    const secLabel = new St.Label({
        text: 'sec',
        y_align: Clutter.ActorAlign.CENTER,
        style: `${fontCss}color: ${textColor}; font-size: 11px; opacity: 0.6; margin-left: 6px;`,
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
        style: `background-color: ${cssColorToRgba(accentHex, 0.25)}; border-radius: 99px; width: 44px; height: 44px;`,
    });
    const playPauseIcon = new St.Icon({
        icon_name: 'media-playback-start-symbolic',
        icon_size: 18,
        style: `color: ${textColor};`,
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
    });
    playPauseBtn.set_child(playPauseIcon);
    attachButtonFeedback(playPauseBtn);
    rightBox.add_child(playPauseBtn);

    mainLayout.add_child(rightBox);

    // ==========================================
    // LOGIKA & FRISSÍTÉS
    // ==========================================
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
        playPauseIcon.set_icon_name('media-playback-start-symbolic');
        updatePresetHighlights();
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
                    } catch (e) {}

                    try {
                        global.display.get_sound_player().play_from_theme(
                            'alarm-clock-elapsed',
                            'Timer',
                            null
                        );
                    } catch (e) {}
                }
                return GLib.SOURCE_REMOVE;
            }
            return GLib.SOURCE_CONTINUE;
        });
    }

    playPauseBtn.connect('button-press-event', (_actor, event) => {
        if (event.get_button() !== BUTTON_PRIMARY || container.actionOverlay)
            return Clutter.EVENT_PROPAGATE;
        if (state.isRunning) stopTimer();
        else startTimer();
        return Clutter.EVENT_STOP;
    });

    container.connect('destroy', () => {
        stopTimer();
        messageSource = null;
    });

    updatePickerDisplay();
    updatePresetHighlights();

    attachResponsiveScaler(container, BASE_CONTAINER_WIDTH, BASE_CONTAINER_HEIGHT, (_ratio, w, h) => {
        scale = Math.max(0.65, Math.min(w / BASE_CONTAINER_WIDTH, h / BASE_CONTAINER_HEIGHT));
    });

    return container;
}