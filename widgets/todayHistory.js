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
} from '../utils/widgetUtils.js';
import { createWidgetContainer, registerWidgetCleanup } from '../shell/widgetUIUtils.js';

const BORDER_ALPHA = 0.14;
const BASE_CONTAINER_WIDTH_PX = 270;
const BASE_CONTAINER_HEIGHT_PX = 160;

export function createTodayHistoryNode(config, width, height, xPosition, yPosition) {
    const fontFamily = resolveExplicitFontFamily(config) || 'Sans';
    const fontCss = fontFamily ? `font-family: ${fontFamily}; ` : '';
    const textColor = resolveWidgetForegroundColor(config);
    const container = createWidgetContainer(config, width, height, xPosition, yPosition);
    container.style += ` border: 1px solid ${cssColorToRgba(textColor, BORDER_ALPHA)};`;

    const language = (config.language || 'hu').toLowerCase();
    const category = (config.category || 'selected').toLowerCase();

    const scale = Math.max(0.65, Math.min(width / BASE_CONTAINER_WIDTH_PX, height / BASE_CONTAINER_HEIGHT_PX));
    const padding = Math.max(10, Math.round(14 * scale));

    const mainLayout = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
        style: `padding: ${padding}px; spacing: ${Math.round(6 * scale)}px;`,
    });

    const titleFontSize = Math.max(10, Math.round(11 * scale));

    // ── Fejléc: Bal oldalon ikon + címke, Jobb oldalon lapozó nyilak ──
    const headerBox = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_expand: true,
        y_align: Clutter.ActorAlign.CENTER,
        style: `margin-bottom: ${Math.round(2 * scale)}px;`,
    });

    const headerLeft = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_expand: true,
        y_align: Clutter.ActorAlign.CENTER,
    });

    const headerIcon = new St.Icon({
        icon_name: 'help-about-symbolic',
        icon_size: Math.round(14 * scale),
        style: `color: ${textColor}; margin-right: 6px; opacity: 0.85;`,
        y_align: Clutter.ActorAlign.CENTER,
    });

    const headerLabel = new St.Label({
        text: 'ON THIS DAY',
        style: `${fontCss}color: ${textColor}; font-size: ${titleFontSize}px; font-weight: bold; letter-spacing: 1px; opacity: 0.9;`,
        y_align: Clutter.ActorAlign.CENTER,
    });
    headerLabel.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;

    headerLeft.add_child(headerIcon);
    headerLeft.add_child(headerLabel);
    headerBox.add_child(headerLeft);

    // Léptető nyilak
    const navBox = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        y_align: Clutter.ActorAlign.CENTER,
        style: `spacing: ${Math.round(4 * scale)}px;`,
    });

    const prevBtn = new St.Button({
        label: '‹',
        reactive: true,
        can_focus: true,
        style: `${fontCss}font-size: ${Math.round(13 * scale)}px; font-weight: bold; padding: 0px ${Math.round(6 * scale)}px; border-radius: 4px; background-color: rgba(255,255,255,0.06); color: ${textColor};`,
    });

    const nextBtn = new St.Button({
        label: '›',
        reactive: true,
        can_focus: true,
        style: `${fontCss}font-size: ${Math.round(13 * scale)}px; font-weight: bold; padding: 0px ${Math.round(6 * scale)}px; border-radius: 4px; background-color: rgba(255,255,255,0.06); color: ${textColor};`,
    });

    navBox.add_child(prevBtn);
    navBox.add_child(nextBtn);
    headerBox.add_child(navBox);
    mainLayout.add_child(headerBox);

    // ── Törzs: Évszám Badge + Esemény leírása ──
    const bodyBox = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
        style: `spacing: ${Math.round(5 * scale)}px;`,
    });

    const yearRow = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        y_align: Clutter.ActorAlign.CENTER,
    });

    const yearPill = new St.Label({
        text: '----',
        style: `${fontCss}font-size: ${Math.round(10 * scale)}px; font-weight: bold; padding: 2px 7px; border-radius: 5px; background-color: #fed049; color: #1e1e24;`,
    });
    yearRow.add_child(yearPill);
    bodyBox.add_child(yearRow);

    const descLabel = new St.Label({
        text: 'Loading history events...',
        style: `${fontCss}color: ${textColor}; font-size: ${Math.round(12 * scale)}px; line-height: 1.35; opacity: 0.95;`,
        y_expand: true,
    });
    descLabel.clutter_text.line_wrap = true;
    descLabel.clutter_text.line_wrap_mode = Pango.WrapMode.WORD;
    descLabel.clutter_text.ellipsize = Pango.EllipsizeMode.END;
    bodyBox.add_child(descLabel);

    mainLayout.add_child(bodyBox);

    // ── Lábléc: Bal oldalon Dátum + Forrás, Jobb oldalon index számláló ──
    const footerBox = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_expand: true,
        y_align: Clutter.ActorAlign.CENTER,
        style: `margin-top: ${Math.round(2 * scale)}px;`,
    });

    const footerLabel = new St.Label({
        text: 'Wikipedia',
        style: `${fontCss}color: ${textColor}; font-size: ${Math.round(8 * scale)}px; opacity: 0.45;`,
        x_expand: true,
    });

    const counterLabel = new St.Label({
        text: '- / -',
        style: `${fontCss}color: ${textColor}; font-size: ${Math.round(8 * scale)}px; opacity: 0.45;`,
    });

    footerBox.add_child(footerLabel);
    footerBox.add_child(counterLabel);
    mainLayout.add_child(footerBox);

    container.add_child(mainLayout);

    // ── Állapotkezelés ───────────────────────────────────────
    let eventsList = [];
    let currentIndex = 0;
    let isDisposed = false;
    let autoRotateSourceId = null;

    const renderCurrentEvent = () => {
        if (!eventsList || eventsList.length === 0) {
            yearPill.set_text('----');
            descLabel.set_text('No historical events found for today.');
            counterLabel.set_text('0 / 0');
            return;
        }

        const ev = eventsList[currentIndex];
        yearPill.set_text(ev.year ? String(ev.year) : 'Year ?');
        descLabel.set_text(ev.text || '');
        counterLabel.set_text(`${currentIndex + 1} / ${eventsList.length}`);
    };

    const nextEvent = () => {
        if (eventsList.length <= 1) return;
        currentIndex = (currentIndex + 1) % eventsList.length;
        renderCurrentEvent();
    };

    const prevEvent = () => {
        if (eventsList.length <= 1) return;
        currentIndex = (currentIndex - 1 + eventsList.length) % eventsList.length;
        renderCurrentEvent();
    };

    prevBtn.connect('clicked', () => {
        prevEvent();
        restartRotationTimer();
    });

    nextBtn.connect('clicked', () => {
        nextEvent();
        restartRotationTimer();
    });

    // ── API Lekérés (Wikimedia) ──────────────────────────────
    const fetchHistory = () => {
        try {
            const now = GLib.DateTime.new_now_local();
            const mm = now.get_month().toString().padStart(2, '0');
            const dd = now.get_day_of_month().toString().padStart(2, '0');

            const monthNamesHu = [
                'január', 'február', 'március', 'április', 'május', 'június',
                'július', 'augusztus', 'szeptember', 'október', 'november', 'december'
            ];
            const dateStr = language === 'hu'
                ? `${monthNamesHu[now.get_month() - 1]} ${now.get_day_of_month()}.`
                : now.format('%B %d');

            footerLabel.set_text(`${dateStr} · Wikipedia (${language.toUpperCase()})`);

            const url = `https://${language}.wikipedia.org/api/rest_v1/feed/onthisday/${category}/${mm}/${dd}`;
            const httpSession = new Soup.Session();
            const message = Soup.Message.new('GET', url);
            message.request_headers.append('User-Agent', 'GNOME-Shell-TodayHistoryWidget/1.0');

            httpSession.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null, (s, res) => {
                try {
                    const bytes = s.send_and_read_finish(res);
                    if (isDisposed || !bytes) return;

                    const jsonText = new TextDecoder().decode(bytes.get_data());
                    const data = JSON.parse(jsonText);

                    // A válasz kategória szerint `selected`, `events`, `births`, vagy `deaths` kulcs alatt van
                    const rawList = data[category] || data.events || data.selected || [];
                    if (Array.isArray(rawList) && rawList.length > 0) {
                        eventsList = rawList;
                        currentIndex = 0;
                        renderCurrentEvent();
                    } else {
                        renderCurrentEvent();
                    }
                } catch (e) {
                    descLabel.set_text('Failed to load events.');
                }
            });
        } catch (e) {}
    };

    // ── Automata forgatás időzítő (30 mp) ───────────────────────
    const restartRotationTimer = () => {
        if (autoRotateSourceId) {
            GLib.source_remove(autoRotateSourceId);
            autoRotateSourceId = null;
        }
        autoRotateSourceId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 30, () => {
            if (isDisposed) return GLib.SOURCE_REMOVE;
            nextEvent();
            return GLib.SOURCE_CONTINUE;
        });
    };

    fetchHistory();
    restartRotationTimer();

    // Óránkénti ellenőrzés (ha éjfél után átfordul a nap)
    const dayCheckTimeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 3600, () => {
        if (isDisposed) return GLib.SOURCE_REMOVE;
        fetchHistory();
        return GLib.SOURCE_CONTINUE;
    });

    registerWidgetCleanup(container, () => {
        isDisposed = true;
        if (autoRotateSourceId) GLib.source_remove(autoRotateSourceId);
        if (dayCheckTimeoutId) GLib.source_remove(dayCheckTimeoutId);
    });

    return container;
}