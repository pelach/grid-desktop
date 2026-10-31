import St from 'gi://St';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import { SECONDARY_OPACITY, parseCssColor, resolveExplicitFontFamily, resolveWidgetForegroundColor } from '../../utils/widgetUtils.js';
import { createWidgetContainer, attachResponsiveScaler, attachButtonFeedback, connectTimerCleanup, startPollingTimer } from '../../shell/widgetUIUtils.js';
import { isActorDestroyed } from '../../utils/actorLifecycle.js';
import { todayDateString, toDateString, loadDatesAsync, getMood, saveMood } from '../../utils/moodStore.js';

const BASE_CONTAINER_WIDTH_PX = 400;
const BASE_CONTAINER_HEIGHT_PX = 200;

const PANEL_GAP_PX = 14;
const LEFT_COLUMN_WIDTH_PX = 150;

const GREETING_FONT_SIZE_PX = 14;
const DATE_FONT_SIZE_PX = 11;
const HISTORY_LABEL_FONT_SIZE_PX = 11;
const PICKER_ROW_PADDING_PX = 4;
const PICKER_ROW_RADIUS_PX = 10;
const FACE_ICON_SIZE_PX = 19;
const DOT_SIZE_PX = 14;
const DOT_GRID_GAP_PX = 7;
const GRID_COLUMNS = 7;
const TODAY_DOT_BORDER_PX = 2;

const MOOD_LEVELS = [
    { level: 1, iconName: 'face-sad-symbolic', color: '#F43F5E' },
    { level: 2, iconName: 'face-worried-symbolic', color: '#F97316' },
    { level: 3, iconName: 'face-plain-symbolic', color: '#EAB308' },
    { level: 4, iconName: 'face-smile-symbolic', color: '#22C55E' },
    { level: 5, iconName: 'face-laugh-symbolic', color: '#3B82F6' },
];

function buildCurrentMonthCalendar() {
    const now = GLib.DateTime.new_now_local();
    const year = now.get_year();
    const month = now.get_month();

    const firstDay = GLib.DateTime.new_local(year, month, 1, 0, 0, 0);
    const startOffset = (firstDay.get_day_of_week() + 6) % 7;

    const nextMonth = month === 12 
        ? GLib.DateTime.new_local(year + 1, 1, 1, 0, 0, 0)
        : GLib.DateTime.new_local(year, month + 1, 1, 0, 0, 0);
    const daysInMonth = nextMonth.add_days(-1).get_day_of_month();

    const cells = [];
    for (let i = 0; i < startOffset; i++) {
        cells.push(null);
    }

    for (let day = 1; day <= daysInMonth; day++) {
        const dt = GLib.DateTime.new_local(year, month, day, 0, 0, 0);
        cells.push(toDateString(dt));
    }

    return {
        monthName: now.format('%B'),
        cells: cells,
        dateKeys: cells.filter(c => c !== null)
    };
}

function greetingForHour(hour) {
    if (hour < 5) return 'Good night';
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
}

function formatDisplayDate(dateTime) {
    return `${dateTime.format('%a')}, ${dateTime.format('%b')} ${dateTime.get_day_of_month()}`;
}

