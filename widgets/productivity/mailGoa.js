import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import Pango from 'gi://Pango';

import {
    resolveWidgetForegroundColor,
    resolveExplicitFontFamily,
    resolveWidgetBackgroundColor,
    cssColorToRgba,
    isDarkBackgroundColor,
    SECONDARY_OPACITY,
} from '../../utils/widgetUtils.js';
import {
    createWidgetContainer,
    registerWidgetCleanup,
    attachResponsiveScaler,
} from '../../shell/widgetUIUtils.js';
import { isActorDestroyed } from '../../utils/actorLifecycle.js';
import { mailEngine } from '../../utils/mailEngine.js';

const BASE_CONTAINER_WIDTH_PX = 200;
const BASE_CONTAINER_HEIGHT_PX = 200;

const CARD_BG_DARK_ALPHA = 0.05;
const CARD_BG_LIGHT_ALPHA = 0.04;
const CARD_BORDER_DARK_ALPHA = 0.06;
const CARD_BORDER_LIGHT_ALPHA = 0.10;

export function createMailGoaNode(config, width, height, xPosition, yPosition) {
    const fontFamily = resolveExplicitFontFamily(config);
    const fontCss = fontFamily ? `font-family: ${fontFamily}; ` : '';
    const textColor = resolveWidgetForegroundColor(config);
    const textRgba = (alpha) => cssColorToRgba(textColor, alpha);
    const container = createWidgetContainer(config, width, height, xPosition, yPosition);

    const isDarkSurface = isDarkBackgroundColor(resolveWidgetBackgroundColor(config));
    const cardBgAlpha = isDarkSurface ? CARD_BG_DARK_ALPHA : CARD_BG_LIGHT_ALPHA;
    const cardBorderAlpha = isDarkSurface ? CARD_BORDER_DARK_ALPHA : CARD_BORDER_LIGHT_ALPHA;

    let scale = Math.max(0.65, Math.min(width / BASE_CONTAINER_WIDTH_PX, height / BASE_CONTAINER_HEIGHT_PX));

    const contentBox = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
    });
    container.add_child(contentBox);

    // ── Szabványos Fejléc ──
    const headerBox = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_expand: true,
        y_align: Clutter.ActorAlign.CENTER,
    });

    const headerIcon = new St.Icon({
        icon_name: 'mail-unread-symbolic',
        y_align: Clutter.ActorAlign.CENTER,
    });

    const headerLabel = new St.Label({
        text: 'Unread Mail',
        y_align: Clutter.ActorAlign.CENTER,
    });
    headerLabel.clutter_text.set_ellipsize(0);

    headerBox.add_child(headerIcon);
    headerBox.add_child(headerLabel);
    contentBox.add_child(headerBox);

    // ── Gördülő lista ──
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

    let lastAccounts = [];

    const renderList = () => {
        if (isActorDestroyed(container)) return;
        listContainer.destroy_all_children();

        const deviceFontSize = Math.max(10, Math.round(12 * scale));
        const cardPadding = Math.max(4, Math.round(6 * scale));
        const cardRadius = Math.max(6, Math.round(8 * scale));

        if (lastAccounts.length === 0) {
            const emptyLabel = new St.Label({
                text: 'No accounts',
                style: `${fontCss}color: ${textColor}; font-size: ${deviceFontSize}px; opacity: ${SECONDARY_OPACITY};`,
                y_align: Clutter.ActorAlign.CENTER,
                x_align: Clutter.ActorAlign.CENTER,
                x_expand: true,
                y_expand: true,
            });
            listContainer.add_child(emptyLabel);
            return;
        }

        const cardBg = textRgba(cardBgAlpha);
        const cardBorder = textRgba(cardBorderAlpha);
        const itemCardStyle = `background-color: ${cardBg}; border: 1px solid ${cardBorder}; border-radius: ${cardRadius}px; padding: ${cardPadding}px 8px;`;

        lastAccounts.forEach((acc) => {
            const rowBtn = new St.Button({
                reactive: true,
                can_focus: true,
                x_expand: true,
                style: itemCardStyle,
            });

            const row = new St.BoxLayout({
                orientation: Clutter.Orientation.HORIZONTAL,
                x_expand: true,
                y_align: Clutter.ActorAlign.CENTER,
            });

            const nameLabel = new St.Label({
                text: acc.name,
                style: `${fontCss}color: ${textColor}; font-size: ${deviceFontSize}px; font-weight: 500;`,
                x_expand: true,
                y_align: Clutter.ActorAlign.CENTER,
            });
            nameLabel.clutter_text.set_ellipsize(Pango.EllipsizeMode.END);

            const countBadge = new St.Label({
                text: `${acc.unread || 0}`,
                style: `${fontCss}color: ${textColor}; font-weight: bold; font-size: ${deviceFontSize}px; opacity: ${acc.unread > 0 ? '1.0' : '0.4'};`,
                y_align: Clutter.ActorAlign.CENTER,
            });

            row.add_child(nameLabel);
            row.add_child(countBadge);
            rowBtn.set_child(row);

            rowBtn.connect('clicked', () => {
                try {
                    Gio.AppInfo.launch_default_for_uri('mailto:', null);
                } catch (e) {}
            });

            listContainer.add_child(rowBtn);
        });
    };

    function applyScale(newScale) {
        scale = newScale;

        const pad = Math.max(8, Math.round(10 * scale));
        const iconSize = Math.round(14 * scale);
        const titleFontSize = Math.max(10, Math.round(12 * scale));
        const rowGap = Math.max(3, Math.round(5 * scale));

        contentBox.style = `padding: ${pad}px; spacing: ${Math.round(4 * scale)}px;`;
        headerBox.style = `margin-bottom: ${Math.round(4 * scale)}px;`;
        headerIcon.icon_size = iconSize;
        headerIcon.style = `color: ${textColor}; margin-right: 6px; opacity: 0.85;`;
        headerLabel.style = `${fontCss}color: ${textColor}; font-size: ${titleFontSize}px; font-weight: bold; opacity: 0.9;`;

        listContainer.style = `spacing: ${rowGap}px;`;
        renderList();
    }

    applyScale(scale);

    attachResponsiveScaler(container, BASE_CONTAINER_WIDTH_PX, BASE_CONTAINER_HEIGHT_PX, (_ratio, w, h) => {
        if (isActorDestroyed(container)) return;
        applyScale(Math.max(0.65, Math.min(w / BASE_CONTAINER_WIDTH_PX, h / BASE_CONTAINER_HEIGHT_PX)));
    });

    const unsubscribe = mailEngine.subscribe((data) => {
        if (isActorDestroyed(container)) return;
        lastAccounts = data.accounts || [];
        renderList();
    });

    registerWidgetCleanup(container, () => {
        unsubscribe();
    });

    return container;
}