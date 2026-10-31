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

function formatUptime(secondsTotal) {
    const total = Math.floor(secondsTotal);
    const days = Math.floor(total / 86400);
    const hours = Math.floor((total % 86400) / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;

    const parts = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0 || days > 0) parts.push(`${hours}h`);
    if (minutes > 0 || hours > 0 || days > 0) parts.push(`${minutes}m`);
    parts.push(`${seconds}s`);

    return parts.join(' ');
}

export function createUptimeNode(config, width, height, xPosition, yPosition) {
    const fontFamily = resolveExplicitFontFamily(config);
    const fontCss = fontFamily ? `font-family: ${fontFamily}; ` : '';
    const textColor = resolveWidgetForegroundColor(config);
    const container = createWidgetContainer(config, width, height, xPosition, yPosition);

    let scale = Math.max(0.65, Math.min(width / BASE_CONTAINER_WIDTH, height / BASE_CONTAINER_HEIGHT));

    const contentBox = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
    });
    container.add_child(contentBox);

    // ── 1. Egységes Fejléc: Bal felül ikon + név ──
    const headerBox = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_expand: true,
        y_align: Clutter.ActorAlign.START,
    });

    const headerIcon = new St.Icon({
        icon_name: 'preferences-system-time-symbolic',
        style: `color: ${textColor};`,
        y_align: Clutter.ActorAlign.CENTER,
    });

    const headerLabel = new St.Label({
        text: 'Uptime',
        y_align: Clutter.ActorAlign.CENTER,
    });
    headerLabel.clutter_text.set_ellipsize(0);

    headerBox.add_child(headerIcon);
    headerBox.add_child(headerLabel);
    contentBox.add_child(headerBox);

    // ── 2. Érték: Középre igazítva a kártyán ──
    const valueBox = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
    });

    const uptimeLabel = new St.Label({
        text: '--',
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
    });

    valueBox.add_child(uptimeLabel);
    contentBox.add_child(valueBox);

    function applyScale(newScale) {
        scale = newScale;
        const titleFontSize = Math.max(11, Math.round(13 * scale));
        const iconSize = Math.round(16 * scale);
        // Hosszabb szöveg (pl. 2d 5h 14m 32s), ezért kissé finomabb, mint az egyetlen százalékérték
        const uptimeFontSize = Math.max(22, Math.round(30 * scale));

        contentBox.style = `padding: ${Math.max(8, Math.round(10 * scale))}px;`;
        headerBox.style = `margin-bottom: ${Math.round(6 * scale)}px;`;
        headerIcon.icon_size = iconSize;
        headerIcon.style = `color: ${textColor}; margin-right: 6px;`;
        headerLabel.style = `${fontCss}color: ${textColor}; font-size: ${titleFontSize}px; font-weight: bold; opacity: 0.9;`;
        uptimeLabel.style = `${fontCss}color: ${textColor}; font-size: ${uptimeFontSize}px; font-weight: bold; line-height: 1.0;`;
    }

    applyScale(scale);

    attachResponsiveScaler(container, BASE_CONTAINER_WIDTH, BASE_CONTAINER_HEIGHT, (_ratio, w, h) => {
        applyScale(Math.max(0.65, Math.min(w / BASE_CONTAINER_WIDTH, h / BASE_CONTAINER_HEIGHT)));
    });

    let isDisposed = false;

    const readUptime = () => {
        try {
            const file = Gio.File.new_for_path('/proc/uptime');
            file.load_contents_async(null, (f, res) => {
                try {
                    const [, contents] = f.load_contents_finish(res);
                    if (isDisposed || !contents) return;

                    const text = new TextDecoder().decode(contents);
                    const [rawSec] = text.trim().split(/\s+/);
                    const seconds = parseFloat(rawSec);

                    if (!isNaN(seconds)) {
                        uptimeLabel.set_text(formatUptime(seconds));
                    }
                } catch (_) {}
            });
        } catch (_) {}
    };

    readUptime();

    // 1 másodperces frissítés a folyamatos másodperchez
    const timeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
        if (isDisposed) return GLib.SOURCE_REMOVE;
        readUptime();
        return GLib.SOURCE_CONTINUE;
    });

    registerWidgetCleanup(container, () => {
        isDisposed = true;
        if (timeoutId) GLib.source_remove(timeoutId);
    });

    return container;
}