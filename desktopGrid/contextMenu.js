import St from 'gi://St';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as BoxPointer from 'resource:///org/gnome/shell/ui/boxpointer.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import { toggleWidgetResizeHandle } from './widgetEditUtils.js';
import { onWidgetResized, onWidgetDeleted } from './dragDrop.js';
import { COLUMNS_COUNT, ROWS_COUNT, getWidgets, supportsSizePresets, SIZE_PRESET_TIERS } from '../utils/widgetUtils.js';

export function createPopupMenuAt(grid, event) {
    if (grid._contextMenuCloseIdleId) {
        GLib.Source.remove(grid._contextMenuCloseIdleId);
        grid._contextMenuCloseIdleId = null;
    }
    if (grid.contextMenu) {
        removeContextMenu(grid);
    }

    const [stageX, stageY] = event.get_coords();
    
    // 1. A dummyActor-t a grid-hez adjuk hozzá, ne a uiGroup-hoz, és legyen explicit mérete
    const dummyActor = new St.Widget({
        reactive: false,
        can_focus: false,
        track_hover: false,
        x: Math.round(stageX),
        y: Math.round(stageY),
        width: 1,
        height: 1
    });
    grid.add_child(dummyActor);
    grid._contextMenuDummyActor = dummyActor;

    // 2. Menü inicializálása
    grid.contextMenu = new PopupMenu.PopupMenu(dummyActor, 0.0, St.Side.TOP);
    const openedMenu = grid.contextMenu;

    openedMenu.connect('open-state-changed', (_menu, isOpen) => {
        if (isOpen || grid.contextMenu !== openedMenu)
            return;
        const closedMenu = openedMenu;
        grid._contextMenuCloseIdleId = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            grid._contextMenuCloseIdleId = null;
            if (grid.contextMenu === closedMenu)
                removeContextMenu(grid);
            return GLib.SOURCE_REMOVE;
        });
    });

    if (!grid._menuManager) {
        grid._menuManager = new PopupMenu.PopupMenuManager(grid);
    }
    grid._menuManager.addMenu(grid.contextMenu);

    return grid.contextMenu;
}

export function removeContextMenu(grid) {
    if (grid.contextMenu) {
        const menu = grid.contextMenu;
        grid.contextMenu = null;
        if (grid._menuManager) {
            grid._menuManager.removeMenu(menu);
        }
        menu.destroy();
    }
    if (grid._contextMenuDummyActor) {
        const parent = grid._contextMenuDummyActor.get_parent();
        if (parent) parent.remove_child(grid._contextMenuDummyActor);
        grid._contextMenuDummyActor = null;
    }
}

export function openPreferences(grid, targetWidgetId = null) {
    if (targetWidgetId) {
        grid.settings.set_string('open-edit-widget-id', targetWidgetId);
    }
    const extension = Extension.lookupByUUID(grid.metadata.uuid);
    if (!extension) return;
    
    try {
        const promise = extension.openPreferences();
        if (promise && typeof promise.catch === 'function') {
            promise.catch((err) => {
                console.warn('Gridgets: Could not open preferences window:', err?.message || err);
            });
        }
    } catch (e) {
        console.warn('Gridgets: Synchronous error opening preferences:', e?.message || e);
    }
}

