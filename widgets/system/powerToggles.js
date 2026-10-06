import St from 'gi://St';
import Gio from 'gi://Gio';
import Clutter from 'gi://Clutter';

import { 
    parseCssColor, 
    resolveExplicitFontFamily, 
    resolveWidgetForegroundColor 
} from '../../utils/widgetUtils.js';
import { createWidgetContainer, attachResponsiveScaler, attachButtonFeedback } from '../../shell/widgetUIUtils.js';
import { isActorDestroyed } from '../../utils/actorLifecycle.js';

const REF_WIDTH_PX = 180;
const REF_HEIGHT_PX = 180;
const CONTAINER_PADDING_PX = 16;
const BUTTON_SIZE_PX = 60;
const ICON_SIZE_PX = 24;
const BORDER_ALPHA = 0.14;

export function createPowerTogglesNode(config, width, height, xPosition, yPosition) {
    const textColor = resolveWidgetForegroundColor(config);
    const fontFamily = resolveExplicitFontFamily(config);
    const fontCss = fontFamily ? `font-family: ${fontFamily}; ` : '';
    const container = createWidgetContainer(config, width, height, xPosition, yPosition);

    const textBytes = parseCssColor(textColor);
    const textRgb = () => `${Math.round(textBytes.r * 255)},${Math.round(textBytes.g * 255)},${Math.round(textBytes.b * 255)}`;
    container.style += ` border: 1px solid rgba(${textRgb()}, ${BORDER_ALPHA});`;

    let scale = Math.min(width / REF_WIDTH_PX, height / REF_HEIGHT_PX);

    // DBus hívások a műveletekhez
    const executeAction = (action) => {
        try {
            if (action === 'suspend') {
                Gio.DBus.system.call(
                    'org.freedesktop.login1',
                    '/org/freedesktop/login1',
                    'org.freedesktop.login1.Manager',
                    'Suspend',
                    new GLib.Variant('(b)', [true]),
                    null,
                    Gio.DBusCallFlags.NONE,
                    -1,
                    null,
                    null
                );
            } else if (action === 'reboot') {
                Gio.DBus.session.call(
                    'org.gnome.SessionManager',
                    '/org/gnome/SessionManager',
                    'org.gnome.SessionManager',
                    'Reboot',
                    null,
                    null,
                    Gio.DBusCallFlags.NONE,
                    -1,
                    null,
                    null
                );
            } else if (action === 'shutdown') {
                Gio.DBus.session.call(
                    'org.gnome.SessionManager',
                    '/org/gnome/SessionManager',
                    'org.gnome.SessionManager',
                    'Shutdown',
                    null,
                    null,
                    Gio.DBusCallFlags.NONE,
                    -1,
                    null,
                    null
                );
            } else if (action === 'logout') {
                Gio.DBus.session.call(
                    'org.gnome.SessionManager',
                    '/org/gnome/SessionManager',
                    'org.gnome.SessionManager',
                    'Logout',
                    new GLib.Variant('(u)', [1]), // 1 = azonnali megerősítő dialog / logout
                    null,
                    Gio.DBusCallFlags.NONE,
                    -1,
                    null,
                    null
                );
            }
        } catch (e) {
            // Fallback parancssori megoldás
            const cmdMap = {
                suspend: 'systemctl suspend',
                reboot: 'gnome-session-quit --reboot',
                shutdown: 'gnome-session-quit --power-off',
                logout: 'gnome-session-quit --logout',
            };
            if (cmdMap[action]) {
                const proc = new Gio.Subprocess({
                    argv: ['sh', '-c', cmdMap[action]],
                    flags: Gio.SubprocessFlags.NONE,
                });
                proc.init(null);
            }
        }
    };

    // Fő konténer: 2x2 elrendezés
    const mainBox = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
    });
    container.add_child(mainBox);

    const topRow = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_expand: true,
        y_expand: true,
    });
    mainBox.add_child(topRow);

    const bottomRow = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_expand: true,
        y_expand: true,
    });
    mainBox.add_child(bottomRow);

    function createActionButton(initialIcon, onClick) {
        const btn = new St.Button({
            reactive: true,
            can_focus: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
            y_expand: true,
            child: new St.Icon({ icon_name: initialIcon })
        });
        attachButtonFeedback(btn);
        btn.connect('clicked', onClick);
        return btn;
    }

    // 1. Bal felső: Felfüggesztés (Pause / Suspend)
    const suspendBtn = createActionButton('media-playback-pause-symbolic', () => executeAction('suspend'));
    topRow.add_child(suspendBtn);

    // 2. Jobb felső: Újraindítás (Reboot)
    const rebootBtn = createActionButton('view-refresh-symbolic', () => executeAction('reboot'));
    topRow.add_child(rebootBtn);

    // 3. Bal alsó: Leállítás (Power Off)
    const shutdownBtn = createActionButton('system-shutdown-symbolic', () => executeAction('shutdown'));
    bottomRow.add_child(shutdownBtn);

    // 4. Jobb alsó: Kijelentkezés (Logout)
    const logoutBtn = createActionButton('system-log-out-symbolic', () => executeAction('logout'));
    bottomRow.add_child(logoutBtn);

    function updateStyles() {
        const px = (v) => Math.max(1, Math.round(v * scale));
        const btnSize = px(BUTTON_SIZE_PX);
        const iconSize = px(ICON_SIZE_PX);

        const getBtnStyle = (isDanger = false) => {
            const bg = isDanger ? `rgba(235, 64, 52, 0.18)` : `rgba(${textRgb()}, 0.08)`;
            const border = isDanger ? `rgba(235, 64, 52, 0.35)` : `rgba(${textRgb()}, 0.12)`;
            return `width: ${btnSize}px; height: ${btnSize}px; `
                 + `border-radius: 9999px; `
                 + `background-color: ${bg}; `
                 + `border: 1px solid ${border};`;
        };

        suspendBtn.style = getBtnStyle(false);
        suspendBtn.child.icon_size = iconSize;

        rebootBtn.style = getBtnStyle(false);
        rebootBtn.child.icon_size = iconSize;

        // A leállítás és kijelentkezés kaphat egy nagyon finom pirosas hangsúlyt, vagy sima textRgb-t
        shutdownBtn.style = getBtnStyle(true);
        shutdownBtn.child.icon_size = iconSize;

        logoutBtn.style = getBtnStyle(false);
        logoutBtn.child.icon_size = iconSize;
    }

    function applyScale(newScale) {
        scale = newScale;
        const px = (v) => Math.max(1, Math.round(v * scale));
        mainBox.style = `padding: ${px(CONTAINER_PADDING_PX)}px; spacing: ${px(10)}px;`;
        topRow.style = `spacing: ${px(10)}px;`;
        bottomRow.style = `spacing: ${px(10)}px;`;
        updateStyles();
    }

    applyScale(scale);

    attachResponsiveScaler(container, REF_WIDTH_PX, REF_HEIGHT_PX, (_ratio, w, h) => {
        if (isActorDestroyed(container)) return;
        applyScale(Math.min(w / REF_WIDTH_PX, h / REF_HEIGHT_PX));
    });

    return container;
}