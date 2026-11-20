import St from 'gi://St';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import { WidgetActor } from '../shell/widgetUIUtils.js';
import { watchActorLifecycle } from '../utils/actorLifecycle.js';
import { launchFileUri, renameDesktopIcon } from '../desktopGrid/contextMenu.js';
import { updateDesktopIconUri } from '../utils/desktopIcons.js';

export const TAG_COLORS = {
    Red: '#ff3b30',
    Orange: '#ff9500',
    Yellow: '#ffcc00',
    Green: '#34c759',
    Blue: '#007aff',
    Purple: '#af52de',
    Gray: '#8e8e93',
};

function readFileTags(uri) {
    if (!uri || !uri.startsWith('file://'))
        return [];

    const file = Gio.File.new_for_uri(uri);
    if (!file.query_exists(null))
        return [];

    const info = file.query_info('xattr::user.xdg.tags', Gio.FileQueryInfoFlags.NONE, null);
    const raw = info.get_attribute_string('xattr::user.xdg.tags');
    if (!raw)
        return [];

    return raw.split(',').map(t => t.trim()).filter(t => t in TAG_COLORS);
}

export function createDesktopIconNode(data, w, h, x, y) {
    const rootContainer = new WidgetActor();
    rootContainer.style_class = 'gridgets-widget desktop-icon-widget';
    rootContainer.style = 'background-color: transparent; border: none; box-shadow: none;';
    rootContainer.x = x || 0;
    rootContainer.y = y || 0;
    rootContainer.width = w;
    rootContainer.height = h;
    rootContainer.clip_to_allocation = false;
    rootContainer.reactive = true;
    rootContainer.can_focus = true;

    if (typeof rootContainer.set_layout_manager === 'function') {
        rootContainer.set_layout_manager(new Clutter.BinLayout());
    } else {
        rootContainer.layout_manager = new Clutter.BinLayout();
    }

    const box = new St.BoxLayout();
    if (typeof Clutter.Orientation !== 'undefined') {
        box.set_orientation(Clutter.Orientation.VERTICAL);
    } else {
        box.vertical = true;
    }

    box.x_expand = true;
    box.y_expand = true;
    box.x_align = Clutter.ActorAlign.CENTER;
    box.y_align = Clutter.ActorAlign.START;
    box.reactive = false;

    const baseCell = Math.min(w, h);
    const iconSize = data.showLabel
        ? Math.round(baseCell * 0.55)
        : Math.round(baseCell * 0.75);

    const gicon = Gio.Icon.new_for_string(data.icon || 'text-x-generic');

    const icon = new St.Icon({
        gicon: gicon,
        icon_size: iconSize,
        reactive: false,
    });
    box.add_child(icon);

    // Színes címke pöttyök sora + fájlnév egy sorban (macOS stílus)
    const labelRow = new St.BoxLayout({
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
        style: 'margin-top: 2px;',
        reactive: false,
    });

    const dotsBox = new St.BoxLayout({
        y_align: Clutter.ActorAlign.CENTER,
        style: 'spacing: 3px; margin-right: 4px;',
        reactive: false,
    });
    labelRow.add_child(dotsBox);

    const fontSize = baseCell <= 68 ? 10 : (baseCell <= 80 ? 11 : 12);
    const label = new St.Label({
        text: data.name || '',
        style_class: 'desktop-icon-label',
        style: `font-size: ${fontSize}px; font-weight: 500; color: #ffffff; text-align: center; text-shadow: 0 1px 2px rgba(0, 0, 0, 0.85); max-width: ${w + 8}px;`,
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
        reactive: false,
    });

    label.clutter_text.set_line_wrap(true);
    label.clutter_text.set_line_wrap_mode(Pango.WrapMode.WORD_CHAR);
    label.clutter_text.set_ellipsize(Pango.EllipsizeMode.END);
    label.clutter_text.set_line_alignment(Pango.Alignment.CENTER);

    labelRow.add_child(label);
    labelRow.visible = Boolean(data.showLabel);
    box.add_child(labelRow);

    rootContainer.add_child(box);

    // 1. CÍMKE PÖTTYÖK FRISSÍTÉSE
    rootContainer.refreshTags = () => {
        dotsBox.destroy_all_children();
        const tags = readFileTags(data.uri);
        const hasTags = tags.length > 0;
        dotsBox.visible = hasTags;
        dotsBox.style = hasTags ? 'spacing: 3px; margin-right: 4px;' : 'spacing: 0; margin-right: 0;';

        for (const tagName of tags) {
            const dot = new St.Widget({
                width: 8,
                height: 8,
                style: `background-color: ${TAG_COLORS[tagName]}; border-radius: 99px; border: 1px solid rgba(0, 0, 0, 0.45);`,
                reactive: false,
            });
            dotsBox.add_child(dot);
        }
    };
    rootContainer.refreshTags();

    // 2. INLINE ÁTNEVEZÉS (macOS stílus)
    let activeEntry = null;
    let entrySignals = [];

    const finishRename = (saveChanges) => {
        if (!activeEntry)
            return;

        const entry = activeEntry;
        activeEntry = null;

        for (const item of entrySignals) {
            item.target.disconnect(item.id);
        }
        entrySignals = [];

        const newText = entry.get_text().trim();
        entry.clutter_text.editable = false;

        labelRow.visible = Boolean(data.showLabel);
        if (global.stage.get_key_focus() === entry.clutter_text || global.stage.get_key_focus() === entry) {
            rootContainer.grab_key_focus();
        }

        box.remove_child(entry);
        entry.destroy();

        if (!saveChanges || !newText || newText === data.name)
            return;

        const isDesktopEntry = Boolean(data.uri && data.uri.endsWith('.desktop'));
        const oldUri = data.uri;
        data.name = newText;
        label.set_text(newText);

        renameDesktopIcon(oldUri, newText, isDesktopEntry, (newUri) => {
            data.uri = newUri;
            if (data.settings) {
                updateDesktopIconUri(data.settings, oldUri, newUri, newText);
            }
        });
    };

    rootContainer.startRename = () => {
        if (activeEntry)
            return;
        
        labelRow.visible = false;

        const isDesktopEntry = Boolean(data.uri && data.uri.endsWith('.desktop'));
        const file = Gio.File.new_for_uri(data.uri);
        // .desktop fájlnál a megjelenített Name=-t szerkesztjük, sima fájlnál a fájlnevet
        const currentName = isDesktopEntry ? (data.name || '') : (file.get_basename() || data.name || '');

        const entry = new St.Entry({
            text: currentName,
            style: `font-size: ${fontSize}px; color: #ffffff; background-color: rgba(30, 30, 35, 0.92); border: 1px solid #3584e4; border-radius: 5px; padding: 2px 5px; margin-top: 2px;`,
            width: w + 24,
            x_align: Clutter.ActorAlign.CENTER,
            can_focus: true,
            reactive: true,
        });

        activeEntry = entry;
        box.add_child(entry);

        const clutterText = entry.clutter_text;
        clutterText.editable = false;
        const activateId = clutterText.connect('activate', () => finishRename(true));
        const keyPressId = clutterText.connect('key-press-event', (_actor, event) => {
            if (event.get_key_symbol() === Clutter.KEY_Escape) {
                finishRename(false);
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });

        entrySignals = [
            { target: clutterText, id: activateId },
            { target: clutterText, id: keyPressId },
        ];

        // Kijelölés a kiterjesztés nélkül (csak sima fájloknál)
        let selEnd = currentName.length;
        if (!isDesktopEntry) {
            const dotIdx = currentName.lastIndexOf('.');
            if (dotIdx > 0)
                selEnd = dotIdx;
        }

        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 60, () => {
            if (activeEntry !== entry)
                return GLib.SOURCE_REMOVE;

            clutterText.editable = true;
            entry.grab_key_focus();

            const focusOutId = clutterText.connect('key-focus-out', () => finishRename(true));
            entrySignals.push({ target: clutterText, id: focusOutId });

            GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                if (activeEntry === entry && clutterText.has_key_focus()) {
                    clutterText.set_selection(0, selEnd);
                }
                return GLib.SOURCE_REMOVE;
            });

            return GLib.SOURCE_REMOVE;
        });
    };

    let lastClickTime = 0;
    const pressId = rootContainer.connect('button-press-event', (actor, event) => {
        if (activeEntry)
            return Clutter.EVENT_STOP;

        if (event.get_button() === 1) {
            const currentTime = Date.now();
            if (currentTime - lastClickTime < 400) {
                lastClickTime = 0;
                launchFileUri(data.uri);
                return Clutter.EVENT_STOP;
            }
            lastClickTime = currentTime;
        }
        return Clutter.EVENT_PROPAGATE;
    });

    rootContainer.registerCleanup(() => {
        if (pressId)
            rootContainer.disconnect(pressId);
        if (activeEntry) {
            for (const item of entrySignals) {
                item.target.disconnect(item.id);
            }
            activeEntry = null;
        }
    });

    return watchActorLifecycle(rootContainer);
}

