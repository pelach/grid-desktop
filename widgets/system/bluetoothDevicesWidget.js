import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

import { 
    resolveExplicitFontFamily, 
    resolveWidgetForegroundColor,
    resolveWidgetBackgroundColor,
    cssColorToRgba,
    isDarkBackgroundColor,
} from '../../utils/widgetUtils.js';

import { 
    createWidgetContainer, 
    attachResponsiveScaler,
    registerWidgetCleanup,
} from '../../shell/widgetUIUtils.js';

import { isActorDestroyed } from '../../utils/actorLifecycle.js';

const BASE_CONTAINER_WIDTH_PX = 200;
const BASE_CONTAINER_HEIGHT_PX = 200;
const CARD_BG_DARK_ALPHA = 0.05;
const CARD_BG_LIGHT_ALPHA = 0.04;
const CARD_BORDER_DARK_ALPHA = 0.06;
const CARD_BORDER_LIGHT_ALPHA = 0.10;

export function createBluetoothDevicesNode(config, width, height, xPosition, yPosition) {
    const fontFamily = resolveExplicitFontFamily(config);
    const fontCss = fontFamily ? `font-family: ${fontFamily}; ` : '';
    const textColor = resolveWidgetForegroundColor(config);
    const container = createWidgetContainer(config, width, height, xPosition, yPosition);

    let scale = Math.max(0.65, Math.min(width / BASE_CONTAINER_WIDTH_PX, height / BASE_CONTAINER_HEIGHT_PX));
    let isDisposed = false;
    const cancellable = new Gio.Cancellable();

    const isDarkSurface = isDarkBackgroundColor(resolveWidgetBackgroundColor(config));
    const cardBgAlpha = isDarkSurface ? CARD_BG_DARK_ALPHA : CARD_BG_LIGHT_ALPHA;
    const cardBorderAlpha = isDarkSurface ? CARD_BORDER_DARK_ALPHA : CARD_BORDER_LIGHT_ALPHA;

    const contentBox = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
    });
    container.add_child(contentBox);

    const headerBox = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_expand: true,
    });
    const headerIcon = new St.Icon({
        icon_name: 'bluetooth-active-symbolic',
        style: `color: ${textColor};`,
        y_align: Clutter.ActorAlign.CENTER,
    });
    const headerLabel = new St.Label({
        text: 'Bluetooth Devices',
        y_align: Clutter.ActorAlign.CENTER,
    });
    headerLabel.clutter_text.set_ellipsize(0);
    headerBox.add_child(headerIcon);
    headerBox.add_child(headerLabel);
    contentBox.add_child(headerBox);

    const scrollView = new St.ScrollView({
        hscrollbar_policy: St.PolicyType.NEVER,
        vscrollbar_policy: St.PolicyType.AUTOMATIC,
        overlay_scrollbars: false,
        x_expand: true,
        y_expand: true,
    });
    contentBox.add_child(scrollView);

    const listContainer = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
    });
    scrollView.set_child(listContainer);

    let lastDevices = [];

    function fetchConnectedBluetoothDevices() {
        return new Promise((resolve) => {
            Gio.DBus.system.call(
                'org.bluez',
                '/',
                'org.freedesktop.DBus.ObjectManager',
                'GetManagedObjects',
                null,
                null,
                Gio.DBusCallFlags.NONE,
                -1,
                cancellable,
                (conn, res) => {
                    try {
                        const reply = conn.call_finish(res);
                        const [objects] = reply.recursiveUnpack();
                        const connectedList = [];

                        for (const [path, interfaces] of Object.entries(objects)) {
                            const dev = interfaces['org.bluez.Device1'];
                            if (dev && dev.Connected) {
                                const battery = interfaces['org.bluez.Battery1'];
                                connectedList.push({
                                    path,
                                    name: dev.Alias || dev.Name || 'Unknown Device',
                                    icon: dev.Icon || 'bluetooth-active-symbolic',
                                    battery: battery ? battery.Percentage : null,
                                });
                            }
                        }
                        resolve(connectedList);
                    } catch (_e) {
                        resolve([]);
                    }
                }
            );
        });
    }

    function disconnectDevice(devicePath, callback) {
        Gio.DBus.system.call(
            'org.bluez',
            devicePath,
            'org.bluez.Device1',
            'Disconnect',
            null,
            null,
            Gio.DBusCallFlags.NONE,
            -1,
            cancellable,
            (conn, res) => {
                try { conn.call_finish(res); } catch (_e) {}
                if (callback && !isDisposed) callback();
            }
        );
    }

    function renderDevicesList(devices) {
        if (isDisposed || isActorDestroyed(container)) return;
        listContainer.destroy_all_children();

        const cardPadding = Math.max(5, Math.round(8 * scale));
        const cardRadius = Math.max(6, Math.round(10 * scale));
        const rowGap = Math.max(4, Math.round(6 * scale));
        const rightScrollGap = Math.max(6, Math.round(8 * scale));
        const deviceFontSize = Math.max(11, Math.round(13 * scale));
        const iconSize = Math.max(16, Math.round(18 * scale));
        const batteryFontSize = Math.max(9, Math.round(11 * scale));

        if (devices.length === 0) {
            const emptyLabel = new St.Label({
                text: 'No connected devices',
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
                style: `${fontCss}color: ${textColor}; opacity: 0.5; font-size: ${deviceFontSize}px; margin-top: 20px;`,
            });
            listContainer.add_child(emptyLabel);
            return;
        }

        for (const dev of devices) {
            const rowBtn = new St.Button({
                reactive: true,
                can_focus: true,
                x_expand: true,
            });

            const bg = cssColorToRgba(textColor, cardBgAlpha);
            const border = cssColorToRgba(textColor, cardBorderAlpha);

            rowBtn.style = `background-color: ${bg}; `
                + `border: 1px solid ${border}; `
                + `border-radius: ${cardRadius}px; `
                + `padding: ${cardPadding}px; `
                + `margin-bottom: ${rowGap}px; `
                + `margin-right: ${rightScrollGap}px;`;

            const rowBox = new St.BoxLayout({
                orientation: Clutter.Orientation.HORIZONTAL,
                x_expand: true,
                y_align: Clutter.ActorAlign.CENTER,
            });
            rowBtn.set_child(rowBox);

            let iconName = dev.icon;
            if (!iconName.endsWith('-symbolic')) {
                iconName += '-symbolic';
            }

            const devIcon = new St.Icon({
                icon_name: iconName,
                icon_size: iconSize,
                style: `color: ${textColor}; opacity: 0.9; margin-right: ${Math.round(8 * scale)}px;`,
                y_align: Clutter.ActorAlign.CENTER,
            });
            rowBox.add_child(devIcon);

            const nameLabel = new St.Label({
                text: dev.name,
                x_expand: true,
                y_align: Clutter.ActorAlign.CENTER,
                style: `${fontCss}color: ${textColor}; font-size: ${deviceFontSize}px; font-weight: 500;`,
            });
            nameLabel.clutter_text.set_ellipsize(3);
            rowBox.add_child(nameLabel);

            if (dev.battery !== null && dev.battery !== undefined) {
                const batteryLabel = new St.Label({
                    text: `${dev.battery}%`,
                    y_align: Clutter.ActorAlign.CENTER,
                    style: `${fontCss}color: ${textColor}; opacity: 0.6; font-size: ${batteryFontSize}px; margin-right: 6px;`,
                });
                rowBox.add_child(batteryLabel);
            }

            const disconnectIcon = new St.Icon({
                icon_name: 'media-eject-symbolic',
                icon_size: Math.round(14 * scale),
                style: `color: ${textColor}; opacity: 0.5;`,
                y_align: Clutter.ActorAlign.CENTER,
            });
            rowBox.add_child(disconnectIcon);

            rowBtn.connect('clicked', () => {
                rowBtn.reactive = false;
                rowBtn.style += ' opacity: 0.5;';
                disconnectDevice(dev.path, () => {
                    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 150, () => {
                        refreshDevices();
                        return GLib.SOURCE_REMOVE;
                    });
                });
            });

            listContainer.add_child(rowBtn);
        }
    }

    async function refreshDevices() {
        if (isDisposed || isActorDestroyed(container)) return;
        lastDevices = await fetchConnectedBluetoothDevices();
        renderDevicesList(lastDevices);
    }

    function applyScale(newScale) {
        scale = newScale;
        const titleFontSize = Math.max(11, Math.round(13 * scale));

        headerBox.style = `margin-bottom: ${Math.round(6 * scale)}px;`;
        headerIcon.icon_size = Math.round(16 * scale);
        headerIcon.style = `color: ${textColor}; margin-right: 6px;`;
        headerLabel.style = `${fontCss}color: ${textColor}; font-size: ${titleFontSize}px; font-weight: bold; opacity: 0.9;`;
        contentBox.style = `padding: ${Math.max(8, Math.round(10 * scale))}px;`;

        renderDevicesList(lastDevices);
    }

    let signalSubId = 0;
    try {
        signalSubId = Gio.DBus.system.signal_subscribe(
            'org.bluez',
            null,
            null,
            null,
            null,
            Gio.DBusSignalFlags.NONE,
            () => {
                GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                    if (!isDisposed && !isActorDestroyed(container)) {
                        refreshDevices();
                    }
                    return GLib.SOURCE_REMOVE;
                });
            }
        );
    } catch (e) {
        console.error('Bluetooth DBus subscription error:', e);
    }

    const pollTimerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 5, () => {
        if (isDisposed) return GLib.SOURCE_REMOVE;
        refreshDevices();
        return GLib.SOURCE_CONTINUE;
    });

    registerWidgetCleanup(container, () => {
        isDisposed = true;
        cancellable.cancel();
        if (pollTimerId) GLib.Source.remove(pollTimerId);
        if (signalSubId) Gio.DBus.system.signal_unsubscribe(signalSubId);
    });

    applyScale(scale);
    refreshDevices();

    attachResponsiveScaler(container, BASE_CONTAINER_WIDTH_PX, BASE_CONTAINER_HEIGHT_PX, (_ratio, w, h) => {
        if (isActorDestroyed(container)) return;
        applyScale(Math.max(0.65, Math.min(w / BASE_CONTAINER_WIDTH_PX, h / BASE_CONTAINER_HEIGHT_PX)));
    });

    return container;
}