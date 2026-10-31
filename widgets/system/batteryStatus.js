import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {
    resolveWidgetForegroundColor,
    resolveExplicitFontFamily,
    cssColorToRgba,
    isDarkBackgroundColor,
    resolveWidgetBackgroundColor,
} from '../../utils/widgetUtils.js';
import { 
    createWidgetContainer, 
    registerWidgetCleanup, 
    attachResponsiveScaler 
} from '../../shell/widgetUIUtils.js';
import { isActorDestroyed } from '../../utils/actorLifecycle.js';

const BASE_CONTAINER_WIDTH_PX = 200;
const BASE_CONTAINER_HEIGHT_PX = 200;

const CARD_BG_DARK_ALPHA = 0.05;
const CARD_BG_LIGHT_ALPHA = 0.04;
const CARD_BORDER_DARK_ALPHA = 0.06;
const CARD_BORDER_LIGHT_ALPHA = 0.10;
const LABEL_OPACITY = 0.65;

function getDeviceMeta(rawType, name) {
    const lowerName = (name || '').toLowerCase();
    const lowerType = (rawType || '').toLowerCase();

    if (lowerType.includes('battery') || lowerName.includes('primary') || lowerName.includes('laptop')) {
        return { icon: 'laptop-symbolic', defaultName: 'This PC' };
    }
    if (lowerType.includes('headset') || lowerType.includes('headphone') || lowerName.includes('nc60')) {
        return { icon: 'audio-headset-symbolic', defaultName: 'Headphones' };
    }
    if (lowerType.includes('mouse') || lowerName.includes('mouse')) {
        return { icon: 'input-mouse-symbolic', defaultName: 'Mouse' };
    }
    if (lowerType.includes('keyboard') || lowerName.includes('keyboard')) {
        return { icon: 'input-keyboard-symbolic', defaultName: 'Keyboard' };
    }
    return { icon: 'battery-symbolic', defaultName: 'Wireless Device' };
}

function getBatteryLevelIcon(percentage, isCharging) {
    if (isCharging) return 'battery-charging-symbolic';
    if (percentage >= 90) return 'battery-level-100-symbolic';
    if (percentage >= 70) return 'battery-level-80-symbolic';
    if (percentage >= 50) return 'battery-level-60-symbolic';
    if (percentage >= 30) return 'battery-level-30-symbolic';
    if (percentage >= 10) return 'battery-level-10-symbolic';
    return 'battery-level-0-symbolic';
}

