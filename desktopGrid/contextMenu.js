import St from 'gi://St';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Meta from 'gi://Meta';
import GIRepository from 'gi://GIRepository';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as BoxPointer from 'resource:///org/gnome/shell/ui/boxpointer.js';
import { toggleWidgetResizeHandle } from './widgetEditUtils.js';
import { onWidgetResized, onWidgetDeleted } from './dragDrop.js';
import { COLUMNS_COUNT, ROWS_COUNT, getWidgets, supportsSizePresets, SIZE_PRESET_TIERS } from '../utils/widgetUtils.js';
import { TAG_COLORS } from '../widgets/desktopIcon.js';
import { syncDesktopIcons } from '../utils/desktopIcons.js';

const hasGnomeAutoar = () => {
    const repo = GIRepository.Repository.dup_default
        ? GIRepository.Repository.dup_default()
        : GIRepository.Repository.get_default();
    return repo.enumerate_versions('GnomeAutoar').length > 0;
};

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

function getFileTags(uri) {
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

function toggleTagOnUris(grid, uris, tagName) {
    for (const uri of uris) {
        if (!uri.startsWith('file://'))
            continue;

        const file = Gio.File.new_for_uri(uri);
        if (!file.query_exists(null))
            continue;

        const currentTags = getFileTags(uri);
        const idx = currentTags.indexOf(tagName);
        if (idx >= 0) {
            currentTags.splice(idx, 1);
        } else {
            currentTags.push(tagName);
        }

        file.set_attribute_string('xattr::user.xdg.tags', currentTags.join(','), Gio.FileQueryInfoFlags.NONE, null);
        file.set_attribute_uint64('time::access', Math.floor(Date.now() / 1000), Gio.FileQueryInfoFlags.NONE, null)
    }

    // Azonnal frissítjük a pöttyöket az érintett ikonokon
    for (const [, node] of grid.widgetNodes) {
        if (node?.widgetData?.isDesktopIcon && uris.includes(node.widgetData.uri)) {
            if (typeof node.refreshTags === 'function')
                node.refreshTags();
        }
    }
}

function addTagsMenuRow(menu, grid, uris) {
    const validUris = uris.filter(u => u && u.startsWith('file://'));
    if (validUris.length === 0)
        return;

    const activeTags = validUris.length === 1 ? getFileTags(validUris[0]) : [];

    const tagItem = new PopupMenu.PopupBaseMenuItem({ reactive: false, can_focus: false });
    const rowBox = new St.BoxLayout({
        style: 'spacing: 8px; padding: 2px 4px;',
        x_expand: true,
    });

    for (const [tagName, hex] of Object.entries(TAG_COLORS)) {
        const isActive = activeTags.includes(tagName);
        const dotBtn = new St.Button({
            width: 16,
            height: 16,
            style: `background-color: ${hex}; border-radius: 99px; border: ${isActive ? '2px solid #ffffff' : '1px solid rgba(0, 0, 0, 0.4)'};`,
        });

        dotBtn.connect('clicked', () => {
            toggleTagOnUris(grid, validUris, tagName);
            menu.close();
        });

        rowBox.add_child(dotBtn);
    }

    tagItem.add_child(rowBox);
    menu.addMenuItem(tagItem);
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
            copyFileOrDirRecursiveAsync(srcFile, targetFile, checkDone);
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


function createNewFolderOnDesktop(grid) {
    const desktopDir = Gio.File.new_for_path(getDesktopPath());
    const folderFile = getUniqueDestinationFile(desktopDir, 'Untitled Folder');

    folderFile.make_directory_async(GLib.PRIORITY_DEFAULT, null, (dir, res) => {
        try {
            dir.make_directory_finish(res);
            const newUri = dir.get_uri();

            // Azonnal szinkronizáljuk és újrarajzoljuk, hogy ne kelljen várni a monitorra,
            // és rögtön indíthassuk rajta az inline átnevezést!
            syncDesktopIcons(grid.settings, false);
            grid._rebuildGrid();

            for (const [, node] of grid.widgetNodes) {
                if (node?.widgetData?.isDesktopIcon && node.widgetData.uri === newUri) {
                    node.startRename?.();
                    break;
                }
            }
        } catch (e) {
            logError(e, 'Grid-desktop: Failed to create new folder');
        }
    });
}

function openDesktopIconContextMenu(grid, event, widgetData) {
    const menu = createPopupMenuAt(grid, event);
    const uri = widgetData.uri || '';
    const homeUri = Gio.File.new_for_path(GLib.get_home_dir()).get_uri();
    const isTrash = uri.startsWith('trash:') || widgetData.name === 'Kuka';
    const isHome = (uri === homeUri || uri === `${homeUri}/`);

    const isNetworkOrMountUri = uri.startsWith('google-drive:') ||
                                uri.startsWith('smb:') ||
                                uri.startsWith('sftp:') ||
                                uri.startsWith('nfs:') ||
                                uri.startsWith('dav:') ||
                                uri.startsWith('davs:');

    const isMount = (!isTrash && !isHome) && (Boolean(widgetData.isSpecial) || isNetworkOrMountUri);
    const isDesktopEntry = uri.endsWith('.desktop');
    const isNormalItem = !widgetData.isSpecial && !isTrash && !isHome && !isMount;

    // 1. Open & Quick Look / Edit
    const openItem = new PopupMenu.PopupMenuItem('Open');
    openItem.connect('activate', () => launchFileUri(uri));
    menu.addMenuItem(openItem);

    if (isDesktopEntry && isNormalItem) {
        const editItem = new PopupMenu.PopupMenuItem('Edit in Text Editor');
        editItem.connect('activate', () => {
            const editor = Gio.AppInfo.get_default_for_type('text/plain', false);
            if (editor) {
                editor.launch([Gio.File.new_for_uri(uri)], global.create_app_launch_context(0, -1));
            }
        });
        menu.addMenuItem(editItem);
    }

    if (isNormalItem && !isDesktopEntry) {
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

    // 2. Rename, Compress, Duplicate, Make Alias
    if (!isTrash) {
        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        if (isNormalItem) {
            const renameItem = new PopupMenu.PopupMenuItem('Rename');
            renameItem.connect('activate', () => {
                const node = grid.widgetNodes.get(widgetData.id);
                if (node && typeof node.startRename === 'function')
                    node.startRename();
            });
            menu.addMenuItem(renameItem);
        }

        if ((isNormalItem || isHome) && hasGnomeAutoar()) {
            const compressItem = new PopupMenu.PopupMenuItem('Compress');
            compressItem.connect('activate', () => compressFiles([uri]));
            menu.addMenuItem(compressItem);
        }

        if (isNormalItem) {
            const duplicateItem = new PopupMenu.PopupMenuItem('Duplicate');
            duplicateItem.connect('activate', () => duplicateFiles([uri]));
            menu.addMenuItem(duplicateItem);
        }

        const aliasItem = new PopupMenu.PopupMenuItem('Make Alias');
        aliasItem.connect('activate', () => makeAliasOnDesktop([uri]));
        menu.addMenuItem(aliasItem);
    }

    // 3. Copy, Copy to…, Move to…, Share, Move to Trash
    if (!isTrash) {
        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const copyClipItem = new PopupMenu.PopupMenuItem('Copy');
        copyClipItem.connect('activate', () => copyUrisToClipboard([uri]));
        menu.addMenuItem(copyClipItem);
    }

    if (isNormalItem || isHome) {
        const copyToItem = new PopupMenu.PopupMenuItem('Copy to…');
        copyToItem.connect('activate', () => {
            chooseDestinationFolder('Select Destination Folder to Copy', (targetUri) => {
                transferFilesTo([uri], targetUri, false);
            });
        });
        menu.addMenuItem(copyToItem);
    }

    if (isNormalItem) {
        const moveToItem = new PopupMenu.PopupMenuItem('Move to…');
        moveToItem.connect('activate', () => {
            chooseDestinationFolder('Select Destination Folder to Move', (targetUri) => {
                transferFilesTo([uri], targetUri, true, () => {
                    const node = grid.widgetNodes.get(widgetData.id);
                    if (node) {
                        node.destroy();
                        grid.widgetNodes.delete(widgetData.id);
                        grid._nodeConfigs.delete(widgetData.id);
                    }
                });
            });
        });
        menu.addMenuItem(moveToItem);
    }

    if ((isNormalItem || isHome) && Gio.AppInfo.get_default_for_uri_scheme('mailto')) {
        const shareItem = new PopupMenu.PopupMenuItem('Share via Email…');
        shareItem.connect('activate', () => shareViaEmail([uri]));
        menu.addMenuItem(shareItem);
    }

    if (isNormalItem) {
        const deleteItem = new PopupMenu.PopupMenuItem('Move to Trash');
        deleteItem.connect('activate', () => {
            trashFile(uri, () => {});
        });
        menu.addMenuItem(deleteItem);
    }

    // 4. Tags (színes pöttyök)
    if (!isTrash) {
        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        addTagsMenuRow(menu, grid, [uri]);
    }

    // 5. Properties
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
        const resizeItem = new PopupMenu.PopupMenuItem(isResizing ? 'Hide Resize Handle' : 'Resize');
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

    const configItem = new PopupMenu.PopupMenuItem('Configure...');
    configItem.connect('activate', () => openPreferences(grid, widgetData.id));
    menu.addMenuItem(configItem);

    const refreshItem = new PopupMenu.PopupMenuItem('Refresh');
    refreshItem.connect('activate', () => grid.refreshWidget(widgetData.id));
    menu.addMenuItem(refreshItem);
    
    const deleteItem = new PopupMenu.PopupMenuItem('Delete');
    deleteItem.connect('activate', () => onWidgetDeleted(grid, widgetData.id));
    menu.addMenuItem(deleteItem);




    Main.uiGroup.add_child(menu.actor);
    menu.open(BoxPointer.PopupAnimation.NONE);
}

export function openContextMenu(grid, event) {
    const menu = createPopupMenuAt(grid, event);

    const newFolderItem = new PopupMenu.PopupMenuItem('New Folder');
    newFolderItem.connect('activate', () => createNewFolderOnDesktop(grid));
    menu.addMenuItem(newFolderItem);

    const pasteItem = new PopupMenu.PopupMenuItem('Paste to Desktop');
    pasteItem.connect('activate', () => pasteClipboardToDesktop());
    menu.addMenuItem(pasteItem);

    if (grid.settings.get_boolean('show-desktop-icons')) {
        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const cleanUpItem = new PopupMenu.PopupMenuItem('Clean Up');
        cleanUpItem.connect('activate', () => {
            syncDesktopIcons(grid.settings, true);
            grid._rebuildGrid();
        });
        menu.addMenuItem(cleanUpItem);
    }

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

    menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

    const propItem = new PopupMenu.PopupMenuItem('Properties');
    propItem.connect('activate', () => {
        const desktopUri = Gio.File.new_for_path(getDesktopPath()).get_uri();
        showProperties(desktopUri);
    });
    menu.addMenuItem(propItem);

    Main.uiGroup.add_child(menu.actor);
    menu.open(BoxPointer.PopupAnimation.NONE);
}

//csoportos kijelölés menüje. (teszt!!)
export function openMultiSelectionContextMenu(grid, event) {
    const selection = grid._selectedWidgetIds;
    if (!selection || selection.size <= 1)
        return;

    const menu = createPopupMenuAt(grid, event);
    const count = selection.size;

    const homeUri = Gio.File.new_for_path(GLib.get_home_dir()).get_uri();
    const openableUris = [];
    const transferableFileUris = []; // Normál fájlok/mappák (Duplicate, Move to, Trash)
    const compressibleUris = [];     // Normál + Home (Compress, Copy to, Email)
    const aliasableUris = [];        // Normál + Home + Mount (Copy, Make Alias, Tags)
    let widgetCount = 0;

    for (const id of selection) {
        const node = grid.widgetNodes.get(id);
        const data = node?.widgetData;
        if (!data)
            continue;

        if (data.isDesktopIcon) {
            const uri = data.uri || '';
            const isTrash = uri.startsWith('trash:') || data.name === 'Kuka';
            const isHome = (uri === homeUri || uri === `${homeUri}/`);
            const isNetworkOrMount = Boolean(data.isSpecial) ||
                                     uri.startsWith('google-drive:') ||
                                     uri.startsWith('smb:') ||
                                     uri.startsWith('sftp:') ||
                                     uri.startsWith('nfs:') ||
                                     uri.startsWith('dav:') ||
                                     uri.startsWith('davs:');

            const isProtected = isTrash || isHome || isNetworkOrMount || Boolean(data.isSpecial);

            if (uri) {
                openableUris.push(uri);
                if (!isTrash)
                    aliasableUris.push(uri);
                if (!isTrash && !isNetworkOrMount && !Boolean(data.isSpecial))
                    compressibleUris.push(uri);
                if (!isProtected)
                    transferableFileUris.push(uri);
            }
        } else {
            widgetCount++;
        }
    }

    // Fejléc
    let headerText = `${count} items selected`;
    if (openableUris.length > 0 && widgetCount > 0) {
        headerText = `${count} items selected (${openableUris.length} files, ${widgetCount} widgets)`;
    } else if (openableUris.length > 0) {
        headerText = `${openableUris.length} files selected`;
    } else if (widgetCount > 0) {
        headerText = `${widgetCount} widgets selected`;
    }

    const headerItem = new PopupMenu.PopupMenuItem(headerText);
    headerItem.setSensitive(false);
    menu.addMenuItem(headerItem);
    menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

    // Open
    const openItem = new PopupMenu.PopupMenuItem(`Open (${openableUris.length})`);
    if (openableUris.length > 0 && widgetCount === 0) {
        openItem.connect('activate', () => {
            for (const uri of openableUris)
                launchFileUri(uri);
        });
    } else {
        openItem.setSensitive(false);
    }
    menu.addMenuItem(openItem);

    menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

    // Compress
    const compressItem = new PopupMenu.PopupMenuItem(`Compress (${compressibleUris.length})`);
    if (compressibleUris.length > 0) {
        compressItem.connect('activate', () => compressFiles(compressibleUris));
    } else {
        compressItem.setSensitive(false);
    }
    menu.addMenuItem(compressItem);

    // Duplicate
    const dupItem = new PopupMenu.PopupMenuItem(`Duplicate (${transferableFileUris.length})`);
    if (transferableFileUris.length > 0) {
        dupItem.connect('activate', () => duplicateFiles(transferableFileUris));
    } else {
        dupItem.setSensitive(false);
    }
    menu.addMenuItem(dupItem);

    // Make Alias
    const aliasItem = new PopupMenu.PopupMenuItem(`Make Alias (${aliasableUris.length})`);
    if (aliasableUris.length > 0) {
        aliasItem.connect('activate', () => makeAliasOnDesktop(aliasableUris));
    } else {
        aliasItem.setSensitive(false);
    }
    menu.addMenuItem(aliasItem);

    menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

    // Copy (vágólapra)
    const copyClipItem = new PopupMenu.PopupMenuItem(`Copy (${aliasableUris.length})`);
    if (aliasableUris.length > 0) {
        copyClipItem.connect('activate', () => copyUrisToClipboard(aliasableUris));
    } else {
        copyClipItem.setSensitive(false);
    }
    menu.addMenuItem(copyClipItem);

    // Copy to…
    const copyToItem = new PopupMenu.PopupMenuItem(`Copy to… (${compressibleUris.length})`);
    if (compressibleUris.length > 0) {
        copyToItem.connect('activate', () => {
            chooseDestinationFolder('Select Destination Folder to Copy', (targetUri) => {
                transferFilesTo(compressibleUris, targetUri, false);
            });
        });
    } else {
        copyToItem.setSensitive(false);
    }
    menu.addMenuItem(copyToItem);

    // Move to…
    const moveToItem = new PopupMenu.PopupMenuItem(`Move to… (${transferableFileUris.length})`);
    if (transferableFileUris.length > 0) {
        moveToItem.connect('activate', () => {
            chooseDestinationFolder('Select Destination Folder to Move', (targetUri) => {
                transferFilesTo(transferableFileUris, targetUri, true, () => {
                    for (const id of selection) {
                        const node = grid.widgetNodes.get(id);
                        if (node && node.widgetData?.isDesktopIcon) {
                            const u = node.widgetData.uri;
                            if (transferableFileUris.includes(u)) {
                                node.destroy();
                                grid.widgetNodes.delete(id);
                                grid._nodeConfigs.delete(id);
                            }
                        }
                    }
                    grid._clearWidgetSelection();
                });
            });
        });
    } else {
        moveToItem.setSensitive(false);
    }
    menu.addMenuItem(moveToItem);

    // Share via Email…
    if (Gio.AppInfo.get_default_for_uri_scheme('mailto')) {
        const shareItem = new PopupMenu.PopupMenuItem(`Share via Email… (${compressibleUris.length})`);
        if (compressibleUris.length > 0) {
            shareItem.connect('activate', () => shareViaEmail(compressibleUris));
        } else {
            shareItem.setSensitive(false);
        }
        menu.addMenuItem(shareItem);
    }

    // Tags
    if (aliasableUris.length > 0) {
        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        addTagsMenuRow(menu, grid, aliasableUris);
    }

    menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

    // Delete / Move to Trash
    const deletableCount = widgetCount + transferableFileUris.length;
    const deleteItem = new PopupMenu.PopupMenuItem(`Delete / Move to Trash (${deletableCount})`);
    if (deletableCount > 0) {
        deleteItem.connect('activate', () => {
            grid._deleteSelectedWidgets();
        });
    } else {
        deleteItem.setSensitive(false);
    }
    menu.addMenuItem(deleteItem);

    Main.uiGroup.add_child(menu.actor);
    menu.open(BoxPointer.PopupAnimation.FULL);
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

        // 1. Ha a fájlkezelő URI listát tett a vágólapra (Nautilus / Nemo / Dolphin)
        if (mimetypes.includes('text/uri-list')) {
            _transferTextMimeAndProcess(selection, 'text/uri-list');
            return;
        }

        // 2. Ha kép adat van a vágólapon (pl. böngészőből "Kép másolása" vagy screenshot)
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

function _transferTextMimeAndProcess(selection, mimeType) {
    const stream = Gio.MemoryOutputStream.new_resizable();
    selection.transfer_async(
        Meta.SelectionType.SELECTION_CLIPBOARD,
        mimeType,
        -1,
        stream,
        null,
        (sel, res) => {
            try {
                sel.transfer_finish(res);
                stream.close(null);
                const bytes = stream.steal_as_bytes();
                const text = new TextDecoder('utf-8').decode(bytes.get_data());
                const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#'));
                for (const line of lines) {
                    if (line.startsWith('file://')) {
                        copyLocalFileToDesktop(line);
                    }
                }
            } catch (e) {
                logError(e, 'Grid-desktop: Failed to read uri-list from clipboard');
            }
        }
    );
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

        if (firstLine.startsWith('file://') || (firstLine.startsWith('/') && GLib.file_test(firstLine, GLib.FileTest.EXISTS))) {
            lines.forEach(entry => {
                if (entry.startsWith('file://')) {
                    copyLocalFileToDesktop(entry);
                } else if (entry.startsWith('/') && GLib.file_test(entry, GLib.FileTest.EXISTS)) {
                    const fileUri = Gio.File.new_for_path(entry).get_uri();
                    copyLocalFileToDesktop(fileUri);
                }
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
    const srcFile = Gio.File.new_for_uri(fileUri);
    const desktopDir = Gio.File.new_for_path(getDesktopPath());
    const targetFile = getUniqueDestinationFile(desktopDir, srcFile.get_basename());
    copyFileOrDirRecursiveAsync(srcFile, targetFile);
}

function copyFileOrDirRecursiveAsync(srcFile, destFile, callback) {
    srcFile.query_info_async('standard::type', Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, GLib.PRIORITY_DEFAULT, null, (file, res) => {
        try {
            const info = file.query_info_finish(res);
            if (info.get_file_type() !== Gio.FileType.DIRECTORY) {
                srcFile.copy_async(destFile, Gio.FileCopyFlags.ALL_METADATA, GLib.PRIORITY_DEFAULT, null, null, (f, r) => {
                    try {
                        f.copy_finish(r);
                    } catch (e) {
                        logError(e, 'Grid-desktop: File copy failed');
                    } finally {
                        if (callback) callback();
                    }
                });
                return;
            }

            destFile.make_directory_async(GLib.PRIORITY_DEFAULT, null, (d, r) => {
                try {
                    d.make_directory_finish(r);
                    srcFile.enumerate_children_async('standard::name', Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, GLib.PRIORITY_DEFAULT, null, (s, er) => {
                        try {
                            const enumerator = s.enumerate_children_finish(er);
                            const children = [];
                            let childInfo;
                            while ((childInfo = enumerator.next_file(null)) !== null) {
                                children.push(childInfo.get_name());
                            }
                            enumerator.close(null);

                            if (children.length === 0) {
                                if (callback) callback();
                                return;
                            }

                            let pending = children.length;
                            for (const name of children) {
                                copyFileOrDirRecursiveAsync(srcFile.get_child(name), destFile.get_child(name), () => {
                                    pending--;
                                    if (pending === 0 && callback) callback();
                                });
                            }
                        } catch (e) {
                            logError(e, 'Grid-desktop: Enumerate children failed');
                            if (callback) callback();
                        }
                    });
                } catch (e) {
                    logError(e, 'Grid-desktop: Make directory failed');
                    if (callback) callback();
                }
            });
        } catch (e) {
            logError(e, 'Grid-desktop: Query info failed during copy');
            if (callback) callback();
        }
    });
}

export function duplicateFiles(uris) {
    for (const uri of uris) {
        const srcFile = Gio.File.new_for_uri(uri);
        const parent = srcFile.get_parent();
        if (!parent) continue;

        const targetFile = getUniqueDestinationFile(parent, srcFile.get_basename());
        copyFileOrDirRecursiveAsync(srcFile, targetFile);
    }
}

export function makeAliasOnDesktop(uris) {
    const desktopDir = Gio.File.new_for_path(getDesktopPath());

    for (const uri of uris) {
        const srcFile = Gio.File.new_for_uri(uri);
        const targetPath = srcFile.get_path();
        if (!targetPath) continue; // Virtuális URI-ra (pl. smb://) nem készülhet POSIX symlink

        const basename = srcFile.get_basename();
        const dotIdx = basename.lastIndexOf('.');
        const aliasBase = dotIdx > 0
            ? `${basename.substring(0, dotIdx)} alias${basename.substring(dotIdx)}`
            : `${basename} alias`;

        const linkFile = getUniqueDestinationFile(desktopDir, aliasBase);
        linkFile.make_symbolic_link(targetPath, null);
    }
}

export async function compressFiles(uris) {
    if (!uris || uris.length === 0 || !hasGnomeAutoar())
        return;

    const { default: GnomeAutoar } = await import('gi://GnomeAutoar');

    const files = uris.map(u => Gio.File.new_for_uri(u));
    const parent = files[0].get_parent() || Gio.File.new_for_path(getDesktopPath());

    // A GnomeAutoar.Compressor 2. paramétere a cél MAPPÁT várja, nem a fájlnevet!
    const compressor = GnomeAutoar.Compressor.new(
        files,
        parent,
        GnomeAutoar.Format.ZIP,
        GnomeAutoar.Filter.NONE,
        false
    );

    const cleanup = () => {
        compressor.disconnect(doneId);
        compressor.disconnect(errId);
    };

    const doneId = compressor.connect('completed', cleanup);
    const errId = compressor.connect('error', (_self, err) => {
        logError(err, 'Grid-desktop: Compression failed');
        cleanup();
    });

    compressor.start_async(null);
}

export function copyUrisToClipboard(uris) {
    if (!uris || uris.length === 0) return;
    // A Nautilus / fájlkezelők a sortöréssel elválasztott file:// URI-kat várják vágólapról
    St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, uris.join('\n'));
}

export function shareViaEmail(uris) {
    const mailApp = Gio.AppInfo.get_default_for_uri_scheme('mailto');
    if (!mailApp || !uris || uris.length === 0) return;

    const paths = uris
        .map(u => Gio.File.new_for_uri(u).get_path())
        .filter(Boolean)
        .map(p => `attach=${encodeURIComponent(p)}`);

    if (paths.length === 0) return;
    const mailtoUri = `mailto:?${paths.join('&')}`;
    Gio.AppInfo.launch_default_for_uri_async(mailtoUri, global.create_app_launch_context(0, -1), null, null);
}

export function renameDesktopIcon(uri, newName, isDesktopEntry, onRenamed = null) {
    const file = Gio.File.new_for_uri(uri);

    if (isDesktopEntry) {
        const path = file.get_path();
        if (!path) return;

        const keyFile = new GLib.KeyFile();
        keyFile.load_from_file(path, GLib.KeyFileFlags.KEEP_COMMENTS | GLib.KeyFileFlags.KEEP_TRANSLATIONS);
        const trimmedName = newName.trim();
        keyFile.set_string('Desktop Entry', 'Name', trimmedName);

        // Ha van lokalizált név (pl. Name[hu]), azt is frissítjük, különben a GIO azt olvassa vissza!
        for (const lang of GLib.get_language_names()) {
            const locKey = `Name[${lang}]`;
            if (keyFile.has_key('Desktop Entry', locKey)) {
                keyFile.set_string('Desktop Entry', locKey, trimmedName);
            }
        }

        keyFile.save_to_file(path);
        if (onRenamed) onRenamed(uri);
        return;
    }

    file.set_display_name_async(newName.trim(), GLib.PRIORITY_DEFAULT, null, (f, res) => {
        const updatedFile = f.set_display_name_finish(res);
        if (updatedFile && onRenamed)
            onRenamed(updatedFile.get_uri());
    });
}