import GLib from 'gi://GLib';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import Gio from 'gi://Gio';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { DesktopGrid } from './desktopGrid/index.js';
import { clearMoodStoreCache } from './utils/moodStore.js';
import { clearGeocodeCache } from './widgets/weather/weatherCommon.js';
import { clearArtworkCaches } from './widgets/music/artwork.js';
import { clearRssEngines } from './utils/rssEngine.js';
import { clearEnsuredDirectories } from './utils/widgetUtils.js';
import { clearMusicPlaybackState } from './widgets/music/playbackState.js';
import { clearMusicPolls } from './widgets/music/index.js';
import { screenTimeEngine } from './utils/screenTimeEngine.js';
import { enableDashContextMenu, disableDashContextMenu } from './utils/dashIntegration.js';
import { clearStorageEngine } from './utils/storageEngine.js';
import { monitorDesktop, stopMonitor, syncDesktopIcons } from './utils/desktopIcons.js';
import { getWidgets, saveWidgets } from './utils/widgetUtils.js';

export default class GridgetsExtension extends Extension {
    enable() {

        this._settings = this.getSettings();

        const isMigrated = this._settings.get_boolean('grid-migrated-v2');
        if (!isMigrated) {
            let widgets = getWidgets(this._settings);
            widgets.forEach(w => {
                if (!w.isDesktopIcon) {
                    w.x = Math.floor(w.x / 2);
                    w.y = Math.floor(w.y / 2);
                    w.width = Math.max(1, Math.round(w.width / 2));
                    w.height = Math.max(1, Math.round(w.height / 2));
                } else {
                    w.x = Math.floor(w.x / 2);
                    w.y = Math.floor(w.y / 2);
                    w.width = 1;
                    w.height = 1;
                }
            });
            saveWidgets(this._settings, widgets);
            this._settings.set_boolean('grid-migrated-v2', true);
        }

        this._desktopGrids = [];
        this._monitorsChangedId = 0;
        this._settingSignalIds = [];
        this._interfaceSignalId = 0;
        this._accentSignalId = 0;
        this._interfaceSettings = Gio.Settings.new('org.gnome.desktop.interface');

        this._settingSignalIds.push(
            this._settings.connect('changed::global-monitor', () => this._rebuildGrids())
        );
        this._settingSignalIds.push(
            this._settings.connect('changed::follow-system-theme', () => this._rebuildGrids())
        );
        this._settingSignalIds.push(
            this._settings.connect('changed::accent-color-override', () => this._rebuildGrids())
        );

        this._settingSignalIds.push(
            this._settings.connect('changed::global-background-opacity', () => this._rebuildGrids())
        );
        this._settingSignalIds.push(
            this._settings.connect('changed::global-background-color', () => this._rebuildGrids())
        );
        this._settingSignalIds.push(
            this._settings.connect('changed::global-foreground-color', () => this._rebuildGrids())
        );
        this._settingSignalIds.push(
            this._settings.connect('changed::global-border-radius', () => this._rebuildGrids())
        );

        
        this._screenTimeRelease = screenTimeEngine.acquire();

        syncDesktopIcons(this._settings, false);
        
        // --- Volume és Meghajtó figyelő (pendrive / hálózati csatolások) ---
        this._volumeMonitor = Gio.VolumeMonitor.get();
        this._volumeSignals = [];
        this._volumeDebounceId = 0;

        const onStorageStateChanged = () => {
            if (this._volumeDebounceId > 0) {
                GLib.source_remove(this._volumeDebounceId);
            }
            // 200ms debounce: elkerüli a dupla újraépítést, ha egyszerre több szignál érkezik
            this._volumeDebounceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT_IDLE, 200, () => {
                this._volumeDebounceId = 0;
                syncDesktopIcons(this._settings, false);
                this._rebuildGrids();
                return GLib.SOURCE_REMOVE;
            });
        };

        this._volumeSignals.push(
            this._volumeMonitor.connect('mount-added', onStorageStateChanged),
            this._volumeMonitor.connect('mount-removed', onStorageStateChanged),
            this._volumeMonitor.connect('volume-added', onStorageStateChanged),
            this._volumeMonitor.connect('volume-removed', onStorageStateChanged),
            this._volumeMonitor.connect('drive-connected', onStorageStateChanged),
            this._volumeMonitor.connect('drive-disconnected', onStorageStateChanged)
        );
        // ------------------------------------------------------------------
        
        this._createAndShowGrids();

        

        this._interfaceSignalId = this._interfaceSettings.connect('changed::color-scheme', () => {
            if (this._settings.get_boolean('follow-system-theme'))
                this._rebuildGrids();
        });

