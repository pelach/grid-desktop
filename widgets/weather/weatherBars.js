import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import { FALLBACK_LOCATION, HOURLY_FORECAST_COUNT, createFallbackIcon, configureWrappingLabel, buildFontCss, refreshDailyBarGeometry } from './weatherCommon.js';
import { SECONDARY_OPACITY } from '../../utils/widgetUtils.js';
import { attachResponsiveScaler } from '../../shell/widgetUIUtils.js';

const BASE_LAYOUT_WIDTH = 400;
const BASE_LAYOUT_HEIGHT = 400;

const BASE_CITY_FONT_SIZE = 17;
const BASE_TEMP_FONT_SIZE = 40;
const BASE_ICON_SIZE = 30;
const BASE_CONDITION_FONT_SIZE = 14;
const BASE_HIGHLOW_FONT_SIZE = 12;

const BASE_HOURLY_TEXT_SIZE = 12.5;
const BASE_HOURLY_ICON_SIZE = 18;

const BASE_DAILY_TEXT_SIZE = 14;
const BASE_DAILY_ICON_SIZE = 18;
const BASE_BAR_HEIGHT = 6;

const FORECAST_DAYS_COUNT = 5;

export function buildBarsLayout(layout, widgetData, extensionPath) {
    const uiElements = { layout, hourlyActors: [], dailyActors: [], dividers: [] };
    const fontCss = buildFontCss(widgetData);

    // ── Segédfüggvény: finom macOS stílusú elválasztó vonal ──
    const createDivider = () => {
        const div = new St.Widget({
            style: 'background-color: rgba(255, 255, 255, 0.12); height: 1px;',
            x_expand: true,
            height: 1,
        });
        uiElements.dividers.push(div);
        return div;
    };

    // ── 1. Header ──
    const topLayout = new St.BoxLayout({ orientation: Clutter.Orientation.HORIZONTAL, x_expand: true });
    const leftLayout = new St.BoxLayout({ orientation: Clutter.Orientation.VERTICAL, x_expand: true });

    uiElements.cityLabel = new St.Label({
        text: widgetData.location || FALLBACK_LOCATION,
        style: `${fontCss}font-weight: 600; font-size: ${BASE_CITY_FONT_SIZE}px; margin-bottom: 2px;`
    });
    configureWrappingLabel(uiElements.cityLabel);

    uiElements.tempLabel = new St.Label({
        text: '--°',
        style: `${fontCss}font-size: ${BASE_TEMP_FONT_SIZE}px; font-weight: 300;`
    });
    leftLayout.add_child(uiElements.cityLabel);
    leftLayout.add_child(uiElements.tempLabel);
    topLayout.add_child(leftLayout);

    const rightLayout = new St.BoxLayout({ 
        orientation: Clutter.Orientation.VERTICAL, 
        x_align: Clutter.ActorAlign.END,
        style: 'spacing: 2px;'
    });
    const iconWrapper = new St.BoxLayout({ orientation: Clutter.Orientation.HORIZONTAL, x_align: Clutter.ActorAlign.END, x_expand: true });
    uiElements.conditionIcon = new St.Icon({
        gicon: createFallbackIcon(extensionPath),
        icon_size: BASE_ICON_SIZE,
        style: 'margin-bottom: 2px;'
    });
    iconWrapper.add_child(uiElements.conditionIcon);

    uiElements.conditionLabel = new St.Label({
        text: 'Loading...',
        style: `${fontCss}font-size: ${BASE_CONDITION_FONT_SIZE}px; font-weight: 400; text-align: right;`
    });
    configureWrappingLabel(uiElements.conditionLabel, Pango.Alignment.RIGHT);

    uiElements.highLowLabel = new St.Label({
        text: 'H:--° L:--°',
        style: `${fontCss}font-size: ${BASE_HIGHLOW_FONT_SIZE}px; opacity: ${SECONDARY_OPACITY}; text-align: right;`,
        x_align: Clutter.ActorAlign.END
    });
    uiElements.highLowLabel.clutter_text.set_line_alignment(Pango.Alignment.RIGHT);

    rightLayout.add_child(iconWrapper);
    rightLayout.add_child(uiElements.conditionLabel);
    rightLayout.add_child(uiElements.highLowLabel);
    topLayout.add_child(rightLayout);

    layout.add_child(topLayout);

    // Vonal a fejléc és az órás sáv között
    layout.add_child(createDivider());

    // ── 2. Hourly Forecast ──
    const hourlyContainer = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_expand: true,
        style: 'margin-top: 6px; margin-bottom: 8px;'
    });

    for (let i = 0; i < HOURLY_FORECAST_COUNT; i++) {
        const hourBox = new St.BoxLayout({ orientation: Clutter.Orientation.VERTICAL, x_expand: true, x_align: Clutter.ActorAlign.CENTER });
        const timeLbl = new St.Label({
            text: '--',
            style: `${fontCss}font-size: ${BASE_HOURLY_TEXT_SIZE}px; opacity: 0.85; text-align: center;`
        });
        timeLbl.clutter_text.set_line_alignment(Pango.Alignment.CENTER);

        const icon = new St.Icon({
            gicon: createFallbackIcon(extensionPath),
            icon_size: BASE_HOURLY_ICON_SIZE,
            style: 'margin-top: 2px; margin-bottom: 2px;'
        });
        const hourlyIconWrapper = new St.BoxLayout({ orientation: Clutter.Orientation.HORIZONTAL, x_align: Clutter.ActorAlign.CENTER, x_expand: true });
        hourlyIconWrapper.add_child(icon);

        const tempLbl = new St.Label({
            text: '--°',
            style: `${fontCss}font-size: ${BASE_HOURLY_TEXT_SIZE}px; font-weight: 500; text-align: center;`
        });
        tempLbl.clutter_text.set_line_alignment(Pango.Alignment.CENTER);

        hourBox.add_child(timeLbl);
        hourBox.add_child(hourlyIconWrapper);
        hourBox.add_child(tempLbl);
        hourlyContainer.add_child(hourBox);
        uiElements.hourlyActors.push({ timeLbl, icon, tempLbl });
    }
    layout.add_child(hourlyContainer);

    // Vonal az órás és a napi előrejelzés között (a napok FÖLÉ)
    layout.add_child(createDivider());

    // ── 3. Daily Forecast with Bars ──
    const dailyContainer = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
    });

    const accentColor = widgetData.accentColor || widgetData.globalAccentColor || '#5b8cbd';

    for (let i = 0; i < FORECAST_DAYS_COUNT; i++) {

        const row = new St.BoxLayout({
            orientation: Clutter.Orientation.HORIZONTAL,
            x_expand: true,
            y_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
            style: 'padding-top: 2px; padding-bottom: 2px;',
        });

        const dayLabel = new St.Label({
            text: '---',
            style: `${fontCss}font-size: ${BASE_DAILY_TEXT_SIZE}px; font-weight: 600; min-width: 36px;`,
            y_align: Clutter.ActorAlign.CENTER,
        });

        const icon = new St.Icon({
            gicon: createFallbackIcon(extensionPath),
            icon_size: BASE_DAILY_ICON_SIZE,
            style: 'margin-right: 6px;',
            y_align: Clutter.ActorAlign.CENTER,
        });

        const minLabel = new St.Label({
            text: '--°',
            style: `${fontCss}font-size: ${BASE_DAILY_TEXT_SIZE}px; min-width: 28px; text-align: right; margin-right: 6px; opacity: 0.85;`,
            y_align: Clutter.ActorAlign.CENTER,
        });

        const barContainer = new St.BoxLayout({
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });

        const barBg = new St.Widget({
            style: `background-color: rgba(255, 255, 255, 0.15); height: ${BASE_BAR_HEIGHT}px; border-radius: 3px;`,
            x_expand: true,
            height: BASE_BAR_HEIGHT,
            y_align: Clutter.ActorAlign.CENTER,
        });

        const activeBar = new St.Widget({
            style: `background-gradient-direction: horizontal; background-gradient-start: ${accentColor}; background-gradient-end: #ffd043; height: ${BASE_BAR_HEIGHT}px; border-radius: 3px;`,
            width: 8,
            height: BASE_BAR_HEIGHT,
            x: 0,
            y: 0,
        });

        barBg.add_child(activeBar);
        barContainer.add_child(barBg);

        const maxLabel = new St.Label({
            text: '--°',
            style: `${fontCss}font-size: ${BASE_DAILY_TEXT_SIZE}px; min-width: 28px; text-align: left; margin-left: 6px; font-weight: 500;`,
            y_align: Clutter.ActorAlign.CENTER,
        });

        row.add_child(dayLabel);
        row.add_child(icon);
        row.add_child(minLabel);
        row.add_child(barContainer);
        row.add_child(maxLabel);

        dailyContainer.add_child(row);

        uiElements.dailyActors.push({
            row,
            dayLabel,
            icon,
            minLabel,
            barBg,
            activeBar,
            maxLabel,
        });
    }
    layout.add_child(dailyContainer);

    return uiElements;
}

