import St from 'gi://St';
import Clutter from 'gi://Clutter';
import { 
    resolveWidgetForegroundColor, 
    resolveExplicitFontFamily, 
    cssColorToRgba, 
    isDarkBackgroundColor, 
    resolveWidgetBackgroundColor, 
    parseCssColor, 
    CAIRO_OPERATOR_CLEAR, 
    CAIRO_OPERATOR_OVER 
} from '../../utils/widgetUtils.js';
import { attachResponsiveScaler } from '../../shell/widgetUIUtils.js';

const BASE_CARD_WIDTH = 200;
const BASE_CARD_HEIGHT = 200;

const CARD_BG_DARK_ALPHA = 0.05;
const CARD_BG_LIGHT_ALPHA = 0.04;
const CARD_BORDER_DARK_ALPHA = 0.06;
const CARD_BORDER_LIGHT_ALPHA = 0.10;

function drawTrendChart(ctx, w, h, samples, accentHex) {
    if (w === 0 || h === 0) return;
    ctx.setOperator(CAIRO_OPERATOR_CLEAR);
    ctx.paint();
    ctx.setOperator(CAIRO_OPERATOR_OVER);
    if (samples.length < 2) return;

    const pad = 4;
    const innerW = w - (pad * 2);
    const innerH = h - (pad * 2);
    const pointAt = (i) => [pad + (i / (samples.length - 1)) * innerW, pad + (1 - Math.max(0, Math.min(1, samples[i]))) * innerH];

    const { r, g, b } = parseCssColor(accentHex);
    ctx.setLineWidth(2);
    ctx.setSourceRGBA(r, g, b, 1);
    ctx.newPath();
    const [sx, sy] = pointAt(0);
    ctx.moveTo(sx, sy);
    for (let i = 1; i < samples.length; i++) {
        const [x, y] = pointAt(i);
        ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.lineTo(w - pad, pad + innerH);
    ctx.lineTo(pad, pad + innerH);
    ctx.closePath();
    ctx.setSourceRGBA(r, g, b, 0.18);
    ctx.fill();
}

export function buildCardsLayout(layout, widgetData, extensionPath) {
    const uiElements = { isCardsLayout: true };
    const metric = (widgetData.weatherMetric || 'uv').toLowerCase();
    const showChart = widgetData.showChart === true;

    const fontFamily = resolveExplicitFontFamily(widgetData);
    const fontCss = fontFamily ? `font-family: ${fontFamily}; ` : '';
    const textColor = resolveWidgetForegroundColor(widgetData);
    const accentHex = widgetData.globalAccentColor || '#3584e4';

    let iconName = 'weather-clear-symbolic';
    let defaultLabel = 'UV Index';
    if (metric === 'humidity') {
        iconName = 'weather-showers-symbolic';
        defaultLabel = 'Humidity';
    } else if (metric === 'aqi') {
        iconName = 'emblem-default-symbolic';
        defaultLabel = 'Air Quality';
    } else if (metric === 'wind') {
        iconName = 'weather-windy-symbolic';
        defaultLabel = 'Wind Speed';
    } else if (metric === 'pressure') {
        iconName = 'weather-clear-symbolic';
        defaultLabel = 'Pressure';
    } else if (metric === 'feels_like') {
        iconName = 'weather-clear-symbolic';
        defaultLabel = 'Feels Like';
    } else if (metric === 'gusts') {
        iconName = 'weather-windy-symbolic';
        defaultLabel = 'Wind Gusts';
    } else if (metric === 'dew_point') {
        iconName = 'weather-showers-symbolic';
        defaultLabel = 'Dew Point';
    } else if (metric === 'cloud') {
        iconName = 'weather-overcast-symbolic';
        defaultLabel = 'Cloud Cover';
    } else if (metric === 'precipitation') {
        iconName = 'weather-showers-scattered-symbolic';
        defaultLabel = 'Precipitation';
    }

    const isDarkSurface = isDarkBackgroundColor(resolveWidgetBackgroundColor(widgetData));

    // ── 1. Egységes Fejléc: KIZÁRÓLAG az IKON és a NÉV ──
    const headerBox = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_expand: true,
        y_align: Clutter.ActorAlign.START,
    });

    const headerIcon = new St.Icon({
        icon_name: iconName,
        style: `color: ${textColor};`,
        y_align: Clutter.ActorAlign.CENTER,
    });

    const headerLabel = new St.Label({
        text: defaultLabel,
        y_align: Clutter.ActorAlign.CENTER,
    });
    headerLabel.clutter_text.set_ellipsize(0);

    headerBox.add_child(headerIcon);
    headerBox.add_child(headerLabel);
    layout.add_child(headerBox);

    let valLabel;
    let chartArea = null;
    let chartCard = null;
    let centerBox = null;
    let samples = [];

    if (!showChart) {
        // ── NORMÁL NÉZET: Érték tökéletesen középre zárva ──
        centerBox = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
            y_expand: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });

        valLabel = new St.Label({
            text: '--',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });

        centerBox.add_child(valLabel);
        layout.add_child(centerBox);
    } else {
        // ── CHART NÉZET: Érték a fejléc alatt, és alatta a grafikon ──
        valLabel = new St.Label({
            text: '--',
            x_expand: true,
            x_align: Clutter.ActorAlign.START,
            y_align: Clutter.ActorAlign.CENTER,
        });
        layout.add_child(valLabel);

        const cardBg = cssColorToRgba(textColor, isDarkSurface ? CARD_BG_DARK_ALPHA : CARD_BG_LIGHT_ALPHA);
        const cardBorderAlpha = isDarkSurface ? CARD_BORDER_DARK_ALPHA : CARD_BORDER_LIGHT_ALPHA;

        chartCard = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
            y_expand: true,
            style: `background-color: ${cardBg}; border: 1px solid ${cssColorToRgba(textColor, cardBorderAlpha)}; border-radius: 10px; padding: 6px; margin-top: 4px;`,
        });

        chartArea = new St.DrawingArea({
            x_expand: true,
            y_expand: true,
            x_align: Clutter.ActorAlign.FILL,
            y_align: Clutter.ActorAlign.FILL,
        });

        chartArea.connect('repaint', (area) => {
            const ctx = area.get_context();
            const [w, h] = area.get_surface_size();
            drawTrendChart(ctx, w, h, samples, accentHex);
            ctx.$dispose();
        });

        chartCard.add_child(chartArea);
        layout.add_child(chartCard);
    }

    uiElements.headerBox = headerBox;
    uiElements.headerIcon = headerIcon;
    uiElements.headerLabel = headerLabel;
    uiElements.valLabel = valLabel;
    uiElements.centerBox = centerBox;
    uiElements.chartCard = chartCard;
    uiElements.showChart = showChart;

    uiElements.updateCards = (json, useFahrenheit = false) => {
        const cur = json.current;
        if (!cur) return;

        const hum = cur.humidity ?? cur.relative_humidity_2m;
        const tempUnit = useFahrenheit ? '°F' : '°C';

        if (metric === 'uv' && cur.uv_index !== null && cur.uv_index !== undefined) {
            valLabel.text = `${cur.uv_index}`;
        } else if (metric === 'humidity' && hum !== null && hum !== undefined) {
            valLabel.text = `${hum}%`;
        } else if (metric === 'aqi' && cur.aqi !== null && cur.aqi !== undefined) {
            valLabel.text = `${cur.aqi}`;
        } else if (metric === 'wind' && cur.windspeed !== null && cur.windspeed !== undefined) {
            valLabel.text = `${Math.round(cur.windspeed)} km/h`;
        } else if (metric === 'pressure' && cur.pressure !== null && cur.pressure !== undefined) {
            valLabel.text = `${Math.round(cur.pressure)} hPa`;
        } else if (metric === 'feels_like') {
            const val = useFahrenheit ? cur.feels_like_f : cur.feels_like_c;
            if (val !== null && val !== undefined) valLabel.text = `${Math.round(val)}${tempUnit}`;
        } else if (metric === 'gusts' && cur.gusts !== null && cur.gusts !== undefined) {
            valLabel.text = `${Math.round(cur.gusts)} km/h`;
        } else if (metric === 'dew_point') {
            const val = useFahrenheit ? cur.dew_point_f : cur.dew_point_c;
            if (val !== null && val !== undefined) valLabel.text = `${Math.round(val)}${tempUnit}`;
        } else if (metric === 'cloud' && cur.cloud !== null && cur.cloud !== undefined) {
            valLabel.text = `${cur.cloud}%`;
        } else if (metric === 'precipitation' && cur.precipitation !== null && cur.precipitation !== undefined) {
            valLabel.text = `${cur.precipitation} mm`;
        }

        if (showChart && chartArea && json.hourly_trends) {
            const rawSamples = json.hourly_trends[metric] || [];
            if (rawSamples.length > 1) {
                const min = Math.min(...rawSamples);
                const max = Math.max(...rawSamples);
                const span = max - min || 1;
                samples = rawSamples.map(v => (v - min) / span);
                chartArea.queue_repaint();
            }
        }
    };

    return uiElements;
}

