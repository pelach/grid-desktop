import St from 'gi://St';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import { 
    parseCssColor, 
    resolveExplicitFontFamily, 
    resolveWidgetForegroundColor,
    getGridDesktopDataDir,
    loadJsonFromFileAsync,
    saveJsonToFile 
} from '../../utils/widgetUtils.js';
import { createWidgetContainer, attachResponsiveScaler, attachButtonFeedback } from '../../shell/widgetUIUtils.js';
import { isActorDestroyed } from '../../utils/actorLifecycle.js';

const BASE_CONTAINER_WIDTH_PX = 400;
const BASE_CONTAINER_HEIGHT_PX = 200;

const DAY_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const DEFAULT_PALETTE = ['#C2E7FF', '#A2C9C2', '#FFE082', '#D7AEFB', '#FFB4AB'];

const DEFAULT_HABITS = [
    { name: 'Code Daily', days: [true, true, true, true, true, false, false], color: '#C2E7FF' },
    { name: 'Hydrate (2L)', days: [true, true, true, true, false, false, false], color: '#A2C9C2' },
    { name: 'Read / Study', days: [true, true, false, true, false, false, false], color: '#FFE082' }
];

function calculateStreak(days) {
    const now = new Date();
    const jsDay = now.getDay();
    const todayIdx = (jsDay + 6) % 7;

    let streak = 0;
    let idx = todayIdx;

    if (!days[todayIdx]) {
        idx = todayIdx - 1;
    }

    while (idx >= 0 && days[idx]) {
        streak++;
        idx--;
    }

    return streak;
}

