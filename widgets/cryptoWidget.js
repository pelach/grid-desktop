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

const COINS = [
    { id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin' },
    { id: 'ethereum', symbol: 'ETH', name: 'Ethereum' },
    { id: 'solana', symbol: 'SOL', name: 'Solana' },
];

export function createCryptoTrackerNode(config, width, height, xPosition, yPosition) {
    const fontFamily = resolveExplicitFontFamily(config) || 'Sans';
    const fontCss = fontFamily ? `font-family: ${fontFamily}; ` : '';
    const textColor = resolveWidgetForegroundColor(config);
    const container = createWidgetContainer(config, width, height, xPosition, yPosition);
    container.style += ` border: 1px solid ${cssColorToRgba(textColor, BORDER_ALPHA)};`;

    const targetCurrency = (config.targetCurrency || 'HUF').toUpperCase();

    const scale = Math.max(0.65, Math.min(width / BASE_CONTAINER_WIDTH_PX, height / BASE_CONTAINER_HEIGHT_PX));
    const padding = Math.max(10, Math.round(14 * scale));

    const mainLayout = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
        style: `padding: ${padding}px; spacing: ${Math.round(6 * scale)}px;`,
    });

    const titleFontSize = Math.max(10, Math.round(11 * scale));

    // ── Fejléc: Bal oldalon MARKETS jelzés, Jobb oldalon a 3 gomb (BTC, ETH, SOL) ──
    const headerBox = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_expand: true,
        y_align: Clutter.ActorAlign.CENTER,
        style: `margin-bottom: ${Math.round(4 * scale)}px;`,
    });

    const headerLeft = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_expand: true,
        y_align: Clutter.ActorAlign.CENTER,
    });

    // Sárga jelzőpötty
    const statusDot = new St.Label({
        text: '●',
        style: `color: #fed049; font-size: ${Math.round(11 * scale)}px; margin-right: 6px;`,
        y_align: Clutter.ActorAlign.CENTER,
    });
    const headerLabel = new St.Label({
        text: 'MARKETS',
        style: `${fontCss}color: ${textColor}; font-size: ${titleFontSize}px; font-weight: bold; letter-spacing: 1px; opacity: 0.9;`,
        y_align: Clutter.ActorAlign.CENTER,
    });
    headerLabel.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
    headerLeft.add_child(statusDot);
    headerLeft.add_child(headerLabel);
    headerBox.add_child(headerLeft);

    // Jobb oldali gombcsoport (pill selector)
    const buttonGroup = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        y_align: Clutter.ActorAlign.CENTER,
        style: `spacing: ${Math.round(4 * scale)}px;`,
    });

    headerBox.add_child(buttonGroup);
    mainLayout.add_child(headerBox);

    // ── Törzs: Bal oldalon az árfolyam + badge, jobb oldalon a grafikon ──
    const bodyRow = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_expand: true,
        y_expand: true,
        y_align: Clutter.ActorAlign.FILL,
    });

    const innerWidth = width - (padding * 2);
    const leftWidth = Math.floor(innerWidth * 0.50);
    const graphWidth = innerWidth - leftWidth;

    const leftCol = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        y_align: Clutter.ActorAlign.CENTER,
        x_align: Clutter.ActorAlign.START,
        width: leftWidth,
        style: `spacing: ${Math.round(4 * scale)}px;`,
    });

    const rateLabel = new St.Label({
        text: '---',
        style: `${fontCss}color: ${textColor}; font-size: ${Math.round(19 * scale)}px; font-weight: bold;`,
    });
    rateLabel.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
    leftCol.add_child(rateLabel);

    const badgeBox = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        y_align: Clutter.ActorAlign.CENTER,
    });

    const changePill = new St.Label({
        text: '0.00%',
        style: `${fontCss}font-size: ${Math.round(9 * scale)}px; font-weight: bold; padding: 2px 6px; border-radius: 4px; background-color: rgba(255,255,255,0.08); color: ${textColor};`,
    });
    const coinNameLabel = new St.Label({
        text: ' Bitcoin',
        style: `${fontCss}color: ${textColor}; font-size: ${Math.round(10 * scale)}px; opacity: 0.65; margin-left: 6px;`,
        y_align: Clutter.ActorAlign.CENTER,
    });
    badgeBox.add_child(changePill);
    badgeBox.add_child(coinNameLabel);
    leftCol.add_child(badgeBox);

    bodyRow.add_child(leftCol);

    // Jobb oldali Sparkline rajzolófelület
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
        text: '24h Live Market Tracking · CoinGecko',
        style: `${fontCss}color: ${textColor}; font-size: ${Math.round(8 * scale)}px; opacity: 0.45;`,
        x_align: Clutter.ActorAlign.START,
    });
    mainLayout.add_child(footerLabel);

    container.add_child(mainLayout);

    // ── Állapot & Gombok inicializálása ─────────────────────────
    let selectedCoinId = 'bitcoin';
    let marketData = {}; // id szerint tárolt adatok
    let isDisposed = false;

    const coinButtons = {};

    const updateButtonStyles = () => {
        COINS.forEach(c => {
            const btn = coinButtons[c.id];
            if (!btn) return;

            const isSelected = (c.id === selectedCoinId);
            if (isSelected) {
                // Aktív pill: sárgás háttér fekete szöveggel
                btn.style = `${fontCss}font-size: ${Math.round(9 * scale)}px; font-weight: bold; padding: ${Math.round(2 * scale)}px ${Math.round(6 * scale)}px; border-radius: ${Math.round(10 * scale)}px; background-color: #fed049; color: #1e1e24;`;
            } else {
                // Inaktív: áttetsző háttér
                btn.style = `${fontCss}font-size: ${Math.round(9 * scale)}px; font-weight: 500; padding: ${Math.round(2 * scale)}px ${Math.round(6 * scale)}px; border-radius: ${Math.round(10 * scale)}px; background-color: rgba(255,255,255,0.06); color: ${textColor}; opacity: 0.75;`;
            }
        });
    };

    const updateView = () => {
        const coin = marketData[selectedCoinId];
        const coinDef = COINS.find(c => c.id === selectedCoinId);
        coinNameLabel.set_text(coinDef ? ` ${coinDef.name}` : '');

        if (!coin) {
            rateLabel.set_text('---');
            changePill.set_text('---');
            drawingArea.queue_repaint();
            return;
        }

        // Érték formázása HUF-ban (ha 100 feletti érték, egészre kerekítve, ezres tagolással)
        const price = coin.current_price;
        if (price !== undefined && price !== null) {
            try {
                // Automatikus pénznem formázás (pl. 34 500 000 Ft, $84,120.50, 78.450 €)
                const formatter = new Intl.NumberFormat('hu-HU', {
                    style: 'currency',
                    currency: targetCurrency,
                    maximumFractionDigits: price < 100 ? 2 : 0,
                });
                rateLabel.set_text(formatter.format(price));
            } catch (e) {
                // Ha a devizakód ismeretlen lenne az Intl-nek, fallback
                const decimals = price < 100 ? 2 : 0;
                rateLabel.set_text(`${price.toFixed(decimals)} ${targetCurrency}`);
            }
        }

        // Százalékos változás formázása
        const diffPct = coin.price_change_percentage_24h || 0;
        const isPositive = diffPct >= 0;
        const sign = isPositive ? '+' : '';
        changePill.set_text(`${sign}${diffPct.toFixed(2)}%`);

        if (isPositive) {
            changePill.style = `${fontCss}font-size: ${Math.round(9 * scale)}px; font-weight: bold; padding: 2px 6px; border-radius: 4px; background-color: rgba(76, 175, 80, 0.22); color: #81c784;`;
        } else {
            changePill.style = `${fontCss}font-size: ${Math.round(9 * scale)}px; font-weight: bold; padding: 2px 6px; border-radius: 4px; background-color: rgba(244, 67, 54, 0.22); color: #e57373;`;
        }

        drawingArea.queue_repaint();
    };

    COINS.forEach(c => {
        const btn = new St.Button({
            label: c.symbol,
            reactive: true,
            can_focus: true,
            track_hover: true,
            y_align: Clutter.ActorAlign.CENTER,
        });

        btn.connect('clicked', () => {
            if (selectedCoinId === c.id) return;
            selectedCoinId = c.id;
            updateButtonStyles();
            updateView();
        });

        coinButtons[c.id] = btn;
        buttonGroup.add_child(btn);
    });

    updateButtonStyles();

    // ── Grafikon kirajzolása (Cairo) ──────────────────────────
    drawingArea.connect('repaint', (area) => {
        const ctx = area.get_context();
        const [w, h] = area.get_surface_size();
        if (w <= 0 || h <= 0) return;

        ctx.setOperator(CAIRO_OPERATOR_CLEAR);
        ctx.paint();
        ctx.setOperator(CAIRO_OPERATOR_OVER);

        const currentCoin = marketData[selectedCoinId];
        const rawPoints = currentCoin?.sparkline_in_7d?.price || [];

        if (rawPoints.length < 2) {
            ctx.$dispose();
            return;
        }

        // Az utolsó ~24-30 pont elég a szép, tiszta 24 órás sparkline-hoz (vagy a teljes 7 nap)
        const historyRates = rawPoints.length > 28 ? rawPoints.slice(-28) : rawPoints;

        const padX = 3 * scale;
        const plotW = Math.max(10, w - (padX * 2));
        const plotH = Math.max(10, Math.min(h * 0.40, 36 * scale));
        const padBottom = (h - plotH) / 2;

        const minVal = Math.min(...historyRates);
        const maxVal = Math.max(...historyRates);
        const range = (maxVal - minVal) === 0 ? 1 : (maxVal - minVal);

        ctx.setLineWidth(Math.max(2.0, 2.3 * scale));
        ctx.setLineCap(CAIRO_LINE_CAP_ROUND);

        const isPositive = (currentCoin.price_change_percentage_24h || 0) >= 0;
        if (isPositive) {
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

    // ── API Lekérés (CoinGecko) ──────────────────────────────
    const fetchRates = () => {
        try {
            const ids = COINS.map(c => c.id).join(',');
            const vsCurrency = targetCurrency.toLowerCase();
            const url = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=${vsCurrency}&ids=${ids}&sparkline=true`;

            const httpSession = new Soup.Session();
            const message = Soup.Message.new('GET', url);
            // CoinGecko User-Agentet vár el
            message.request_headers.append('User-Agent', 'GNOME-Shell-CryptoWidget/1.0');

            httpSession.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null, (s, res) => {
                try {
                    const bytes = s.send_and_read_finish(res);
                    if (isDisposed || !bytes) return;

                    const jsonText = new TextDecoder().decode(bytes.get_data());
                    const data = JSON.parse(jsonText);

                    if (Array.isArray(data)) {
                        data.forEach(item => {
                            marketData[item.id] = item;
                        });
                        updateView();
                    }
                } catch (e) {}
            });
        } catch (e) {}
    };

    fetchRates();

    // 3 percenkénti (180 mp) frissítés – kényelmesen a CoinGecko ingyenes limitjén belül marad
    const timeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 180, () => {
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