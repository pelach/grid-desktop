import St from 'gi://St';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Meta from 'gi://Meta';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as BoxPointer from 'resource:///org/gnome/shell/ui/boxpointer.js';
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

    const dummyActor = new St.Widget({
        reactive: false,
        can_focus: false,
        track_hover: false,
        x: Math.round(stageX),
        y: Math.round(stageY),
        width: 1,
        height: 1,
    });
    grid.add_child(dummyActor);
    grid._contextMenuDummyActor = dummyActor;

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
        if (parent)
            parent.remove_child(grid._contextMenuDummyActor);
        grid._contextMenuDummyActor = null;
    }
}

export function openPreferences(grid, targetWidgetId = null) {
    if (targetWidgetId) {
        grid.settings.set_string('open-edit-widget-id', targetWidgetId);
    }

    const extension = grid.extension || grid._extension;
    if (extension && typeof extension.openPreferences === 'function') {
        extension.openPreferences();
    }
}

export function launchSettingsPanel(panelName = null) {
    try {
        const appInfo = Gio.DesktopAppInfo.new('org.gnome.Settings.desktop');
        if (appInfo) {
            const context = global.create_app_launch_context(0, -1);
            if (panelName) {
                appInfo.launch_uris([`gnome-control-center://${panelName}`], context);
            } else {
                appInfo.launch([], context);
            }
        }
    } catch (e) {
        logError(e, 'Grid-desktop: Failed to launch Settings');
    }
}

export function previewWithSushi(fileOrUri) {
    if (!fileOrUri) return;

    // Ha sima útvonal érkezik (/home/...), csinálunk belőle file:// URI-t
    let uri = fileOrUri;
    if (!uri.includes('://')) {
        uri = Gio.File.new_for_path(fileOrUri).get_uri();
    }

    try {
        Gio.DBus.session.call(
            'org.gnome.NautilusPreviewer',
            '/org/gnome/NautilusPreviewer',
            'org.gnome.NautilusPreviewer',
            'ShowFile',
            new GLib.Variant('(sib)', [uri, 0, true]), // true = szóközre bezárja, ha már nyitva van
            null,
            Gio.DBusCallFlags.NONE,
            -1,
            null,
            (connection, res) => {
                try {
                    connection.call_finish(res);
                } catch (e) {
                    // Ha nincs telepítve a gnome-sushi csomag, nem kell a felhasználót zargatni
                    logError(e, 'Grid-desktop: Sushi preview not available');
                }
            }
        );
    } catch (e) {
        logError(e, 'Grid-desktop: Failed to invoke Sushi D-Bus');
    }
}

export function launchFileUri(uri) {
    try {
        const file = Gio.File.new_for_uri(uri);
        const path = file.get_path();

        if (path && path.endsWith('.desktop')) {
            const appInfo = Gio.DesktopAppInfo.new_from_filename(path);
            if (appInfo) {
                const context = global.create_app_launch_context(0, -1);
                appInfo.launch([], context);
                return;
            }
        }

        const appInfo = file.query_default_handler(null);
        if (appInfo) {
            const context = global.create_app_launch_context(0, -1);
            appInfo.launch([file], context);
        }
    } catch (e) {
        logError(e, 'Grid-desktop: Failed to open URI');
    }
}

export function trashFile(uri, callback) {
    try {
        const file = Gio.File.new_for_uri(uri);
        file.trash_async(GLib.PRIORITY_DEFAULT, null, (source, res) => {
            try {
                file.trash_finish(res);
                if (callback)
                    callback();
            } catch (err) {
                logError(err, 'Grid-desktop: Trash operation failed');
            }
        });
    } catch (e) {
        logError(e, 'Grid-desktop: Trash init failed');
    }
}