export function createMoodNode(config, width, height, xPosition, yPosition) {
    const textColor = resolveWidgetForegroundColor(config);
    const fontFamily = resolveExplicitFontFamily(config);
    const fontCss = fontFamily ? `font-family: ${fontFamily}; ` : '';
    const container = createWidgetContainer(config, width, height, xPosition, yPosition);

    const textBytes = parseCssColor(textColor);
    const textRgb = () => `${Math.round(textBytes.r * 255)},${Math.round(textBytes.g * 255)},${Math.round(textBytes.b * 255)}`;

    let scale = Math.max(0.65, Math.min(width / BASE_CONTAINER_WIDTH_PX, height / BASE_CONTAINER_HEIGHT_PX));

    const calData = buildCurrentMonthCalendar();
    const state = { 
        monthName: calData.monthName,
        cells: calData.cells,
        dateKeys: calData.dateKeys,
        moodButtons: [] 
    };

    const mainBox = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
    });
    container.add_child(mainBox);

    // ── 1. Szabványos Fejléc ──
    const headerRow = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        y_align: Clutter.ActorAlign.CENTER,
        x_expand: true,
    });
    mainBox.add_child(headerRow);

    const headerIcon = new St.Icon({
        icon_name: 'face-smile-symbolic',
        style: `color: ${textColor};`,
        y_align: Clutter.ActorAlign.CENTER,
    });
    headerRow.add_child(headerIcon);

    const titleLabel = new St.Label({
        text: 'Mood',
        y_align: Clutter.ActorAlign.CENTER,
    });
    titleLabel.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
    headerRow.add_child(titleLabel);

    // ── 2. Tartalmi blokk ──
    const contentBox = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_expand: true,
        y_expand: true,
    });
    mainBox.add_child(contentBox);

    // Bal oldali panel: Köszöntés + Smiley választó
    const actionPanel = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: false,
    });
    contentBox.add_child(actionPanel);

    const greetingLabel = new St.Label({
        text: greetingForHour(GLib.DateTime.new_now_local().get_hour()),
    });

    const dateLabel = new St.Label({
        text: formatDisplayDate(GLib.DateTime.new_now_local()),
    });
    actionPanel.add_child(greetingLabel);
    actionPanel.add_child(dateLabel);
    actionPanel.add_child(new St.Widget({ y_expand: true }));

    const faceRow = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_align: Clutter.ActorAlign.FILL,
    });
    actionPanel.add_child(faceRow);

    for (const mood of MOOD_LEVELS) {
        const button = new St.Button({
            reactive: true,
            can_focus: true,
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
            child: new St.Icon({ icon_name: mood.iconName, icon_size: FACE_ICON_SIZE_PX }),
        });
        button.moodLevel = mood.level;
        button.connect('clicked', () => setMood(mood.level));
        faceRow.add_child(button);
        attachButtonFeedback(button);
        state.moodButtons.push(button);
    }

    // Jobb oldali panel: Hónap neve + Naptári pöttyök
    const historyPanel = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.START,
    });
    contentBox.add_child(historyPanel);

    const historyLabel = new St.Label({ text: state.monthName });
    historyPanel.add_child(historyLabel);

    const dotGrid = new St.Widget({
        layout_manager: new Clutter.GridLayout({
            column_spacing: DOT_GRID_GAP_PX,
            row_spacing: DOT_GRID_GAP_PX,
        }),
    });
    historyPanel.add_child(dotGrid);

    function applyScale(newScale) {
        scale = newScale;
        const px = (v) => Math.max(1, Math.round(v * scale));

        const currentGridGap = Math.max(3, Math.round(DOT_GRID_GAP_PX * scale));
        dotGrid.layout_manager.column_spacing = currentGridGap;
        dotGrid.layout_manager.row_spacing = currentGridGap;
        
        const pad = Math.max(8, Math.round(10 * scale));
        const titleFontSize = Math.max(11, Math.round(13 * scale));
        const iconSize = Math.round(16 * scale);

        mainBox.style = `padding: ${pad}px;`;

        headerRow.style = `margin-bottom: ${Math.round(6 * scale)}px;`;
        headerIcon.icon_size = iconSize;
        headerIcon.style = `color: ${textColor}; margin-right: 6px;`;
        titleLabel.style = `${fontCss}font-size: ${titleFontSize}px; font-weight: bold; color: ${textColor}; opacity: 0.9;`;

        contentBox.style = `spacing: ${px(PANEL_GAP_PX)}px;`;
        actionPanel.style = `width: ${px(LEFT_COLUMN_WIDTH_PX)}px; spacing: 2px;`;
        historyPanel.style = `margin-top: ${px(2)}px;`;

        greetingLabel.style = `${fontCss}font-size: ${px(GREETING_FONT_SIZE_PX)}px; font-weight: 500; color: ${textColor};`;
        dateLabel.style = `${fontCss}font-size: ${px(DATE_FONT_SIZE_PX)}px; color: ${textColor}; opacity: ${SECONDARY_OPACITY};`;

        faceRow.style = `background-color: rgba(${textRgb()}, 0.08); padding: ${px(PICKER_ROW_PADDING_PX)}px; border-radius: ${px(PICKER_ROW_RADIUS_PX)}px;`;

        for (const button of state.moodButtons) {
            const level = MOOD_LEVELS.find(mood => mood.level === button.moodLevel);
            const isActive = getMood(todayDateString()) === level.level;
            applyButtonStyle(button, level, isActive, px(FACE_ICON_SIZE_PX));
        }

        historyLabel.style = `${fontCss}font-size: ${px(HISTORY_LABEL_FONT_SIZE_PX)}px; color: ${textColor}; opacity: ${SECONDARY_OPACITY}; margin-bottom: ${px(4)}px;`;

        renderDotGrid();
    }

    function applyButtonStyle(button, level, isActive, iconSizePx) {
        button.child.icon_size = iconSizePx;
        button.child.opacity = isActive ? 255 : 120;
        button.style = isActive
            ? `border-radius: 9999px; background-color: rgba(${textRgb()}, 0.14);`
            : 'border-radius: 9999px;';
    }

    function buildDot(dateKey) {
        const px = (v) => Math.max(1, Math.round(v * scale));
        const size = px(DOT_SIZE_PX);

        if (!dateKey) {
            return new St.Widget({
                width: size,
                height: size,
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
            });
        }

        const isToday = dateKey === todayDateString();
        const level = getMood(dateKey);
        const finalSize = isToday ? px(DOT_SIZE_PX + TODAY_DOT_BORDER_PX) : size;

        const dot = new St.Widget({
            width: finalSize,
            height: finalSize,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });

        let dotStyle = `border-radius: 9999px; width: ${finalSize}px; height: ${finalSize}px;`;
        if (level > 0) {
            const mood = MOOD_LEVELS.find(entry => entry.level === level);
            dotStyle += `background-color: ${mood.color};`;
        } else {
            dotStyle += `background-color: rgba(${textRgb()}, 0.15);`;
        }
        if (isToday) {
            dotStyle += `border: ${px(TODAY_DOT_BORDER_PX)}px solid ${textColor};`;
        }
        dot.style = dotStyle;
        return dot;
    }

    function renderDotGrid() {
        const layout = dotGrid.layout_manager;
        dotGrid.destroy_all_children();

        state.cells.forEach((dateKey, index) => {
            const column = index % GRID_COLUMNS;
            const row = Math.floor(index / GRID_COLUMNS);
            layout.attach(buildDot(dateKey), column, row, 1, 1);
        });
    }

    function refreshClockDependents() {
        const now = GLib.DateTime.new_now_local();
        greetingLabel.text = greetingForHour(now.get_hour());
        dateLabel.text = formatDisplayDate(now);

        const currentMonthName = now.format('%B');
        if (state.monthName !== currentMonthName) {
            const updated = buildCurrentMonthCalendar();
            state.monthName = updated.monthName;
            state.cells = updated.cells;
            state.dateKeys = updated.dateKeys;
            historyLabel.text = state.monthName;

            loadDatesAsync(state.dateKeys, () => {
                if (isActorDestroyed(container)) return;
                renderDotGrid();
                applyTodayButtonStates();
            });
        }
    }

    function applyTodayButtonStates() {
        const todayLevel = getMood(todayDateString());
        for (const button of state.moodButtons) {
            const mood = MOOD_LEVELS.find(entry => entry.level === button.moodLevel);
            applyButtonStyle(button, mood, mood.level === todayLevel, Math.max(1, Math.round(FACE_ICON_SIZE_PX * scale)));
        }
    }

    function setMood(level) {
        const todayKey = todayDateString();
        saveMood(todayKey, level);

        for (const button of state.moodButtons) {
            const mood = MOOD_LEVELS.find(entry => entry.level === button.moodLevel);
            applyButtonStyle(button, mood, mood.level === level, Math.max(1, Math.round(FACE_ICON_SIZE_PX * scale)));
        }
        renderDotGrid();
    }

    const MINUTE_REFRESH_INTERVAL_MS = 60000;
    startPollingTimer(refreshClockDependents, MINUTE_REFRESH_INTERVAL_MS, state);
    connectTimerCleanup(container, state);

    applyScale(scale);
    loadDatesAsync(state.dateKeys, () => {
        if (isActorDestroyed(container)) return;
        renderDotGrid();
        const todayLevel = getMood(todayDateString());
        if (todayLevel > 0) {
            setMood(todayLevel);
        }
    });

    attachResponsiveScaler(container, BASE_CONTAINER_WIDTH_PX, BASE_CONTAINER_HEIGHT_PX, (_ratio, w, h) => {
        if (isActorDestroyed(container)) return;
        applyScale(Math.max(0.65, Math.min(w / BASE_CONTAINER_WIDTH_PX, h / BASE_CONTAINER_HEIGHT_PX)));
    });

    return container;
}