import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const DEFAULT_HOST = '1.1.1.1';
const PING_INTERVAL_MS = 2500;
const REGEX_PING_TIME = /time=([0-9.]+)\s*ms/;

class PingMonitorEngine {
    constructor() {
        this._subscribers = new Map();
        this._nextId = 1;
        this._timerId = null;
        this._isProbing = false;
        this._host = DEFAULT_HOST;
    }

    setHost(newHost) {
        const target = (newHost && newHost.trim()) ? newHost.trim() : DEFAULT_HOST;
        if (this._host !== target) {
            this._host = target;
            if (this._subscribers.size > 0 && !this._isProbing) {
                this._probe();
            }
        }
    }

    getHost() {
        return this._host;
    }

    subscribe(callback) {
        const id = this._nextId++;
        this._subscribers.set(id, callback);

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

        this._probe();
        this._timerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, PING_INTERVAL_MS, () => {
            this._probe();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _stop() {
        if (this._timerId) {
            GLib.source_remove(this._timerId);
            this._timerId = null;
        }
        this._isProbing = false;
    }

    _notify(pingData) {
        for (const callback of this._subscribers.values()) {
            try {
                callback(pingData);
            } catch (err) {
                logError(err, 'PingEngine subscriber notification error');
            }
        }
    }

    _probe() {
        if (this._isProbing) return;
        this._isProbing = true;

        const host = this._host;
        const argv = ['ping', '-c', '1', '-W', '1', host];

        let launcher;
        try {
            launcher = new Gio.SubprocessLauncher({
                flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
            });
        } catch (e) {
            this._isProbing = false;
            this._notify({ host, ms: -1, isOnline: false });
            return;
        }

        let proc;
        try {
            proc = launcher.spawnv(argv);
        } catch (e) {
            this._isProbing = false;
            this._notify({ host, ms: -1, isOnline: false });
            return;
        }

        proc.communicate_utf8_async(null, null, (source, res) => {
            let stdout = '';
            let isSuccess = false;

            try {
                const [, out] = source.communicate_utf8_finish(res);
                stdout = out || '';
                isSuccess = source.get_successful();
            } catch (e) {
                isSuccess = false;
            }

            this._isProbing = false;

            if (isSuccess && stdout) {
                const match = stdout.match(REGEX_PING_TIME);
                if (match && match[1]) {
                    const msValue = parseFloat(match[1]);
                    this._notify({
                        host,
                        ms: msValue,
                        isOnline: true,
                    });
                    return;
                }
            }

            // Timeout vagy sikertelen kérés esetén
            this._notify({
                host,
                ms: -1,
                isOnline: false,
            });
        });
    }
}

export const pingEngine = new PingMonitorEngine();