import St from 'gi://St';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import { 
    parseCssColor, 
    resolveExplicitFontFamily, 
    resolveWidgetForegroundColor,
    getGridDesktopDataDir,
    loadJsonFromFileAsync,
    saveJsonToFile,
    saveJsonToFileSync
} from '../../utils/widgetUtils.js';
import { createWidgetContainer, registerWidgetCleanup, attachResponsiveScaler, attachButtonFeedback } from '../../shell/widgetUIUtils.js';
import { isActorDestroyed } from '../../utils/actorLifecycle.js';

const BASE_CONTAINER_WIDTH = 200;
const BASE_CONTAINER_HEIGHT = 200;

const DEFAULT_TASKS = [
    { text: 'Workout', done: true },
    { text: 'Study', done: false },
    { text: 'Eyedrops', done: true },
];

export function createTodoNode(config, width, height, xPosition, yPosition) {
    const fontFamily = resolveExplicitFontFamily(config);
    const fontCss = fontFamily ? `font-family: ${fontFamily}; ` : '';
    const textColor = resolveWidgetForegroundColor(config);
    const container = createWidgetContainer(config, width, height, xPosition, yPosition);

    const textBytes = parseCssColor(textColor);
    const textRgb = () => `${Math.round(textBytes.r * 255)},${Math.round(textBytes.g * 255)},${Math.round(textBytes.b * 255)}`;

    const dataDir = getGridDesktopDataDir('todos');
    const filePath = GLib.build_filenamev([dataDir, `todo-${config.id || 'default'}.json`]);

    let tasks = DEFAULT_TASKS.map(task => ({ ...task }));
    let scale = Math.max(0.65, Math.min(width / BASE_CONTAINER_WIDTH, height / BASE_CONTAINER_HEIGHT));
    let tasksLoaded = false;

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
        text: 'To-Do',
        y_align: Clutter.ActorAlign.CENTER,
    });
    titleLabel.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
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

    // ── INLINE HOZZÁADÁS SOR ──
    const inlineInputBox = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        y_align: Clutter.ActorAlign.CENTER,
        visible: false,
    });
    mainBox.add_child(inlineInputBox);

    const entry = new St.Entry({
        hint_text: 'New task…',
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

    const saveTasks = () => saveJsonToFile(filePath, { tasks });

    function triggerAdd() {
        const text = entry.get_text().trim();
        if (text.length > 0) {
            tasks.push({ text, done: false });
            saveTasks();
            renderRows();
        }
        entry.set_text('');
        state.isAdding = false;
        inlineInputBox.visible = false;
        if (global.stage.get_key_focus() === entry) {
            global.stage.set_key_focus(null);
        }
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
        if (global.stage.get_key_focus() === entry) {
            global.stage.set_key_focus(null);
        }
    });

    entry.clutter_text.connect('key-press-event', (_actor, event) => {
        const symbol = event.get_key_symbol();
        if (symbol === Clutter.KEY_Escape) {
            state.isAdding = false;
            inlineInputBox.visible = false;
            entry.set_text('');
            global.stage.set_key_focus(null);
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    });

    function renderRows() {
        listContainer.destroy_all_children();

        const cardPadding = Math.max(5, Math.round(6 * scale));
        const cardRadius = Math.max(6, Math.round(9 * scale));
        const rowGap = Math.max(4, Math.round(5 * scale));
        const rightScrollGap = Math.max(6, Math.round(8 * scale));
        const itemFontSize = Math.max(11, Math.round(13 * scale));
        const checkSize = Math.max(15, Math.round(16 * scale));

        if (tasks.length === 0) {
            const emptyLabel = new St.Label({
                text: 'No tasks yet',
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
                style: `${fontCss}font-size: ${itemFontSize}px; color: ${textColor}; opacity: 0.5; margin-top: ${Math.round(20 * scale)}px;`,
            });
            listContainer.add_child(emptyLabel);
            return;
        }

        tasks.forEach((task, idx) => {
            const cardBg = task.done ? `rgba(${textRgb()}, 0.04)` : `rgba(${textRgb()}, 0.08)`;
            const borderCol = task.done ? `rgba(${textRgb()}, 0.06)` : `rgba(${textRgb()}, 0.16)`;

            const row = new St.BoxLayout({
                orientation: Clutter.Orientation.HORIZONTAL,
                y_align: Clutter.ActorAlign.CENTER,
                x_expand: true,
                style: `background-color: ${cardBg}; `
                     + `border: 1px solid ${borderCol}; `
                     + `padding: ${cardPadding}px; `
                     + `border-radius: ${cardRadius}px; `
                     + `margin-bottom: ${rowGap}px; `
                     + `margin-right: ${rightScrollGap}px;`
            });

            // Kör alakú checkbox
            const checkBtn = new St.Button({
                reactive: true,
                can_focus: true,
                y_align: Clutter.ActorAlign.CENTER,
                style: `width: ${checkSize}px; height: ${checkSize}px; `
                     + `border-radius: 9999px; `
                     + `background-color: transparent; `
                     + `border: 1.5px solid rgba(${textRgb()}, ${task.done ? '0.35' : '0.65'}); `
                     + `margin-right: ${Math.round(8 * scale)}px;`
            });

            if (task.done) {
                checkBtn.set_child(new St.Icon({
                    icon_name: 'emblem-ok-symbolic',
                    icon_size: Math.max(9, Math.round(10 * scale)),
                    style: `color: ${textColor}; opacity: 0.6;`
                }));
            }

            checkBtn.connect('clicked', () => {
                if (isActorDestroyed(container)) return;
                task.done = !task.done;
                saveTasks();
                renderRows();
            });
            attachButtonFeedback(checkBtn);
            row.add_child(checkBtn);

            // Szöveg formázása
            const escapedText = GLib.markup_escape_text(task.text || '', -1);
            const textMarkup = task.done ? `<s>${escapedText}</s>` : escapedText;

            const textLabel = new St.Label({
                x_expand: true,
                y_align: Clutter.ActorAlign.CENTER,
                style: `${fontCss}font-size: ${itemFontSize}px; `
                     + `color: ${textColor}; opacity: ${task.done ? 0.45 : 0.95}; `
                     + `font-weight: ${task.done ? 'normal' : '500'};`
            });
            textLabel.clutter_text.use_markup = true;
            textLabel.clutter_text.ellipsize = Pango.EllipsizeMode.END;
            textLabel.clutter_text.set_markup(textMarkup);
            row.add_child(textLabel);

            // Törlés gomb
            const deleteBtn = new St.Button({
                reactive: true,
                can_focus: true,
                y_align: Clutter.ActorAlign.CENTER,
                style: `padding: 2px; border-radius: 9999px; opacity: 0.4;`,
                child: new St.Icon({
                    icon_name: 'window-close-symbolic',
                    icon_size: Math.max(11, Math.round(12 * scale))
                })
            });
            deleteBtn.connect('clicked', () => {
                if (isActorDestroyed(container)) return;
                tasks.splice(idx, 1);
                saveTasks();
                renderRows();
            });
            attachButtonFeedback(deleteBtn);
            row.add_child(deleteBtn);

            listContainer.add_child(row);
        });
    }

    function applyScale(newScale) {
        scale = newScale;
        const titleFontSize = Math.max(11, Math.round(13 * scale));
        const iconSize = Math.round(16 * scale);

        // Nincs felesleges spacing a mainBox-on, pont úgy mint az audioOutput.js-ben:
        mainBox.style = `padding: ${Math.max(8, Math.round(10 * scale))}px;`;

        headerRow.style = `margin-bottom: ${Math.round(6 * scale)}px;`;
        headerIcon.icon_size = iconSize;
        headerIcon.style = `color: ${textColor}; margin-right: 6px;`;

        titleLabel.style = `${fontCss}font-size: ${titleFontSize}px; font-weight: bold; `
            + `color: ${textColor}; opacity: 0.9;`;

        addButton.style = `border-radius: 9999px; background-color: rgba(${textRgb()}, 0.12); padding: ${Math.max(3, Math.round(4 * scale))}px;`;
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

    registerWidgetCleanup(container, () => {
        if (tasksLoaded)
            saveJsonToFileSync(filePath, { tasks });
        if (global.stage.get_key_focus() === entry)
            global.stage.set_key_focus(null);
    });

    attachResponsiveScaler(container, BASE_CONTAINER_WIDTH, BASE_CONTAINER_HEIGHT, (_ratio, w, h) => {
        if (isActorDestroyed(container)) return;
        applyScale(Math.max(0.65, Math.min(w / BASE_CONTAINER_WIDTH, h / BASE_CONTAINER_HEIGHT)));
    });

    loadJsonFromFileAsync(filePath, (savedData, loadError) => {
        if (isActorDestroyed(container)) return;
        tasksLoaded = true;
        if (savedData && Array.isArray(savedData.tasks)) {
            tasks = savedData.tasks.filter(t => t && typeof t.text === 'string')
                .map(t => ({ text: t.text, done: !!t.done }));
            renderRows();
        } else if (!loadError) {
            saveTasks();
        }
    });

    return container;
}