export function createHabitTrackerNode(config, width, height, xPosition, yPosition) {
    const dataDir = getGridDesktopDataDir('habits');
    const filePath = GLib.build_filenamev([dataDir, `${config.id || 'habits'}.json`]);

    let habits = JSON.parse(JSON.stringify(DEFAULT_HABITS));

    function saveHabits() {
        saveJsonToFile(filePath, habits);
    }

    const textColor = resolveWidgetForegroundColor(config);
    const fontFamily = resolveExplicitFontFamily(config);
    const fontCss = fontFamily ? `font-family: ${fontFamily}; ` : '';
    const container = createWidgetContainer(config, width, height, xPosition, yPosition);

    const textBytes = parseCssColor(textColor);
    const textRgb = () => `${Math.round(textBytes.r * 255)},${Math.round(textBytes.g * 255)},${Math.round(textBytes.b * 255)}`;

    let scale = Math.max(0.65, Math.min(width / BASE_CONTAINER_WIDTH_PX, height / BASE_CONTAINER_HEIGHT_PX));

    const state = {
        isAdding: false
    };

    const mainBox = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
    });
    container.add_child(mainBox);

    // ── 1. Egységes Fejléc ──
    const headerRow = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        y_align: Clutter.ActorAlign.CENTER,
        x_expand: true,
    });
    mainBox.add_child(headerRow);

    const headerIcon = new St.Icon({
        icon_name: 'checkbox-checked-symbolic',
        style: `color: ${textColor};`,
        y_align: Clutter.ActorAlign.CENTER,
    });
    headerRow.add_child(headerIcon);

    const titleLabel = new St.Label({
        text: 'Habit Tracker',
        y_align: Clutter.ActorAlign.CENTER,
    });
    titleLabel.clutter_text.ellipsize = 0; 
    headerRow.add_child(titleLabel);

    headerRow.add_child(new St.Widget({ x_expand: true }));

    const addButton = new St.Button({
        reactive: true,
        can_focus: true,
        y_align: Clutter.ActorAlign.CENTER,
        child: new St.Icon({ icon_name: 'list-add-symbolic' }),
    });
    attachButtonFeedback(addButton);
    headerRow.add_child(addButton);

    // ── INLINE INPUT MEZŐ ──
    const inlineInputBox = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        y_align: Clutter.ActorAlign.CENTER,
        visible: false,
    });
    mainBox.add_child(inlineInputBox);

    const entry = new St.Entry({
        hint_text: 'New habit...',
        can_focus: true,
        x_expand: true,
    });
    inlineInputBox.add_child(entry);

    const saveAddBtn = new St.Button({
        reactive: true,
        can_focus: true,
        child: new St.Icon({ icon_name: 'emblem-ok-symbolic' }),
    });
    attachButtonFeedback(saveAddBtn);
    inlineInputBox.add_child(saveAddBtn);

    const cancelAddBtn = new St.Button({
        reactive: true,
        can_focus: true,
        child: new St.Icon({ icon_name: 'window-close-symbolic' }),
    });
    attachButtonFeedback(cancelAddBtn);
    inlineInputBox.add_child(cancelAddBtn);

    // ── 2. Görgethető feladatlista ──
    const listScroll = new St.ScrollView({
        hscrollbar_policy: St.PolicyType.NEVER,
        vscrollbar_policy: St.PolicyType.AUTOMATIC,
        overlay_scrollbars: false,
        x_expand: true,
        y_expand: true,
    });
    const listContainer = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
    });
    listScroll.add_child(listContainer);
    mainBox.add_child(listScroll);

    function triggerAdd() {
        const text = entry.get_text().trim();
        if (text.length > 0) {
            const col = DEFAULT_PALETTE[habits.length % DEFAULT_PALETTE.length];
            habits.push({
                name: text,
                days: [false, false, false, false, false, false, false],
                color: col
            });
            saveHabits();
            renderRows();
        }
        entry.set_text('');
        state.isAdding = false;
        inlineInputBox.visible = false;
    }

    addButton.connect('clicked', () => {
        state.isAdding = !state.isAdding;
        inlineInputBox.visible = state.isAdding;
        if (state.isAdding) entry.grab_key_focus();
    });

    saveAddBtn.connect('clicked', triggerAdd);
    entry.clutter_text.connect('activate', triggerAdd);

    cancelAddBtn.connect('clicked', () => {
        state.isAdding = false;
        inlineInputBox.visible = false;
        entry.set_text('');
    });

    function renderRows() {
        listContainer.destroy_all_children();

        const cardPadding = Math.max(3, Math.round(5 * scale));
        const cardRadius = Math.max(6, Math.round(8 * scale));
        const rowGap = Math.max(3, Math.round(4 * scale));
        const rightScrollGap = Math.max(4, Math.round(6 * scale));
        const nameFontSize = Math.max(10, Math.round(12 * scale));
        const streakFontSize = Math.max(9, Math.round(10.5 * scale));
        const circleSize = Math.max(15, Math.round(16 * scale)); // 20 helyett finom 16px!
        const dayLabelFontSize = Math.max(8, Math.round(8.5 * scale));

        habits.forEach((habit, hIdx) => {
            const row = new St.BoxLayout({
                orientation: Clutter.Orientation.HORIZONTAL,
                y_align: Clutter.ActorAlign.CENTER,
                x_expand: true,
                style: `background-color: rgba(${textRgb()}, 0.06); `
                     + `padding: ${cardPadding}px 8px; `
                     + `border-radius: ${cardRadius}px; `
                     + `margin-bottom: ${rowGap}px; `
                     + `margin-right: ${rightScrollGap}px;`
            });

            // Név
            const nameLabel = new St.Label({
                text: habit.name,
                y_align: Clutter.ActorAlign.CENTER,
                x_expand: true,
                style: `${fontCss}font-size: ${nameFontSize}px; font-weight: 500; color: ${textColor};`
            });
            nameLabel.clutter_text.set_ellipsize(3);
            row.add_child(nameLabel);

            // Streak számláló
            const currentStreak = calculateStreak(habit.days);
            const streakPill = new St.Label({
                text: `${currentStreak}d`,
                y_align: Clutter.ActorAlign.CENTER,
                style: `${fontCss}font-size: ${streakFontSize}px; font-weight: bold; color: ${textColor}; `
                     + `background-color: rgba(${textRgb()}, 0.08); `
                     + `padding: 2px 7px; `
                     + `border-radius: 9999px; `
                     + `margin-right: ${Math.round(8 * scale)}px;`
            });
            row.add_child(streakPill);

            // 7 Nap körök
            const daysBox = new St.BoxLayout({
                orientation: Clutter.Orientation.HORIZONTAL,
                y_align: Clutter.ActorAlign.CENTER,
                style: `spacing: 2px; margin-right: 4px;`
            });

            habit.days.forEach((done, dIdx) => {
                const dayBtn = new St.Button({
                    reactive: true,
                    can_focus: true,
                    y_align: Clutter.ActorAlign.CENTER,
                });

                const dayLabel = new St.Label({
                    text: DAY_LABELS[dIdx],
                    y_align: Clutter.ActorAlign.CENTER,
                    x_align: Clutter.ActorAlign.CENTER,
                });
                dayBtn.set_child(dayLabel);

                function updateDayStyle() {
                    const isDone = habit.days[dIdx];
                    const bg = isDone ? habit.color : 'transparent';
                    const border = isDone ? habit.color : `rgba(${textRgb()}, 0.25)`;
                    const dayTextColor = isDone ? '#1E1E1E' : textColor;

                    dayBtn.style = `width: ${circleSize}px; height: ${circleSize}px; `
                        + `border-radius: 9999px; `
                        + `background-color: ${bg}; `
                        + `border: 1px solid ${border};`;

                    dayLabel.style = `${fontCss}font-size: ${dayLabelFontSize}px; font-weight: bold; `
                        + `color: ${dayTextColor}; `
                        + `text-align: center; width: ${circleSize}px;`;
                }

                updateDayStyle();

                dayBtn.connect('clicked', () => {
                    habit.days[dIdx] = !habit.days[dIdx];
                    updateDayStyle();
                    streakPill.text = `${calculateStreak(habit.days)}d`;
                    saveHabits();
                });

                attachButtonFeedback(dayBtn);
                daysBox.add_child(dayBtn);
            });

            row.add_child(daysBox);

            // Törlés gomb
            const removeBtn = new St.Button({
                reactive: true,
                can_focus: true,
                y_align: Clutter.ActorAlign.CENTER,
                style: `padding: 2px; border-radius: 9999px; opacity: 0.6;`,
                child: new St.Icon({
                    icon_name: 'window-close-symbolic',
                    icon_size: Math.max(10, Math.round(12 * scale))
                })
            });
            attachButtonFeedback(removeBtn);

            removeBtn.connect('clicked', () => {
                habits.splice(hIdx, 1);
                saveHabits();
                renderRows();
            });

            row.add_child(removeBtn);
            listContainer.add_child(row);
        });
    }

    function applyScale(newScale) {
        scale = newScale;

        const pad = Math.max(8, Math.round(10 * scale));
        const titleFontSize = Math.max(11, Math.round(13 * scale));
        const iconSize = Math.round(16 * scale);

        mainBox.style = `padding: ${pad}px;`;

        headerRow.style = `margin-bottom: ${Math.round(6 * scale)}px;`;
        headerIcon.icon_size = iconSize;
        headerIcon.style = `color: ${textColor}; margin-right: 6px;`;

        titleLabel.style = `${fontCss}font-size: ${titleFontSize}px; font-weight: bold; color: ${textColor}; opacity: 0.9;`;

        addButton.style = `border-radius: 9999px; background-color: rgba(${textRgb()}, 0.12); padding: 4px;`;
        if (addButton.child) addButton.child.icon_size = Math.max(12, Math.round(13 * scale));

        inlineInputBox.style = `spacing: ${Math.round(6 * scale)}px; margin-bottom: ${Math.round(6 * scale)}px;`;
        entry.style = `${fontCss}font-size: ${Math.max(10, Math.round(12 * scale))}px; padding: 4px 8px; border-radius: 6px;`;

        saveAddBtn.style = `border-radius: 9999px; background-color: rgba(${textRgb()}, 0.15); padding: 4px;`;
        if (saveAddBtn.child) saveAddBtn.child.icon_size = 12;

        cancelAddBtn.style = `border-radius: 9999px; background-color: rgba(${textRgb()}, 0.1); padding: 4px;`;
        if (cancelAddBtn.child) cancelAddBtn.child.icon_size = 12;

        renderRows();
    }

    applyScale(scale);

    loadJsonFromFileAsync(filePath, (data, error) => {
        if (isActorDestroyed(container)) return;
        if (Array.isArray(data) && data.length > 0) {
            habits = data;
            renderRows();
        }
    });

    attachResponsiveScaler(container, BASE_CONTAINER_WIDTH_PX, BASE_CONTAINER_HEIGHT_PX, (_ratio, w, h) => {
        if (isActorDestroyed(container)) return;
        applyScale(Math.max(0.65, Math.min(w / BASE_CONTAINER_WIDTH_PX, h / BASE_CONTAINER_HEIGHT_PX)));
    });

    return container;
}