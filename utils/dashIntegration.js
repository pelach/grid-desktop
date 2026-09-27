import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as AppMenu from 'resource:///org/gnome/shell/ui/appMenu.js';

let _origOpen = null;

function addAppToDesktop(appInfo) {
    try {
        const desktopPath = GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_DESKTOP) 
            || `${GLib.get_home_dir()}/Desktop`;
        const srcPath = appInfo.get_filename();
        if (!srcPath) return;

        const srcFile = Gio.File.new_for_path(srcPath);
        const fileName = srcFile.get_basename();
        const destFile = Gio.File.new_for_path(`${desktopPath}/${fileName}`);

        srcFile.copy(destFile, Gio.FileCopyFlags.OVERWRITE, null, null);

        const destPath = destFile.get_path();
        GLib.chmod(destPath, 0o755);

        try {
            const info = Gio.FileInfo.new();
            info.set_attribute_string('metadata::trusted', 'true');
            destFile.set_attributes_from_info(info, Gio.FileQueryInfoFlags.NONE, null);
        } catch (e) {
            Gio.Subprocess.new(['gio', 'set', destPath, 'metadata::trusted', 'true'], Gio.SubprocessFlags.NONE);
        }
        console.log('[grid-desktop] Sikeres másolás az asztalra:', fileName);
    } catch (e) {
        console.error('[grid-desktop] Hiba az asztalra másoláskor:', e);
    }
}

export function enableDashContextMenu() {
    if (_origOpen) return;

    const AppMenuClass = AppMenu.AppMenu;
    if (!AppMenuClass || !AppMenuClass.prototype) return;

    // A listádon látható 'open' metódus elkapása
    _origOpen = AppMenuClass.prototype.open;

    AppMenuClass.prototype.open = function (...args) {
        // Először lefut a natív megnyitás
        const res = _origOpen.apply(this, args);

        try {
            // AppMenu példány esetén a this._app tárolja az alkalmazást
            const app = this._app;
            if (!app) return res;

            // Csak egyszer adjuk hozzá a menüpontot
            if (!this._hasGridDesktopItem) {
                const appInfo = app.get_app_info ? app.get_app_info() : null;
                
                if (appInfo && appInfo.get_filename()) {
                    this._hasGridDesktopItem = true;

                    this.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
                    const item = new PopupMenu.PopupMenuItem('Add to Desktop');
                    item.connect('activate', () => {
                        addAppToDesktop(appInfo);
                    });
                    this.addMenuItem(item);
                    console.log('[grid-desktop] Menüpont hozzáadva a megnyitáskor!');
                }
            }
        } catch (err) {
            console.error('[grid-desktop] Hiba a menüpont injektálásakor:', err);
        }

        return res;
    };

    console.log('[grid-desktop] AppMenu.open patch sikeresen aktiválva!');
}

export function disableDashContextMenu() {
    if (_origOpen && AppMenu.AppMenu?.prototype) {
        AppMenu.AppMenu.prototype.open = _origOpen;
        _origOpen = null;
    }
}