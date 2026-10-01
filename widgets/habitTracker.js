import St from 'gi://St';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import { 
    SECONDARY_OPACITY, 
    parseCssColor, 
    resolveExplicitFontFamily, 
    resolveWidgetForegroundColor,
    getGridDesktopDataDir,
    loadJsonFromFileAsync,
    saveJsonToFile 
} from '../utils/widgetUtils.js';
import { createWidgetContainer, attachResponsiveScaler, attachButtonFeedback, connectTimerCleanup, startPollingTimer } from '../shell/widgetUIUtils.js';
import { isActorDestroyed } from '../utils/actorLifecycle.js';

const REF_WIDTH_PX = 380;
const REF_HEIGHT_PX = 230;
const CONTAINER_PADDING_PX = 14;
const ROW_GAP_PX = 8;
const ROW_PADDING_PX = 8;
const ROW_RADIUS_PX = 14;
const CIRCLE_SIZE_PX = 22;
const BORDER_ALPHA = 0.14;

const DAY_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const DEFAULT_PALETTE = ['#C2E7FF', '#A2C9C2', '#FFE082', '#D7AEFB', '#FFB4AB'];

const DEFAULT_HABITS = [
    { name: 'Code Daily', streak: 18, days: [true, true, true, true, true, false, false], color: '#C2E7FF' },
    { name: 'Hydrate (2L)', streak: 12, days: [true, true, true, true, false, false, false], color: '#A2C9C2' },
    { name: 'Read / Study', streak: 7, days: [true, true, false, true, false, false, false], color: '#FFE082' }
];

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
    container.style += ` border: 1px solid rgba(${textRgb()}, ${BORDER_ALPHA});`;

    let scale = Math.min(width / REF_WIDTH_PX, height / REF_HEIGHT_PX);


    const state = {
        isAdding: false
    };

    const mainBox = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
    });
    container.add_child(mainBox);

    // --- FEJLÉC ---
    const headerRow = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        y_align: Clutter.ActorAlign.CENTER,
        x_expand: true,
    });
    mainBox.add_child(headerRow);

    const titleIcon = new St.Widget({
        y_align: Clutter.ActorAlign.CENTER,
    });
    headerRow.add_child(titleIcon);

    const titleLabel = new St.Label({
        text: 'HABIT TRACKER',
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

    // --- INLINE INPUT MEZŐ ---
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

    // --- LISTA KONTÉNER ---
    const listScroll = new St.ScrollView({
        hscrollbar_policy: St.PolicyType.NEVER,
        vscrollbar_policy: St.PolicyType.AUTOMATIC,
        overlay_scrollbars: true,
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
                streak: 1,
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
        const px = (v) => Math.max(1, Math.round(v * scale));

        habits.forEach((habit, hIdx) => {
            const row = new St.BoxLayout({
                orientation: Clutter.Orientation.HORIZONTAL,
                y_align: Clutter.ActorAlign.CENTER,
                x_expand: true,
                style: `background-color: rgba(${textRgb()}, 0.06); `
                     + `padding: ${px(ROW_PADDING_PX)}px; `
                     + `border-radius: ${px(ROW_RADIUS_PX)}px; `
                     + `margin-bottom: ${px(ROW_GAP_PX)}px;`
            });

            // Név
            const nameLabel = new St.Label({
                text: habit.name,
                y_align: Clutter.ActorAlign.CENTER,
                x_expand: true,
                style: `${fontCss}font-size: ${px(13)}px; font-weight: 500; color: ${textColor};`
            });
            row.add_child(nameLabel);

            // Streak számláló
            const streakPill = new St.Label({
                text: `${habit.streak || 0}d`,
                y_align: Clutter.ActorAlign.CENTER,
                style: `${fontCss}font-size: ${px(11)}px; font-weight: bold; color: ${textColor}; `
                     + `background-color: rgba(${textRgb()}, 0.08); `
                     + `padding: ${px(2)}px ${px(8)}px; `
                     + `border-radius: 9999px; `
                     + `margin-right: ${px(10)}px;`
            });
            row.add_child(streakPill);

            // 7 Nap körök
            const daysBox = new St.BoxLayout({
                orientation: Clutter.Orientation.HORIZONTAL,
                y_align: Clutter.ActorAlign.CENTER,
                style: `spacing: ${px(5)}px;`
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

                    dayBtn.style = `width: ${px(CIRCLE_SIZE_PX)}px; height: ${px(CIRCLE_SIZE_PX)}px; `
                        + `border-radius: 9999px; `
                        + `background-color: ${bg}; `
                        + `border: 1px solid ${border};`;

                    dayLabel.style = `${fontCss}font-size: ${px(10)}px; font-weight: bold; `
                        + `color: ${dayTextColor}; `
                        + `text-align: center; width: ${px(CIRCLE_SIZE_PX)}px;`;
                }

                updateDayStyle();

                dayBtn.connect('clicked', () => {
                    habit.days[dIdx] = !habit.days[dIdx];
                    updateDayStyle();
                    saveHabits();
                });

                attachButtonFeedback(dayBtn);
                daysBox.add_child(dayBtn);
            });

            row.add_child(daysBox);
            listContainer.add_child(row);
        });
    }

    function applyScale(newScale) {
        scale = newScale;
        const px = (v) => Math.max(1, Math.round(v * scale));

        mainBox.style = `padding: ${px(CONTAINER_PADDING_PX)}px; spacing: ${px(8)}px;`;

        titleIcon.style = `width: ${px(7)}px; height: ${px(7)}px; border-radius: 9999px; `
            + `background-color: #4ade80; margin-right: ${px(8)}px;`;

        titleLabel.style = `${fontCss}font-size: ${px(12)}px; font-weight: bold; `
            + `color: ${textColor}; opacity: ${SECONDARY_OPACITY}; letter-spacing: 0.5px;`;

        addButton.style = `border-radius: 9999px; background-color: rgba(${textRgb()}, 0.12); padding: ${px(4)}px;`;
        if (addButton.child) addButton.child.icon_size = px(13);

        inlineInputBox.style = `spacing: ${px(6)}px; margin-bottom: ${px(6)}px;`;
        entry.style = `${fontCss}font-size: ${px(12)}px; padding: ${px(4)}px ${px(8)}px; border-radius: ${px(6)}px;`;
        
        saveAddBtn.style = `border-radius: 9999px; background-color: rgba(${textRgb()}, 0.15); padding: ${px(4)}px;`;
        if (saveAddBtn.child) saveAddBtn.child.icon_size = px(12);

        cancelAddBtn.style = `border-radius: 9999px; background-color: rgba(${textRgb()}, 0.1); padding: ${px(4)}px;`;
        if (cancelAddBtn.child) cancelAddBtn.child.icon_size = px(12);

        renderRows();
    }

    applyScale(scale);

    // Adatok betöltése a fájlból
    loadJsonFromFileAsync(filePath, (data, error) => {
        if (isActorDestroyed(container)) return;
        if (Array.isArray(data) && data.length > 0) {
            habits = data;
            renderRows();
        }
    });
    attachResponsiveScaler(container, REF_WIDTH_PX, REF_HEIGHT_PX, (_ratio, w, h) => {
        if (isActorDestroyed(container)) return;
        applyScale(Math.min(w / REF_WIDTH_PX, h / REF_HEIGHT_PX));
    });

    return container;
}