import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import {
    resolveWidgetForegroundColor,
    resolveExplicitFontFamily,
    parseCssColor,
    cssColorToRgba,
    isDarkBackgroundColor,
    resolveWidgetBackgroundColor,
    SECONDARY_OPACITY,
} from '../../utils/widgetUtils.js';
import { 
    createWidgetContainer, 
    registerWidgetCleanup, 
    attachResponsiveScaler, 
    drawSparkline, 
    SPARK_SAMPLE_CAPACITY 
} from '../../shell/widgetUIUtils.js';
import { pingEngine } from '../../utils/pingEngine.js';

const BASE_CONTAINER_WIDTH = 200;
const BASE_CONTAINER_HEIGHT = 200;

const CARD_BG_DARK_ALPHA = 0.05;
const CARD_BG_LIGHT_ALPHA = 0.04;
const CARD_BORDER_DARK_ALPHA = 0.06;
const CARD_BORDER_LIGHT_ALPHA = 0.10;
const PING_BASELINE_MS = 60;

export function createPingNode(config, width, height, xPosition, yPosition) {
    const targetHost = config.pingHost || '1.1.1.1';
    const targetLabel = config.pingLabel || 'Cloudflare';
    const showChart = config.showChart === true;

    pingEngine.setHost(targetHost);

    const textColor = resolveWidgetForegroundColor(config);
    const fontFamily = resolveExplicitFontFamily(config);
    const fontCss = fontFamily ? `font-family: ${fontFamily}; ` : '';
    const accentRgb = parseCssColor(config.globalAccentColor || '#3584e4');
    const container = createWidgetContainer(config, width, height, xPosition, yPosition);

    let scale = Math.max(0.65, Math.min(width / BASE_CONTAINER_WIDTH, height / BASE_CONTAINER_HEIGHT));
    const isDarkSurface = isDarkBackgroundColor(resolveWidgetBackgroundColor(config));

    // Fő konténer
    const mainLayout = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
    });
    container.add_child(mainLayout);

    // ── 1. Egységes Fejléc: Bal felül ikon + címke ──
    const headerBox = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_expand: true,
        y_align: Clutter.ActorAlign.START,
    });

    const headerIcon = new St.Icon({
        icon_name: 'network-transmit-receive-symbolic',
        style: `color: ${textColor};`,
        y_align: Clutter.ActorAlign.CENTER,
    });

    const headerLabel = new St.Label({
        text: targetLabel,
        y_align: Clutter.ActorAlign.CENTER,
    });
    headerLabel.clutter_text.set_ellipsize(Pango.EllipsizeMode.END);

    headerBox.add_child(headerIcon);
    headerBox.add_child(headerLabel);
    mainLayout.add_child(headerBox);

    // ── Értéksor (szám + ms + státusz pötty) ──
    const valueRow = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        y_align: Clutter.ActorAlign.CENTER,
    });

    const valueLabel = new St.Label({
        text: '--',
    });
    valueLabel.clutter_text.set_ellipsize(Pango.EllipsizeMode.NONE);

    const unitLabel = new St.Label({
        text: 'ms',
    });
    unitLabel.clutter_text.set_ellipsize(Pango.EllipsizeMode.NONE);

    const statusDot = new St.Widget({
        y_align: Clutter.ActorAlign.CENTER,
    });

    valueRow.add_child(valueLabel);
    valueRow.add_child(unitLabel);
    valueRow.add_child(statusDot);

    let chartCard = null;
    let sparkArea = null;
    let centerBox = null;
    const samples = [];
    let currentDotColor = '#33d17a';

    if (!showChart) {
        // ── NORMÁL NÉZET: Értéksor tökéletesen KÖZÉPRE zárva ──
        centerBox = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
            y_expand: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });

        valueRow.x_align = Clutter.ActorAlign.CENTER;
        centerBox.add_child(valueRow);
        mainLayout.add_child(centerBox);
    } else {
        // ── CHART NÉZET: Értéksor balra zártan felül, alatta a chart ──
        valueRow.x_align = Clutter.ActorAlign.START;
        mainLayout.add_child(valueRow);

        const cardBg = cssColorToRgba(textColor, isDarkSurface ? CARD_BG_DARK_ALPHA : CARD_BG_LIGHT_ALPHA);
        const cardBorderAlpha = isDarkSurface ? CARD_BORDER_DARK_ALPHA : CARD_BORDER_LIGHT_ALPHA;

        chartCard = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
            y_expand: true,
            style: `background-color: ${cardBg}; border: 1px solid ${cssColorToRgba(textColor, cardBorderAlpha)}; border-radius: 10px; padding: 6px; margin-top: 4px;`,
        });

        sparkArea = new St.DrawingArea({
            x_expand: true,
            y_expand: true,
            x_align: Clutter.ActorAlign.FILL,
            y_align: Clutter.ActorAlign.FILL,
        });

        sparkArea.connect('repaint', (area) => {
            const context = area.get_context();
            const [surfaceWidth, surfaceHeight] = area.get_surface_size();
            const peak = Math.max(PING_BASELINE_MS, ...samples);
            drawSparkline(context, surfaceWidth, surfaceHeight, samples, peak,
                accentRgb.r, accentRgb.g, accentRgb.b, 1.0);
            context.$dispose();
        });

        chartCard.add_child(sparkArea);
        mainLayout.add_child(chartCard);
    }

    function applyScale(newScale) {
        scale = newScale;
        const titleFontSize = Math.max(11, Math.round(13 * scale));
        const iconSize = Math.round(16 * scale);
        const dotSize = Math.max(6, Math.round(8 * scale));

        mainLayout.style = `padding: ${Math.max(8, Math.round(10 * scale))}px;`;
        headerBox.style = `margin-bottom: ${Math.round(6 * scale)}px;`;
        headerIcon.icon_size = iconSize;
        headerIcon.style = `color: ${textColor}; margin-right: 6px;`;
        headerLabel.style = `${fontCss}color: ${textColor}; font-size: ${titleFontSize}px; font-weight: bold; opacity: 0.9;`;

        statusDot.style = `width: ${dotSize}px; height: ${dotSize}px; border-radius: 99px; `
            + `background-color: ${currentDotColor}; margin-left: ${Math.round(6 * scale)}px; margin-top: ${Math.round(2 * scale)}px;`;

        if (!showChart) {
            // NORMÁL NÉZET
            const valSize = Math.max(32, Math.round(44 * scale));
            valueLabel.style = `${fontCss}color: ${textColor}; font-size: ${valSize}px; font-weight: bold; line-height: 1.0;`;
            unitLabel.style = `${fontCss}color: ${textColor}; opacity: ${SECONDARY_OPACITY}; `
                + `font-size: ${Math.round(valSize * 0.42)}px; font-weight: 500; `
                + `margin-left: ${Math.round(4 * scale)}px; margin-top: ${Math.round(6 * scale)}px;`;
        } else {
            // CHART NÉZET
            const valSize = Math.max(15, Math.round(18 * scale));
            const cardRadius = Math.max(6, Math.round(10 * scale));
            const cardPad = Math.max(4, Math.round(6 * scale));
            const cardMargin = Math.max(4, Math.round(6 * scale));

            valueLabel.style = `${fontCss}color: ${textColor}; font-size: ${valSize}px; font-weight: bold; line-height: 1.1; margin-bottom: 2px;`;
            unitLabel.style = `${fontCss}color: ${textColor}; opacity: ${SECONDARY_OPACITY}; `
                + `font-size: ${Math.round(valSize * 0.65)}px; font-weight: 500; `
                + `margin-left: ${Math.round(3 * scale)}px; margin-top: ${Math.round(2 * scale)}px; margin-bottom: 2px;`;

            if (chartCard) {
                const cardBg = cssColorToRgba(textColor, isDarkSurface ? CARD_BG_DARK_ALPHA : CARD_BG_LIGHT_ALPHA);
                const cardBorderAlpha = isDarkSurface ? CARD_BORDER_DARK_ALPHA : CARD_BORDER_LIGHT_ALPHA;
                chartCard.style = `background-color: ${cardBg}; border: 1px solid ${cssColorToRgba(textColor, cardBorderAlpha)}; border-radius: ${cardRadius}px; padding: ${cardPad}px; margin-top: ${cardMargin}px;`;
            }
        }
    }

    applyScale(scale);

    attachResponsiveScaler(container, BASE_CONTAINER_WIDTH, BASE_CONTAINER_HEIGHT, (_ratio, w, h) => {
        applyScale(Math.max(0.65, Math.min(w / BASE_CONTAINER_WIDTH, h / BASE_CONTAINER_HEIGHT)));
    });

    const onDataUpdate = (data) => {
        const dotSize = Math.max(6, Math.round(8 * scale));

        if (!data.isOnline || data.ms < 0) {
            valueLabel.set_text('--');
            currentDotColor = '#e01b24';
            statusDot.style = `width: ${dotSize}px; height: ${dotSize}px; border-radius: 99px; `
                + `background-color: ${currentDotColor}; margin-left: ${Math.round(6 * scale)}px; margin-top: ${Math.round(2 * scale)}px;`;
            if (showChart) samples.push(PING_BASELINE_MS);
        } else {
            const roundedMs = Math.round(data.ms);
            valueLabel.set_text(String(roundedMs));

            if (roundedMs >= 150) {
                currentDotColor = '#e01b24';
            } else if (roundedMs >= 50) {
                currentDotColor = '#f6d32d';
            } else {
                currentDotColor = '#33d17a';
            }

            statusDot.style = `width: ${dotSize}px; height: ${dotSize}px; border-radius: 99px; `
                + `background-color: ${currentDotColor}; margin-left: ${Math.round(6 * scale)}px; margin-top: ${Math.round(2 * scale)}px;`;
            if (showChart) samples.push(roundedMs);
        }

        if (showChart && sparkArea) {
            if (samples.length > SPARK_SAMPLE_CAPACITY)
                samples.shift();
            sparkArea.queue_repaint();
        }
    };

    const releaseEngine = pingEngine.subscribe(onDataUpdate);
    registerWidgetCleanup(container, releaseEngine);

    return container;
}