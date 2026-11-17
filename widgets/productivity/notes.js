import St from 'gi://St';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import { getGridgetsDataDir, loadJsonFromFileAsync, resolveExplicitFontFamily, resolveWidgetForegroundColor, saveJsonToFile, saveJsonToFileSync } from '../../utils/widgetUtils.js';
import { createWidgetContainer, registerWidgetCleanup, scheduleDeferredUpdate, attachButtonFeedback, attachResponsiveScaler } from '../../shell/widgetUIUtils.js';
import { BUTTON_PRIMARY } from '../../desktopGrid/constants.js';
import { isActorDestroyed } from '../../utils/actorLifecycle.js';

const DEFAULT_NOTE_TEXT = 'Quick Note\n- [ ] Task 1\n- [x] Task 2\n\n**Click the pen icon to edit**';
const BASE_CONTAINER_WIDTH_PX = 200;
const BASE_CONTAINER_HEIGHT_PX = 200;

const MARKDOWN_RULES = [
    [/\*\*(.+?)\*\*/g, '<b>$1</b>'],
    [/\*(.+?)\*/g, '<i>$1</i>'],
    [/^- \[ \]/gm, '[ ] '],
    [/^- \[x\]/gm, '[x] '],
    [/^###\s*(.*$)/gm, '<span size="large" weight="bold">$1</span>'],
    [/^##\s*(.*$)/gm, '<span size="x-large" weight="bold">$1</span>'],
    [/^#\s*(.*$)/gm, '<span size="xx-large" weight="bold">$1</span>'],
];

function convertMarkdownToPango(text) {
    if (!text) return '';
    let escaped = GLib.markup_escape_text(text, -1);

    // Engedélyezett Pango tagek visszaállítása (pl. <u>, <b>, <i>, <s>, <span>)
    escaped = escaped
        .replace(/&lt;(\/?(?:b|i|u|s|tt|big|small|sub|sup))&gt;/gi, '<$1>')
        .replace(/&lt;span\b([^&]*)&gt;/gi, (_m, attrs) => `<span${attrs.replace(/&quot;/g, '"').replace(/&#39;/g, "'")}>`)
        .replace(/&lt;\/span&gt;/gi, '</span>');

    for (const [regex, replacement] of MARKDOWN_RULES) {
        escaped = escaped.replace(regex, replacement);
    }
    return escaped;
}

export function createNotesNode(config, width, height, xPosition, yPosition) {
    let rawFont = resolveExplicitFontFamily(config) || '';
    const cleanFontFamily = rawFont.replace(/['"]/g, '').split(',')[0].trim();
    const fontCss = cleanFontFamily ? `font-family: '${cleanFontFamily}'; ` : '';

    // Egyéni fontméret a prefs-ből:
    const userFontSize = config.fontSize || 13;

    const textColor = resolveWidgetForegroundColor(config);
    const container = createWidgetContainer(config, width, height, xPosition, yPosition);

    let scale = Math.max(0.65, Math.min(width / BASE_CONTAINER_WIDTH_PX, height / BASE_CONTAINER_HEIGHT_PX));

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
    });
    container.add_child(contentBox);

    const headerBox = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_expand: true,
        y_align: Clutter.ActorAlign.CENTER,
    });

    const headerIcon = new St.Icon({
        icon_name: 'note-symbolic',
        y_align: Clutter.ActorAlign.CENTER,
    });

    const titleLabel = new St.Label({
        text: 'Notes',
        style: `${fontCss}color: ${textColor}; opacity: 0.9;`,
        x_expand: true,
        y_align: Clutter.ActorAlign.CENTER,
    });

    const formatIcons = [];
    const formatBox = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        y_align: Clutter.ActorAlign.CENTER,
        visible: false,
    });

    const createFormatButton = (iconName, openTag, closeTag) => {
        const icon = new St.Icon({
            icon_name: iconName,
            style: `color: ${textColor}; opacity: 0.75;`,
        });
        formatIcons.push(icon);

        const btn = new St.Button({
            child: icon,
            can_focus: false,
            reactive: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        attachButtonFeedback(btn);

        btn.connect('button-press-event', (_actor, event) => {
            if (event.get_button() === BUTTON_PRIMARY && isEditingActive) {
                wrapSelection(openTag, closeTag);
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });

        return btn;
    };

    formatBox.add_child(createFormatButton('format-text-bold-symbolic', '**', '**'));
    formatBox.add_child(createFormatButton('format-text-italic-symbolic', '*', '*'));
    formatBox.add_child(createFormatButton('format-text-underline-symbolic', '<u>', '</u>'));

    const editIcon = new St.Icon({
        icon_name: 'document-edit-symbolic',
        style: `color: ${textColor}; opacity: 0.75;`,
    });

    const editButton = new St.Button({
        child: editIcon,
        can_focus: true,
        reactive: true,
        y_align: Clutter.ActorAlign.CENTER,
    });

    headerBox.add_child(headerIcon);
    headerBox.add_child(titleLabel);
    headerBox.add_child(formatBox);
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

        const step = vadj.step_increment || 24;
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

    const wrapSelection = (openTag, closeTag) => {
        const text = textEditor.text || '';
        const cursor = textEditor.cursor_position;
        const bound = textEditor.selection_bound;

        const start = Math.min(cursor, bound);
        const end = Math.max(cursor, bound);

        const before = text.slice(0, start);
        const selected = text.slice(start, end);
        const after = text.slice(end);

        textEditor.text = `${before}${openTag}${selected}${closeTag}${after}`;
        noteContent = textEditor.text;

        global.stage.set_key_focus(textEditor);

        const newPos = selected.length > 0
            ? start + openTag.length + selected.length + closeTag.length
            : start + openTag.length;

        textEditor.set_cursor_position(newPos);
        textEditor.set_selection_bound(newPos);
    };

    const showNoteViewer = () => {
        if (global.stage.get_key_focus() === textEditor) {
            global.stage.set_key_focus(null);
        }
        displayLabel.use_markup = true;
        displayLabel.text = convertMarkdownToPango(noteContent);
        if (scrollView.vadjustment) scrollView.vadjustment.value = 0;
        formatBox.hide();
        editorContainer.hide();
        displayLabel.show();
        editIcon.set_icon_name('document-edit-symbolic');
        isEditingActive = false;
    };

    const showNoteEditor = () => {
        textEditor.text = noteContent;
        displayLabel.hide();
        formatBox.show();
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

    function applyScale(newScale) {
        scale = newScale;

        const pad = Math.max(8, Math.round(10 * scale));
        const iconSize = Math.round(14 * scale);
        const titleFontSize = Math.max(10, Math.round(12 * scale));

        // Tartalom betűmérete: a felhasználó által beállított userFontSize szorozva a skálával
        const effectiveContentSize = Math.max(10, Math.round(userFontSize * scale));

        contentBox.style = `padding: ${pad}px;`;
        headerBox.style = `margin-bottom: ${Math.round(4 * scale)}px;`;
        headerIcon.icon_size = iconSize;
        headerIcon.style = `color: ${textColor}; margin-right: 5px; opacity: 0.85;`;
        titleLabel.style = `${fontCss}color: ${textColor}; font-size: ${titleFontSize}px; font-weight: bold; opacity: 0.9;`;

        editIcon.icon_size = iconSize;

        const fmtGap = Math.max(2, Math.round(4 * scale));
        formatBox.style = `margin-right: ${fmtGap}px; spacing: ${fmtGap}px;`;
        for (const icon of formatIcons) {
            icon.icon_size = iconSize;
        }

        const targetFontName = `${cleanFontFamily ? `${cleanFontFamily} ` : ''}${effectiveContentSize}px`;
        displayLabel.font_name = targetFontName;
        textEditor.font_name = targetFontName;
    }

    applyScale(scale);
    showNoteViewer();

    attachResponsiveScaler(container, BASE_CONTAINER_WIDTH_PX, BASE_CONTAINER_HEIGHT_PX, (_ratio, w, h) => {
        if (isActorDestroyed(container)) return;
        applyScale(Math.max(0.65, Math.min(w / BASE_CONTAINER_WIDTH_PX, h / BASE_CONTAINER_HEIGHT_PX)));
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