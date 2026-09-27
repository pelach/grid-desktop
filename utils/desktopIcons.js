import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import { getWidgets, saveWidgets, findEmptySpot, nextWidgetId, calculateGridDimensions } from './widgetUtils.js';

let _monitor = null;
let _monitorTimeoutId = null;

export function syncDesktopIcons(settings, forceOrganize = false) {
    if (!settings) return;

    const showDesktopIcons = settings.get_boolean('show-desktop-icons');
    let widgets = getWidgets(settings);

    if (!showDesktopIcons) {
        const countBefore = widgets.length;
        widgets = widgets.filter(w => !w.isDesktopIcon);
        if (widgets.length !== countBefore) {
            saveWidgets(settings, widgets);
        }
        return;
    }

    const desktopPath = GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_DESKTOP) || `${GLib.get_home_dir()}/Desktop`;
    const directory = Gio.File.new_for_path(desktopPath);

    const showLabels = settings.get_boolean('desktop-icons-show-labels');
    const size = showLabels ? 3 : 2;
    const side = settings.get_string('desktop-icons-side') || 'left';
    const direction = settings.get_string('desktop-icons-direction') || 'vertical';

    const showHome = settings.get_boolean('desktop-icons-show-home');
    const showTrash = settings.get_boolean('desktop-icons-show-trash');
    const showMounts = settings.get_boolean('desktop-icons-show-mounts');

    // --- ITT SZÁMOLJUK KI DINAMIKUSAN A MONITOR RÁCSMÉRETÉT ---
    const stageWidth = global.stage ? global.stage.width : 1920;
    const stageHeight = global.stage ? global.stage.height : 1080;
    const gridDimensions = calculateGridDimensions(stageWidth, stageHeight);
    const cols = gridDimensions.gridCols;
    const rows = gridDimensions.gridRows;

    let currentFiles = [];

    if (showHome) {
        currentFiles.push({
            name: GLib.get_user_name() || 'Saját mappa',
            uri: Gio.File.new_for_path(GLib.get_home_dir()).get_uri(),
            icon: 'user-home',
            isSpecial: true,
        });
    }

    if (showTrash) {
        const trashFile = Gio.File.new_for_uri('trash:///');
        let trashIcon = 'user-trash';
        try {
            const trashInfo = trashFile.query_info('trash::item-count', Gio.FileQueryInfoFlags.NONE, null);
            const count = trashInfo.get_attribute_uint32('trash::item-count');
            if (count > 0) {
                trashIcon = 'user-trash-full';
            }
        } catch (e) {}

        currentFiles.push({
            name: 'Kuka',
            uri: 'trash:///',
            icon: trashIcon,
            isSpecial: true,
        });
    }

    // 3. Csatolt meghajtók és hálózati kötetek
    if (showMounts) {
        try {
            const volumeMonitor = Gio.VolumeMonitor.get();
            const mounts = volumeMonitor.get_mounts();
            mounts.forEach(mount => {
                // Gyökérfájlrendszer (/ vagy home partició) kihagyása, csak külső/hálózati kell
                const root = mount.get_root();
                if (root && root.get_path() !== '/') {
                    currentFiles.push({
                        name: mount.get_name(),
                        uri: root.get_uri(),
                        icon: mount.get_icon() ? mount.get_icon().to_string() : 'drive-harddisk',
                        isSpecial: true,
                    });
                }
            });
        } catch (e) {
            console.error('[grid-desktop] Nem sikerült lekérni a csatolt meghajtókat:', e);
        }
    }

    try {
        const enumerator = directory.enumerate_children(
            'standard::name,standard::display-name,standard::icon,standard::type',
            Gio.FileQueryInfoFlags.NONE,
            null
        );
        let info;
        while ((info = enumerator.next_file(null)) !== null) {
            const fileName = info.get_name();
            // Rejtett fájlok (. és ..) kihagyása
            if (fileName.startsWith('.')) continue;

            const childFile = directory.get_child(fileName);
            let displayName = info.get_display_name() || fileName;
            let iconString = info.get_icon() ? info.get_icon().to_string() : 'text-x-generic';
            let isDesktopEntry = false;

            // Ha .desktop fájl, olvassuk ki a metaadatait (név, ikon)
            if (fileName.endsWith('.desktop')) {
                try {
                    const appInfo = Gio.DesktopAppInfo.new_from_filename(childFile.get_path());
                    if (appInfo) {
                        displayName = appInfo.get_name() || displayName;
                        const gicon = appInfo.get_icon();
                        if (gicon) {
                            iconString = gicon.to_string();

                            // Ha a téma nem találja név szerint, megkeressük a fizikai PNG fájlt:
                            if (!iconString.startsWith('/')) {
                                const userIconDir = `${GLib.get_home_dir()}/.local/share/icons/hicolor`;
                                const sizes = ['128x128', '256x256', '48x48', '64x64', '32x32'];
                                for (const sz of sizes) {
                                    const testPath = `${userIconDir}/${sz}/apps/${iconString}.png`;
                                    if (GLib.file_test(testPath, GLib.FileTest.EXISTS)) {
                                        iconString = testPath; // Megtaláltuk a konkrét képet!
                                        break;
                                    }
                                }
                            }
                        }
                        isDesktopEntry = true;
                    }
                } catch (err) {
                    console.warn('[grid-desktop] Nem sikerült beolvasni a desktop bejegyzést:', err);
                }
            }

            currentFiles.push({
                name: displayName,
                uri: childFile.get_uri(),
                path: childFile.get_path(),
                icon: iconString,
                isDesktopEntry: isDesktopEntry
            });
        }
    } catch (e) {
        console.error('[grid-desktop] Nem sikerült beolvasni az Asztal mappát:', e);
        return;
    }

    let modified = false;

    // 1. Töröljük a már nem létező fájlok widgetjeit
    const countBefore = widgets.length;
    widgets = widgets.filter(w => {
        if (!w.isDesktopIcon) return true;
        return currentFiles.some(f => f.uri === w.uri);
    });
    if (widgets.length !== countBefore) modified = true;

    // 2. Új elemek hozzáadása vagy módosultak frissítése
    currentFiles.forEach(file => {
        let w = widgets.find(icon => icon.isDesktopIcon && icon.uri === file.uri);
        if (!w) {
            // A hibás COLUMNS_COUNT helyett a dinamikus cols és rows fut:
            const spot = findEmptySpot(widgets, size, size, cols, rows);
            w = {
                id: nextWidgetId(settings, 'desktop'),
                type: 'desktop-icon',
                isDesktopIcon: true,
                uri: file.uri,
                name: file.name,
                icon: file.icon,
                width: size,
                height: size,
                showLabel: showLabels,
                x: spot ? spot.x : 0,
                y: spot ? spot.y : 0
            };
            widgets.push(w);
            modified = true;
        } else if (w.name !== file.name || w.showLabel !== showLabels || w.icon !== file.icon) {
            w.name = file.name;
            w.icon = file.icon;
            w.showLabel = showLabels;
            w.width = size;
            w.height = size;
            modified = true;
        }
    });

    // 3. Kényszerített újrarendezés (ha a beállítás megváltozott)
    if (forceOrganize) {
        let desktopIcons = widgets.filter(w => w.isDesktopIcon);
        let otherWidgets = widgets.filter(w => !w.isDesktopIcon);

        // Tájolás kiolvasása
        let isRight = false;
        try {
            isRight = (settings.get_string('desktop-icons-side') === 'right');
        } catch (e) {
            isRight = (settings.get_enum('desktop-icons-side') === 1);
        }

        let isVertical = true;
        try {
            isVertical = (settings.get_string('desktop-icons-direction') === 'vertical');
        } catch (e) {
            isVertical = (settings.get_enum('desktop-icons-direction') === 0);
        }

        // A legszélső érvényes oszlop pontosan a rács legszéle
        let startX = isRight ? (cols - size) : 0;
        let curX = startX;
        let curY = 0;

        desktopIcons.forEach(icon => {
            icon.width = size;
            icon.height = size;

            let placed = false;
            let safetyCount = 0;

            while (!placed && safetyCount < 300) {
                safetyCount++;

                // Átfedés vizsgálata más rácselemekkel
                const overlap = otherWidgets.some(other => {
                    return curX < (other.x + other.width) &&
                           (curX + size) > other.x &&
                           curY < (other.y + other.height) &&
                           (curY + size) > other.y;
                });

                if (!overlap) {
                    icon.x = curX;
                    icon.y = curY;
                    placed = true;
                }

                // Következő mező léptetése
                if (isVertical) {
                    curY += size;
                    // Ha eléri a képernyő alját, új oszlopot nyitunk befelé haladva
                    if (curY + size > rows) {
                        curY = 0;
                        curX = isRight ? (curX - size) : (curX + size);
                    }
                } else {
                    curX = isRight ? (curX - size) : (curX + size);
                    // Ha eléri a monitor szélét, új sort kezdünk lefelé
                    if (curX < 0 || (curX + size) > cols) {
                        curX = startX;
                        curY += size;
                    }
                }
            }
        });

        modified = true;
    }

    if (modified) {
        saveWidgets(settings, widgets);
    }
}

