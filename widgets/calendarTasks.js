import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {
    resolveWidgetForegroundColor,
    resolveExplicitFontFamily,
    cssColorToRgba,
} from '../utils/widgetUtils.js';
import { createWidgetContainer, registerWidgetCleanup, attachResponsiveScaler } from '../shell/widgetUIUtils.js';
import { isActorDestroyed } from '../utils/actorLifecycle.js';

const BORDER_ALPHA = 0.14;
const BASE_CONTAINER_WIDTH_PX = 200;
const BASE_CONTAINER_HEIGHT_PX = 200;

export function createCalendarTasksNode(config, width, height, xPosition, yPosition) {
    const fontFamily = resolveExplicitFontFamily(config) || 'Sans';
    const fontCss = fontFamily ? `font-family: ${fontFamily}; ` : '';
    const textColor = resolveWidgetForegroundColor(config);
    const container = createWidgetContainer(config, width, height, xPosition, yPosition);
    container.style += ` border: 1px solid ${cssColorToRgba(textColor, BORDER_ALPHA)};`;

    let scale = Math.max(0.65, Math.min(width / BASE_CONTAINER_WIDTH_PX, height / BASE_CONTAINER_HEIGHT_PX));

    const contentBox = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
    });
    container.add_child(contentBox);

    // ── Fejléc: Dátum + Lapozó gombok ──
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
        icon_name: 'x-office-calendar-symbolic',
        style: `color: ${textColor}; margin-right: 6px; opacity: 0.85;`,
        y_align: Clutter.ActorAlign.CENTER,
    });

    const headerLabel = new St.Label({
        text: '',
        y_align: Clutter.ActorAlign.CENTER,
        x_expand: true,
    });
    headerLabel.clutter_text.ellipsize = Pango.EllipsizeMode.END;

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
    contentBox.add_child(headerBox);

    // ── Görgethető lista (ScrollView mint az audioOutput-ban) ──
    const scrollView = new St.ScrollView({
        hscrollbar_policy: St.PolicyType.NEVER,
        vscrollbar_policy: St.PolicyType.AUTOMATIC,
        overlay_scrollbars: false,
        x_expand: true,
        y_expand: true,
    });
    contentBox.add_child(scrollView);

    const listContainer = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
    });
    scrollView.set_child(listContainer);

    // ── Állapotkezelés ──
    let dayOffset = 0;
    let isDisposed = false;

    const getSelectedDateTime = () => {
        const now = GLib.DateTime.new_now_local();
        return now.add_days(dayOffset);
    };

    const updateHeader = () => {
        const targetDate = getSelectedDateTime();
        headerLabel.set_text(targetDate.format('%b %e, %a').toUpperCase());
    };

    // Forrás színek betöltése az Evolution konfigurációból
    const getCalendarSourcesMap = () => {
        const map = new Map();
        const homeDir = GLib.get_home_dir();

        const scanDir = (dirFile) => {
            try {
                if (!dirFile.query_exists(null)) return;
                const enumerator = dirFile.enumerate_children('standard::name,standard::type', Gio.FileQueryInfoFlags.NONE, null);
                let info;
                while ((info = enumerator.next_file(null)) !== null) {
                    const child = dirFile.get_child(info.get_name());
                    if (info.get_file_type() === Gio.FileType.DIRECTORY) {
                        scanDir(child); // bemegyünk az alkönyvtárakba (pl. 37e4b1e9...)
                    } else if (info.get_name().endsWith('.source')) {
                        const [ok, bytes] = child.load_contents(null);
                        if (!ok || !bytes) continue;
                        const content = new TextDecoder().decode(bytes);

                        if (!content.includes('[Calendar]')) continue;

                        let color = null;
                        // Először a [Calendar] alatti Color-t keressük, ha nincs, a WebDAV alól
                        const colorMatch = content.match(/Color=([^\r\n]+)/);
                        if (colorMatch && colorMatch[1]) {
                            color = colorMatch[1].trim();
                        }

                        if (color) {
                            const uid = info.get_name().replace(/\.source$/, '');
                            map.set(uid, color);
                        }
                    }
                }
            } catch (e) {
                console.log('[CalendarTasks] Source scan error:', e.message);
            }
        };

        // Mindkét lehetséges helyet bejárjuk mélységében
        scanDir(Gio.File.new_for_path(`${homeDir}/.config/evolution/sources`));
        scanDir(Gio.File.new_for_path(`${homeDir}/.cache/evolution/sources`));

        console.log('[CalendarTasks] Betöltött naptár színek száma:', map.size);
        return map;
    };

    // Események listájának felépítése
    const loadDayEvents = () => {
        if (isActorDestroyed(container) || isDisposed) return;
        updateHeader();
        listContainer.destroy_all_children();

        const targetDate = getSelectedDateTime();
        const calMap = getCalendarSourcesMap();

        const cardPadding = Math.max(4, Math.round(6 * scale));
        const cardRadius = Math.max(5, Math.round(7 * scale));
        const rowGap = Math.max(3, Math.round(5 * scale));
        const rightScrollGap = Math.max(4, Math.round(6 * scale));
        const titleFontSize = Math.max(10, Math.round(11 * scale));
        const timeFontSize = Math.max(9, Math.round(10 * scale));

        let rawEvents = [];

        try {
            const dateMenu = Main.panel?.statusArea?.dateMenu;
            const eventSource = dateMenu?._eventSource || dateMenu?._calendar?._eventSource;

            if (eventSource && typeof eventSource.getEvents === 'function') {
                const startJs = new Date(targetDate.get_year(), targetDate.get_month() - 1, targetDate.get_day_of_month(), 0, 0, 0);
                const endJs = new Date(targetDate.get_year(), targetDate.get_month() - 1, targetDate.get_day_of_month() + 1, 0, 0, 0);
                rawEvents = eventSource.getEvents(startJs, endJs) || [];
            }
        } catch (e) {}

        if (!rawEvents || rawEvents.length === 0) {
            const emptyLabel = new St.Label({
                text: 'No events',
                style: `${fontCss}color: ${textColor}; font-size: ${titleFontSize}px; opacity: 0.5; margin-top: 10px;`,
                x_align: Clutter.ActorAlign.CENTER,
            });
            listContainer.add_child(emptyLabel);
            return;
        }



        // Feldolgozás és idő szerinti rendezés
        const parsed = [];
        for (const ev of rawEvents) {
            let calColor = '#4a90d9';

            // Az ev.id első sora a naptár UID-je!
            if (ev.id) {
                const sourceUid = ev.id.split('\n')[0].trim();
                if (calMap.has(sourceUid)) {
                    calColor = calMap.get(sourceUid);
                } else {
                    // Ha részleges egyezés kellene
                    for (const [sUid, color] of calMap.entries()) {
                        if (sourceUid.includes(sUid) || sUid.includes(sourceUid)) {
                            calColor = color;
                            break;
                        }
                    }
                }
            }

            let timeStr = '';
            let sortTime = -1;

            if (ev.date) {
                const startJs = new Date(ev.date);
                const endJs = ev.end ? new Date(ev.end) : null;
                const durationMs = endJs ? (endJs.getTime() - startJs.getTime()) : 0;

                // Ha pont 1 teljes nap (vagy annak többszöröse), akkor egész napos esemény (pl. Névnap)
                const isAllDay = (durationMs > 0 && durationMs % (24 * 60 * 60 * 1000) === 0);

                if (!isAllDay) {
                    const dt = GLib.DateTime.new_from_unix_local(Math.floor(startJs.getTime() / 1000));
                    timeStr = dt.format('%H:%M');
                    sortTime = dt.get_hour() * 60 + dt.get_minute();
                }
            }

            parsed.push({
                summary: ev.summary || 'Untitled',
                timeStr,
                color: calColor,
                sortTime,
            });
        }

        parsed.sort((a, b) => a.sortTime - b.sortTime);

        // Kártyák hozzáadása a listához
        for (const item of parsed) {
            const rowBox = new St.BoxLayout({
                orientation: Clutter.Orientation.HORIZONTAL,
                x_expand: true,
                y_align: Clutter.ActorAlign.CENTER,
                style: `background-color: ${item.color}; `
                    + `border-radius: ${cardRadius}px; `
                    + `padding: ${cardPadding}px ${Math.round(8 * scale)}px; `
                    + `margin-bottom: ${rowGap}px; `
                    + `margin-right: ${rightScrollGap}px;`,
            });

            const titleLabel = new St.Label({
                text: item.summary,
                x_expand: true,
                y_align: Clutter.ActorAlign.CENTER,
                style: `${fontCss}color: #ffffff; font-size: ${titleFontSize}px; font-weight: bold;`,
            });
            titleLabel.clutter_text.ellipsize = Pango.EllipsizeMode.END;
            rowBox.add_child(titleLabel);

            if (item.timeStr) {
                const timeLabel = new St.Label({
                    text: item.timeStr,
                    y_align: Clutter.ActorAlign.CENTER,
                    style: `${fontCss}color: rgba(255,255,255,0.9); font-size: ${timeFontSize}px; margin-left: 6px;`,
                });
                rowBox.add_child(timeLabel);
            }

            listContainer.add_child(rowBox);
        }
    };

    function applyScale(newScale) {
        scale = newScale;
        const titleFontSize = Math.max(10, Math.round(11 * scale));
        const btnFontSize = Math.max(11, Math.round(13 * scale));
        const navPad = Math.max(3, Math.round(5 * scale));

        contentBox.style = `padding: ${Math.max(8, Math.round(10 * scale))}px;`;
        headerBox.style = `margin-bottom: ${Math.round(6 * scale)}px;`;
        headerIcon.icon_size = Math.round(14 * scale);
        headerLabel.style = `${fontCss}color: ${textColor}; font-size: ${titleFontSize}px; font-weight: bold; opacity: 0.9;`;

        navBox.style = `spacing: ${Math.round(4 * scale)}px;`;
        const btnStyle = `${fontCss}font-size: ${btnFontSize}px; font-weight: bold; padding: 0px ${navPad}px; border-radius: 4px; background-color: rgba(255,255,255,0.06); color: ${textColor};`;
        prevBtn.style = btnStyle;
        nextBtn.style = btnStyle;

        loadDayEvents();
    }

    prevBtn.connect('clicked', () => {
        dayOffset -= 1;
        loadDayEvents();
    });

    nextBtn.connect('clicked', () => {
        dayOffset += 1;
        loadDayEvents();
    });

    applyScale(scale);

    attachResponsiveScaler(container, BASE_CONTAINER_WIDTH_PX, BASE_CONTAINER_HEIGHT_PX, (_ratio, w, h) => {
        if (isActorDestroyed(container)) return;
        applyScale(Math.max(0.65, Math.min(w / BASE_CONTAINER_WIDTH_PX, h / BASE_CONTAINER_HEIGHT_PX)));
    });

    let hasLoaded = false;
    let fallbackTimerId = null;
    let mapSignalId = 0;

    const triggerInitialLoad = () => {
        if (hasLoaded || isDisposed || isActorDestroyed(container)) return;
        hasLoaded = true;
        loadDayEvents();
    };

    if (container.get_stage() && container.is_mapped()) {
        GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            triggerInitialLoad();
            return GLib.SOURCE_REMOVE;
        });
    } else {
        mapSignalId = container.connect('notify::mapped', () => {
            if (container.is_mapped()) {
                if (mapSignalId) {
                    container.disconnect(mapSignalId);
                    mapSignalId = 0;
                }
                GLib.timeout_add(GLib.PRIORITY_DEFAULT, 150, () => {
                    triggerInitialLoad();
                    return GLib.SOURCE_REMOVE;
                });
            }
        });
    }

    fallbackTimerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
        triggerInitialLoad();
        fallbackTimerId = null;
        return GLib.SOURCE_REMOVE;
    });

    // ── Takarítás bezáráskor / törléskor ──
    registerWidgetCleanup(container, () => {
        isDisposed = true;
        if (mapSignalId) {
            container.disconnect(mapSignalId);
            mapSignalId = 0;
        }
        if (fallbackTimerId) {
            GLib.source_remove(fallbackTimerId);
            fallbackTimerId = null;
        }
    });

    return container;
}