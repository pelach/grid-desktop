import St from 'gi://St';
import Clutter from 'gi://Clutter';
import { resolveWidgetForegroundColor, resolveExplicitFontFamily, cssColorToRgba, isDarkBackgroundColor, resolveWidgetBackgroundColor, parseCssColor, CAIRO_OPERATOR_CLEAR, CAIRO_OPERATOR_OVER } from '../../utils/widgetUtils.js';

const BORDER_ALPHA = 0.14;
const BADGE_BG_ALPHA = 0.12;
const SUB_LABEL_OPACITY = 0.65;
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

    // Finom 1px-es Adwaita keret, mint a System Info-nál:
    layout.style += ` border: 1px solid ${cssColorToRgba(textColor, BORDER_ALPHA)}; border-radius: 12px;`;

    let iconName = 'weather-clear-symbolic';
    let defaultLabel = 'UV INDEX';

    if (metric === 'humidity') {
        iconName = 'weather-showers-symbolic';
        defaultLabel = 'HUMIDITY';
    } else if (metric === 'aqi') {
        iconName = 'emblem-default-symbolic';
        defaultLabel = 'AIR QUALITY';
    } else if (metric === 'wind') {
        iconName = 'weather-windy-symbolic';
        defaultLabel = 'WIND SPEED';
    }

    const isDarkSurface = isDarkBackgroundColor(resolveWidgetBackgroundColor(widgetData));
    const badgeBg = cssColorToRgba(textColor, BADGE_BG_ALPHA);

    const iconBadge = new St.Bin({
        style: `background-color: ${badgeBg}; border-radius: 7px; padding: 5px;`,
        y_align: Clutter.ActorAlign.CENTER,
    });
    const topIcon = new St.Icon({
        icon_name: iconName,
        icon_size: 15,
        style: `color: ${textColor}; opacity: 0.9;`,
    });
    iconBadge.set_child(topIcon);

    let valLabel;
    let typeLabel;
    let chartArea = null;
    let samples = [];

    if (!showChart) {
        // NORMÁL NÉZET: Fent jobb oldalon a badge, alul a nagy szám és felirat
        const topBox = new St.BoxLayout({
            orientation: Clutter.Orientation.HORIZONTAL,
            x_align: Clutter.ActorAlign.END,
            x_expand: true,
        });
        topBox.add_child(iconBadge);
        layout.add_child(topBox);

        const bottomBox = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            y_align: Clutter.ActorAlign.END,
            y_expand: true,
        });

        valLabel = new St.Label({
            text: '--',
            style: `${fontCss}color: ${textColor}; font-size: 22px; font-weight: bold; line-height: 1.1;`,
        });

        typeLabel = new St.Label({
            text: defaultLabel,
            style: `${fontCss}color: ${textColor}; font-size: 12px; opacity: ${SUB_LABEL_OPACITY}; font-weight: 500;`,
        });

        bottomBox.add_child(valLabel);
        bottomBox.add_child(typeLabel);
        layout.add_child(bottomBox);
    } else {
        // CHART NÉZET: Fejléc balra az értékkel és felirattal, jobbra a badge, alatta kártya
        const headerBox = new St.BoxLayout({
            orientation: Clutter.Orientation.HORIZONTAL,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });

        const textInfoBox = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });

        valLabel = new St.Label({
            text: '--',
            style: `${fontCss}color: ${textColor}; font-size: 18px; font-weight: bold; line-height: 1.0;`,
        });

        typeLabel = new St.Label({
            text: defaultLabel,
            style: `${fontCss}color: ${textColor}; font-size: 11px; opacity: ${SUB_LABEL_OPACITY}; font-weight: 500;`,
        });

        textInfoBox.add_child(valLabel);
        textInfoBox.add_child(typeLabel);
        headerBox.add_child(textInfoBox);
        headerBox.add_child(iconBadge);
        layout.add_child(headerBox);

        const cardBg = cssColorToRgba(textColor, isDarkSurface ? CARD_BG_DARK_ALPHA : CARD_BG_LIGHT_ALPHA);
        const cardBorderAlpha = isDarkSurface ? CARD_BORDER_DARK_ALPHA : CARD_BORDER_LIGHT_ALPHA;

        const chartCard = new St.BoxLayout({
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

    uiElements.updateCards = (json) => {
        const cur = json.current;
        if (!cur) return;

        const hum = cur.humidity ?? cur.relative_humidity_2m;

        if (metric === 'uv' && cur.uv_index !== null && cur.uv_index !== undefined) {
            valLabel.text = `${cur.uv_index}`;
        } else if (metric === 'humidity' && hum !== null && hum !== undefined) {
            valLabel.text = `${hum}%`;
        } else if (metric === 'aqi' && cur.aqi !== null && cur.aqi !== undefined) {
            valLabel.text = `${cur.aqi}`;
        } else if (metric === 'wind' && cur.windspeed !== null && cur.windspeed !== undefined) {
            valLabel.text = `${Math.round(cur.windspeed)} km/h`;
        }

        // A saját metrika trendjének kirajzolása:
        if (showChart && chartArea && json.hourly_trends) {
            const rawSamples = json.hourly_trends[metric] || [];
            
            if (rawSamples.length > 1) {
                const min = Math.min(...rawSamples);
                const max = Math.max(...rawSamples);
                const span = max - min || 1;
                // Skálázás 0.0 és 1.0 közé:
                samples = rawSamples.map(v => (v - min) / span);
                chartArea.queue_repaint();
            }
        }
    };

    return uiElements;
}

export function attachCardsScaler(widgetNode, uiElements, widgetData) {
    // A layout automatikusan követi a cellaméretet
}