let _volumeMonitor = null;
let _mountSignals = [];

export function monitorDesktop(settings, callback) {
    if (_monitor || !settings) return;

    const desktopPath = GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_DESKTOP) || `${GLib.get_home_dir()}/Desktop`;
    const file = Gio.File.new_for_path(desktopPath);

    try {
        _volumeMonitor = Gio.VolumeMonitor.get();
        const onMountChange = () => {
            if (_monitorTimeoutId) {
                GLib.Source.remove(_monitorTimeoutId);
                _monitorTimeoutId = null;
            }
            _monitorTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 300, () => {
                _monitorTimeoutId = null;
                syncDesktopIcons(settings, false);
                if (callback) callback();
                return GLib.SOURCE_REMOVE;
            });
        };

        _mountSignals.push(_volumeMonitor.connect('mount-added', onMountChange));
        _mountSignals.push(_volumeMonitor.connect('mount-removed', onMountChange));
        _mountSignals.push(_volumeMonitor.connect('mount-changed', onMountChange));
    } catch (e) {}
}

export function stopMonitor() {
    if (_monitorTimeoutId) {
        GLib.Source.remove(_monitorTimeoutId);
        _monitorTimeoutId = null;
    }
    if (_monitor) {
        _monitor.cancel();
        _monitor = null;
    }
    if (_volumeMonitor && _mountSignals.length > 0) {
        _mountSignals.forEach(id => _volumeMonitor.disconnect(id));
        _mountSignals = [];
        _volumeMonitor = null;
    }
}