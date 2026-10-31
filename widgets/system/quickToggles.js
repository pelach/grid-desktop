import St from 'gi://St';
import Gio from 'gi://Gio';
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

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

export function createQuickTogglesNode(config, width, height, xPosition, yPosition) {
    const textColor = resolveWidgetForegroundColor(config);
    const fontFamily = resolveExplicitFontFamily(config);
    const fontCss = fontFamily ? `font-family: ${fontFamily}; ` : '';
    const container = createWidgetContainer(config, width, height, xPosition, yPosition);

    const textBytes = parseCssColor(textColor);
    const textRgb = () => `${Math.round(textBytes.r * 255)},${Math.round(textBytes.g * 255)},${Math.round(textBytes.b * 255)}`;

    let scale = Math.max(0.65, Math.min(width, height) / BASE_CONTAINER_SIZE);

    const interfaceSettings = new Gio.Settings({ schema_id: 'org.gnome.desktop.interface' });
    const colorSettings = new Gio.Settings({ schema_id: 'org.gnome.settings-daemon.plugins.color' });
    const notifSettings = new Gio.Settings({ schema_id: 'org.gnome.desktop.notifications' });

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

    function createToggleButton(initialIcon, onClick) {
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

    const darkBtn = createToggleButton('weather-clear-night-symbolic', () => {
        const isDark = interfaceSettings.get_string('color-scheme') === 'prefer-dark';
        interfaceSettings.set_string('color-scheme', isDark ? 'default' : 'prefer-dark');
    });
    topRow.add_child(darkBtn);

    const nightBtn = createToggleButton('night-light-symbolic', () => {
        const active = colorSettings.get_boolean('night-light-enabled');
        colorSettings.set_boolean('night-light-enabled', !active);
    });
    topRow.add_child(nightBtn);

    const dndBtn = createToggleButton('notifications-symbolic', () => {
        const banners = notifSettings.get_boolean('show-banners');
        notifSettings.set_boolean('show-banners', !banners);
    });
    bottomRow.add_child(dndBtn);

    const lockBtn = createToggleButton('system-lock-screen-symbolic', () => {
        Main.screenShield.lock(true);
    });
    bottomRow.add_child(lockBtn);

    function updateStyles() {
        const px = (v) => Math.max(1, Math.round(v * scale));
        const btnSize = px(BUTTON_SIZE_PX);
        const iconSize = px(ICON_SIZE_PX);

        const isDark = interfaceSettings.get_string('color-scheme') === 'prefer-dark';
        const isNight = colorSettings.get_boolean('night-light-enabled');
        const isDnd = !notifSettings.get_boolean('show-banners');

        const getBtnStyle = (isActive) => {
            const bg = isActive ? `rgba(${textRgb()}, 0.22)` : `rgba(${textRgb()}, 0.07)`;
            const border = isActive ? `rgba(${textRgb()}, 0.35)` : `rgba(${textRgb()}, 0.1)`;
            return `width: ${btnSize}px; height: ${btnSize}px; `
                 + `border-radius: 9999px; `
                 + `background-color: ${bg}; `
                 + `border: 1px solid ${border};`;
        };

        darkBtn.style = getBtnStyle(isDark);
        darkBtn.child.icon_name = isDark ? 'weather-clear-night-symbolic' : 'weather-clear-symbolic';
        darkBtn.child.icon_size = iconSize;

        nightBtn.style = getBtnStyle(isNight);
        nightBtn.child.icon_size = iconSize;

        dndBtn.style = getBtnStyle(isDnd);
        dndBtn.child.icon_name = isDnd ? 'notifications-disabled-symbolic' : 'notifications-symbolic';
        dndBtn.child.icon_size = iconSize;

        lockBtn.style = getBtnStyle(false);
        lockBtn.child.icon_size = iconSize;
    }

    const idDark = interfaceSettings.connect('changed::color-scheme', () => {
        if (!isActorDestroyed(container)) updateStyles();
    });
    const idNight = colorSettings.connect('changed::night-light-enabled', () => {
        if (!isActorDestroyed(container)) updateStyles();
    });
    const idDnd = notifSettings.connect('changed::show-banners', () => {
        if (!isActorDestroyed(container)) updateStyles();
    });

    container.connect('destroy', () => {
        interfaceSettings.disconnect(idDark);
        colorSettings.disconnect(idNight);
        notifSettings.disconnect(idDnd);
    });

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