/** Opens a GNOME Settings panel through GIO's app launcher instead of a raw fork/exec. */
export function launchSettingsPanel(panelName = null) {
    try {
        // 1. Megpróbáljuk a hivatalos org.gnome.Settings desktop bejegyzésen keresztül
        const appInfo = Gio.DesktopAppInfo.new('org.gnome.Settings.desktop');
        if (appInfo) {
            const context = global.create_app_launch_context(0, -1);
            if (panelName) {
                // Ha van konkrét alpanel megadva (pl. background, display)
                Gio.Subprocess.new(['gnome-control-center', panelName], Gio.SubprocessFlags.NONE);
            } else {
                appInfo.launch([], context);
            }
            return;
        }
    } catch (e) {
        console.warn('Gridgets: DesktopAppInfo launch failed, falling back to subprocess:', e);
    }

    // 2. Tartalék megoldás (Subprocess - string argumentumlista)
    try {
        const cmd = panelName ? ['gnome-control-center', panelName] : ['gnome-control-center'];
        const proc = Gio.Subprocess.new(cmd, Gio.SubprocessFlags.NONE);
        proc.wait_async(null, null);
    } catch (err) {
        console.error('Gridgets: Failed to launch GNOME Settings:', err);
    }
}
export function launchFileUri(uri) {
    try {
        const file = Gio.File.new_for_uri(uri);
        const path = file.get_path();

        // Ha .desktop fájlt indítunk, ne szerkesztésre nyissuk, hanem futtassuk az appot!
        if (path && path.endsWith('.desktop')) {
            const appInfo = Gio.DesktopAppInfo.new_from_filename(path);
            if (appInfo) {
                const context = global.create_app_launch_context(0, -1);
                appInfo.launch([], context);
                return;
            }
        }

        // Minden más normál fájl/mappa megnyitása:
        const appInfo = file.query_default_handler(null);
        if (appInfo) {
            const context = global.create_app_launch_context(0, -1);
            appInfo.launch([file], context);
            return;
        }
    } catch (e) {
        console.warn('Gridgets: Hiba az alkalmazás indításakor:', e);
    }

    try {
        const proc = Gio.Subprocess.new(['gio', 'open', uri], Gio.SubprocessFlags.NONE);
        proc.wait_async(null, null);
    } catch (err) {
        console.error('Gridgets: Végzetes hiba az URI megnyitásakor:', err);
    }
}

/** Fájl kukába helyezése */
function trashFile(uri, callback) {
    try {
        const file = Gio.File.new_for_uri(uri);
        file.trash_async(GLib.PRIORITY_DEFAULT, null, (source, res) => {
            try {
                file.trash_finish(res);
                if (callback) callback();
            } catch (err) {
                console.error('Hiba a kukába helyezéskor:', err);
            }
        });
    } catch (e) {
        console.error('Kukába dobás sikertelen:', e);
    }
}

/** Kuka ürítése */
function emptyTrash() {
    try {
        const proc = Gio.Subprocess.new(['gio', 'trash', '--empty'], Gio.SubprocessFlags.NONE);
        proc.wait_async(null, null);
    } catch (e) {
        console.error('Nem sikerült kiüríteni a kukát:', e);
    }
}

/** Fájl/Mappa tulajdonságok ablak megnyitása Nautilusban */
function showProperties(uri) {
    try {
        const bus = Gio.bus_get_sync(Gio.BusType.SESSION, null);
        bus.call(
            'org.freedesktop.FileManager1',
            '/org/freedesktop/FileManager1',
            'org.freedesktop.FileManager1',
            'ShowItemProperties',
            new GLib.Variant('(ass)', [[uri], '']),
            null,
            Gio.DBusCallFlags.NONE,
            -1,
            null,
            (connection, res) => {
                try {
                    connection.call_finish(res);
                } catch (e) {
                    // Ha a DBus nem érhető el, tartalékként nyissuk meg a mappát
                    launchFileUri(uri);
                }
            }
        );
    } catch (e) {
        console.error('Nem sikerült megnyitni a tulajdonságokat:', e);
        launchFileUri(uri);
    }
}

