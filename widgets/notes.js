import St from 'gi://St';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import { SECONDARY_OPACITY, cssColorToRgba, getGridgetsDataDir, loadJsonFromFileAsync, resolveExplicitFontFamily, resolveWidgetForegroundColor, saveJsonToFile, saveJsonToFileSync } from '../utils/widgetUtils.js';
import { createWidgetContainer, registerWidgetCleanup, scheduleDeferredUpdate, attachButtonFeedback, attachResponsiveScaler } from '../shell/widgetUIUtils.js';
import { BUTTON_PRIMARY } from '../desktopGrid/constants.js';
import { isActorDestroyed } from '../utils/actorLifecycle.js';

const DEFAULT_NOTE_TEXT = 'Quick Note\n- [ ] Task 1\n- [x] Task 2\n\n**Click the pen icon to edit**';
const BASE_TITLE_FONT_SIZE = 14;
const BASE_CONTENT_FONT_SIZE = 14;
const BASE_ICON_SIZE = 16;
const MIN_FONT_SIZE = 11;
const MIN_ICON_SIZE = 13;
const BORDER_ALPHA = 0.14;
const MARKDOWN_RULES = [
    [/\*\*(.*?)\*\*/g, '<b>$1</b>'],
    [/\*(.*?)\*/g, '<i>$1</i>'],
    [/^- \[ \]/gm, '[ ] '],
    [/^- \[x\]/gm, '[x] '],
    [/^### (.*$)/gm, '<span size="large" weight="bold">$1</span>'],
    [/^## (.*$)/gm, '<span size="x-large" weight="bold">$1</span>'],
    [/^# (.*$)/gm, '<span size="xx-large" weight="bold">$1</span>'],
];

const REF_WIDTH_PX = 240;
const REF_HEIGHT_PX = 160;

function convertMarkdownToPango(text) {
    if (!text) return '';
    let escaped = GLib.markup_escape_text(text, -1);
    for (const [regex, replacement] of MARKDOWN_RULES) {
        escaped = escaped.replace(regex, replacement);
    }
    return escaped;
}

export function createNotesNode(config, width, height, xPosition, yPosition) {
    const fontFamily = resolveExplicitFontFamily(config);
    const fontCss = fontFamily ? `font-family: ${fontFamily}; ` : '';
    const textColor = resolveWidgetForegroundColor(config);
    const container = createWidgetContainer(config, width, height, xPosition, yPosition);
    container.style += ` border: 1px solid ${cssColorToRgba(textColor, BORDER_ALPHA)};`;

    const baseDir = getGridgetsDataDir('notes');
    const notesFilePath = GLib.build_filenamev([
        baseDir,
        `notes-${config.id}.json`
    ]);

    let noteContent = DEFAULT_NOTE_TEXT;

    const contentBox = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
        style: 'padding: 12px;',
    });

    const headerBox = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        style: 'margin-bottom: 8px;',
    });

    const titleLabel = new St.Label({
        text: 'Quick Notes',
        style: `${fontCss}color: ${textColor}; opacity: ${SECONDARY_OPACITY};`,
        x_expand: true,
        y_align: Clutter.ActorAlign.CENTER,
    });

    const editIcon = new St.Icon({
        icon_name: 'document-edit-symbolic',
        style: `color: ${textColor}; opacity: 0.6;`,
    });

    const editButton = new St.Button({
        child: editIcon,
        can_focus: true,
        reactive: true,
        y_align: Clutter.ActorAlign.CENTER,
    });

    headerBox.add_child(titleLabel);
    headerBox.add_child(editButton);
    attachButtonFeedback(editButton);
    contentBox.add_child(headerBox);

    const scrollView = new St.ScrollView({
        x_expand: true,
        y_expand: true,
        reactive: true,
        clip_to_allocation: true,
    });
    scrollView.set_policy(St.PolicyType.NEVER, St.PolicyType.EXTERNAL);

    const scrollContent = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: false,
        reactive: true,
    });
    scrollView.set_child(scrollContent);
    contentBox.add_child(scrollView);

    const handleScroll = (_actor, event) => {
        const vadj = scrollView.vadjustment;
        if (!vadj) return Clutter.EVENT_PROPAGATE;

        const step = vadj.step_increment || 28;
        const direction = event.get_scroll_direction();

        if (direction === Clutter.ScrollDirection.UP) {
            vadj.value = Math.max(vadj.lower, vadj.value - step);
            return Clutter.EVENT_STOP;
        } else if (direction === Clutter.ScrollDirection.DOWN) {
            vadj.value = Math.min(vadj.upper - vadj.page_size, vadj.value + step);
            return Clutter.EVENT_STOP;
        } else if (direction === Clutter.ScrollDirection.SMOOTH) {
            const [, dy] = event.get_scroll_delta();
            vadj.value = Math.max(vadj.lower, Math.min(vadj.upper - vadj.page_size, vadj.value + dy * step));
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    };

    scrollView.connect('scroll-event', handleScroll);
    scrollContent.connect('scroll-event', handleScroll);

    
    const displayLabel = new Clutter.Text({
        font_name: fontFamily ? `${fontFamily} 14px` : '14px',
        editable: false,
        selectable: false,
        reactive: true,
        line_wrap: true,
        use_markup: true,
        x_expand: true,
    });
    scrollContent.connect('style-changed', () => {
        if (isActorDestroyed(container) || !scrollContent.get_stage()) return;
        displayLabel.set_color(scrollContent.get_theme_node().get_foreground_color());
    });
    displayLabel.connect('scroll-event', handleScroll);
    scrollContent.add_child(displayLabel);


    const editorContainer = new St.BoxLayout({
        style: `color: ${textColor};`,
        x_expand: true,
        clip_to_allocation: true,
    });

    let textEditor = new Clutter.Text({
        font_name: fontFamily ? `${fontFamily} 14px` : '14px',
        editable: true,
        selectable: true,
        reactive: true,
        line_wrap: true,
        x_expand: true,
    });
    editorContainer.connect('style-changed', () => {
        if (isActorDestroyed(container) || !editorContainer.get_stage()) return;
        textEditor.set_color(editorContainer.get_theme_node().get_foreground_color());
    });
    editorContainer.add_child(textEditor);
    scrollContent.add_child(editorContainer);

    let isEditingActive = false;
    const state = { deferredUpdateId: null };

    const showNoteViewer = () => {
        if (global.stage.get_key_focus() === textEditor) {
            global.stage.set_key_focus(null);
        }
        displayLabel.set_markup(convertMarkdownToPango(noteContent));
        if (scrollView.vadjustment) scrollView.vadjustment.value = 0;
        editorContainer.hide();
        displayLabel.show();
        editIcon.set_icon_name('document-edit-symbolic');
        isEditingActive = false;
    }

    const showNoteEditor = () => {
        textEditor.text = noteContent;
        displayLabel.hide();
        editorContainer.show();
        global.stage.set_key_focus(textEditor);
        editIcon.set_icon_name('object-select-symbolic');
        isEditingActive = true;
    };

    textEditor.connect('text-changed', () => {
        if (isEditingActive) {
            noteContent = textEditor.text;
            scheduleDeferredUpdate(state, 500, () => saveJsonToFile(notesFilePath, { notes: noteContent }));
        }
    });

    registerWidgetCleanup(container, () => {
        if (state.deferredUpdateId) {
            GLib.Source.remove(state.deferredUpdateId);
            state.deferredUpdateId = null;
        }
        if (isEditingActive) {
            noteContent = textEditor.text;
            saveJsonToFileSync(notesFilePath, { notes: noteContent });
            if (global.stage.get_key_focus() === textEditor) {
                global.stage.set_key_focus(null);
            }
        }
    });

    editButton.connect('button-press-event', (_actor, event) => {
        if (event.get_button() === BUTTON_PRIMARY) {
            if (isEditingActive) {
                noteContent = textEditor.text;
                showNoteViewer();
                saveJsonToFile(notesFilePath, { notes: noteContent });
            } else {
                showNoteEditor();
            }
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    });

    showNoteViewer();
    container.add_child(contentBox);

    function applyScale(scale) {
        const titleFontSize = Math.max(MIN_FONT_SIZE, Math.round(BASE_TITLE_FONT_SIZE * scale));
        const contentFontSize = Math.max(MIN_FONT_SIZE, Math.round(BASE_CONTENT_FONT_SIZE * scale));
        const iconSize = Math.max(MIN_ICON_SIZE, Math.round(BASE_ICON_SIZE * scale));

        titleLabel.set_style(`${fontCss}color: ${textColor}; font-size: ${titleFontSize}px; opacity: ${SECONDARY_OPACITY};`);
        editIcon.set_icon_size(iconSize);

        displayLabel.font_name = `${fontFamily ? `${fontFamily} ` : ''}${contentFontSize}px`;

        const currentText = textEditor.text;
        const wasEditing = isEditingActive;
        editorContainer.remove_child(textEditor);
        textEditor.destroy();
        const newEditor = new Clutter.Text({
            font_name: `${fontFamily ? `${fontFamily} ` : ''}${contentFontSize}px`,
            editable: true,
            selectable: true,
            reactive: true,
            line_wrap: true,
            x_expand: true,
        });
        editorContainer.add_child(newEditor);
        newEditor.text = currentText;
        if (editorContainer.get_stage()) {
            newEditor.set_color(editorContainer.get_theme_node().get_foreground_color());
        }
        newEditor.connect('text-changed', () => {
            if (isEditingActive) {
                noteContent = newEditor.text;
                scheduleDeferredUpdate(state, 500, () => saveJsonToFile(notesFilePath, { notes: noteContent }));
            }
        });
        textEditor = newEditor;
        if (wasEditing) {
            global.stage.set_key_focus(textEditor);
        }
    }

    applyScale(Math.min(width / REF_WIDTH_PX, height / REF_HEIGHT_PX));
    attachResponsiveScaler(container, REF_WIDTH_PX, REF_HEIGHT_PX, (_ratio, w, h) => {
        if (isActorDestroyed(container)) return;
        applyScale(Math.min(w / REF_WIDTH_PX, h / REF_HEIGHT_PX));
    });

    loadJsonFromFileAsync(notesFilePath, (savedData, loadError) => {
        if (isActorDestroyed(container)) return;
        if (savedData && savedData.notes !== undefined) {
            noteContent = savedData.notes;
            if (!isEditingActive) {
                showNoteViewer();
            }
        } else if (!loadError) {
            saveJsonToFile(notesFilePath, { notes: noteContent });
        }
    });

    return container;
}