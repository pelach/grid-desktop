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
    attachResponsiveScaler 
} from '../../shell/widgetUIUtils.js';

import { isActorDestroyed } from '../../utils/actorLifecycle.js';

const BASE_CONTAINER_WIDTH_PX = 200;
const BASE_CONTAINER_HEIGHT_PX = 200;
const BORDER_ALPHA = 0.14;
const CARD_BG_DARK_ALPHA = 0.05;
const CARD_BG_LIGHT_ALPHA = 0.04;
const CARD_BORDER_DARK_ALPHA = 0.06;
const CARD_BORDER_LIGHT_ALPHA = 0.10;

const PROFILES = [
    { id: 'power-saver', label: 'Power saver', icon: 'power-profile-power-saver-symbolic' },
    { id: 'balanced', label: 'Balanced', icon: 'power-profile-balanced-symbolic' },
    { id: 'performance', label: 'Performance', icon: 'power-profile-performance-symbolic' },
];

export function createPowerProfilesNode(config, width, height, xPosition, yPosition) {
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
        icon_name: 'power-profile-balanced-symbolic',
        style: `color: ${textColor};`,
        y_align: Clutter.ActorAlign.CENTER,
    });
    const headerLabel = new St.Label({
        text: 'Energy management',
        y_align: Clutter.ActorAlign.CENTER,
    });
    headerLabel.clutter_text.set_ellipsize(0);
    headerBox.add_child(headerIcon);
    headerBox.add_child(headerLabel);
    contentBox.add_child(headerBox);

    // Görgető konténer
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

    const powerToggle = Main.panel?.statusArea?.quickSettings?._powerProfiles?.quickSettingsItems?.[0];
    const proxy = powerToggle?._proxy;

    function refreshProfiles() {
        if (isActorDestroyed(container)) return;

        listContainer.destroy_all_children();

        const cardPadding = Math.max(5, Math.round(8 * scale));
        const cardRadius = Math.max(6, Math.round(10 * scale));
        const rowGap = Math.max(4, Math.round(6 * scale));
        const rightScrollGap = Math.max(6, Math.round(8 * scale));
        const fontSize = Math.max(11, Math.round(13 * scale));
        const iconSize = Math.max(16, Math.round(18 * scale));
        const statusIconSize = Math.max(12, Math.round(14 * scale));

        const activeProfile = proxy?.ActiveProfile || 'balanced';

        const supportedProfileIds = proxy?.Profiles ? proxy.Profiles.map(p => p.Profile?.unpack ? p.Profile.unpack() : p.Profile) : null;

        const visibleProfiles = PROFILES.filter(p => {
            if (!supportedProfileIds) return true;
            return supportedProfileIds.includes(p.id);
        });

        for (const prof of visibleProfiles) {
            const isActive = (prof.id === activeProfile);

            const rowBtn = new St.Button({
                reactive: true,
                can_focus: true,
                x_expand: true,
            });

            const bg = isActive 
                ? cssColorToRgba(textColor, 0.18) 
                : cssColorToRgba(textColor, cardBgAlpha);
            const border = isActive 
                ? cssColorToRgba(textColor, 0.35) 
                : cssColorToRgba(textColor, cardBorderAlpha);

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

            const devIcon = new St.Icon({
                icon_name: prof.icon,
                icon_size: iconSize,
                style: `color: ${textColor}; opacity: ${isActive ? 1.0 : 0.85}; margin-right: ${Math.round(8 * scale)}px;`,
                y_align: Clutter.ActorAlign.CENTER,
            });
            rowBox.add_child(devIcon);

            const nameLabel = new St.Label({
                text: prof.label,
                x_expand: true,
                y_align: Clutter.ActorAlign.CENTER,
                style: `${fontCss}color: ${textColor}; font-size: ${fontSize}px; font-weight: 500;`,
            });
            nameLabel.clutter_text.set_ellipsize(3);
            rowBox.add_child(nameLabel);

            if (isActive) {
                const checkIcon = new St.Icon({
                    icon_name: 'emblem-ok-symbolic',
                    icon_size: statusIconSize,
                    style: `color: ${textColor}; opacity: 0.9;`,
                    y_align: Clutter.ActorAlign.CENTER,
                });
                rowBox.add_child(checkIcon);
            }

            rowBtn.connect('clicked', () => {
                if (proxy) {
                    proxy.ActiveProfile = prof.id;
                    refreshProfiles();
                    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 80, () => {
                        refreshProfiles();
                        return GLib.SOURCE_REMOVE;
                    });
                }
            });

            listContainer.add_child(rowBtn);
        }
    }

    function applyScale(newScale) {
        scale = newScale;
        const titleFontSize = Math.max(11, Math.round(13 * scale));

        headerBox.style = `margin-bottom: ${Math.round(6 * scale)}px;`;
        headerIcon.icon_size = Math.round(16 * scale);
        headerIcon.style = `color: ${textColor}; margin-right: 6px;`;
        headerLabel.style = `${fontCss}color: ${textColor}; font-size: ${titleFontSize}px; font-weight: bold; opacity: 0.9;`;
        contentBox.style = `padding: ${Math.max(8, Math.round(10 * scale))}px;`;
        
        refreshProfiles();
    }

    let sigPropChanged = 0;
    if (proxy) {
        sigPropChanged = proxy.connect('g-properties-changed', () => {
            refreshProfiles();
        });
    }

    container.connect('destroy', () => {
        if (proxy && sigPropChanged) {
            proxy.disconnect(sigPropChanged);
        }
    });

    applyScale(scale);

    attachResponsiveScaler(container, BASE_CONTAINER_WIDTH_PX, BASE_CONTAINER_HEIGHT_PX, (_ratio, w, h) => {
        if (isActorDestroyed(container)) return;
        applyScale(Math.max(0.65, Math.min(w / BASE_CONTAINER_WIDTH_PX, h / BASE_CONTAINER_HEIGHT_PX)));
    });

    return container;
}