/** Asztali ikon saját jobb klikkes menüje */
function openDesktopIconContextMenu(grid, event, widgetData) {
    const menu = createPopupMenuAt(grid, event);
    const uri = widgetData.uri || '';
    const isTrash = uri.startsWith('trash:') || widgetData.name === 'Kuka';
    const isSpecial = !!widgetData.isSpecial || isTrash;

    // 1. Megnyitás
    const openItem = new PopupMenu.PopupMenuItem('Open..');
    openItem.connect('activate', () => launchFileUri(uri));
    menu.addMenuItem(openItem);

    // 2. Kuka esetén: Kuka ürítése
    if (isTrash) {
        const emptyItem = new PopupMenu.PopupMenuItem('Emptying the trashcan');
        emptyItem.connect('activate', () => emptyTrash());
        menu.addMenuItem(emptyItem);
    }

    // 3. CSAK akkor Kukába helyezés, ha NEM a Kuka és NEM speciális elem
    if (!isSpecial && !isTrash) {
        const deleteItem = new PopupMenu.PopupMenuItem('Move to Trash');
        deleteItem.connect('activate', () => {
            trashFile(uri, () => {
                // A könyvtárfigyelő automatikusan frissíti a rácsot
            });
        });
        menu.addMenuItem(deleteItem);
    }

    menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

    // 4. Tulajdonságok
    const propItem = new PopupMenu.PopupMenuItem('Properties');
    propItem.connect('activate', () => showProperties(uri));
    menu.addMenuItem(propItem);

    Main.uiGroup.add_child(menu.actor);
    menu.open(BoxPointer.PopupAnimation.FULL);
}
export function openWidgetContextMenu(grid, event, node, widgetData) {
    // Ha asztali ikonra kattintottak, a saját helyi menüjét nyitjuk meg
    if (widgetData.isDesktopIcon) {
        openDesktopIconContextMenu(grid, event, widgetData);
        return;
    }

    const menu = createPopupMenuAt(grid, event);

    if (supportsSizePresets(widgetData)) {
        const sizeMenu = new PopupMenu.PopupSubMenuMenuItem('Size');
        SIZE_PRESET_TIERS.forEach((label, sizeIndex) => {
            const item = new PopupMenu.PopupMenuItem(label);
            item.connect('activate', () => grid.applySizePreset(widgetData.id, sizeIndex));
            sizeMenu.menu.addMenuItem(item);
        });
        menu.addMenuItem(sizeMenu);
    } else {
        const isResizing = !!node.actionOverlay;
        const resizeItem = new PopupMenu.PopupMenuItem(isResizing ? 'Hide Resize Handle' : 'Resize Widget');
        resizeItem.connect('activate', () => {
            const allWidgets = getWidgets(grid.settings);
            const gridCols = grid.gridCols || COLUMNS_COUNT;
            const gridRows = grid.gridRows || ROWS_COUNT;
            toggleWidgetResizeHandle(
                node,
                widgetData,
                grid.cellTotalWidth,
                grid.cellTotalHeight,
                grid.extensionPath,
                (newCols, newRows, newX) => onWidgetResized(grid, widgetData.id, newCols, newRows, newX),
                allWidgets,
                gridCols,
                gridRows
            );
        });
        menu.addMenuItem(resizeItem);
    }

    const configItem = new PopupMenu.PopupMenuItem('Configure Widget...');
    configItem.connect('activate', () => openPreferences(grid, widgetData.id));
    menu.addMenuItem(configItem);

    const deleteItem = new PopupMenu.PopupMenuItem('Delete Widget');
    deleteItem.connect('activate', () => onWidgetDeleted(grid, widgetData.id));
    menu.addMenuItem(deleteItem);

    Main.uiGroup.add_child(menu.actor);
    menu.open(BoxPointer.PopupAnimation.NONE);
}

export function openContextMenu(grid, event) {
    const menu = createPopupMenuAt(grid, event);

    const bgItem = new PopupMenu.PopupMenuItem('Change Background...');
    bgItem.connect('activate', () => launchSettingsPanel('background'));
    menu.addMenuItem(bgItem);

    const displayItem = new PopupMenu.PopupMenuItem('Display Settings');
    displayItem.connect('activate', () => launchSettingsPanel('display'));
    menu.addMenuItem(displayItem);

    const settingsItem = new PopupMenu.PopupMenuItem('GNOME Settings');
    settingsItem.connect('activate', () => launchSettingsPanel());
    menu.addMenuItem(settingsItem);

    menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

    const prefsItem = new PopupMenu.PopupMenuItem('Gridgets Preferences...');
    prefsItem.connect('activate', () => openPreferences(grid));
    menu.addMenuItem(prefsItem);

    const toggleLinesItem = new PopupMenu.PopupMenuItem('Toggle Grid Lines');
    toggleLinesItem.connect('activate', () => {
        const current = grid.settings.get_boolean('show-grid');
        grid.settings.set_boolean('show-grid', !current);
    });
    menu.addMenuItem(toggleLinesItem);

    Main.uiGroup.add_child(menu.actor);
    menu.open(BoxPointer.PopupAnimation.NONE);
}
