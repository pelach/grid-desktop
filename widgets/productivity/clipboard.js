import St from 'gi://St';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import Meta from 'gi://Meta';
import Pango from 'gi://Pango';
import { 
    SECONDARY_OPACITY, 
    cssColorToRgba, 
    getGridgetsDataDir, 
    loadJsonFromFileAsync, 
    resolveExplicitFontFamily, 
    resolveWidgetForegroundColor, 
    saveJsonToFile 
} from '../../utils/widgetUtils.js';
import {
    createWidgetContainer,
    attachResponsiveScaler,
    registerWidgetCleanup
} from '../../shell/widgetUIUtils.js';
import { isActorDestroyed } from '../../utils/actorLifecycle.js';

const MAX_HISTORY_LENGTH = 25;
const PREVIEW_TEXT_MAX_LENGTH = 45;
const PREVIEW_TEXT_MIN_LENGTH = 22;

const ITEM_IDLE_ALPHA = 0.06;
const ITEM_HOVER_ALPHA = 0.12;

const BASE_CONTAINER_WIDTH_PX = 200;
const BASE_CONTAINER_HEIGHT_PX = 200;

export function createClipboardNode(config, width, height, xPosition, yPosition) {
    const fontFamily = resolveExplicitFontFamily(config);
    const fontCss = fontFamily ? `font-family: ${fontFamily}; ` : '';
    const textColor = resolveWidgetForegroundColor(config);
    const container = createWidgetContainer(config, width, height, xPosition, yPosition);
    const textRgba = (alpha) => cssColorToRgba(textColor, alpha);

    let currentScale = Math.max(0.65, Math.min(width / BASE_CONTAINER_WIDTH_PX, height / BASE_CONTAINER_HEIGHT_PX));

    const contentBox = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
    });
    container.add_child(contentBox);

    // ── Fejléc ──
    const headerBox = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_expand: true,
        y_align: Clutter.ActorAlign.CENTER,
    });

    const headerIcon = new St.Icon({
        icon_name: 'edit-paste-symbolic',
        y_align: Clutter.ActorAlign.CENTER,
    });

    const headerLabel = new St.Label({
        text: 'CLIPBOARD',
        x_expand: true,
        y_align: Clutter.ActorAlign.CENTER,
    });
    headerLabel.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;

    headerBox.add_child(headerIcon);
    headerBox.add_child(headerLabel);
    contentBox.add_child(headerBox);

    // ── Gördülő elemlista ──
    const scrollView = new St.ScrollView({
        hscrollbar_policy: St.PolicyType.NEVER,
        vscrollbar_policy: St.PolicyType.AUTOMATIC,
        overlay_scrollbars: true,
        x_expand: true,
        y_expand: true,
    });
    contentBox.add_child(scrollView);

    const itemContainer = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
    });
    scrollView.set_child(itemContainer);

    const baseDir = getGridgetsDataDir('clipboard');
    const clipboardFilePath = GLib.build_filenamev([
        baseDir,
        `clipboard-${config.id}.json`
    ]);

    const state = {
        clipboardHistory: [],
        ownerChangedId: null,
    };

    const systemClipboard = St.Clipboard.get_default();
    const selection = global.display.get_selection();

    const renderClipboardItems = () => {
        if (isActorDestroyed(container)) return;
        itemContainer.destroy_all_children();

        const itemFontSize = Math.max(10, Math.round(12 * currentScale));

        if (state.clipboardHistory.length === 0) {
            const emptyLabel = new St.Label({
                text: 'No clipboard history yet',
                style: `${fontCss}color: ${textColor}; opacity: ${SECONDARY_OPACITY}; font-size: ${itemFontSize}px;`,
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
                x_expand: true,
                y_expand: true,
            });
            itemContainer.add_child(emptyLabel);
            return;
        }

        const maxLen = Math.max(PREVIEW_TEXT_MIN_LENGTH, Math.round(PREVIEW_TEXT_MAX_LENGTH * currentScale));
        const itemRadius = Math.max(4, Math.round(6 * currentScale));
        const padV = Math.max(3, Math.round(5 * currentScale));
        const padH = Math.max(6, Math.round(8 * currentScale));
        const gap = Math.max(3, Math.round(4 * currentScale));

        const itemNormalStyle = `padding: ${padV}px ${padH}px; margin-bottom: ${gap}px; border-radius: ${itemRadius}px; `
            + `background-color: ${textRgba(ITEM_IDLE_ALPHA)}; border: 1px solid ${textRgba(0.06)};`;
        const itemHoverStyle = `padding: ${padV}px ${padH}px; margin-bottom: ${gap}px; border-radius: ${itemRadius}px; `
            + `background-color: ${textRgba(ITEM_HOVER_ALPHA)}; border: 1px solid ${textRgba(0.18)};`;

        state.clipboardHistory.forEach((clipboardText) => {
            const itemBox = new St.Button({
                reactive: true,
                can_focus: true,
                x_expand: true,
                style: itemNormalStyle,
            });

            itemBox.connect('enter-event', () => {
                itemBox.style = itemHoverStyle;
                return Clutter.EVENT_PROPAGATE;
            });
            itemBox.connect('leave-event', () => {
                itemBox.style = itemNormalStyle;
                return Clutter.EVENT_PROPAGATE;
            });

            const singleLinePreview = clipboardText.replace(/\s+/g, ' ').trim();
            const truncatedPreview = singleLinePreview.length > maxLen
                ? `${singleLinePreview.substring(0, maxLen)}…`
                : singleLinePreview;

            const textLabel = new St.Label({
                text: truncatedPreview,
                style: `${fontCss}color: ${textColor}; font-size: ${itemFontSize}px; line-height: 1.25;`,
                y_align: Clutter.ActorAlign.CENTER,
                x_expand: true,
            });
            textLabel.clutter_text.ellipsize = Pango.EllipsizeMode.END;
            itemBox.set_child(textLabel);

            itemBox.connect('clicked', () => {
                systemClipboard.set_text(St.ClipboardType.CLIPBOARD, clipboardText);
            });

            itemContainer.add_child(itemBox);
        });
    };

    const updateClipboardIfChanged = () => {
        if (isActorDestroyed(container)) return;
        systemClipboard.get_text(St.ClipboardType.CLIPBOARD, (_clipboard, newClipboardText) => {
            if (isActorDestroyed(container) || !newClipboardText || newClipboardText.trim() === '') return;

            const isAlreadyLatest = state.clipboardHistory.length > 0
                && state.clipboardHistory[0] === newClipboardText;

            if (!isAlreadyLatest) {
                const existingIndex = state.clipboardHistory.indexOf(newClipboardText);
                if (existingIndex > -1) {
                    state.clipboardHistory.splice(existingIndex, 1);
                }

                state.clipboardHistory.unshift(newClipboardText);
                if (state.clipboardHistory.length > MAX_HISTORY_LENGTH) {
                    state.clipboardHistory.pop();
                }

                saveJsonToFile(clipboardFilePath, { history: state.clipboardHistory });
                renderClipboardItems();
            }
        });
    };

    loadJsonFromFileAsync(clipboardFilePath, (savedData, loadError) => {
        if (isActorDestroyed(container)) return;
        if (savedData && Array.isArray(savedData.history)) {
            state.clipboardHistory = savedData.history;
            renderClipboardItems();
        } else if (!loadError) {
            saveJsonToFile(clipboardFilePath, { history: state.clipboardHistory });
        }
        updateClipboardIfChanged();
    });

    state.ownerChangedId = selection.connect('owner-changed', (_selection, selectionType) => {
        if (selectionType === Meta.SelectionType.SELECTION_CLIPBOARD) {
            updateClipboardIfChanged();
        }
    });

    registerWidgetCleanup(container, () => {
        if (state.ownerChangedId) {
            selection.disconnect(state.ownerChangedId);
            state.ownerChangedId = null;
        }
    });

    function applyScale(scale) {
        currentScale = scale;
        const padding = Math.max(8, Math.round(10 * scale));
        const titleFontSize = Math.max(10, Math.round(12 * scale));
        const iconSize = Math.round(14 * scale);

        contentBox.style = `padding: ${padding}px; spacing: ${Math.round(4 * scale)}px;`;
        headerBox.style = `margin-bottom: ${Math.round(4 * scale)}px; border-bottom: 1px solid ${textRgba(0.1)}; padding-bottom: ${Math.round(4 * scale)}px;`;
        headerIcon.icon_size = iconSize;
        headerIcon.style = `color: ${textColor}; margin-right: 6px; opacity: 0.85;`;
        headerLabel.style = `${fontCss}color: ${textColor}; font-size: ${titleFontSize}px; font-weight: bold; letter-spacing: 0.5px; opacity: 0.9;`;

        renderClipboardItems();
    }

    applyScale(currentScale);
    attachResponsiveScaler(container, BASE_CONTAINER_WIDTH_PX, BASE_CONTAINER_HEIGHT_PX, (_ratio, w, h) => {
        if (isActorDestroyed(container)) return;
        applyScale(Math.max(0.65, Math.min(w / BASE_CONTAINER_WIDTH_PX, h / BASE_CONTAINER_HEIGHT_PX)));
    });

    return container;
}