export function attachBarsScaler(widgetNode, uiElements, widgetData) {
    const fontCss = buildFontCss(widgetData);

    return attachResponsiveScaler(widgetNode, BASE_LAYOUT_WIDTH, BASE_LAYOUT_HEIGHT, (scale, w, h) => {
        if (!uiElements || !uiElements.cityLabel) return;
        const s = Math.max(0.65, scale);

        const outerPad = Math.max(12, Math.round(14 * s));
        if (uiElements.layout) {
            uiElements.layout.style = `padding: ${outerPad}px;`;
        }

        const citySize = Math.max(1, Math.round(BASE_CITY_FONT_SIZE * s));
        const tempSize = Math.max(1, Math.round(BASE_TEMP_FONT_SIZE * s));
        const iconSize = Math.max(1, Math.round(BASE_ICON_SIZE * s));
        const condSize = Math.max(1, Math.round(BASE_CONDITION_FONT_SIZE * s));
        const highLowSize = Math.max(1, Math.round(BASE_HIGHLOW_FONT_SIZE * s));

        const hourlyTextSize = Math.max(1, Math.round(BASE_HOURLY_TEXT_SIZE * s));
        const hourlyIconSize = Math.max(1, Math.round(BASE_HOURLY_ICON_SIZE * s));

        const dailyTextSize = Math.max(1, Math.round(BASE_DAILY_TEXT_SIZE * s));
        const dailyIconSize = Math.max(1, Math.round(BASE_DAILY_ICON_SIZE * s));
        const barH = Math.max(4, Math.round(BASE_BAR_HEIGHT * s));
        
        const dayW = Math.max(26, Math.round(36 * s));
        const valW = Math.max(22, Math.round(28 * s));
        const gap = Math.max(4, Math.round(6 * s));

        uiElements.cityLabel.style = `${fontCss}font-weight: 600; font-size: ${citySize}px; margin-bottom: 2px; color: inherit;`;
        uiElements.tempLabel.style = `${fontCss}font-size: ${tempSize}px; font-weight: 300; color: inherit;`;
        uiElements.conditionIcon.icon_size = iconSize;
        uiElements.conditionLabel.style = `${fontCss}font-size: ${condSize}px; font-weight: 400; text-align: right; color: inherit;`;
        uiElements.highLowLabel.style = `${fontCss}font-size: ${highLowSize}px; opacity: ${SECONDARY_OPACITY}; text-align: right; color: inherit;`;

        if (uiElements.hourlyActors) {
            uiElements.hourlyActors.forEach(actor => {
                if (actor.timeLbl) actor.timeLbl.style = `${fontCss}font-size: ${hourlyTextSize}px; opacity: 0.85; text-align: center; color: inherit;`;
                if (actor.icon) actor.icon.icon_size = hourlyIconSize;
                if (actor.tempLbl) actor.tempLbl.style = `${fontCss}font-size: ${hourlyTextSize}px; font-weight: 500; text-align: center; color: inherit;`;
            });
        }

        if (uiElements.dailyActors) {
            const accentColor = widgetData.accentColor || widgetData.globalAccentColor || '#5b8cbd';
            const availableBarWidth = Math.max(30, Math.floor(w - (outerPad * 2) - dayW - dailyIconSize - (valW * 2) - (gap * 4)));

            uiElements.dailyActors.forEach(actor => {
                actor.dayLabel.style = `${fontCss}font-size: ${dailyTextSize}px; font-weight: 600; min-width: ${dayW}px; color: inherit;`;
                actor.icon.icon_size = dailyIconSize;
                actor.minLabel.style = `${fontCss}font-size: ${dailyTextSize}px; min-width: ${valW}px; text-align: right; margin-right: ${gap}px; opacity: 0.85; color: inherit;`;
                actor.maxLabel.style = `${fontCss}font-size: ${dailyTextSize}px; min-width: ${valW}px; text-align: left; margin-left: ${gap}px; font-weight: 500; color: inherit;`;

                actor.barBg.set_height(barH);
                actor.barBg.style = `background-color: rgba(255, 255, 255, 0.15); height: ${barH}px; border-radius: ${Math.round(barH / 2)}px;`;
                actor.activeBar.set_height(barH);
                actor.activeBar.style = `background-gradient-direction: horizontal; background-gradient-start: ${accentColor}; background-gradient-end: #ffd043; height: ${barH}px; border-radius: ${Math.round(barH / 2)}px;`;

                refreshDailyBarGeometry(actor, availableBarWidth);
            });
        }
    });
}