function chooseDestinationFolder(title, callback) {
    try {
        const bus = Gio.DBus.session;
        // Egyedi token a kérelemhez, így előre tudjuk a válasz D-Bus elérési útját
        const token = `grid_${GLib.random_int()}`;
        const sender = bus.get_unique_name().replace(/^\:/, '').replace(/\./g, '_');
        const expectedPath = `/org/freedesktop/portal/desktop/request/${sender}/${token}`;

        let signalId = 0;

        // 1. ELŐSZÖR feliratkozunk a szignálra, hogy kizárjuk a versenyhelyzetet
        signalId = bus.signal_subscribe(
            'org.freedesktop.portal.Desktop',
            'org.freedesktop.portal.Request',
            'Response',
            expectedPath,
            null,
            Gio.DBusSignalFlags.NONE,
            (_conn, _sender, _path, _iface, _signal, params) => {
                if (signalId) {
                    bus.signal_unsubscribe(signalId);
                    signalId = 0;
                }

                try {
                    const unpacked = params.recursiveUnpack();
                    const responseCode = unpacked[0];
                    const results = unpacked[1] || {};

                    // 0 = Success (a felhasználó kiválasztotta a mappát)
                    if (responseCode === 0 && results.uris && results.uris.length > 0) {
                        callback(results.uris[0]);
                    }
                } catch (e) {
                    logError(e, 'Grid-desktop: Failed to parse portal response');
                }
            }
        );

        // 2. Ezután küldjük el a kérést az előre megadott handle_token-nel
        bus.call(
            'org.freedesktop.portal.Desktop',
            '/org/freedesktop/portal/desktop',
            'org.freedesktop.portal.FileChooser',
            'OpenFile',
            new GLib.Variant('(ssa{sv})', [
                '', // parent window
                title,
                {
                    'handle_token': new GLib.Variant('s', token),
                    'directory': new GLib.Variant('b', true), // Csak mappa választható
                    'modal': new GLib.Variant('b', true),
                }
            ]),
            null,
            Gio.DBusCallFlags.NONE,
            -1,
            null,
            (_conn, res) => {
                try {
                    bus.call_finish(res);
                } catch (e) {
                    if (signalId) {
                        bus.signal_unsubscribe(signalId);
                        signalId = 0;
                    }
                    logError(e, 'Grid-desktop: FileChooser portal call failed');
                }
            }
        );
    } catch (e) {
        logError(e, 'Grid-desktop: Failed to initialize folder chooser portal');
    }
}

function getUniqueDestinationFile(destDir, basename) {
    let target = destDir.get_child(basename);
    if (!target.query_exists(null))
        return target;

    let name = basename;
    let ext = '';
    const dotIdx = basename.lastIndexOf('.');
    if (dotIdx > 0) {
        name = basename.substring(0, dotIdx);
        ext = basename.substring(dotIdx);
    }

    let counter = 1;
    while (target.query_exists(null)) {
        target = destDir.get_child(`${name} (${counter})${ext}`);
        counter++;
    }
    return target;
}

export function transferFilesTo(uris, destDirUri, isMove = false, onComplete = null) {
    if (!uris || uris.length === 0 || !destDirUri) return;

    const destDir = Gio.File.new_for_uri(destDirUri);
    const flags = Gio.FileCopyFlags.ALL_METADATA;

    let pendingCount = uris.length;
    const checkDone = () => {
        pendingCount--;
        if (pendingCount === 0 && typeof onComplete === 'function') {
            onComplete();
        }
    };

    for (const uri of uris) {
        const srcFile = Gio.File.new_for_uri(uri);
        const basename = srcFile.get_basename();
        const targetFile = getUniqueDestinationFile(destDir, basename);

        if (isMove) {
            srcFile.move_async(
                targetFile,
                flags,
                GLib.PRIORITY_DEFAULT,
                null, // Cancellable
                null, // Progress callback
                (file, res) => {
                    try {
                        file.move_finish(res);
                    } catch (e) {
                        logError(e, `Grid-desktop: Move failed for ${basename}`);
                    } finally {
                        checkDone();
                    }
                }
            );
        } else {
            srcFile.copy_async(
                targetFile,
                flags,
                GLib.PRIORITY_DEFAULT,
                null,
                null,
                (file, res) => {
                    try {
                        file.copy_finish(res);
                    } catch (e) {
                        logError(e, `Grid-desktop: Copy failed for ${basename}`);
                    } finally {
                        checkDone();
                    }
                }
            );
        }
    }
}


function emptyTrash() {
    try {
        const trash = Gio.File.new_for_uri('trash:///');
        trash.delete_async(GLib.PRIORITY_DEFAULT, null, (file, res) => {
            try {
                file.delete_finish(res);
            } catch (e) {
                logError(e, 'Grid-desktop: Failed to empty trash');
            }
        });
    } catch (e) {
        logError(e, 'Grid-desktop: Failed to init trash empty');
    }
}

