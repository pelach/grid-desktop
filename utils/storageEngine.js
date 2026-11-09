import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const DEFAULT_REFRESH_INTERVAL_SEC = 900; // 15 perc nyugodt háttérciklus

class StorageEngine {
    constructor() {
        this._subscribers = new Map(); // targetPath => Set of callbacks
        this._timerId = null;
        this._isScanning = false;
        this._cache = new Map(); // targetPath => data

        // GIO Volume Monitor: azonnali esemény, ha meghajtót csatolnak / lecsatolnak!
        this._volumeMonitor = Gio.VolumeMonitor.get();
        this._mountAddedId = this._volumeMonitor.connect('mount-added', () => {
            this.refreshAll();
        });
        this._mountRemovedId = this._volumeMonitor.connect('mount-removed', () => {
            this.refreshAll();
        });
    }

    subscribe(targetPath = '/', callback) {
        const normPath = targetPath || '/';
        if (!this._subscribers.has(normPath)) {
            this._subscribers.set(normPath, new Set());
        }
        const set = this._subscribers.get(normPath);
        set.add(callback);

        const cached = this._cache.get(normPath);
        if (cached) {
            try {
                callback(cached);
            } catch (e) {
                logError(e, `[StorageEngine] Initial callback error`);
            }
        }

        if (this._getTotalSubscribersCount() === 1) {
            this.refreshAll();
            this._startTimer();
        } else if (!cached) {
            this.refreshPath(normPath);
        }

        return () => {
            set.delete(callback);
            if (set.size === 0) {
                this._subscribers.delete(normPath);
            }
            if (this._getTotalSubscribersCount() === 0) {
                this._stopTimer();
            }
        };
    }

    _getTotalSubscribersCount() {
        let count = 0;
        for (const set of this._subscribers.values()) count += set.size;
        return count;
    }

    _startTimer() {
        this._stopTimer();
        this._timerId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT,
            DEFAULT_REFRESH_INTERVAL_SEC,
            () => {
                this.refreshAll();
                return GLib.SOURCE_CONTINUE;
            }
        );
    }

    _stopTimer() {
        if (this._timerId) {
            GLib.source_remove(this._timerId);
            this._timerId = null;
        }
    }

    refreshAll() {
        for (const path of this._subscribers.keys()) {
            this.refreshPath(path);
        }
    }

    async refreshPath(targetPath = '/') {
        try {
            const data = await this._scanPathAsync(targetPath);
            
            const resultData = data || {
                path: targetPath,
                isUnmounted: true,
                total: 0,
                free: 0,
                used: 0,
                categories: { system: 0, media: 0, archive: 0, image: 0, docs: 0, other: 0 },
            };

            this._cache.set(targetPath, resultData);
            const set = this._subscribers.get(targetPath);
            if (set) {
                for (const cb of set) {
                    try {
                        cb(resultData);
                    } catch (err) {
                        logError(err, `[StorageEngine] Callback error`);
                    }
                }
            }
        } catch (err) {
            logError(err, `[StorageEngine] Scan failed for ${targetPath}`);
        }
    }

    async _scanPathAsync(targetPath = '/') {
        const fsInfo = await this._getFsInfoAsync(targetPath);
        if (!fsInfo) return null;

        const total = fsInfo.total;
        const free = fsInfo.free;
        const used = Math.max(0, total - free);

        return {
            path: targetPath,
            total,
            free,
            used,
            categories: {
                system: used,
                media: 0,
                archive: 0,
                image: 0,
                docs: 0,
                other: 0,
            },
        };
    }

    _getFsInfoAsync(mountPath = '/') {
        return new Promise((resolve) => {
            try {
                const file = Gio.File.new_for_path(mountPath);
                file.query_filesystem_info_async(
                    'filesystem::size,filesystem::free',
                    GLib.PRIORITY_LOW,
                    null,
                    (f, res) => {
                        try {
                            const info = f.query_filesystem_info_finish(res);
                            const total = info.get_attribute_uint64('filesystem::size');
                            const free = info.get_attribute_uint64('filesystem::free');
                            resolve({ total, free });
                        } catch {
                            resolve(null);
                        }
                    }
                );
            } catch {
                resolve(null);
            }
        });
    }

    destroy() {
        this._stopTimer();

        if (this._volumeMonitor) {
            if (this._mountAddedId) {
                this._volumeMonitor.disconnect(this._mountAddedId);
                this._mountAddedId = null;
            }
            if (this._mountRemovedId) {
                this._volumeMonitor.disconnect(this._mountRemovedId);
                this._mountRemovedId = null;
            }
            this._volumeMonitor = null;
        }

        this._subscribers.clear();
        this._cache.clear();
    }
}

export const storageEngine = new StorageEngine();
export function clearStorageEngine() {
    storageEngine.destroy();
}