import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

const DEFAULT_POLL_INTERVAL_MS = 60000;

class MailMonitorEngine {
    constructor() {
        this._subscribers = new Map();
        this._nextId = 1;
        this._timerId = null;
        this._isFetching = false;
        this._lastData = { unreadTotal: 0, accounts: [] };
    }

    subscribe(callback) {
        const id = this._nextId++;
        this._subscribers.set(id, callback);

        if (this._lastData) {
            callback(this._lastData);
        }

        if (this._subscribers.size === 1) {
            this._start();
        }

        return () => {
            this._subscribers.delete(id);
            if (this._subscribers.size === 0) {
                this._stop();
            }
        };
    }

    _start() {
        if (this._timerId) return;

        this._fetch();
        this._timerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, DEFAULT_POLL_INTERVAL_MS, () => {
            this._fetch();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _stop() {
        if (this._timerId) {
            GLib.source_remove(this._timerId);
            this._timerId = null;
        }
        this._isFetching = false;
    }

    _notify(data) {
        this._lastData = data;
        for (const callback of this._subscribers.values()) {
            try {
                callback(data);
            } catch (err) {
                console.error('MailEngine subscriber error:', err);
            }
        }
    }

    _getScriptPath() {
        // import.meta.url = file:///.../utils/mailEngine.js
        const currentFile = Gio.File.new_for_uri(import.meta.url);
        const utilsDir = currentFile.get_parent(); // Ez maga a 'utils' mappa
        const scriptFile = utilsDir.get_child('mail_fetcher.py');
        return scriptFile.get_path();
    }

    _fetch() {
        if (this._isFetching) return;
        this._isFetching = true;

        const scriptPath = this._getScriptPath();

        try {
            const proc = new Gio.Subprocess({
                argv: ['python3', scriptPath],
                flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_MERGE,
            });

            proc.init(null);

            proc.communicate_utf8_async(null, null, (p, res) => {
                this._isFetching = false;
                try {
                    const [, stdout] = p.communicate_utf8_finish(res);

                    if (p.get_successful()) {
                        // Kikeressük az utolsó érvényes JSON sort (ha esetleg stderr sorok is jönnének)
                        const lines = stdout.trim().split('\n');
                        const lastLine = lines[lines.length - 1];
                        const data = JSON.parse(lastLine);

                        this._notify({
                            unreadTotal: data.unreadTotal ?? 0,
                            accounts: data.accounts ?? [],
                            error: false,
                        });
                    } else {
                        console.warn('MailEngine: Python script returned an error:', stdout);
                    }
                } catch (err) {
                    console.warn('MailEngine: Output processing error:', err.message);
                }
            });
        } catch (e) {
            this._isFetching = false;
            console.warn('MailEngine: Subprocess startup error:', e.message);
        }
    }
}

export const mailEngine = new MailMonitorEngine();