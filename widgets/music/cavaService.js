import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const NUM_BARS = 32;

const subscribers = new Set();
let cavaPath = undefined;
let cavaSubproc = null;
let cavaCancellable = null;
let inputStream = null;
let barValues = new Uint8Array(NUM_BARS);

const runtimeDir = GLib.get_user_runtime_dir();
const userName = GLib.get_user_name();
const fifoPath = GLib.build_filenamev([runtimeDir, `grid_desktop_cava_${userName}.fifo`]);
const confPath = GLib.build_filenamev([runtimeDir, `grid_desktop_cava_${userName}.conf`]);

function findCava() {
    if (cavaPath !== undefined)
        return cavaPath;

    const path = GLib.find_program_in_path('cava');
    if (path) {
        cavaPath = path;
        return cavaPath;
    }

    const fallbacks = [
        '/snap/bin/cava',
        GLib.build_filenamev([GLib.get_home_dir(), '.local', 'bin', 'cava']),
        '/usr/local/bin/cava',
    ];

    cavaPath = fallbacks.find(fb => GLib.file_test(fb, GLib.FileTest.IS_EXECUTABLE)) || null;
    return cavaPath;
}

export function isCavaAvailable() {
    return Boolean(findCava());
}

function readStreamLoop() {
    if (!inputStream || !cavaCancellable || cavaCancellable.is_cancelled())
        return;

    inputStream.read_bytes_async(NUM_BARS, GLib.PRIORITY_DEFAULT, cavaCancellable, (stream, res) => {
        try {
            const gBytes = stream.read_bytes_finish(res);
            const data = gBytes?.get_data();
            if (data && data.length === NUM_BARS) {
                barValues = data;
                for (const cb of subscribers)
                    cb(barValues);
            }
            if (!cavaCancellable?.is_cancelled())
                readStreamLoop();
        } catch (_e) {
            // Cancellable megszakítás vagy stream lezárás
        }
    });
}

function stopCavaProcess() {
    if (cavaCancellable) {
        cavaCancellable.cancel();
        cavaCancellable = null;
    }
    if (inputStream) {
        try { inputStream.close(null); } catch (_e) {}
        inputStream = null;
    }
    if (cavaSubproc) {
        try { cavaSubproc.force_exit(); } catch (_e) {}
        cavaSubproc = null;
    }
    barValues.fill(0);
}

function startCavaProcess() {
    const bin = findCava();
    if (!bin || cavaSubproc)
        return;

    try {
        const confContent = `[general]\nbars = ${NUM_BARS}\nframerate = 22\n`
            + `[input]\nmethod = pulse\nsource = @DEFAULT_MONITOR@\n`
            + `[output]\nmethod = raw\nraw_target = ${fifoPath}\ndata_format = binary\nbit_format = 8bit\n`;
        GLib.file_set_contents(confPath, confContent);

        if (!GLib.file_test(fifoPath, GLib.FileTest.EXISTS)) {
            const mkfifo = Gio.Subprocess.new(['mkfifo', fifoPath], Gio.SubprocessFlags.NONE);
            mkfifo.wait(null);
        }

        cavaCancellable = new Gio.Cancellable();
        cavaSubproc = Gio.Subprocess.new([bin, '-p', confPath], Gio.SubprocessFlags.NONE);

        const fifoFile = Gio.File.new_for_path(fifoPath);
        fifoFile.read_async(GLib.PRIORITY_DEFAULT, cavaCancellable, (_f, res) => {
            try {
                inputStream = fifoFile.read_finish(res);
                readStreamLoop();
            } catch (_e) {
                stopCavaProcess();
            }
        });
    } catch (_e) {
        stopCavaProcess();
    }
}

/**
 * Feliratkozás az élő spektrum adatokra. Az első feliratkozó elindítja a CAVA-t,
 * az utolsó leiratkozó leállítja. Visszatérési értéke a leiratkozó függvény.
 */
export function subscribeCava(callback) {
    subscribers.add(callback);
    if (subscribers.size === 1)
        startCavaProcess();

    return () => {
        subscribers.delete(callback);
        if (subscribers.size === 0)
            stopCavaProcess();
    };
}

/** Kötelező takarítás extension disable() híváskor. */
export function destroyCavaService() {
    subscribers.clear();
    stopCavaProcess();
    try {
        Gio.File.new_for_path(fifoPath).delete(null);
        Gio.File.new_for_path(confPath).delete(null);
    } catch (_e) {}
}