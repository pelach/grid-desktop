import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {
    resolveWidgetForegroundColor,
    resolveExplicitFontFamily,
} from '../../utils/widgetUtils.js';
import { createWidgetContainer, registerWidgetCleanup, attachResponsiveScaler } from '../../shell/widgetUIUtils.js';

const BASE_CONTAINER_WIDTH = 200;
const BASE_CONTAINER_HEIGHT = 200;

function getFlatpakUpdateCount(callback) {
    if (!GLib.find_program_in_path('flatpak')) {
        callback(0);
        return;
    }

    try {
        const proc = new Gio.Subprocess({
            argv: ['sh', '-c', 'LC_ALL=C flatpak remote-ls --updates 2>/dev/null | wc -l'],
            flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE,
        });
        proc.init(null);
        proc.communicate_utf8_async(null, null, (p, res) => {
            try {
                const [, stdout] = p.communicate_utf8_finish(res);
                const count = parseInt(stdout?.trim() || '0', 10);
                callback(isNaN(count) ? 0 : count);
            } catch (_) {
                callback(0);
            }
        });
    } catch (_) {
        callback(0);
    }
}

// Csomagkezelő felderítése parancs és felirat szerint
function detectPackageManager() {
    if (GLib.find_program_in_path('checkupdates')) {
        return {
            name: 'Pacman',
            cmd: ['sh', '-c', 'LC_ALL=C checkupdates 2>/dev/null | wc -l'],
        };
    }
    if (GLib.file_test('/usr/lib/update-notifier/apt-check', GLib.FileTest.EXISTS)) {
        return {
            name: 'APT',
            cmd: ['sh', '-c', '/usr/lib/update-notifier/apt-check 2>/dev/null | cut -d";" -f1'],
        };
    }
    if (GLib.find_program_in_path('apt')) {
        return {
            name: 'APT',
            cmd: ['sh', '-c', 'LC_ALL=C apt list --upgradable 2>/dev/null | grep -c "/"'],
        };
    }
    if (GLib.find_program_in_path('dnf')) {
        return {
            name: 'DNF',
            cmd: ['sh', '-c', "LC_ALL=C dnf check-update -q 2>/dev/null | grep -E '^[a-zA-Z0-9]' | wc -l || true"],
        };
    }
    if (GLib.find_program_in_path('zypper')) {
        return {
            name: 'Zypper',
            cmd: ['sh', '-c', "LC_ALL=C zypper -qn lu 2>/dev/null | grep -E '^v ' | wc -l"],
        };
    }
    return {
        name: 'Updates',
        cmd: null,
    };
}

export function createUpdatesNode(config, width, height, xPosition, yPosition) {
    const fontFamily = resolveExplicitFontFamily(config);
    const fontCss = fontFamily ? `font-family: ${fontFamily}; ` : '';
    const textColor = resolveWidgetForegroundColor(config);
    const container = createWidgetContainer(config, width, height, xPosition, yPosition);

    let scale = Math.max(0.65, Math.min(width / BASE_CONTAINER_WIDTH, height / BASE_CONTAINER_HEIGHT));
    const pm = detectPackageManager();

    const mainLayout = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
    });
    container.add_child(mainLayout);

    // ── 1. Egységes Fejléc: Bal felül ikon + csomagkezelő név ──
    const headerBox = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_expand: true,
        y_align: Clutter.ActorAlign.START,
    });

    const headerIcon = new St.Icon({
        icon_name: 'software-update-available-symbolic',
        style: `color: ${textColor};`,
        y_align: Clutter.ActorAlign.CENTER,
    });

    const headerLabel = new St.Label({
        text: pm.name,
        y_align: Clutter.ActorAlign.CENTER,
    });
    headerLabel.clutter_text.set_ellipsize(0);

    headerBox.add_child(headerIcon);
    headerBox.add_child(headerLabel);
    mainLayout.add_child(headerBox);

    // ── 2. Középre zárt doboz: A nagy szám ──
    const centerBox = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
    });

    const countLabel = new St.Label({
        text: '--',
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
    });

    centerBox.add_child(countLabel);
    mainLayout.add_child(centerBox);

    function applyScale(newScale) {
        scale = newScale;
        const titleFontSize = Math.max(11, Math.round(13 * scale));
        const iconSize = Math.round(16 * scale);
        const valSize = Math.max(32, Math.round(44 * scale));

        mainLayout.style = `padding: ${Math.max(8, Math.round(10 * scale))}px;`;
        headerBox.style = `margin-bottom: ${Math.round(6 * scale)}px;`;
        headerIcon.icon_size = iconSize;
        headerIcon.style = `color: ${textColor}; margin-right: 6px;`;
        headerLabel.style = `${fontCss}color: ${textColor}; font-size: ${titleFontSize}px; font-weight: bold; opacity: 0.9;`;
        countLabel.style = `${fontCss}color: ${textColor}; font-size: ${valSize}px; font-weight: bold; line-height: 1.0;`;
    }

    applyScale(scale);

    attachResponsiveScaler(container, BASE_CONTAINER_WIDTH, BASE_CONTAINER_HEIGHT, (_ratio, w, h) => {
        applyScale(Math.max(0.65, Math.min(w / BASE_CONTAINER_WIDTH, h / BASE_CONTAINER_HEIGHT)));
    });

    let isDisposed = false;

    const checkUpdates = () => {
        const runNativeCheck = () => {
            return new Promise((resolve) => {
                if (!pm.cmd) return resolve(0);
                try {
                    const proc = new Gio.Subprocess({
                        argv: pm.cmd,
                        flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE,
                    });
                    proc.init(null);
                    proc.communicate_utf8_async(null, null, (p, res) => {
                        try {
                            const [, stdout] = p.communicate_utf8_finish(res);
                            const count = parseInt(stdout?.trim() || '0', 10);
                            resolve(isNaN(count) ? 0 : count);
                        } catch (_) {
                            resolve(0);
                        }
                    });
                } catch (_) {
                    resolve(0);
                }
            });
        };

        const runFlatpakCheck = () => {
            return new Promise((resolve) => {
                getFlatpakUpdateCount((count) => resolve(count));
            });
        };

        Promise.all([runNativeCheck(), runFlatpakCheck()]).then(([nativeCount, flatpakCount]) => {
            if (isDisposed) return;
            const total = nativeCount + flatpakCount;
            countLabel.set_text(`${total}`);

            if (total === 0) {
                headerIcon.set_icon_name('emblem-ok-symbolic');
            } else {
                headerIcon.set_icon_name('software-update-available-symbolic');
            }

            if (flatpakCount > 0 && nativeCount > 0) {
                headerLabel.set_text(`${pm.name} + FP`);
            } else if (flatpakCount > 0 && nativeCount === 0) {
                headerLabel.set_text('Flatpak');
            } else {
                headerLabel.set_text(pm.name);
            }
        });
    };

    checkUpdates();

    // 30 percenkénti ellenőrzés
    const timeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1800, () => {
        if (isDisposed) return GLib.SOURCE_REMOVE;
        checkUpdates();
        return GLib.SOURCE_CONTINUE;
    });

    registerWidgetCleanup(container, () => {
        isDisposed = true;
        if (timeoutId) GLib.source_remove(timeoutId);
    });

    return container;
}