export function createBatteryStatusNode(config, width, height, xPosition, yPosition) {
    const fontFamily = resolveExplicitFontFamily(config);
    const fontCss = fontFamily ? `font-family: ${fontFamily}; ` : '';
    const textColor = resolveWidgetForegroundColor(config);
    const container = createWidgetContainer(config, width, height, xPosition, yPosition);

    let scale = Math.max(0.65, Math.min(width / BASE_CONTAINER_WIDTH_PX, height / BASE_CONTAINER_HEIGHT_PX));
    let lastDevicesData = [];
    let isDisposed = false;

    const isDarkSurface = isDarkBackgroundColor(resolveWidgetBackgroundColor(config));
    const cardBgAlpha = isDarkSurface ? CARD_BG_DARK_ALPHA : CARD_BG_LIGHT_ALPHA;
    const cardBorderAlpha = isDarkSurface ? CARD_BORDER_DARK_ALPHA : CARD_BORDER_LIGHT_ALPHA;

    const contentBox = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
    });
    container.add_child(contentBox);

    // ── 1. Egységes Fejléc (Hajszálpontosan mint az audioOutput.js) ──
    const headerBox = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_expand: true,
    });
    const headerIcon = new St.Icon({
        icon_name: 'battery-level-100-charged-symbolic',
        style: `color: ${textColor};`,
        y_align: Clutter.ActorAlign.CENTER,
    });
    const headerLabel = new St.Label({
        text: 'Battery Status',
        y_align: Clutter.ActorAlign.CENTER,
    });
    headerLabel.clutter_text.set_ellipsize(0);
    headerBox.add_child(headerIcon);
    headerBox.add_child(headerLabel);
    contentBox.add_child(headerBox);

    // ── 2. Görgető konténer ──
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

    const renderDeviceRow = (data) => {
        // audioOutput.js szerinti méretezés
        const cardPadding = Math.max(5, Math.round(8 * scale));
        const cardRadius = Math.max(6, Math.round(10 * scale));
        const rowGap = Math.max(4, Math.round(6 * scale));
        const rightScrollGap = Math.max(6, Math.round(8 * scale));
        const deviceFontSize = Math.max(11, Math.round(13 * scale));
        const percentFontSize = Math.max(11, Math.round(13 * scale));
        const subFontSize = Math.max(9, Math.round(10 * scale));
        const iconSize = Math.max(16, Math.round(18 * scale));
        const miniIconSize = Math.max(12, Math.round(14 * scale));

        const cardBg = cssColorToRgba(textColor, cardBgAlpha);
        const cardBorder = cssColorToRgba(textColor, cardBorderAlpha);
        
        const itemCardStyle = `background-color: ${cardBg}; `
            + `border: 1px solid ${cardBorder}; `
            + `border-radius: ${cardRadius}px; `
            + `padding: ${cardPadding}px; `
            + `margin-bottom: ${rowGap}px; `
            + `margin-right: ${rightScrollGap}px;`;

        const row = new St.BoxLayout({
            orientation: Clutter.Orientation.HORIZONTAL,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
            style: itemCardStyle,
        });

        const leftIcon = new St.Icon({
            icon_name: data.iconName,
            icon_size: iconSize,
            style: `color: ${textColor}; opacity: 0.85; margin-right: ${Math.round(8 * scale)}px;`,
            y_align: Clutter.ActorAlign.CENTER,
        });
        row.add_child(leftIcon);

        const nameBox = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        const nameLabel = new St.Label({
            text: data.name,
            style: `${fontCss}color: ${textColor}; font-size: ${deviceFontSize}px; font-weight: 500;`,
        });
        nameLabel.clutter_text.set_ellipsize(3);

        const subLabel = new St.Label({
            text: data.subtext,
            style: `${fontCss}color: ${textColor}; font-size: ${subFontSize}px; opacity: ${LABEL_OPACITY};`,
        });
        nameBox.add_child(nameLabel);
        nameBox.add_child(subLabel);
        row.add_child(nameBox);

        const rightBox = new St.BoxLayout({
            orientation: Clutter.Orientation.HORIZONTAL,
            x_align: Clutter.ActorAlign.END,
            y_align: Clutter.ActorAlign.CENTER,
            style: `spacing: 4px;`,
        });
        const percentLabel = new St.Label({
            text: `${data.percentage}%`,
            style: `${fontCss}color: ${textColor}; font-size: ${percentFontSize}px; font-weight: bold;`,
            y_align: Clutter.ActorAlign.CENTER,
        });
        const miniBatteryIcon = new St.Icon({
            icon_name: getBatteryLevelIcon(data.percentage, data.isCharging),
            icon_size: miniIconSize,
            style: `color: ${textColor}; opacity: 0.8;`,
            y_align: Clutter.ActorAlign.CENTER,
        });
        rightBox.add_child(percentLabel);
        rightBox.add_child(miniBatteryIcon);
        row.add_child(rightBox);

        return row;
    };

    const renderList = () => {
        if (isDisposed || isActorDestroyed(container)) return;
        listContainer.destroy_all_children();

        const deviceFontSize = Math.max(11, Math.round(13 * scale));

        if (lastDevicesData.length === 0) {
            const emptyLabel = new St.Label({
                text: 'No battery devices detected',
                style: `${fontCss}color: ${textColor}; font-size: ${deviceFontSize}px; opacity: ${LABEL_OPACITY};`,
                y_align: Clutter.ActorAlign.CENTER,
                x_align: Clutter.ActorAlign.CENTER,
                x_expand: true,
                y_expand: true,
            });
            listContainer.add_child(emptyLabel);
            return;
        }

        lastDevicesData.forEach(d => listContainer.add_child(renderDeviceRow(d)));
    };

    const parseAndRender = (output) => {
        if (isDisposed || isActorDestroyed(container)) return;

        const devices = [];
        const blocks = output.split(/Device:\s+/).filter(Boolean);

        for (const block of blocks) {
            const firstLine = block.split('\n')[0] || '';
            if (firstLine.includes('line_power') || firstLine.includes('DisplayDevice')) continue;

            const modelMatch = block.match(/model:\s+(.+)/i);
            const percentageMatch = block.match(/percentage:\s+([0-9]+)%/i);
            const stateMatch = block.match(/state:\s+([a-zA-Z-]+)/i);

            if (!percentageMatch) continue;

            const percentage = parseInt(percentageMatch[1], 10);
            const rawModel = modelMatch ? modelMatch[1].trim() : '';
            const rawState = stateMatch ? stateMatch[1].trim().toLowerCase() : '';

            const isCharging = rawState.includes('charging') && !rawState.includes('discharging');
            const meta = getDeviceMeta(firstLine, rawModel);

            let displayName = rawModel;
            if (!displayName || displayName === 'Primary') {
                displayName = meta.defaultName;
            }

            let subtext = 'Connected';
            if (meta.defaultName === 'This PC') {
                subtext = isCharging ? 'Charging' : (rawState.includes('discharging') ? 'Discharging' : 'Connected');
            }

            devices.push({
                isPc: meta.defaultName === 'This PC',
                name: displayName,
                iconName: meta.icon,
                percentage,
                isCharging,
                subtext,
            });
        }

        devices.sort((a, b) => (a.isPc ? -1 : 1));
        lastDevicesData = devices;
        renderList();
    };

    const refreshData = () => {
        try {
            const proc = new Gio.Subprocess({
                argv: ['upower', '-d'],
                flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE,
            });
            proc.init(null);
            proc.communicate_utf8_async(null, null, (p, res) => {
                try {
                    const [, stdout] = p.communicate_utf8_finish(res);
                    if (stdout) parseAndRender(stdout);
                } catch (e) {}
            });
        } catch (err) {}
    };

    function applyScale(newScale) {
        scale = newScale;
        const titleFontSize = Math.max(11, Math.round(13 * scale));

        headerBox.style = `margin-bottom: ${Math.round(6 * scale)}px;`;
        headerIcon.icon_size = Math.round(16 * scale);
        headerIcon.style = `color: ${textColor}; margin-right: 6px;`;
        headerLabel.style = `${fontCss}color: ${textColor}; font-size: ${titleFontSize}px; font-weight: bold; opacity: 0.9;`;
        contentBox.style = `padding: ${Math.max(8, Math.round(10 * scale))}px;`;

        renderList();
    }

    applyScale(scale);

    attachResponsiveScaler(container, BASE_CONTAINER_WIDTH_PX, BASE_CONTAINER_HEIGHT_PX, (_ratio, w, h) => {
        if (isActorDestroyed(container)) return;
        applyScale(Math.max(0.65, Math.min(w / BASE_CONTAINER_WIDTH_PX, h / BASE_CONTAINER_HEIGHT_PX)));
    });

    refreshData();

    const timeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 10, () => {
        if (isDisposed) return GLib.SOURCE_REMOVE;
        refreshData();
        return GLib.SOURCE_CONTINUE;
    });

    registerWidgetCleanup(container, () => {
        isDisposed = true;
        if (timeoutId) GLib.source_remove(timeoutId);
    });

    return container;
}