function ejectOrUnmountTargetUri(uri) {
    try {
        const file = Gio.File.new_for_uri(uri);
        const volumeMonitor = Gio.VolumeMonitor.get();
        const mounts = volumeMonitor.get_mounts();

        let targetMount = mounts.find(m => {
            const root = m.get_root();
            return root && (root.get_uri() === uri || uri.startsWith(root.get_uri()));
        });

        if (!targetMount) {
            try {
                targetMount = file.find_enclosing_mount(null);
            } catch (_) {}
        }

        if (targetMount) {
            const mountOp = new Gio.MountOperation();

            if (targetMount.can_eject()) {
                targetMount.eject_with_operation(
                    Gio.MountUnmountFlags.NONE,
                    mountOp,
                    null,
                    (src, res) => {
                        try {
                            src.eject_with_operation_finish(res);
                        } catch (e) {
                            logError(e, 'Grid-desktop: Eject failed');
                        }
                    }
                );
                return;
            }

            const drive = targetMount.get_drive();
            if (drive && drive.can_stop()) {
                drive.stop(
                    Gio.MountUnmountFlags.NONE,
                    mountOp,
                    null,
                    (src, res) => {
                        try {
                            src.stop_finish(res);
                        } catch (e) {
                            logError(e, 'Grid-desktop: Drive stop failed');
                        }
                    }
                );
                return;
            }

            if (targetMount.can_unmount()) {
                targetMount.unmount_with_operation(
                    Gio.MountUnmountFlags.NONE,
                    mountOp,
                    null,
                    (src, res) => {
                        try {
                            src.unmount_with_operation_finish(res);
                        } catch (e) {
                            logError(e, 'Grid-desktop: Unmount failed');
                        }
                    }
                );
            }
        }
    } catch (e) {
        logError(e, 'Grid-desktop: Target unmount failed');
    }
}

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
                } catch (_) {
                    launchFileUri(uri);
                }
            }
        );
    } catch (_) {
        launchFileUri(uri);
    }
}

function openDesktopIconContextMenu(grid, event, widgetData) {
    const menu = createPopupMenuAt(grid, event);
    const uri = widgetData.uri || '';
    const isTrash = uri.startsWith('trash:') || widgetData.name === 'Kuka';
    const isHome = uri === Gio.File.new_for_path(GLib.get_home_dir()).get_uri();

    const isNetworkOrMountUri = uri.startsWith('google-drive:') ||
                                uri.startsWith('smb:') ||
                                uri.startsWith('sftp:') ||
                                uri.startsWith('nfs:') ||
                                uri.startsWith('dav:') ||
                                uri.startsWith('davs:');

    const isMount = (!isTrash && !isHome) && (Boolean(widgetData.isSpecial) || isNetworkOrMountUri);

    const openItem = new PopupMenu.PopupMenuItem('Open');
    openItem.connect('activate', () => launchFileUri(uri));
    menu.addMenuItem(openItem);

    const isDesktopEntry = uri.endsWith('.desktop');
    if (!widgetData.isSpecial && !isTrash && !isMount && !isDesktopEntry) {
        const previewItem = new PopupMenu.PopupMenuItem('Quick Look (Sushi)');
        previewItem.connect('activate', () => previewWithSushi(uri));
        menu.addMenuItem(previewItem);
    }

    if (isTrash) {
        const emptyItem = new PopupMenu.PopupMenuItem('Empty Trash');
        emptyItem.connect('activate', () => emptyTrash());
        menu.addMenuItem(emptyItem);
    }

    if (isMount) {
        const isNetworkShare = uri.startsWith('smb:') ||
                               uri.startsWith('sftp:') ||
                               uri.startsWith('nfs:') ||
                               uri.startsWith('dav:') ||
                               uri.startsWith('davs:');

        const menuLabel = isNetworkShare ? 'Unmount' : 'Eject';
        const unmountItem = new PopupMenu.PopupMenuItem(menuLabel);
        unmountItem.connect('activate', () => ejectOrUnmountTargetUri(uri));
        menu.addMenuItem(unmountItem);
    }

    if (!widgetData.isSpecial && !isTrash && !isHome && !isMount) {
        // Segédfüggvény: összegyűjti az összes kijelölt fájl URI-ját (vagy csak ezt az egyet)
        const getTargetUris = () => {
            const selection = grid._selectedWidgetIds;
            if (selection && selection.has(widgetData.id) && selection.size > 1) {
                const uris = [];
                for (const id of selection) {
                    const node = grid.widgetNodes.get(id);
                    const data = node?.widgetData;
                    if (data && data.isDesktopIcon && data.uri && !data.isSpecial) {
                        uris.push(data.uri);
                    }
                }
                if (uris.length > 0) return uris;
            }
            return [uri];
        };

        const copyItem = new PopupMenu.PopupMenuItem('Copy to…');
        copyItem.connect('activate', () => {
            const fileUris = getTargetUris();
            chooseDestinationFolder('Select Destination Folder to Copy', (targetUri) => {
                transferFilesTo(fileUris, targetUri, false);
            });
        });
        menu.addMenuItem(copyItem);

        const moveItem = new PopupMenu.PopupMenuItem('Move to…');
        moveItem.connect('activate', () => {
            const fileUris = getTargetUris();
            chooseDestinationFolder('Select Destination Folder to Move', (targetUri) => {
                transferFilesTo(fileUris, targetUri, true, () => {
                    // Áthelyezés után azonnal tüntessük el az ikonokat a képernyőről
                    if (grid._selectedWidgetIds && grid._selectedWidgetIds.has(widgetData.id)) {
                        for (const id of grid._selectedWidgetIds) {
                            const node = grid.widgetNodes.get(id);
                            if (node && node.widgetData?.isDesktopIcon) {
                                node.destroy();
                                grid.widgetNodes.delete(id);
                                grid._nodeConfigs.delete(id);
                            }
                        }
                        grid._clearWidgetSelection();
                    } else {
                        const node = grid.widgetNodes.get(widgetData.id);
                        if (node) {
                            node.destroy();
                            grid.widgetNodes.delete(widgetData.id);
                            grid._nodeConfigs.delete(widgetData.id);
                        }
                    }
                });
            });
        });
        menu.addMenuItem(moveItem);

        const deleteItem = new PopupMenu.PopupMenuItem('Move to Trash');
        deleteItem.connect('activate', () => {
            trashFile(uri, () => {});
        });
        menu.addMenuItem(deleteItem);
    }

    menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

    const propItem = new PopupMenu.PopupMenuItem('Properties');
    propItem.connect('activate', () => showProperties(uri));
    menu.addMenuItem(propItem);

    Main.uiGroup.add_child(menu.actor);
    menu.open(BoxPointer.PopupAnimation.FULL);
}

