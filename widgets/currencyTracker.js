import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup';
import Pango from 'gi://Pango';
import {
    resolveWidgetForegroundColor,
    resolveExplicitFontFamily,
    cssColorToRgba,
    CAIRO_OPERATOR_CLEAR,
    CAIRO_OPERATOR_OVER,
    CAIRO_LINE_CAP_ROUND,
} from '../utils/widgetUtils.js';
import { createWidgetContainer, registerWidgetCleanup } from '../shell/widgetUIUtils.js';

const BORDER_ALPHA = 0.14;
const BASE_CONTAINER_WIDTH_PX = 270;
const BASE_CONTAINER_HEIGHT_PX = 160;

export function createCurrencyTrackerNode(config, width, height, xPosition, yPosition) {
    const fontFamily = resolveExplicitFontFamily(config) || 'Sans';
    const fontCss = fontFamily ? `font-family: ${fontFamily}; ` : '';
    const textColor = resolveWidgetForegroundColor(config);
    const container = createWidgetContainer(config, width, height, xPosition, yPosition);
    container.style += ` border: 1px solid ${cssColorToRgba(textColor, BORDER_ALPHA)};`;

    const baseCurrency = (config.baseCurrency || 'EUR').toUpperCase();
    const targetCurrency = (config.targetCurrency || 'HUF').toUpperCase();

    const scale = Math.max(0.65, Math.min(width / BASE_CONTAINER_WIDTH_PX, height / BASE_CONTAINER_HEIGHT_PX));
    const padding = Math.max(10, Math.round(14 * scale));

    const mainLayout = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
        style: `padding: ${padding}px; spacing: ${Math.round(6 * scale)}px;`,
    });

    const titleFontSize = Math.max(11, Math.round(13 * scale));

    const headerBox = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_expand: true,
        style: `margin-bottom: ${Math.round(4 * scale)}px;`,
    });
    const headerIcon = new St.Icon({
        icon_name: 'bank-symbolic',
        icon_size: Math.round(16 * scale),
        style: `color: ${textColor}; margin-right: 6px;`,
        y_align: Clutter.ActorAlign.CENTER,
    });
    const headerLabel = new St.Label({
        text: `${baseCurrency} / ${targetCurrency}`,
        style: `${fontCss}color: ${textColor}; font-size: ${titleFontSize}px; font-weight: bold; opacity: 0.9;`,
        y_align: Clutter.ActorAlign.CENTER,
    });
    headerLabel.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;

    headerBox.add_child(headerIcon);
    headerBox.add_child(headerLabel);
    mainLayout.add_child(headerBox);

    // ── Törzs: Bal oldalon az érték + badge, jobb oldalon a Cairo grafikon ──
    const bodyRow = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_expand: true,
        y_expand: true,
        y_align: Clutter.ActorAlign.FILL,
    });

    const innerWidth = width - (padding * 2);
    const leftWidth = Math.floor(innerWidth * 0.48); // Bal oldal a számoknak
    const graphWidth = innerWidth - leftWidth;       // Jobb oldal a grafikonnak

    const leftCol = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        y_align: Clutter.ActorAlign.CENTER,
        x_align: Clutter.ActorAlign.START,
        width: leftWidth,
        style: `spacing: ${Math.round(4 * scale)}px;`,
    });

    const rateLabel = new St.Label({
        text: '---',
        style: `${fontCss}color: ${textColor}; font-size: ${Math.round(22 * scale)}px; font-weight: bold;`,
    });
    rateLabel.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
    leftCol.add_child(rateLabel);

    const badgeBox = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        y_align: Clutter.ActorAlign.CENTER,
    });

    const changePill = new St.Label({
        text: '0.00%',
        style: `${fontCss}font-size: ${Math.round(10 * scale)}px; font-weight: bold; padding: 2px 7px; border-radius: 5px; background-color: rgba(255,255,255,0.08); color: ${textColor};`,
    });
    const targetUnitLabel = new St.Label({
        text: ` ${targetCurrency}`,
        style: `${fontCss}color: ${textColor}; font-size: ${Math.round(11 * scale)}px; opacity: 0.6; margin-left: 6px;`,
        y_align: Clutter.ActorAlign.CENTER,
    });
    badgeBox.add_child(changePill);
    badgeBox.add_child(targetUnitLabel);
    leftCol.add_child(badgeBox);

    bodyRow.add_child(leftCol);

    // Jobb oldali Sparkline: explicit szélességgel a 3. és 4. rácsoszloptér kitöltéséhez
    const drawingArea = new St.DrawingArea({
        width: graphWidth,
        y_expand: true,
        x_align: Clutter.ActorAlign.FILL,
        y_align: Clutter.ActorAlign.FILL,
    });
    bodyRow.add_child(drawingArea);
    mainLayout.add_child(bodyRow);

    // Lábléc
    const footerLabel = new St.Label({
        text: '30-day trend · Frankfurter API',
        style: `${fontCss}color: ${textColor}; font-size: ${Math.round(8 * scale)}px; opacity: 0.45;`,
        x_align: Clutter.ActorAlign.START,
    });
    mainLayout.add_child(footerLabel);

    container.add_child(mainLayout);

    // ── Állapot ───────────────────────────────────────────────
    let historyRates = [];
    let isDisposed = false;
    let isPositiveTrend = true;

    // ── Grafikon kirajzolása ──────────────────────────────────
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
        const plotH = Math.max(10, Math.min(h * 0.35, 30 * scale));
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

    // ── API Lekérés (Soup session) ────────────────────────────
    const fetchRates = () => {
        try {
            // Elmúlt 30 nap kiszámítása (hogy legalább 5-6 munkanap meglegyen a hétvégék miatt)
            const now = GLib.DateTime.new_now_local();
            const past = now.add_days(-30);
            const startDateStr = past.format('%Y-%m-%d');

            const url = `https://api.frankfurter.app/${startDateStr}..?from=${baseCurrency}&to=${targetCurrency}`;
            const httpSession = new Soup.Session();
            const message = Soup.Message.new('GET', url);

            httpSession.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null, (s, res) => {
                try {
                    const bytes = s.send_and_read_finish(res);
                    if (isDisposed || !bytes) return;

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

                    // Formázás: 2 tizedesjegy, ha kicsi az érték, 4
                    const decimals = currentRate < 10 ? 4 : 2;
                    rateLabel.set_text(currentRate.toFixed(decimals));

                    isPositiveTrend = diffPct >= 0;
                    const sign = isPositiveTrend ? '+' : '';
                    changePill.set_text(`${sign}${diffPct.toFixed(2)}%`);

                    if (isPositiveTrend) {
                        changePill.style = `${fontCss}font-size: ${Math.round(9 * scale)}px; font-weight: bold; padding: 2px 6px; border-radius: 4px; background-color: rgba(76, 175, 80, 0.2); color: #81c784;`;
                    } else {
                        changePill.style = `${fontCss}font-size: ${Math.round(9 * scale)}px; font-weight: bold; padding: 2px 6px; border-radius: 4px; background-color: rgba(244, 67, 54, 0.2); color: #e57373;`;
                    }

                    drawingArea.queue_repaint();
                } catch (e) {}
            });
        } catch (e) {}
    };

    fetchRates();

    // 15 percenkénti frissítés (devizapiacra bőven elég)
    const timeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 900, () => {
        if (isDisposed) return GLib.SOURCE_REMOVE;
        fetchRates();
        return GLib.SOURCE_CONTINUE;
    });

    registerWidgetCleanup(container, () => {
        isDisposed = true;
        if (timeoutId) GLib.source_remove(timeoutId);
    });

    return container;
}