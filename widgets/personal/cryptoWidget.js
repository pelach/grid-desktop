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

const COINS = [
    { id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin' },
    { id: 'ethereum', symbol: 'ETH', name: 'Ethereum' },
    { id: 'solana', symbol: 'SOL', name: 'Solana' },
];

export function createCryptoTrackerNode(config, width, height, xPosition, yPosition) {
    const fontFamily = resolveExplicitFontFamily(config);
    const fontCss = fontFamily ? `font-family: ${fontFamily}; ` : '';
    const textColor = resolveWidgetForegroundColor(config);
    const container = createWidgetContainer(config, width, height, xPosition, yPosition);

    const targetCurrency = (config.targetCurrency || 'USD').toUpperCase();
    let scale = Math.max(0.65, Math.min(width / BASE_CONTAINER_WIDTH_PX, height / BASE_CONTAINER_HEIGHT_PX));

    const mainLayout = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
    });
    container.add_child(mainLayout);

    // ── Fejléc: Bal oldalon MARKETS jelzés, Jobb oldalon a 3 gomb (BTC, ETH, SOL) ──
    const headerBox = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_expand: true,
        y_align: Clutter.ActorAlign.CENTER,
    });

    const headerLeft = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_expand: true,
        y_align: Clutter.ActorAlign.CENTER,
    });

    const statusDot = new St.Label({
        text: '●',
        y_align: Clutter.ActorAlign.CENTER,
    });
    const headerLabel = new St.Label({
        text: 'MARKETS',
        y_align: Clutter.ActorAlign.CENTER,
    });
    headerLabel.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
    headerLeft.add_child(statusDot);
    headerLeft.add_child(headerLabel);
    headerBox.add_child(headerLeft);

    const buttonGroup = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        y_align: Clutter.ActorAlign.CENTER,
    });
    headerBox.add_child(buttonGroup);
    mainLayout.add_child(headerBox);

    // ── Törzs: Bal oldalon árfolyam + badge, jobb oldalon a grafikon ──
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
    const coinNameLabel = new St.Label({
        text: ' Bitcoin',
        y_align: Clutter.ActorAlign.CENTER,
    });
    badgeBox.add_child(changePill);
    badgeBox.add_child(coinNameLabel);
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
        text: '24h Live Market Tracking · CoinGecko',
        x_align: Clutter.ActorAlign.START,
    });
    mainLayout.add_child(footerLabel);

    // ── Állapot & Gombok inicializálása ──
    let selectedCoinId = 'bitcoin';
    let marketData = {};
    let isDisposed = false;
    const coinButtons = {};

    const updateButtonStyles = () => {
        const btnFontSize = Math.max(10, Math.round(12 * scale));
        const btnPadY = Math.round(3 * scale);
        const btnPadX = Math.round(8 * scale);
        const btnRadius = Math.round(10 * scale);

        COINS.forEach(c => {
            const btn = coinButtons[c.id];
            if (!btn) return;

            const isSelected = (c.id === selectedCoinId);
            if (isSelected) {
                btn.style = `${fontCss}font-size: ${btnFontSize}px; font-weight: bold; padding: ${btnPadY}px ${btnPadX}px; border-radius: ${btnRadius}px; background-color: #fed049; color: #1e1e24;`;
            } else {
                btn.style = `${fontCss}font-size: ${btnFontSize}px; font-weight: 500; padding: ${btnPadY}px ${btnPadX}px; border-radius: ${btnRadius}px; background-color: rgba(255,255,255,0.06); color: ${textColor}; opacity: 0.75;`;
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

        const price = coin.current_price;
        if (price !== undefined && price !== null) {
            try {
                const formatter = new Intl.NumberFormat(undefined, {
                    maximumFractionDigits: price < 100 ? 2 : 0,
                });
                rateLabel.set_text(formatter.format(price));
            } catch (e) {
                const decimals = price < 100 ? 2 : 0;
                rateLabel.set_text(price.toFixed(decimals));
            }
        }

        // --- DINAMIKUS BETŰMÉRET A KARAKTEREK SZÁMA ALAPJÁN ---
        const textLen = (rateLabel.get_text() || '').length;
        // Ha 7 karakternél hosszabb (pl. HUF milliók), 26px bázis, különben nagy 32px bázis:
        const baseFontSize = textLen > 7 ? 26 : 32;
        const rateFontSize = Math.max(18, Math.round(baseFontSize * scale));
        rateLabel.style = `${fontCss}color: ${textColor}; font-size: ${rateFontSize}px; font-weight: bold;`;

        const diffPct = coin.price_change_percentage_24h || 0;
        const isPositive = diffPct >= 0;
        const sign = isPositive ? '+' : '';
        changePill.set_text(`${sign}${diffPct.toFixed(2)}%`);

        const pillFontSize = Math.max(10, Math.round(11 * scale));
        if (isPositive) {
            changePill.style = `${fontCss}font-size: ${pillFontSize}px; font-weight: bold; padding: 2px 6px; border-radius: 4px; background-color: rgba(76, 175, 80, 0.22); color: #81c784;`;
        } else {
            changePill.style = `${fontCss}font-size: ${pillFontSize}px; font-weight: bold; padding: 2px 6px; border-radius: 4px; background-color: rgba(244, 67, 54, 0.22); color: #e57373;`;
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

    // ── Reszponzív skálázó függvény (applyScale) ──
    function applyScale(newScale, currentWidth) {
        scale = newScale;

        const pad = Math.max(8, Math.round(10 * scale));
        const titleFontSize = Math.max(11, Math.round(13 * scale));
        const coinNameFontSize = Math.max(10, Math.round(12 * scale));
        const footerFontSize = Math.max(8, Math.round(9 * scale));

        mainLayout.style = `padding: ${pad}px; spacing: ${Math.round(4 * scale)}px;`;
        headerBox.style = `margin-bottom: ${Math.round(4 * scale)}px;`;
        statusDot.style = `color: #fed049; font-size: ${Math.round(12 * scale)}px; margin-right: 6px;`;
        headerLabel.style = `${fontCss}color: ${textColor}; font-size: ${titleFontSize}px; font-weight: bold; letter-spacing: 1px; opacity: 0.9;`;

        buttonGroup.style = `spacing: ${Math.round(4 * scale)}px;`;

        const effectiveW = (currentWidth || container.width || 400) - (pad * 2);
        // Szélesebb bal oszlop a nagy számoknak:
        leftCol.width = Math.floor(effectiveW * 0.58);
        leftCol.style = `spacing: ${Math.round(4 * scale)}px;`;

        coinNameLabel.style = `${fontCss}color: ${textColor}; font-size: ${coinNameFontSize}px; opacity: 0.65; margin-left: 6px;`;
        footerLabel.style = `${fontCss}color: ${textColor}; font-size: ${footerFontSize}px; opacity: 0.45;`;

        updateButtonStyles();
        // Ez frissíti a rateLabel betűméretét és a grafikont is az új skála szerint:
        updateView();
    }

    // ── Cairo grafikon ──
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

        const historyRates = rawPoints.length > 28 ? rawPoints.slice(-28) : rawPoints;
        const padX = Math.round(6 * scale);
        const plotW = Math.max(10, w - (padX * 2));
        // h * 0.50 helyett h * 0.32 és 24 * scale felső korlát:
        const plotH = Math.max(8, Math.min(h * 0.32, 24 * scale));
        const padBottom = (h - plotH) / 2;

        const minVal = Math.min(...historyRates);
        const maxVal = Math.max(...historyRates);
        const range = (maxVal - minVal) === 0 ? 1 : (maxVal - minVal);

        ctx.setLineWidth(Math.max(1.8, 2.2 * scale));
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

    // ── API Lekérés ──
    const fetchRates = () => {
        try {
            const ids = COINS.map(c => c.id).join(',');
            const vsCurrency = targetCurrency.toLowerCase();
            const url = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=${vsCurrency}&ids=${ids}&sparkline=true`;

            const httpSession = new Soup.Session();
            const message = Soup.Message.new('GET', url);
            message.request_headers.append('User-Agent', 'GNOME-Shell-CryptoWidget/1.0');

            httpSession.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null, (s, res) => {
                try {
                    const bytes = s.send_and_read_finish(res);
                    if (isDisposed || !bytes || isActorDestroyed(container)) return;

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

    const timeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 180, () => {
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