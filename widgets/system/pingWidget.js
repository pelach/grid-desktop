import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import {
    resolveWidgetForegroundColor,
    resolveExplicitFontFamily,
    parseCssColor,
    cssColorToRgba,
    SECONDARY_OPACITY,
} from '../../utils/widgetUtils.js';
import { createWidgetContainer, registerWidgetCleanup, drawSparkline, SPARK_SAMPLE_CAPACITY } from '../../shell/widgetUIUtils.js';
import { pingEngine } from '../../utils/pingEngine.js';

const BASE_CONTAINER_WIDTH = 130;
const BASE_CONTAINER_HEIGHT = 130;
const PADDING_PX = 14;
const CHART_CONTAINER_BG_ALPHA = 0.08;
const CHART_CONTAINER_BORDER_ALPHA = 0.08;
const ICON_CONTAINER_BG_ALPHA = 0.08;
const ICON_CONTAINER_BORDER_ALPHA = 0.08;
const PING_BASELINE_MS = 60;

export function createPingNode(config, width, height, xPosition, yPosition) {
    const targetHost = config.pingHost || '1.1.1.1';
    const targetLabel = config.pingLabel || 'Cloudflare';
    const showChart = config.showChart !== false;

    pingEngine.setHost(targetHost);

    const textColor = resolveWidgetForegroundColor(config);
    const fontFamily = resolveExplicitFontFamily(config);
    const fontCss = fontFamily ? `font-family: ${fontFamily}; ` : '';
    const accentRgb = parseCssColor(config.globalAccentColor || '#3584e4');
    const container = createWidgetContainer(config, width, height, xPosition, yPosition);

    const scale = Math.min(width / BASE_CONTAINER_WIDTH, height / BASE_CONTAINER_HEIGHT);
    const pad = Math.max(8, Math.round(PADDING_PX * scale));

    // Ha nincs chart, nagyobb betűméretet használunk, mint a 3. referencia widgetnél
    const baseValueFont = showChart ? 24 : 32;
    const baseLabelFont = showChart ? 11 : 12;

    const valueFontSize = Math.max(14, Math.round(baseValueFont * scale));
    const labelFontSize = Math.max(9, Math.round(baseLabelFont * scale));
    const iconBoxSize = Math.max(22, Math.round(26 * scale));
    const iconSize = Math.max(12, Math.round(14 * scale));

    // Fő konténer
    const mainBox = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
        style: `padding: ${pad}px;`,
    });

    // Értéksor (szám + ms + státusz pötty)
    const valueRow = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_align: Clutter.ActorAlign.START,
        y_align: Clutter.ActorAlign.CENTER,
    });

    const valueLabel = new St.Label({
        text: '--',
        style: `${fontCss}color: ${textColor}; font-size: ${valueFontSize}px; font-weight: 600;`,
    });
    valueLabel.clutter_text.set_ellipsize(Pango.EllipsizeMode.NONE);

    const unitLabel = new St.Label({
        text: 'ms',
        style: `${fontCss}color: ${textColor}; opacity: ${SECONDARY_OPACITY}; `
            + `font-size: ${Math.round(valueFontSize * 0.42)}px; font-weight: 400; `
            + `margin-left: ${Math.round(3 * scale)}px; margin-top: ${Math.round(4 * scale)}px;`,
    });
    unitLabel.clutter_text.set_ellipsize(Pango.EllipsizeMode.NONE);

    const dotSize = Math.max(5, Math.round(6 * scale));
    const statusDot = new St.Widget({
        width: dotSize,
        height: dotSize,
        y_align: Clutter.ActorAlign.CENTER,
        style: `width: ${dotSize}px; height: ${dotSize}px; border-radius: 99px; `
            + `background-color: #33d17a; margin-left: ${Math.round(6 * scale)}px; margin-top: ${Math.round(4 * scale)}px;`,
    });

    valueRow.add_child(valueLabel);
    valueRow.add_child(unitLabel);
    valueRow.add_child(statusDot);

    const hostLabel = new St.Label({
        text: targetLabel,
        style: `${fontCss}color: ${textColor}; font-size: ${labelFontSize}px; opacity: ${SECONDARY_OPACITY}; margin-top: 1px;`,
    });
    hostLabel.clutter_text.set_ellipsize(Pango.EllipsizeMode.END);

    // Jobb felső kis ikon doboz
    const iconContainer = new St.BoxLayout({
        width: iconBoxSize,
        height: iconBoxSize,
        y_align: Clutter.ActorAlign.START, // Ne nyúljon le, maradjon a tetején
        y_expand: false,                   // Tiltjuk a függőleges terjeszkedést
        x_expand: false,
        style: `background-color: ${cssColorToRgba(textColor, ICON_CONTAINER_BG_ALPHA)}; `
            + `border: 1px solid ${cssColorToRgba(textColor, ICON_CONTAINER_BORDER_ALPHA)}; `
            + `border-radius: ${Math.round(6 * scale)}px;`,
    });

    const icon = new St.Icon({
        icon_name: 'network-transmit-receive-symbolic',
        icon_size: iconSize,
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
        x_expand: true,
        y_expand: true,
        style: `color: ${textColor}; opacity: ${SECONDARY_OPACITY};`,
    });
    iconContainer.add_child(icon);

    let sparkArea = null;
    const samples = [];

    if (showChart) {
        // --- 1. VÁLTOZAT: Van grafikon (középső CPU kártya mintájára) ---
        const topRow = new St.BoxLayout({
            orientation: Clutter.Orientation.HORIZONTAL,
            x_expand: true,
            y_align: Clutter.ActorAlign.START,
        });

        const textColumn = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
        });
        textColumn.add_child(valueRow);
        textColumn.add_child(hostLabel);

        topRow.add_child(textColumn);
        topRow.add_child(iconContainer);
        mainBox.add_child(topRow);

        const chartWrapper = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
            y_expand: true,
            style: `background-color: ${cssColorToRgba(textColor, CHART_CONTAINER_BG_ALPHA)}; `
                + `border: 1px solid ${cssColorToRgba(textColor, CHART_CONTAINER_BORDER_ALPHA)}; `
                + `border-radius: ${Math.round(8 * scale)}px; `
                + `margin-top: ${Math.round(8 * scale)}px; padding: 4px;`,
        });

        sparkArea = new St.DrawingArea({
            x_expand: true,
            y_expand: true,
        });

        chartWrapper.add_child(sparkArea);
        mainBox.add_child(chartWrapper);

        sparkArea.connect('repaint', (area) => {
            const context = area.get_context();
            const [surfaceWidth, surfaceHeight] = area.get_surface_size();
            const peak = Math.max(PING_BASELINE_MS, ...samples);
            drawSparkline(context, surfaceWidth, surfaceHeight, samples, peak,
                accentRgb.r, accentRgb.g, accentRgb.b, 1.0);
            context.$dispose();
        });
    } else {
        // --- 2. VÁLTOZAT: Nincs grafikon (3. CPU kártya mintájára) ---
        // Fent csak a jobbra igazított ikon ül:
        const iconRow = new St.BoxLayout({
            orientation: Clutter.Orientation.HORIZONTAL,
            x_expand: true,
            x_align: Clutter.ActorAlign.END,
            y_align: Clutter.ActorAlign.START,
        });
        iconRow.add_child(iconContainer);
        mainBox.add_child(iconRow);

        // Alulra lecsúsztatott szöveges blokk:
        const bottomColumn = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
            y_expand: true,
            y_align: Clutter.ActorAlign.END,
        });
        bottomColumn.add_child(valueRow);
        bottomColumn.add_child(hostLabel);
        mainBox.add_child(bottomColumn);
    }

    container.add_child(mainBox);

    const onDataUpdate = (data) => {
        if (!data.isOnline || data.ms < 0) {
            valueLabel.set_text('--');
            statusDot.style = `width: ${dotSize}px; height: ${dotSize}px; border-radius: 99px; `
                + `background-color: #e01b24; margin-left: ${Math.round(6 * scale)}px; margin-top: ${Math.round(4 * scale)}px;`;
            if (showChart) samples.push(PING_BASELINE_MS);
        } else {
            const roundedMs = Math.round(data.ms);
            valueLabel.set_text(String(roundedMs));

            let dotColor = '#33d17a';
            if (roundedMs >= 150) {
                dotColor = '#e01b24';
            } else if (roundedMs >= 50) {
                dotColor = '#f6d32d';
            }

            statusDot.style = `width: ${dotSize}px; height: ${dotSize}px; border-radius: 99px; `
                + `background-color: ${dotColor}; margin-left: ${Math.round(6 * scale)}px; margin-top: ${Math.round(4 * scale)}px;`;
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