export function attachCardsScaler(widgetNode, uiElements, widgetData) {
    if (!uiElements || !uiElements.valLabel) return null;

    const fontFamily = resolveExplicitFontFamily(widgetData);
    const fontCss = fontFamily ? `font-family: ${fontFamily}; ` : '';
    const textColor = resolveWidgetForegroundColor(widgetData);
    const isDarkSurface = isDarkBackgroundColor(resolveWidgetBackgroundColor(widgetData));
    const cardBg = cssColorToRgba(textColor, isDarkSurface ? CARD_BG_DARK_ALPHA : CARD_BG_LIGHT_ALPHA);
    const cardBorderAlpha = isDarkSurface ? CARD_BORDER_DARK_ALPHA : CARD_BORDER_LIGHT_ALPHA;

    return attachResponsiveScaler(widgetNode, BASE_CARD_WIDTH, BASE_CARD_HEIGHT, (scale) => {
        if (!uiElements.valLabel) return;

        // AudioOutput szabvány fejléc:
        const titleFontSize = Math.max(11, Math.round(13 * scale));
        const iconSize = Math.round(16 * scale);

        uiElements.headerBox.style = `margin-bottom: ${Math.round(6 * scale)}px;`;
        uiElements.headerIcon.icon_size = iconSize;
        uiElements.headerIcon.style = `color: ${textColor}; margin-right: 6px;`;
        uiElements.headerLabel.style = `${fontCss}color: ${textColor}; font-size: ${titleFontSize}px; font-weight: bold; opacity: 0.9;`;

        if (!uiElements.showChart) {
            // NORMÁL NÉZET: Középen a nagy érték
            const valSize = Math.max(32, Math.round(44 * scale));
            uiElements.valLabel.style = `${fontCss}color: ${textColor}; font-size: ${valSize}px; font-weight: bold; line-height: 1.0;`;
        } else {
            // CHART NÉZET: Érték felül a chart előtt, alatta a chart kártya
            const valSize = Math.max(15, Math.round(18 * scale));
            const cardRadius = Math.max(6, Math.round(10 * scale));
            const cardPad = Math.max(4, Math.round(6 * scale));
            const cardMargin = Math.max(4, Math.round(6 * scale));

            uiElements.valLabel.style = `${fontCss}color: ${textColor}; font-size: ${valSize}px; font-weight: bold; line-height: 1.1; margin-bottom: 2px;`;

            if (uiElements.chartCard) {
                uiElements.chartCard.style = `background-color: ${cardBg}; border: 1px solid ${cssColorToRgba(textColor, cardBorderAlpha)}; border-radius: ${cardRadius}px; padding: ${cardPad}px; margin-top: ${cardMargin}px;`;
            }
        }
    });
}