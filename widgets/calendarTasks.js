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
        try {
            const homeDir = GLib.get_home_dir();
            const sourcesDir = Gio.File.new_for_path(`${homeDir}/.config/evolution/sources`);
            if (sourcesDir.query_exists(null)) {
                const enumerator = sourcesDir.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
                let fileInfo;
                while ((fileInfo = enumerator.next_file(null)) !== null) {
                    const filename = fileInfo.get_name();
                    if (!filename.endsWith('.source')) continue;

                    const [ok, bytes] = GLib.file_get_contents(`${homeDir}/.config/evolution/sources/${filename}`);
                    if (!ok || !bytes) continue;
                    const content = new TextDecoder().decode(bytes);

                    if (!content.includes('[Calendar]')) continue;

                    let color = '#4a90d9';
                    const colorMatch = content.match(/Color=([^\r\n]+)/);
                    if (colorMatch && colorMatch[1]) color = colorMatch[1].trim();

                    const uid = filename.replace(/\.source$/, '');
                    map.set(uid, color);
                }
            }
        } catch (e) {}
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
            if (ev.sourceUid) {
                for (const [sUid, color] of calMap.entries()) {
                    if (ev.sourceUid.includes(sUid)) {
                        calColor = color;
                        break;
                    }
                }
            }

            let timeStr = '';
            let sortTime = -1;

            if (!ev.isAllDay && ev.date) {
                const dt = GLib.DateTime.new_from_unix_local(Math.floor(ev.date.getTime() / 1000));
                timeStr = dt.format('%H:%M');
                sortTime = dt.get_hour() * 60 + dt.get_minute();
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

    registerWidgetCleanup(container, () => {
        isDisposed = true;
    });

    return container;
}