        if (this._interfaceSettings.settings_schema.has_key('accent-color')) {
            this._accentSignalId = this._interfaceSettings.connect('changed::accent-color', () => {
                this._rebuildGrids();
            });
        }

        this._settingSignalIds.push(
            this._settings.connect('changed::grid-cell-size', () => this._rebuildGrids())
        );
        this._settingSignalIds.push(
            this._settings.connect('changed::grid-gap-size', () => this._rebuildGrids())
        );
        this._settingSignalIds.push(
            this._settings.connect('changed::show-widget-border', () => this._rebuildGrids())
        );

        enableDashContextMenu();
    }

    disable() {
        stopMonitor();
        disableDashContextMenu();
        
        // VolumeMonitor szignálok lecsatolása memóriaszivárgás ellen
        if (this._volumeDebounceId > 0) {
            GLib.source_remove(this._volumeDebounceId);
            this._volumeDebounceId = 0;
        }
        if (this._volumeMonitor && this._volumeSignals) {
            this._volumeSignals.forEach(id => this._volumeMonitor.disconnect(id));
            this._volumeSignals = [];
            this._volumeMonitor = null;
        }

        if (this._monitorsChangedTimeoutId > 0) {
            GLib.source_remove(this._monitorsChangedTimeoutId);
            this._monitorsChangedTimeoutId = 0;
        }
        if (this._monitorsChangedId > 0) {
            Main.layoutManager.disconnect(this._monitorsChangedId);
            this._monitorsChangedId = 0;
        }

        if (this._monitorsChangedIdleId) {
            GLib.Source.remove(this._monitorsChangedIdleId);
            this._monitorsChangedIdleId = 0;
        }


        if (this._interfaceSettings && this._interfaceSignalId > 0) {
            this._interfaceSettings.disconnect(this._interfaceSignalId);
            this._interfaceSignalId = 0;
        }
        if (this._interfaceSettings && this._accentSignalId > 0) {
            this._interfaceSettings.disconnect(this._accentSignalId);
            this._accentSignalId = 0;
        }
        this._interfaceSettings = null;
        if (this._settings && this._settingSignalIds.length > 0) {
            this._settingSignalIds.forEach(id => this._settings.disconnect(id));
            this._settingSignalIds = [];
        }
        this._settings = null;

        this._removeAllGrids();
        if (this._screenTimeRelease) {
            this._screenTimeRelease();
            this._screenTimeRelease = null;
        }
        clearMoodStoreCache();
        clearGeocodeCache();
        clearArtworkCaches();
        clearRssEngines();
        clearMusicPlaybackState();
        clearMusicPolls();
        clearEnsuredDirectories();
        clearStorageEngine();
    }

    _spawnGrid(monitorIndex) {
        const grid = new DesktopGrid(this.path, this._settings, this.metadata, monitorIndex, this._interfaceSettings);
        grid.extension = this;
        // _backgroundGroup is private Shell API, but it is the only layer that
        // renders above the wallpaper while staying below every window; GNOME
        // Shell exposes no public accessor for that position.
        Main.layoutManager._backgroundGroup.add_child(grid);
        this._desktopGrids.push(grid);
    }

    _createAndShowGrids() {
        if (this._desktopGrids.length > 0)
            return;

        const settings = this._settings;
        const monitorMode = settings.get_string('global-monitor') || 'primary';
        const nMonitors = global.display.get_n_monitors();

        if (nMonitors === 0) {
            this._spawnGrid(null);
            return;
        }

        if (monitorMode === 'each' && nMonitors > 1) {
            for (let i = 0; i < nMonitors; i++)
                this._spawnGrid(i);
        } else if (monitorMode === 'primary') {
            const prim = global.display.get_primary_monitor();
            this._spawnGrid(prim);
        } else if (monitorMode === 'all') {
            this._spawnGrid(null);
        } else {
            const targetIdx = parseInt(monitorMode, 10);
            const primaryIdx = global.display.get_primary_monitor();
            const validIdx = (!isNaN(targetIdx) && targetIdx >= 0 && targetIdx < nMonitors) ? targetIdx : primaryIdx;
            this._spawnGrid(validIdx);
        }
    }

    _removeAllGrids() {
        this._desktopGrids.forEach(grid => {
            if (grid.get_parent()) {
                grid.get_parent().remove_child(grid);
            }
            grid.destroy();
        });
        this._desktopGrids = [];
    }

    _rebuildGrids() {
        this._removeAllGrids();
        this._createAndShowGrids();
    }
}
