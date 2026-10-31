import St from 'gi://St';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';

import { 
    parseCssColor, 
    resolveExplicitFontFamily, 
    resolveWidgetForegroundColor 
} from '../../utils/widgetUtils.js';
import { createWidgetContainer, attachResponsiveScaler, attachButtonFeedback } from '../../shell/widgetUIUtils.js';
import { isActorDestroyed } from '../../utils/actorLifecycle.js';

const BASE_CONTAINER_SIZE = 200;
const CONTAINER_PADDING_PX = 12;
const BUTTON_SIZE_PX = 62;
const ICON_SIZE_PX = 24;

export function createPowerTogglesNode(config, width, height, xPosition, yPosition) {
    const textColor = resolveWidgetForegroundColor(config);
    const fontFamily = resolveExplicitFontFamily(config);
    const fontCss = fontFamily ? `font-family: ${fontFamily}; ` : '';
    const container = createWidgetContainer(config, width, height, xPosition, yPosition);

    const textBytes = parseCssColor(textColor);
    const textRgb = () => `${Math.round(textBytes.r * 255)},${Math.round(textBytes.g * 255)},${Math.round(textBytes.b * 255)}`;

    let scale = Math.max(0.65, Math.min(width, height) / BASE_CONTAINER_SIZE);

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
                    new GLib.Variant('(u)', [1]),
                    null,
                    Gio.DBusCallFlags.NONE,
                    -1,
                    null,
                    null
                );
            }
        } catch (e) {
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

    const suspendBtn = createActionButton('media-playback-pause-symbolic', () => executeAction('suspend'));
    topRow.add_child(suspendBtn);

    const rebootBtn = createActionButton('view-refresh-symbolic', () => executeAction('reboot'));
    topRow.add_child(rebootBtn);

    const shutdownBtn = createActionButton('system-shutdown-symbolic', () => executeAction('shutdown'));
    bottomRow.add_child(shutdownBtn);

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

    attachResponsiveScaler(container, BASE_CONTAINER_SIZE, BASE_CONTAINER_SIZE, (_ratio, w, h) => {
        if (isActorDestroyed(container)) return;
        applyScale(Math.max(0.65, Math.min(w, h) / BASE_CONTAINER_SIZE));
    });

    return container;
}