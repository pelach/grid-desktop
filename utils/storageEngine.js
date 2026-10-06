import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const DEFAULT_REFRESH_INTERVAL_SEC = 900; // 15 perc alapértelmezett frissítés

class StorageEngine {
    constructor() {
        this._subscribers = new Set();
        this._timerId = null;
        this._isScanning = false;
        this._cachedData = null;
    }

    subscribe(callback) {
        this._subscribers.add(callback);

        // Ha van már gyorsítótárazott adatunk, azonnal átadjuk
        if (this._cachedData) {
            try {
                callback(this._cachedData);
            } catch (e) {
                console.error(`[StorageEngine] Initial callback error: ${e}`);
            }
        }

        // Első feliratkozó esetén elindítjuk a ciklust
        if (this._subscribers.size === 1) {
            this.refresh();
            this._startTimer();
        }

        return () => {
            this._subscribers.delete(callback);
            if (this._subscribers.size === 0) {
                this._stopTimer();
            }
        };
    }

    _startTimer() {
        this._stopTimer();
        this._timerId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT,
            DEFAULT_REFRESH_INTERVAL_SEC,
            () => {
                this.refresh();
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

    refresh() {
        if (this._isScanning)
            return;

        this._isScanning = true;
        this._scanAllAsync()
            .then((data) => {
                this._isScanning = false;
                if (!data) return;

                this._cachedData = data;
                for (const cb of this._subscribers) {
                    try {
                        cb(data);
                    } catch (err) {
                        console.error(`[StorageEngine] Callback error: ${err}`);
                    }
                }
            })
            .catch((err) => {
                this._isScanning = false;
                console.error(`[StorageEngine] Scan failed: ${err}`);
            });
    }

    async _scanAllAsync() {
        const rootInfo = await this._getFsInfoAsync('/');
        const homeBreakdown = await this._runFindAwkAsync();

        if (!rootInfo)
            return null;

        const total = rootInfo.total;
        const free = rootInfo.free;
        const used = Math.max(0, total - free);

        const video = homeBreakdown.video || 0;
        const audio = homeBreakdown.audio || 0;
        const media = video + audio;
        const archive = homeBreakdown.archive || 0;
        const image = homeBreakdown.image || 0;
        const docs = homeBreakdown.docs || 0;
        const otherHome = homeBreakdown.other || 0;

        const categorizedHomeSum = media + archive + image + docs + otherHome;
        // Rendszer + alkalmazások = teljes használt lemez mínusz a kategorizált home adatok
        const system = Math.max(0, used - categorizedHomeSum);

        return {
            total,
            free,
            used,
            categories: {
                system,
                media,
                archive,
                image,
                docs,
                other: otherHome,
            },
        };
    }

    _getFsInfoAsync(mountPath = '/') {
        return new Promise((resolve) => {
            try {
                const file = Gio.File.new_for_path(mountPath);
                file.query_filesystem_info_async(
                    'filesystem::size,filesystem::free',
                    GLib.PRIORITY_DEFAULT,
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

    _runFindAwkAsync() {
        return new Promise((resolve) => {
            const shellCommand = `find "$HOME" -maxdepth 6 -name ".*" -prune -o -type f -printf "%b\\t%p\\n" 2>/dev/null | awk -F'\\t' '{
                size = $1 * 512;
                n = split(tolower($2), parts, ".");
                ext = (n > 1) ? parts[n] : "none";
                if (ext ~ /^(mp4|mkv|avi|mov|webm)$/) video += size;
                else if (ext ~ /^(mp3|flac|wav|ogg|aac|m4a|wma)$/) audio += size;
                else if (ext ~ /^(jpg|jpeg|png|gif|webp|svg|bmp)$/) image += size;
                else if (ext ~ /^(pdf|doc|docx|odt|ods|odp|txt|xls|xlsx|csv)$/) docs += size;
                else if (ext ~ /^(zip|tar|gz|7z|rar|iso|deb)$/) archive += size;
                else other += size;
            }
            END {
                printf "{\\"video\\":%d,\\"audio\\":%d,\\"image\\":%d,\\"docs\\":%d,\\"archive\\":%d,\\"other\\":%d}\\n", video, audio, image, docs, archive, other;
            }'`;

            try {
                const proc = Gio.Subprocess.new(
                    ['/bin/bash', '-c', shellCommand],
                    Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE
                );

                proc.communicate_utf8_async(null, null, (p, res) => {
                    try {
                        const [, stdout] = p.communicate_utf8_finish(res);
                        if (stdout) {
                            const parsed = JSON.parse(stdout.trim());
                            resolve(parsed);
                            return;
                        }
                    } catch (e) {
                        console.error(`[StorageEngine] Parse error: ${e}`);
                    }
                    resolve({});
                });
            } catch (err) {
                console.error(`[StorageEngine] Subprocess spawn error: ${err}`);
                resolve({});
            }
        });
    }
}

export const storageEngine = new StorageEngine();