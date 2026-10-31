import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';

import { 
    resolveWidgetForegroundColor, 
    resolveExplicitFontFamily, 
    parseCssColor,
    todayDateString,
    loadJsonFromFileAsync,
    saveJsonToFile,
    saveJsonToFileSync,
    getGridDesktopDataDir,
} from '../../utils/widgetUtils.js';
import { 
    createWidgetContainer, 
    connectTimerCleanup, 
    attachResponsiveScaler,
    attachButtonFeedback,
    drawCircularArc
} from '../../shell/widgetUIUtils.js';

const WATERMIND_ARC_LINE_WIDTH_RATIO = 0.06;
const BASE_CONTAINER_SIZE = 200;
const BASE_ARC_MARGIN = 20;
const BASE_ARC_MIN_SIZE = 80;
const WORK_SHIFT_HOURS = 8;

export function createWatermindNode(config, width, height, xPosition, yPosition) {
    const fontFamily = resolveExplicitFontFamily(config);
    const fontCss = fontFamily ? `font-family: ${fontFamily}; ` : '';
    const textColor = resolveWidgetForegroundColor(config);
    const accentHex = config.globalAccentColor || '#3584e4';

    const extensionPath = Gio.File.new_for_uri(import.meta.url).get_parent().get_parent().get_path();
    const iconPath = GLib.build_filenamev([extensionPath, 'assets', 'icons', 'watermind-symbolic.svg']);
    const waterIcon = new Gio.FileIcon({ file: Gio.File.new_for_path(iconPath) });

    const container = createWidgetContainer(config, width, height, xPosition, yPosition);

    const hourlyTargetMl = config.hourlyTargetMl || 250;
    const totalDailyTargetMl = WORK_SHIFT_HOURS * hourlyTargetMl;
    const intervalMinutes = config.intervalMinutes || 60;
    const intervalMs = intervalMinutes * 60 * 1000;
    const btnValues = [
        config.btn1Ml || 200,
        config.btn2Ml || 500,
        config.btn3Ml || 750
    ];

    const state = {
        timerId: null,
        totalConsumedToday: 0,
        lastDrinkTime: Date.now(),
        sessionStartTime: Date.now(),
        lastDay: todayDateString(),
        hasNotified: false,
        previewAmountMl: 0,
    };

    const baseDir = getGridDesktopDataDir('watermind');
    const dataFilePath = GLib.build_filenamev([
        baseDir,
        `watermind-${config.id}.json`
    ]);

    function loadWidgetState() {
        loadJsonFromFileAsync(dataFilePath, (savedData) => {
            if (savedData && savedData.lastDay === state.lastDay) {
                state.totalConsumedToday = savedData.totalConsumedToday || 0;
                state.lastDrinkTime = savedData.lastDrinkTime || Date.now();
                state.sessionStartTime = savedData.sessionStartTime || Date.now();
            }
            updateUI();
        });
    }

    function persistWidgetState() {
        saveJsonToFile(dataFilePath, {
            lastDay: state.lastDay,
            totalConsumedToday: state.totalConsumedToday,
            lastDrinkTime: state.lastDrinkTime,
            sessionStartTime: state.sessionStartTime,
        });
    }

    loadWidgetState();

    let scale = Math.min(width, height) / BASE_CONTAINER_SIZE;
    let arcMargin = Math.round(BASE_ARC_MARGIN * scale);
    let arcSize = Math.max(BASE_ARC_MIN_SIZE, Math.min(width, height) - arcMargin);

    let titleFontSize = Math.max(10, Math.round(12 * scale));
    let mainFontSize = Math.max(18, Math.round(24 * scale));
    let subFontSize = Math.max(9, Math.round(11 * scale));
    let btnFontSize = Math.max(9, Math.round(10 * scale));

    let messageSource = null;
    let activeNotification = null;

    function getMessageSource() {
        if (!messageSource || messageSource.is_destroyed?.() || messageSource._disposed) {
            messageSource = new MessageTray.Source({
                title: 'Watermind',
                icon: waterIcon, 
            });
            messageSource.connect('destroy', () => {
                messageSource = null;
            });
            Main.messageTray.add(messageSource);
        }
        return messageSource;
    }

    function sendReminderNotification() {
        try {
            const src = getMessageSource();
            // Itt NEM const, hanem a külső let változónak adjuk értékül:
            activeNotification = new MessageTray.Notification({
                source: src,
                title: 'Watermind',
                body: `Time to drink a glass of water! (${hourlyTargetMl} ml/hour recommended)`,
                gicon: waterIcon, // <--- A felugró értesítésen is a saját ikon jelenik meg
                isTransient: false,
            });
            src.addNotification(activeNotification);
        } catch (e) {
            console.error('Watermind notify error:', e);
        }

        try {
            global.display.get_sound_player().play_from_theme('message-new-instant', 'Watermind', null);
        } catch (e) {}
    }

    const canvasActor = new St.DrawingArea({
        width: arcSize,
        height: arcSize,
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
    });

    canvasActor.connect('repaint', (area) => {
        const ctx = area.get_context();
        const [w, h] = area.get_surface_size();
        if (w === 0 || h === 0) return;

        const now = Date.now();
        const currentDrinkProgress = Math.min(1, state.totalConsumedToday / totalDailyTargetMl);
        const elapsedSessionHours = Math.max(0, (now - state.sessionStartTime) / (1000 * 3600));
        const expectedProgress = Math.min(1, elapsedSessionHours / WORK_SHIFT_HOURS);

        // 1. Alap körív és kék progress rajzolása a szabványos függvénnyel (pont mint a timer/pomodoro)
        drawCircularArc(ctx, w, h, currentDrinkProgress, accentHex, WATERMIND_ARC_LINE_WIDTH_RATIO);

        // 2. A drawCircularArc belső sugarának és vonalvastagságának pontos értékei:
        const xc = w / 2;
        const yc = h / 2;
        const lineWidth = Math.max(2, Math.min(w, h) * WATERMIND_ARC_LINE_WIDTH_RATIO);
        const radius = (Math.min(w, h) - lineWidth) / 2;

        // 3. Hover előnézeti ív (ha van)
        if (state.previewAmountMl > 0) {
            const nextProgress = Math.min(1, (state.totalConsumedToday + state.previewAmountMl) / totalDailyTargetMl);
            if (nextProgress > currentDrinkProgress) {
                const startAng = -Math.PI / 2 + (currentDrinkProgress * 2 * Math.PI);
                const endAng = -Math.PI / 2 + (nextProgress * 2 * Math.PI);
                const { r, g, b } = parseCssColor(accentHex);
                ctx.setSourceRGBA(r, g, b, 0.35);
                ctx.setLineWidth(lineWidth);
                ctx.setLineCap(1);
                ctx.arc(xc, yc, radius, startAng, endAng);
                ctx.stroke();
            }
        }

        // 4. Fehér marker vonal (időarányosan elvárt szint) pontosan az ív vastagságában
        if (expectedProgress > 0 && expectedProgress <= 1) {
            const markerAngle = -Math.PI / 2 + (expectedProgress * 2 * Math.PI);
            const markerInnerR = radius - (lineWidth * 0.55);
            const markerOuterR = radius + (lineWidth * 0.55);

            const x1 = xc + markerInnerR * Math.cos(markerAngle);
            const y1 = yc + markerInnerR * Math.sin(markerAngle);
            const x2 = xc + markerOuterR * Math.cos(markerAngle);
            const y2 = yc + markerOuterR * Math.sin(markerAngle);

            ctx.setLineWidth(Math.max(2, lineWidth * 0.35));
            ctx.setSourceRGBA(1, 1, 1, 0.95);
            ctx.setLineCap(1);
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.stroke();
        }

        ctx.$dispose();
    });

    const labelsBox = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
        x_expand: true,
        y_expand: true,
        reactive: true,
    });

    const titleLabel = new St.Label({
        text: 'Watermind',
        x_align: Clutter.ActorAlign.CENTER,
        style: `${fontCss}color: ${textColor}; font-size: ${titleFontSize}px; opacity: 0.55; margin-bottom: 2px;`,
    });

    const consumedLabel = new St.Label({
        text: '0 ml',
        x_align: Clutter.ActorAlign.CENTER,
        style: `${fontCss}color: ${textColor}; font-size: ${mainFontSize}px; font-weight: 300;`,
    });

    const timerLabel = new St.Label({
        text: '--:--',
        x_align: Clutter.ActorAlign.CENTER,
        style: `${fontCss}color: ${textColor}; font-size: ${subFontSize}px; opacity: 0.55; margin-top: 1px;`,
    });

    // 3 kapcsoló gomb sora a körön BELÜL
    const controlsRow = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_align: Clutter.ActorAlign.CENTER,
        style: `margin-top: ${Math.round(6 * scale)}px; spacing: ${Math.max(2, Math.round(4 * scale))}px;`,
    });

    const buttons = [];

    btnValues.forEach((ml) => {
        const btn = new St.Button({
            label: `${ml}`,
            style_class: 'button',
            reactive: true,
            can_focus: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });

        btn.connect('notify::hover', () => {
            state.previewAmountMl = btn.hover ? ml : 0;
            canvasActor.queue_repaint();
        });

        btn.connect('clicked', () => {
            if (activeNotification) {
                activeNotification.destroy();
                activeNotification = null;
            }
            state.totalConsumedToday += ml;
            state.lastDrinkTime = Date.now();
            state.hasNotified = false;
            state.previewAmountMl = 0;
            persistWidgetState();
            updateUI();
        });

        attachButtonFeedback(btn);
        buttons.push(btn);
        controlsRow.add_child(btn);
    });

    labelsBox.add_child(titleLabel);
    labelsBox.add_child(consumedLabel);
    labelsBox.add_child(timerLabel);
    labelsBox.add_child(controlsRow);

    // Dupla / Jobb klikk tesztelési nullázás a feliratokra
    consumedLabel.reactive = true;
    consumedLabel.connect('button-press-event', (_actor, event) => {
        if (event.get_button() === 3 || event.get_click_count() === 2) {
            state.totalConsumedToday = 0;
            state.lastDrinkTime = Date.now();
            state.sessionStartTime = Date.now();
            state.hasNotified = false;
            state.previewAmountMl = 0;
            persistWidgetState();
            updateUI();
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    });

    const contentStack = new Clutter.Actor({
        layout_manager: new Clutter.BinLayout(),
        x_expand: true,
        y_expand: true,
    });

    contentStack.add_child(canvasActor);
    contentStack.add_child(labelsBox);
    container.set_child(contentStack);

    function updateUI() {
        const now = Date.now();
        const currentDay = todayDateString();

        if (state.lastDay !== currentDay) {
            state.lastDay = currentDay;
            state.totalConsumedToday = 0;
            state.sessionStartTime = now;
            state.lastDrinkTime = now;
            state.hasNotified = false;
            persistWidgetState();
        }

        consumedLabel.set_text(`${state.totalConsumedToday} ml`);

        const elapsedSinceDrink = Math.max(0, now - state.lastDrinkTime);
        const remainingMs = Math.max(0, intervalMs - elapsedSinceDrink);

        if (remainingMs <= 0) {
            timerLabel.set_text('Time to drink!');
            if (!state.hasNotified) {
                state.hasNotified = true;
                sendReminderNotification();
            }
        } else {
            const remSec = Math.floor(remainingMs / 1000);
            const m = Math.floor(remSec / 60);
            const s = remSec % 60;
            timerLabel.set_text(`${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`);
        }

        canvasActor.queue_repaint();
    }

    state.timerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
        updateUI();
        return GLib.SOURCE_CONTINUE;
    });

    connectTimerCleanup(container, state);

    container.connect('destroy', () => {
        saveJsonToFileSync(dataFilePath, {
            lastDay: state.lastDay,
            totalConsumedToday: state.totalConsumedToday,
            lastDrinkTime: state.lastDrinkTime,
            sessionStartTime: state.sessionStartTime,
        });

        if (messageSource) {
            try {
                messageSource.destroy();
            } catch (_e) {}
            messageSource = null;
        }
    });

    function applyScale(newScale) {
        scale = newScale;
        arcMargin = Math.round(BASE_ARC_MARGIN * scale);
        arcSize = Math.max(BASE_ARC_MIN_SIZE, Math.min(container.width, container.height) - arcMargin);

        // Pontosan a fájl tetején lévő finomított arányok:
        titleFontSize = Math.max(10, Math.round(12 * scale));
        mainFontSize = Math.max(18, Math.round(24 * scale));
        subFontSize = Math.max(9, Math.round(11 * scale));
        btnFontSize = Math.max(9, Math.round(10 * scale));

        canvasActor.set_size(arcSize, arcSize);
        canvasActor.queue_repaint();

        titleLabel.style = `${fontCss}color: ${textColor}; font-size: ${titleFontSize}px; opacity: 0.55; margin-bottom: 2px;`;
        consumedLabel.style = `${fontCss}color: ${textColor}; font-size: ${mainFontSize}px; font-weight: 300;`;
        timerLabel.style = `${fontCss}color: ${textColor}; font-size: ${subFontSize}px; opacity: 0.55; margin-top: 1px;`;

        const btnPadY = Math.max(1, Math.round(2 * scale));
        const btnPadX = Math.max(2, Math.round(5 * scale));
        controlsRow.style = `margin-top: ${Math.round(5 * scale)}px; spacing: ${Math.max(2, Math.round(4 * scale))}px;`;

        buttons.forEach((btn) => {
            btn.style = `${fontCss}padding: ${btnPadY}px ${btnPadX}px; font-size: ${btnFontSize}px; min-width: 0px; min-height: 0px; border-radius: 99px;`;
        });
    }

    attachResponsiveScaler(container, BASE_CONTAINER_SIZE, BASE_CONTAINER_SIZE, (_ratio, w, h) => {
        applyScale(Math.max(0.65, Math.min(w, h) / BASE_CONTAINER_SIZE));
    });

    updateUI();
    return container;
}