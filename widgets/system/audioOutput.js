import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

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
    attachButtonFeedback 
} from '../../shell/widgetUIUtils.js';

import { isActorDestroyed } from '../../utils/actorLifecycle.js';

const BASE_CONTAINER_WIDTH_PX = 200;
const BASE_CONTAINER_HEIGHT_PX = 200;
const BORDER_ALPHA = 0.14;
const CARD_BG_DARK_ALPHA = 0.05;
const CARD_BG_LIGHT_ALPHA = 0.04;
const CARD_BORDER_DARK_ALPHA = 0.06;
const CARD_BORDER_LIGHT_ALPHA = 0.10;
const LABEL_OPACITY = 0.65;

export function createAudioOutputNode(config, width, height, xPosition, yPosition) {
    const fontFamily = resolveExplicitFontFamily(config);
    const fontCss = fontFamily ? `font-family: ${fontFamily}; ` : '';
    const textColor = resolveWidgetForegroundColor(config);
    const container = createWidgetContainer(config, width, height, xPosition, yPosition);
    container.style += ` border: 1px solid ${cssColorToRgba(textColor, BORDER_ALPHA)};`;

    let scale = Math.max(0.65, Math.min(width / BASE_CONTAINER_WIDTH_PX, height / BASE_CONTAINER_HEIGHT_PX));

    const isDarkSurface = isDarkBackgroundColor(resolveWidgetBackgroundColor(config));
    const cardBgAlpha = isDarkSurface ? CARD_BG_DARK_ALPHA : CARD_BG_LIGHT_ALPHA;
    const cardBorderAlpha = isDarkSurface ? CARD_BORDER_DARK_ALPHA : CARD_BORDER_LIGHT_ALPHA;

    const contentBox = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
    });
    container.add_child(contentBox);

    // Fejléc
    const headerBox = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_expand: true,
    });
    const headerIcon = new St.Icon({
        icon_name: 'audio-volume-high-symbolic',
        style: `color: ${textColor};`,
        y_align: Clutter.ActorAlign.CENTER,
    });
    const headerLabel = new St.Label({
        text: 'Sound Output',
        y_align: Clutter.ActorAlign.CENTER,
    });
    headerBox.add_child(headerIcon);
    headerBox.add_child(headerLabel);
    contentBox.add_child(headerBox);

    const scrollView = new St.ScrollView({
        style_class: 'vfade',
        x_expand: true,
        y_expand: true,
    });
    scrollView.set_policy(St.PolicyType.NEVER, St.PolicyType.EXTERNAL);
    contentBox.add_child(scrollView);

    const listContainer = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
    });
    scrollView.set_child(listContainer);

    const outputMenu = Main.panel?.statusArea?.quickSettings?._volumeOutput?._output;

    function refreshDevices() {
        if (isActorDestroyed(container) || !outputMenu?._deviceItems) return;

        listContainer.destroy_all_children();

        const cardPadding = Math.max(4, Math.round(6 * scale));
        const cardRadius = Math.max(6, Math.round(10 * scale));
        const deviceFontSize = Math.max(10, Math.round(12 * scale));
        const subFontSize = Math.max(9, Math.round(10 * scale));
        const iconSize = Math.max(16, Math.round(18 * scale));
        const statusIconSize = Math.max(12, Math.round(14 * scale));

        for (const [id, item] of outputMenu._deviceItems) {
            // A Looking Glass alapján az aktív elem ornament értéke pontosan 2 (DOT):
            const isDefault = (item._ornament === 2 || item.ornament === 2);

            const labelText = item.label?.text || 'Output Device';
            const iconName = item.icon?.gicon?.get_names ? item.icon.gicon.get_names()[0] : (item.icon?.icon_name || 'audio-speakers-symbolic');

            const rowBtn = new St.Button({
                reactive: true,
                can_focus: true,
                x_expand: true,
                margin_bottom: Math.max(3, Math.round(5 * scale)),
            });
            attachButtonFeedback(rowBtn);

            const bg = isDefault 
                ? cssColorToRgba(textColor, 0.18) 
                : cssColorToRgba(textColor, cardBgAlpha);
            const border = isDefault 
                ? cssColorToRgba(textColor, 0.35) 
                : cssColorToRgba(textColor, cardBorderAlpha);

            rowBtn.style = `background-color: ${bg}; border: 1px solid ${border}; border-radius: ${cardRadius}px; padding: ${cardPadding}px;`;

            const rowBox = new St.BoxLayout({
                orientation: Clutter.Orientation.HORIZONTAL,
                x_expand: true,
                y_align: Clutter.ActorAlign.CENTER,
            });
            rowBtn.set_child(rowBox);

            const devIcon = new St.Icon({
                icon_name: iconName,
                icon_size: iconSize,
                style: `color: ${textColor}; opacity: ${isDefault ? 1.0 : 0.85}; margin-right: ${Math.round(8 * scale)}px;`,
                y_align: Clutter.ActorAlign.CENTER,
            });
            rowBox.add_child(devIcon);

            const labelBox = new St.BoxLayout({
                orientation: Clutter.Orientation.VERTICAL,
                x_expand: true,
                y_align: Clutter.ActorAlign.CENTER,
            });

            const nameLabel = new St.Label({
                text: labelText,
                style: `${fontCss}color: ${textColor}; font-size: ${deviceFontSize}px; font-weight: 500;`,
            });
            nameLabel.clutter_text.set_ellipsize(3);
            labelBox.add_child(nameLabel);

            const subLabel = new St.Label({
                text: isDefault ? 'Active' : 'Ready',
                style: `${fontCss}color: ${textColor}; font-size: ${subFontSize}px; opacity: ${isDefault ? 0.9 : LABEL_OPACITY};`,
            });
            labelBox.add_child(subLabel);
            rowBox.add_child(labelBox);

            // Ha aktív, felrakjuk a pipát a kártya jobb szélére
            if (isDefault) {
                const checkIcon = new St.Icon({
                    icon_name: 'emblem-ok-symbolic',
                    icon_size: statusIconSize,
                    style: `color: ${textColor}; opacity: 0.9;`,
                    y_align: Clutter.ActorAlign.CENTER,
                });
                rowBox.add_child(checkIcon);
            }

            rowBtn.connect('clicked', () => {
                item.activate(Clutter.get_current_event());
                refreshDevices();
                GLib.timeout_add(GLib.PRIORITY_DEFAULT, 80, () => {
                    refreshDevices();
                    return GLib.SOURCE_REMOVE;
                });
            });

            listContainer.add_child(rowBtn);
        }
    }

    function applyScale(newScale) {
        scale = newScale;
        const titleFontSize = Math.max(11, Math.round(13 * scale));

        contentBox.style = `padding: ${Math.max(6, Math.round(8 * scale))}px;`;
        headerBox.style = `margin-bottom: ${Math.round(4 * scale)}px;`;
        headerIcon.icon_size = Math.round(16 * scale);
        headerIcon.style = `color: ${textColor}; margin-right: 6px;`;
        headerLabel.style = `${fontCss}color: ${textColor}; font-size: ${titleFontSize}px; font-weight: bold; opacity: 0.9;`;

        refreshDevices();
    }

    // Élő szinkron
    const mixerControl = Main.panel?.statusArea?.quickSettings?._volumeOutput?._control;
    let sigDefaultSink = 0;
    let sigActiveUpdate = 0;

    if (mixerControl) {
        sigDefaultSink = mixerControl.connect('default-sink-changed', refreshDevices);
        sigActiveUpdate = mixerControl.connect('active-output-update', refreshDevices);
    }

    container.connect('destroy', () => {
        if (mixerControl) {
            if (sigDefaultSink) mixerControl.disconnect(sigDefaultSink);
            if (sigActiveUpdate) mixerControl.disconnect(sigActiveUpdate);
        }
    });

    applyScale(scale);

    attachResponsiveScaler(container, BASE_CONTAINER_WIDTH_PX, BASE_CONTAINER_HEIGHT_PX, (_ratio, w, h) => {
        if (isActorDestroyed(container)) return;
        applyScale(Math.max(0.65, Math.min(w / BASE_CONTAINER_WIDTH_PX, h / BASE_CONTAINER_HEIGHT_PX)));
    });

    return container;
}