export function openWidgetContextMenu(grid, event, node, widgetData) {
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
        const isResizing = Boolean(node.actionOverlay);
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

    const pasteItem = new PopupMenu.PopupMenuItem('Paste to Desktop');
    pasteItem.connect('activate', () => pasteClipboardToDesktop());
    menu.addMenuItem(pasteItem);

    menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

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

    const prefsItem = new PopupMenu.PopupMenuItem('Grid-desktop Settings');
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
export function openMultiSelectionContextMenu(grid, event) {

}

function getDesktopPath() {
    return GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_DESKTOP) ||
           GLib.build_filenamev([GLib.get_home_dir(), 'Desktop']);
}

function getUniqueDesktopPath(desiredName, ext) {
    const desktop = getDesktopPath();
    let safeName = desiredName.replace(/[/\\?%*:|"<>]/g, '_').trim();
    if (!safeName)
        safeName = `picture_${GLib.DateTime.new_now_local().format('%Y%m%d_%H%M%S')}`;

    let filename = `${safeName}.${ext}`;
    let targetFile = Gio.File.new_for_path(GLib.build_filenamev([desktop, filename]));
    let counter = 1;

    while (targetFile.query_exists(null)) {
        filename = `${safeName} (${counter}).${ext}`;
        targetFile = Gio.File.new_for_path(GLib.build_filenamev([desktop, filename]));
        counter++;
    }

    return targetFile;
}

function extractImageBasenameFromHtml(htmlText) {
    try {
        const srcMatch = htmlText.match(/<img[^>]+src=["']([^"']+)["']/i);
        if (srcMatch && srcMatch[1]) {
            const url = srcMatch[1].split('?')[0].split('#')[0];
            const base = GLib.path_get_basename(decodeURIComponent(url));
            if (base && base.includes('.'))
                return base.substring(0, base.lastIndexOf('.'));
        }

        const altMatch = htmlText.match(/<img[^>]+alt=["']([^"']+)["']/i);
        if (altMatch && altMatch[1] && altMatch[1].trim())
            return altMatch[1].trim();
    } catch (_) {}
    return null;
}

function pasteClipboardToDesktop() {
    try {
        const display = global.display;
        const selection = display.get_selection();
        const mimetypes = selection.get_mimetypes(Meta.SelectionType.SELECTION_CLIPBOARD) || [];
        const imageMime = mimetypes.find(m => m.startsWith('image/'));

        if (imageMime) {
            if (mimetypes.includes('text/html')) {
                _extractHtmlAndSaveImage(selection, imageMime);
            } else {
                _saveImageFromMutterSelection(selection, imageMime, null);
            }
            return;
        }
    } catch (err) {
        logError(err, 'Grid-desktop: Clipboard paste error');
    }

    _handleTextClipboard();
}

function _extractHtmlAndSaveImage(selection, imageMime) {
    const stream = Gio.MemoryOutputStream.new_resizable();
    selection.transfer_async(
        Meta.SelectionType.SELECTION_CLIPBOARD,
        'text/html',
        -1,
        stream,
        null,
        (sel, res) => {
            let extractedName = null;
            try {
                sel.transfer_finish(res);
                stream.close(null);
                const bytes = stream.steal_as_bytes();
                const htmlText = new TextDecoder('utf-8').decode(bytes.get_data());
                extractedName = extractImageBasenameFromHtml(htmlText);
            } catch (_) {}
            _saveImageFromMutterSelection(selection, imageMime, extractedName);
        }
    );
}

function _saveImageFromMutterSelection(selection, mimeType, baseName = null) {
    let ext = mimeType.split('/')[1] || 'png';
    if (ext === 'jpeg')
        ext = 'jpg';
    ext = ext.split(';')[0];

    const finalBaseName = baseName || `picture_${GLib.DateTime.new_now_local().format('%Y%m%d_%H%M%S')}`;
    const targetFile = getUniqueDesktopPath(finalBaseName, ext);

    targetFile.replace_async(null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, GLib.PRIORITY_DEFAULT, null, (f, resOpen) => {
        try {
            const outputStream = f.replace_finish(resOpen);

            selection.transfer_async(
                Meta.SelectionType.SELECTION_CLIPBOARD,
                mimeType,
                -1,
                outputStream,
                null,
                (sel, resTransfer) => {
                    try {
                        sel.transfer_finish(resTransfer);
                        outputStream.close(null);
                    } catch (e) {
                        logError(e, 'Grid-desktop: Image transfer failed');
                    }
                }
            );
        } catch (err) {
            logError(err, 'Grid-desktop: Image file replace failed');
        }
    });
}

function _handleTextClipboard() {
    const clipboard = St.Clipboard.get_default();

    clipboard.get_text(St.ClipboardType.CLIPBOARD, (_clip, text) => {
        if (!text || !text.trim())
            return;

        const trimmed = text.trim();
        const lines = trimmed.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
        const firstLine = lines[0];

        if (firstLine.startsWith('http://') || firstLine.startsWith('https://')) {
            const isImage = /\.(png|jpe?g|gif|webp|svg)(\?.*)?$/i.test(firstLine);
            if (isImage) {
                downloadImageToDesktop(firstLine);
                return;
            }
        }

        if (firstLine.startsWith('file://')) {
            lines.forEach(uri => {
                if (uri.startsWith('file://'))
                    copyLocalFileToDesktop(uri);
            });
            return;
        }

        saveTextToDesktop(trimmed);
    });
}

function saveTextToDesktop(text) {
    const desktop = getDesktopPath();
    const dateStr = GLib.DateTime.new_now_local().format('%Y%m%d_%H%M%S');
    const targetPath = GLib.build_filenamev([desktop, `text_${dateStr}.txt`]);

    try {
        const file = Gio.File.new_for_path(targetPath);
        file.replace_contents(
            new TextEncoder().encode(text),
            null,
            false,
            Gio.FileCreateFlags.REPLACE_DESTINATION,
            null
        );
    } catch (e) {
        logError(e, 'Grid-desktop: Failed to save text');
    }
}

function downloadImageToDesktop(url) {
    const desktop = getDesktopPath();
    const uriFile = Gio.File.new_for_uri(url);

    let basename = uriFile.get_basename();
    if (!basename || !basename.includes('.')) {
        basename = `kep_${GLib.DateTime.new_now_local().format('%Y%m%d_%H%M%S')}.png`;
    } else {
        basename = basename.split('?')[0];
    }

    const targetFile = Gio.File.new_for_path(GLib.build_filenamev([desktop, basename]));

    try {
        uriFile.copy(targetFile, Gio.FileCopyFlags.OVERWRITE, null, null);
    } catch (e) {
        logError(e, 'Grid-desktop: Download copy failed');
    }
}

function copyLocalFileToDesktop(fileUri) {
    try {
        const srcFile = Gio.File.new_for_uri(fileUri);
        const desktop = getDesktopPath();
        const targetFile = Gio.File.new_for_path(
            GLib.build_filenamev([desktop, srcFile.get_basename()])
        );

        srcFile.copy(targetFile, Gio.FileCopyFlags.OVERWRITE, null, null);
    } catch (e) {
        logError(e, 'Grid-desktop: Local file copy failed');
    }
}