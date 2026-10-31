import St from 'gi://St';
import Clutter from 'gi://Clutter';
import {
    resolveWidgetForegroundColor,
    resolveExplicitFontFamily,
    parseCssColor,
    cssColorToRgba,
    CAIRO_OPERATOR_CLEAR,
    CAIRO_OPERATOR_OVER,
    isDarkBackgroundColor,
    resolveWidgetBackgroundColor,
} from '../../utils/widgetUtils.js';
import { createWidgetContainer, registerWidgetCleanup, attachResponsiveScaler } from '../../shell/widgetUIUtils.js';
import { cpuRamEngine, networkEngine } from '../../utils/systemMonitorEngine.js';
import { formatBytesPerSecond } from './network.js';
import { isActorDestroyed } from '../../utils/actorLifecycle.js';

const PERCENTAGE_FACTOR = 100;
const CHART_MAX_SAMPLES = 60;
const CHART_LINE_WIDTH = 1.8;
const CHART_FILL_ALPHA = 0.16;
const CHART_PAD = 3;
const LABEL_OPACITY = 0.65;

const BASE_CONTAINER_SIZE = 200;
const BASE_CARD_PADDING_PX = 8;
const BASE_CARD_RADIUS_PX = 10;
const BASE_CARD_GAP_PX = 6;
const BASE_TITLE_FONT_SIZE_PX = 11;
const BASE_BADGE_FONT_SIZE_PX = 11;
const BASE_NET_LABEL_FONT_SIZE_PX = 10;
const BASE_NET_VALUE_FONT_SIZE_PX = 14;
const BASE_NET_UNIT_FONT_SIZE_PX = 10;

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

    const innerW = w - (CHART_PAD * 2);
    const innerH = h - (CHART_PAD * 2);

    const pointAt = (index) => {
        const ratio = index / (samples.length - 1);
        const value = Math.max(0, Math.min(1, samples[index]));
        return [
            CHART_PAD + ratio * innerW,
            CHART_PAD + (1 - value) * innerH,
        ];
    };

    const { r, g, b } = parseCssColor(accentHex);

    ctx.setLineWidth(CHART_LINE_WIDTH);
    ctx.setSourceRGBA(r, g, b, 1);
    ctx.newPath();
    const [startX, startY] = pointAt(0);
    ctx.moveTo(startX, startY);
    for (let i = 1; i < samples.length; i++) {
        const [x, y] = pointAt(i);
        ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.lineTo(w - CHART_PAD, CHART_PAD + innerH);
    ctx.lineTo(CHART_PAD, CHART_PAD + innerH);
    ctx.closePath();
    ctx.setSourceRGBA(r, g, b, CHART_FILL_ALPHA);
    ctx.fill();
}

function createValueUnitRow(fontCss, textColor, valueFontSize, unitFontSize) {
    const row = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_align: Clutter.ActorAlign.START,
    });
    const valueLabel = new St.Label({
        text: '--',
        style: `${fontCss}color: ${textColor}; font-size: ${valueFontSize}px; font-weight: 400;`,
    });
    const unitLabel = new St.Label({
        text: '',
        style: `${fontCss}color: ${textColor}; font-size: ${unitFontSize}px; opacity: ${LABEL_OPACITY};`,
    });
    row.add_child(valueLabel);
    row.add_child(unitLabel);
    return { row, valueLabel, unitLabel };
}

