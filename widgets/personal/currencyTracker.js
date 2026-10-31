import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup';
import Pango from 'gi://Pango';
import {
    resolveWidgetForegroundColor,
    resolveExplicitFontFamily,
    CAIRO_OPERATOR_CLEAR,
    CAIRO_OPERATOR_OVER,
    CAIRO_LINE_CAP_ROUND,
} from '../../utils/widgetUtils.js';
import { 
    createWidgetContainer, 
    registerWidgetCleanup, 
    attachResponsiveScaler 
} from '../../shell/widgetUIUtils.js';
import { isActorDestroyed } from '../../utils/actorLifecycle.js';

const BASE_CONTAINER_WIDTH_PX = 400;
const BASE_CONTAINER_HEIGHT_PX = 200;

export function createCurrencyTrackerNode(config, width, height, xPosition, yPosition) {
    const fontFamily = resolveExplicitFontFamily(config);
    const fontCss = fontFamily ? `font-family: ${fontFamily}; ` : '';
    const textColor = resolveWidgetForegroundColor(config);
    const container = createWidgetContainer(config, width, height, xPosition, yPosition);

    const baseCurrency = (config.baseCurrency || 'EUR').toUpperCase();
    const targetCurrency = (config.targetCurrency || 'HUF').toUpperCase();
    const invertColors = Boolean(config.invertColors);

    let scale = Math.max(0.65, Math.min(width / BASE_CONTAINER_WIDTH_PX, height / BASE_CONTAINER_HEIGHT_PX));

    const mainLayout = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
    });
    container.add_child(mainLayout);

    // ── Fejléc ──
    const headerBox = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_expand: true,
    });
    const headerIcon = new St.Icon({
        icon_name: 'bank-symbolic',
        style: `color: ${textColor}; margin-right: 6px;`,
        y_align: Clutter.ActorAlign.CENTER,
    });
    const headerLabel = new St.Label({
        text: `${baseCurrency} / ${targetCurrency}`,
        y_align: Clutter.ActorAlign.CENTER,
    });
    headerLabel.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;

    headerBox.add_child(headerIcon);
    headerBox.add_child(headerLabel);
    mainLayout.add_child(headerBox);

    // ── Törzs: Bal oldalon érték + badge, jobb oldalon a grafikon ──
    const bodyRow = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_expand: true,
        y_expand: true,
        y_align: Clutter.ActorAlign.FILL,
    });

    const leftCol = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        y_align: Clutter.ActorAlign.CENTER,
        x_align: Clutter.ActorAlign.START,
    });

    const rateLabel = new St.Label({
        text: '---',
    });
    rateLabel.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
    leftCol.add_child(rateLabel);

    const badgeBox = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        y_align: Clutter.ActorAlign.CENTER,
    });

    const changePill = new St.Label({
        text: '0.00%',
    });
    const targetUnitLabel = new St.Label({
        text: ` ${targetCurrency}`,
        y_align: Clutter.ActorAlign.CENTER,
    });
    badgeBox.add_child(changePill);
    badgeBox.add_child(targetUnitLabel);
    leftCol.add_child(badgeBox);
    bodyRow.add_child(leftCol);

    const drawingArea = new St.DrawingArea({
        x_expand: true,
        y_expand: true,
        x_align: Clutter.ActorAlign.FILL,
        y_align: Clutter.ActorAlign.FILL,
    });
    bodyRow.add_child(drawingArea);
    mainLayout.add_child(bodyRow);

    // ── Lábléc ──
    const footerLabel = new St.Label({
        text: '30-day trend · Frankfurter API',
        x_align: Clutter.ActorAlign.START,
    });
    mainLayout.add_child(footerLabel);

    // ── Állapot ──
    let historyRates = [];
    let isDisposed = false;
    let isPositiveTrend = true;

    // ── Reszponzív skálázó függvény (applyScale) ──
    function applyScale(newScale, currentWidth) {
        scale = newScale;

        const pad = Math.max(8, Math.round(10 * scale));
        const titleFontSize = Math.max(11, Math.round(13 * scale));
        const rateFontSize = Math.max(18, Math.round(26 * scale));
        const pillFontSize = Math.max(10, Math.round(12 * scale));
        const unitFontSize = Math.max(10, Math.round(12 * scale));
        const footerFontSize = Math.max(8, Math.round(9 * scale));

        mainLayout.style = `padding: ${pad}px; spacing: ${Math.round(6 * scale)}px;`;
        headerBox.style = `margin-bottom: ${Math.round(6 * scale)}px;`;
        headerIcon.icon_size = Math.round(16 * scale);
        headerLabel.style = `${fontCss}color: ${textColor}; font-size: ${titleFontSize}px; font-weight: bold; opacity: 0.9;`;

        const effectiveW = (currentWidth || container.width || 400) - (pad * 2);
        leftCol.width = Math.floor(effectiveW * 0.48);
        leftCol.style = `spacing: ${Math.round(4 * scale)}px;`;

        rateLabel.style = `${fontCss}color: ${textColor}; font-size: ${rateFontSize}px; font-weight: bold;`;
        targetUnitLabel.style = `${fontCss}color: ${textColor}; font-size: ${unitFontSize}px; opacity: 0.6; margin-left: 6px;`;
        footerLabel.style = `${fontCss}color: ${textColor}; font-size: ${footerFontSize}px; opacity: 0.45;`;

        // Pill színstílus frissítése a trendnek megfelelően
        if (isPositiveTrend) {
            changePill.style = `${fontCss}font-size: ${pillFontSize}px; font-weight: bold; padding: 2px 7px; border-radius: 5px; background-color: rgba(76, 175, 80, 0.2); color: #81c784;`;
        } else {
            changePill.style = `${fontCss}font-size: ${pillFontSize}px; font-weight: bold; padding: 2px 7px; border-radius: 5px; background-color: rgba(244, 67, 54, 0.2); color: #e57373;`;
        }

        drawingArea.queue_repaint();
    }

    // ── Grafikon kirajzolása ──
    drawingArea.connect('repaint', (area) => {
        const ctx = area.get_context();
        const [w, h] = area.get_surface_size();
        if (w <= 0 || h <= 0) return;

        ctx.setOperator(CAIRO_OPERATOR_CLEAR);
        ctx.paint();
        ctx.setOperator(CAIRO_OPERATOR_OVER);

        if (historyRates.length < 2) {
            ctx.$dispose();
            return;
        }

        const padX = 2 * scale;
        const plotW = Math.max(10, w - (padX * 2));
        const plotH = Math.max(10, Math.min(h * 0.45, 36 * scale));
        const padBottom = (h - plotH) / 2;

        const minVal = Math.min(...historyRates);
        const maxVal = Math.max(...historyRates);
        const range = (maxVal - minVal) === 0 ? 1 : (maxVal - minVal);

        ctx.setLineWidth(Math.max(2.0, 2.5 * scale));
        ctx.setLineCap(CAIRO_LINE_CAP_ROUND);

        if (isPositiveTrend) {
            ctx.setSourceRGBA(0.50, 0.85, 0.55, 1.0);
        } else {
            ctx.setSourceRGBA(0.95, 0.45, 0.45, 1.0);
        }

        const stepX = plotW / (historyRates.length - 1);
        ctx.newPath();

        historyRates.forEach((val, idx) => {
            const x = padX + (idx * stepX);
            const norm = (val - minVal) / range;
            const y = h - padBottom - (norm * plotH);

            if (idx === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        });

        ctx.stroke();
        ctx.$dispose();
    });

    // ── API Lekérés ──
    const fetchRates = () => {
        try {
            const now = GLib.DateTime.new_now_local();
            const past = now.add_days(-30);
            const startDateStr = past.format('%Y-%m-%d');

            const url = `https://api.frankfurter.app/${startDateStr}..?from=${baseCurrency}&to=${targetCurrency}`;
            const httpSession = new Soup.Session();
            const message = Soup.Message.new('GET', url);

            httpSession.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null, (s, res) => {
                try {
                    const bytes = s.send_and_read_finish(res);
                    if (isDisposed || !bytes || isActorDestroyed(container)) return;

                    const data = JSON.parse(new TextDecoder().decode(bytes.get_data()));
                    if (!data || !data.rates || typeof data.rates !== 'object') {
                        rateLabel.set_text('N/A');
                        changePill.set_text('Error');
                        return;
                    }

                    const dates = Object.keys(data.rates).sort();
                    if (dates.length === 0) return;

                    historyRates = dates.map(d => data.rates[d][targetCurrency]).filter(Boolean);
                    if (historyRates.length === 0) return;

                    const currentRate = historyRates[historyRates.length - 1];
                    const firstRate = historyRates[0];
                    const diffPct = ((currentRate - firstRate) / firstRate) * 100;

                    const decimals = currentRate < 10 ? 4 : 2;
                    rateLabel.set_text(currentRate.toFixed(decimals));

                    isPositiveTrend = invertColors ? diffPct < 0 : diffPct >= 0;
                    const sign = isPositiveTrend ? '+' : '';
                    changePill.set_text(`${sign}${diffPct.toFixed(2)}%`);

                    applyScale(scale, container.width);
                } catch (e) {}
            });
        } catch (e) {}
    };

    fetchRates();

    const timeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 900, () => {
        if (isDisposed) return GLib.SOURCE_REMOVE;
        fetchRates();
        return GLib.SOURCE_CONTINUE;
    });

    registerWidgetCleanup(container, () => {
        isDisposed = true;
        if (timeoutId) GLib.source_remove(timeoutId);
    });

    applyScale(scale, width);

    attachResponsiveScaler(container, BASE_CONTAINER_WIDTH_PX, BASE_CONTAINER_HEIGHT_PX, (_ratio, w, h) => {
        if (isActorDestroyed(container)) return;
        applyScale(Math.max(0.65, Math.min(w / BASE_CONTAINER_WIDTH_PX, h / BASE_CONTAINER_HEIGHT_PX)), w);
    });

    return container;
}