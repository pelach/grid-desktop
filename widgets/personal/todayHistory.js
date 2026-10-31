import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup';
import Pango from 'gi://Pango';
import {
    resolveWidgetForegroundColor,
    resolveExplicitFontFamily,
} from '../../utils/widgetUtils.js';
import { 
    createWidgetContainer, 
    registerWidgetCleanup, 
    attachResponsiveScaler 
} from '../../shell/widgetUIUtils.js';
import { isActorDestroyed } from '../../utils/actorLifecycle.js';

const BASE_CONTAINER_WIDTH_PX = 200;
const BASE_CONTAINER_HEIGHT_PX = 200;

export function createTodayHistoryNode(config, width, height, xPosition, yPosition) {
    const fontFamily = resolveExplicitFontFamily(config);
    const fontCss = fontFamily ? `font-family: ${fontFamily}; ` : '';
    const textColor = resolveWidgetForegroundColor(config);
    const container = createWidgetContainer(config, width, height, xPosition, yPosition);

    const language = (config.language || 'hu').toLowerCase();
    const category = (config.category || 'selected').toLowerCase();

    let scale = Math.max(0.65, Math.min(width / BASE_CONTAINER_WIDTH_PX, height / BASE_CONTAINER_HEIGHT_PX));

    const mainLayout = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
    });
    container.add_child(mainLayout);

    // ── 1. Fejléc: Ikon + Címke + Lapozó gombok ──
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

    const headerIcon = new St.Icon({
        icon_name: 'help-about-symbolic',
        y_align: Clutter.ActorAlign.CENTER,
    });

    const headerLabel = new St.Label({
        text: 'ON THIS DAY',
        y_align: Clutter.ActorAlign.CENTER,
    });
    headerLabel.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;

    headerLeft.add_child(headerIcon);
    headerLeft.add_child(headerLabel);
    headerBox.add_child(headerLeft);

    const navBox = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        y_align: Clutter.ActorAlign.CENTER,
    });

    const prevBtn = new St.Button({
        label: '‹',
        reactive: true,
        can_focus: true,
    });

    const nextBtn = new St.Button({
        label: '›',
        reactive: true,
        can_focus: true,
    });

    navBox.add_child(prevBtn);
    navBox.add_child(nextBtn);
    headerBox.add_child(navBox);
    mainLayout.add_child(headerBox);

    // ── 2. Törzs: Görgethető eseményleírás ──
    const scrollView = new St.ScrollView({
        hscrollbar_policy: St.PolicyType.NEVER,
        vscrollbar_policy: St.PolicyType.AUTOMATIC,
        overlay_scrollbars: true,
        x_expand: true,
        y_expand: true,
    });
    mainLayout.add_child(scrollView);

    const bodyBox = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
    });
    scrollView.set_child(bodyBox);

    const yearRow = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        y_align: Clutter.ActorAlign.CENTER,
    });

    const yearPill = new St.Label({
        text: '----',
    });
    yearRow.add_child(yearPill);
    bodyBox.add_child(yearRow);

    const descLabel = new St.Label({
        text: 'Loading history events...',
        x_expand: true,
    });
    descLabel.clutter_text.line_wrap = true;
    descLabel.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
    descLabel.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
    bodyBox.add_child(descLabel);

    // ── 3. Lábléc: Forrás + Sorszámláló ──
    const footerBox = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_expand: true,
        y_align: Clutter.ActorAlign.CENTER,
    });

    const footerLabel = new St.Label({
        text: 'Wikipedia',
        x_expand: true,
    });

    const counterLabel = new St.Label({
        text: '- / -',
    });

    footerBox.add_child(footerLabel);
    footerBox.add_child(counterLabel);
    mainLayout.add_child(footerBox);

    // ── Reszponzív skálázás (200x200 bázis) ──
    function applyScale(newScale) {
        scale = newScale;

        const pad = Math.max(8, Math.round(10 * scale));
        const titleFontSize = Math.max(10, Math.round(12 * scale));
        const btnFontSize = Math.max(10, Math.round(11 * scale));
        const btnPadX = Math.round(5 * scale);
        const iconSize = Math.round(13 * scale);

        mainLayout.style = `padding: ${pad}px; spacing: ${Math.round(4 * scale)}px;`;

        headerBox.style = `margin-bottom: ${Math.round(4 * scale)}px;`;
        headerIcon.icon_size = iconSize;
        headerIcon.style = `color: ${textColor}; margin-right: 5px; opacity: 0.85;`;
        headerLabel.style = `${fontCss}color: ${textColor}; font-size: ${titleFontSize}px; font-weight: bold; letter-spacing: 0.5px; opacity: 0.9;`;

        navBox.style = `spacing: ${Math.round(3 * scale)}px;`;
        const btnStyle = `${fontCss}font-size: ${btnFontSize}px; font-weight: bold; padding: 0px ${btnPadX}px; border-radius: 4px; background-color: rgba(255,255,255,0.08); color: ${textColor};`;
        prevBtn.style = btnStyle;
        nextBtn.style = btnStyle;

        const rightPad = Math.max(8, Math.round(10 * scale));
        bodyBox.style = `spacing: ${Math.round(4 * scale)}px; padding-right: ${rightPad}px;`;

        const pillFontSize = Math.max(9, Math.round(10.5 * scale));
        yearPill.style = `${fontCss}font-size: ${pillFontSize}px; font-weight: bold; padding: 1px 6px; border-radius: 4px; background-color: #fed049; color: #1e1e24; margin-bottom: 2px;`;
        
        const descFontSize = Math.max(11, Math.round(13.5 * scale));
        descLabel.style = `${fontCss}color: ${textColor}; font-size: ${descFontSize}px; line-height: 1.35; opacity: 0.92;`;

        footerBox.style = `margin-top: ${Math.round(3 * scale)}px;`;
        const footerFontSize = Math.max(8, Math.round(9 * scale));
        footerLabel.style = `${fontCss}color: ${textColor}; font-size: ${footerFontSize}px; opacity: 0.45;`;
        counterLabel.style = `${fontCss}color: ${textColor}; font-size: ${footerFontSize}px; opacity: 0.45;`;
    }

    applyScale(scale);

    attachResponsiveScaler(container, BASE_CONTAINER_WIDTH_PX, BASE_CONTAINER_HEIGHT_PX, (_ratio, w, h) => {
        if (isActorDestroyed(container)) return;
        applyScale(Math.max(0.65, Math.min(w / BASE_CONTAINER_WIDTH_PX, h / BASE_CONTAINER_HEIGHT_PX)));
    });

    // ── Állapotkezelés ──
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

        try {
            const adj = scrollView.vscroll?.adjustment || scrollView.vadjustment;
            if (adj) adj.set_value(0);
        } catch (e) {}
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

    // ── API Lekérés ──
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
                    if (isDisposed || !bytes || isActorDestroyed(container)) return;

                    const jsonText = new TextDecoder().decode(bytes.get_data());
                    const data = JSON.parse(jsonText);

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