export function createSystemDashboardNode(config, width, height, xPosition, yPosition) {
    const fontFamily = resolveExplicitFontFamily(config);
    const fontCss = fontFamily ? `font-family: ${fontFamily}; ` : '';
    const textColor = resolveWidgetForegroundColor(config);
    const accentHex = config.globalAccentColor || '#3584e4';
    const container = createWidgetContainer(config, width, height, xPosition, yPosition);

    let scale = Math.max(0.65, Math.min(width, height) / BASE_CONTAINER_SIZE);

    const isDarkSurface = isDarkBackgroundColor(resolveWidgetBackgroundColor(config));
    const cardBg = cssColorToRgba(textColor, isDarkSurface ? CARD_BG_DARK_ALPHA : CARD_BG_LIGHT_ALPHA);
    const cardBorderAlpha = isDarkSurface ? CARD_BORDER_DARK_ALPHA : CARD_BORDER_LIGHT_ALPHA;

    const contentBox = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
    });

    const processorCard = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
    });

    const processorHeader = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_expand: true,
    });
    const processorTitle = new St.Label({
        text: 'Processor',
        style: `${fontCss}color: ${textColor}; opacity: ${LABEL_OPACITY};`,
        y_align: Clutter.ActorAlign.CENTER,
        x_expand: true,
    });
    const processorBadge = new St.Label({
        text: '0%',
        y_align: Clutter.ActorAlign.CENTER,
    });
    processorHeader.add_child(processorTitle);
    processorHeader.add_child(processorBadge);
    processorCard.add_child(processorHeader);

    const cpuChartArea = new St.DrawingArea({
        x_expand: true,
        y_expand: true,
        x_align: Clutter.ActorAlign.FILL,
        y_align: Clutter.ActorAlign.FILL,
    });
    processorCard.add_child(cpuChartArea);

    const networkCard = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
    });

    const networkGrid = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_expand: true,
    });

    const createNetworkStat = (labelText) => {
        const stat = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
        });
        const label = new St.Label({
            text: labelText,
            style: `${fontCss}color: ${textColor}; opacity: ${LABEL_OPACITY};`,
        });
        const valueRow = createValueUnitRow(fontCss, textColor, 14, 10);
        stat.add_child(label);
        stat.add_child(valueRow.row);
        return { stat, label, valueLabel: valueRow.valueLabel, unitLabel: valueRow.unitLabel };
    };

    const downloadStat = createNetworkStat('Download');
    const uploadStat = createNetworkStat('Upload');

    networkGrid.add_child(downloadStat.stat);
    networkGrid.add_child(uploadStat.stat);
    networkCard.add_child(networkGrid);

    contentBox.add_child(processorCard);
    contentBox.add_child(networkCard);
    container.add_child(contentBox);

    let cpuSamples = [];

    cpuChartArea.connect('repaint', (area) => {
        const ctx = area.get_context();
        const [w, h] = area.get_surface_size();
        drawTrendChart(ctx, w, h, cpuSamples, accentHex);
        ctx.$dispose();
    });

    const onCpuRamUpdate = (data) => {
        if (isActorDestroyed(container)) return;
        cpuSamples.push(data.cpuProgress);
        if (cpuSamples.length > CHART_MAX_SAMPLES) {
            cpuSamples.shift();
        }
        processorBadge.set_text(`${Math.round(data.cpuProgress * PERCENTAGE_FACTOR)}%`);
        cpuChartArea.queue_repaint();
    };

    const onNetworkUpdate = (data) => {
        if (isActorDestroyed(container)) return;
        const setNetworkValue = (valueLabel, unitLabel, bytesPerSec) => {
            const [value, unit] = formatBytesPerSecond(bytesPerSec).split(' ');
            valueLabel.set_text(value);
            unitLabel.set_text(` ${unit}`);
        };
        setNetworkValue(downloadStat.valueLabel, downloadStat.unitLabel, data.downloadSpeed);
        setNetworkValue(uploadStat.valueLabel, uploadStat.unitLabel, data.uploadSpeed);
    };

    function applyScale(newScale) {
        scale = newScale;
        const cardPadding = Math.max(6, Math.round(BASE_CARD_PADDING_PX * scale));
        const cardRadius = Math.max(6, Math.round(BASE_CARD_RADIUS_PX * scale));
        const cardGap = Math.max(4, Math.round(BASE_CARD_GAP_PX * scale));
        const titleFontSize = Math.max(10, Math.round(BASE_TITLE_FONT_SIZE_PX * scale));
        const badgeFontSize = Math.max(9, Math.round(BASE_BADGE_FONT_SIZE_PX * scale));
        const netLabelFontSize = Math.max(9, Math.round(BASE_NET_LABEL_FONT_SIZE_PX * scale));
        const netValueFontSize = Math.max(11, Math.round(BASE_NET_VALUE_FONT_SIZE_PX * scale));
        const netUnitFontSize = Math.max(8, Math.round(BASE_NET_UNIT_FONT_SIZE_PX * scale));

        const cardStyle = `background-color: ${cardBg}; border: 1px solid ${cssColorToRgba(textColor, cardBorderAlpha)}; border-radius: ${cardRadius}px; padding: ${cardPadding}px;`;

        contentBox.style = `padding: ${Math.max(6, Math.round(8 * scale))}px; spacing: ${cardGap}px;`;
        processorCard.style = cardStyle;
        networkCard.style = cardStyle;

        processorHeader.style = `margin-bottom: ${Math.round(4 * scale)}px;`;
        processorTitle.style = `${fontCss}color: ${textColor}; font-size: ${titleFontSize}px; opacity: ${LABEL_OPACITY}; font-weight: 500;`;
        processorBadge.style = `${fontCss}color: ${textColor}; font-size: ${badgeFontSize}px; background-color: ${cssColorToRgba(textColor, 0.08)}; border-radius: 999px; padding: 1px 8px; font-weight: bold;`;

        networkGrid.style = `spacing: ${cardGap * 2}px;`;

        [downloadStat, uploadStat].forEach(stat => {
            stat.stat.style = `spacing: 1px;`;
            stat.label.style = `${fontCss}color: ${textColor}; font-size: ${netLabelFontSize}px; opacity: ${LABEL_OPACITY}; font-weight: 500;`;
            stat.valueLabel.style = `${fontCss}color: ${textColor}; font-size: ${netValueFontSize}px; font-weight: 400;`;
            stat.unitLabel.style = `${fontCss}color: ${textColor}; font-size: ${netUnitFontSize}px; opacity: ${LABEL_OPACITY};`;
        });

        cpuChartArea.queue_repaint();
    }

    applyScale(scale);

    attachResponsiveScaler(container, BASE_CONTAINER_SIZE, BASE_CONTAINER_SIZE, (_ratio, w, h) => {
        if (isActorDestroyed(container)) return;
        applyScale(Math.max(0.65, Math.min(w, h) / BASE_CONTAINER_SIZE));
    });

    const releaseCpuRam = cpuRamEngine.subscribe(onCpuRamUpdate);
    const releaseNetwork = networkEngine.subscribe(onNetworkUpdate);

    registerWidgetCleanup(container, () => {
        releaseCpuRam();
        releaseNetwork();
    });

    return container;
}