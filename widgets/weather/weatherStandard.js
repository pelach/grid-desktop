import St from 'gi://St';
import Clutter from 'gi://Clutter';
import { FALLBACK_LOCATION, createFallbackIcon, configureWrappingLabel, buildFontCss } from './weatherCommon.js';
import { SECONDARY_OPACITY } from '../../utils/widgetUtils.js';
import { attachResponsiveScaler } from '../../shell/widgetUIUtils.js';

const BASE_LAYOUT_SIZE = 200;

const BASE_CITY_FONT_SIZE = 15.5;
const BASE_TEMP_FONT_SIZE = 36;
const BASE_ICON_SIZE = 24;
const BASE_CONDITION_FONT_SIZE = 14;
const BASE_HIGHLOW_FONT_SIZE = 12;

const CITY_MARGIN_BOTTOM_PX = 2;
const TEMP_MARGIN_BOTTOM_PX = 8;
const CONDITION_ICON_MARGIN_RIGHT_PX = 6;
const HIGHLOW_MARGIN_TOP_PX = 3;

export function buildStandardLayout(layout, widgetData, extensionPath) {
    const uiElements = {};
    const fontCss = buildFontCss(widgetData);
    uiElements.cityLabel = new St.Label({
        text: widgetData.location || FALLBACK_LOCATION,
        style: `${fontCss}font-weight: 500; font-size: ${BASE_CITY_FONT_SIZE}px; margin-bottom: ${CITY_MARGIN_BOTTOM_PX}px;`
    });
    uiElements.tempLabel = new St.Label({
        text: '--°',
        style: `${fontCss}font-size: ${BASE_TEMP_FONT_SIZE}px; font-weight: 300; margin-bottom: ${TEMP_MARGIN_BOTTOM_PX}px;`
    });
    layout.add_child(uiElements.cityLabel);
    layout.add_child(uiElements.tempLabel);

    const flexSpacer = new St.Widget({ y_expand: true });
    layout.add_child(flexSpacer);

    const conditionLayout = new St.BoxLayout({ orientation: Clutter.Orientation.HORIZONTAL });
    uiElements.conditionIcon = new St.Icon({
        gicon: createFallbackIcon(extensionPath),
        icon_size: BASE_ICON_SIZE,
        style: `margin-right: ${CONDITION_ICON_MARGIN_RIGHT_PX}px;`,
        y_align: Clutter.ActorAlign.CENTER,
    });
    uiElements.conditionLabel = new St.Label({
        text: 'Loading...',
        style: `${fontCss}font-size: ${BASE_CONDITION_FONT_SIZE}px; font-weight: 400;`,
        y_align: Clutter.ActorAlign.CENTER,
    });
    configureWrappingLabel(uiElements.conditionLabel);
    conditionLayout.add_child(uiElements.conditionIcon);
    conditionLayout.add_child(uiElements.conditionLabel);
    layout.add_child(conditionLayout);

    uiElements.highLowLabel = new St.Label({
        text: 'H:--° L:--°',
        style: `${fontCss}font-size: ${BASE_HIGHLOW_FONT_SIZE}px; opacity: ${SECONDARY_OPACITY}; margin-top: ${HIGHLOW_MARGIN_TOP_PX}px;`
    });
    layout.add_child(uiElements.highLowLabel);

    return uiElements;
}

export function attachStandardScaler(widgetNode, uiElements, widgetData) {
    const fontCss = buildFontCss(widgetData);
    return attachResponsiveScaler(widgetNode, BASE_LAYOUT_SIZE, BASE_LAYOUT_SIZE, (scale) => {
        if (!uiElements || !uiElements.cityLabel) return;
        const s = Math.max(0.65, scale);

        const citySize = Math.max(1, Math.round(BASE_CITY_FONT_SIZE * s));
        const tempSize = Math.max(1, Math.round(BASE_TEMP_FONT_SIZE * s));
        const iconSize = Math.max(1, Math.round(BASE_ICON_SIZE * s));
        const condSize = Math.max(1, Math.round(BASE_CONDITION_FONT_SIZE * s));
        const highLowSize = Math.max(1, Math.round(BASE_HIGHLOW_FONT_SIZE * s));

        uiElements.cityLabel.style = `${fontCss}font-weight: 500; font-size: ${citySize}px; margin-bottom: ${Math.round(CITY_MARGIN_BOTTOM_PX * s)}px; color: inherit;`;
        uiElements.tempLabel.style = `${fontCss}font-size: ${tempSize}px; font-weight: 300; margin-bottom: ${Math.round(TEMP_MARGIN_BOTTOM_PX * s)}px; color: inherit;`;
        uiElements.conditionIcon.icon_size = iconSize;
        uiElements.conditionIcon.style = `margin-right: ${Math.round(CONDITION_ICON_MARGIN_RIGHT_PX * s)}px;`;
        uiElements.conditionLabel.style = `${fontCss}font-size: ${condSize}px; font-weight: 400; color: inherit;`;
        uiElements.highLowLabel.style = `${fontCss}font-size: ${highLowSize}px; opacity: ${SECONDARY_OPACITY}; margin-top: ${Math.round(HIGHLOW_MARGIN_TOP_PX * s)}px; color: inherit;`;
    });
}