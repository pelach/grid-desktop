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
    resolveTextOnAccentColor,
} from '../../utils/widgetUtils.js';
import {
    createWidgetContainer,
    registerWidgetCleanup,
    attachResponsiveScaler,
    connectTimerCleanup,
    startPollingTimer,
    MONTH_NAMES_ABBREVIATED,
} from '../../shell/widgetUIUtils.js';
import {
    fetchWeatherViaOpenMeteo,
    releaseWeatherSession,
    resolveConditionCode,
    getWeatherAssets,
} from '../weather/weatherCommon.js';
import { isActorDestroyed } from '../../utils/actorLifecycle.js';

const BASE_WIDTH = 400;
const BASE_HEIGHT = 200;
const DATE_POLL_INTERVAL_MS = 60000;
const WEATHER_POLL_INTERVAL_S = 1800;

const WEEKDAY_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const WEEKS_IN_GRID = 6;

function getDaysInMonth(year, month) {
    if (month === 2 && ((year % 4 === 0 && year % 100 !== 0) || year % 400 === 0))
        return 29;
    return DAYS_IN_MONTH[month - 1];
}

export function createCalendarEventsNode(config, width, height, xPosition, yPosition) {
    const fontFamily = resolveExplicitFontFamily(config);
    const fontCss = fontFamily ? `font-family: ${fontFamily}; ` : '';
    const textColor = resolveWidgetForegroundColor(config);
    const accentColor = config.globalAccentColor || '#3584e4';
    const container = createWidgetContainer(config, width, height, xPosition, yPosition);

    const dummyBgActor = new St.Widget({ visible: false });
    container.add_child(dummyBgActor);

    let scale = Math.max(0.65, Math.min(width / BASE_WIDTH, height / BASE_HEIGHT));

    const nowLocal = GLib.DateTime.new_now_local();
    let viewYear = nowLocal.get_year();
    let viewMonth = nowLocal.get_month();
    let selectedDate = nowLocal;

    let isDisposed = false;
    let cachedCalMap = new Map();
    let dayButtons = [];
    let dayButtonLabels = [];
    let weekdayCells = [];

    // Fő vízszintes elrendezés
    const rootLayout = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_expand: true,
        y_expand: true,
    });
    container.add_child(rootLayout);

    // ==========================================
    // 1. BAL OLDAL: NAPTÁR (Rögzített szélesség)
    // ==========================================
    const leftColumn = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        y_expand: true,
        x_expand: false, // Ne engedje a jobboldalnak tologatni
    });
    rootLayout.add_child(leftColumn);

    // Fejléc
    const calHeaderBox = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_expand: true,
        y_align: Clutter.ActorAlign.CENTER,
    });
    leftColumn.add_child(calHeaderBox);

    const prevMonthBtn = new St.Button({
        label: '‹',
        reactive: true,
        can_focus: true,
    });
    const calMonthLabel = new St.Label({
        text: '',
        x_expand: true,
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
    });
    const nextMonthBtn = new St.Button({
        label: '›',
        reactive: true,
        can_focus: true,
    });

    calHeaderBox.add_child(prevMonthBtn);
    calHeaderBox.add_child(calMonthLabel);
    calHeaderBox.add_child(nextMonthBtn);

    // Hét napjai fejléc
    const weekdaysRow = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_expand: true,
    });
    leftColumn.add_child(weekdaysRow);

    const weekdaySlots = [];
    for (let i = 0; i < 7; i++) {
        const slot = new St.Widget({
            layout_manager: new Clutter.BinLayout(),
            x_expand: false,
        });
        const label = new St.Label({
            text: WEEKDAY_LABELS[i],
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        slot.add_child(label);
        weekdaysRow.add_child(slot);
        weekdaySlots.push(label);
        weekdayCells.push(slot);
    }

    // 6x7 rács
    const daysGrid = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        y_expand: true,
        x_expand: true,
    });
    leftColumn.add_child(daysGrid);

    for (let row = 0; row < WEEKS_IN_GRID; row++) {
        const rowBox = new St.BoxLayout({
            orientation: Clutter.Orientation.HORIZONTAL,
            y_expand: true,
            x_expand: true,
        });
        daysGrid.add_child(rowBox);

        for (let col = 0; col < 7; col++) {
            const btn = new St.Button({
                reactive: true,
                can_focus: true,
                x_expand: false,
                y_expand: true,
            });
            const lbl = new St.Label({
                text: '',
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
            });
            btn.set_child(lbl);
            rowBox.add_child(btn);

            dayButtons.push(btn);
            dayButtonLabels.push(lbl);
        }
    }

    // Fix függőleges osztóvonal
    const divider = new St.Widget({
        style: `background-color: ${textColor}; opacity: 0.12;`,
        y_expand: true,
        x_expand: false,
    });
    rootLayout.add_child(divider);

    // ==========================================
    // 2. JOBB OLDAL: ESEMÉNYEK + IDŐJÁRÁS
    // ==========================================
    const rightColumn = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
    });
    rootLayout.add_child(rightColumn);

    const taskHeaderBox = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_expand: true,
        y_align: Clutter.ActorAlign.CENTER,
    });
    rightColumn.add_child(taskHeaderBox);

    const taskDateLabel = new St.Label({
        text: '',
        style: `${fontCss}color: ${accentColor}; font-weight: 800;`,
        y_align: Clutter.ActorAlign.CENTER,
    });
    taskDateLabel.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
    taskHeaderBox.add_child(taskDateLabel);

    taskHeaderBox.add_child(new St.Widget({ x_expand: true }));

    const weatherRow = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        y_align: Clutter.ActorAlign.CENTER,
    });
    const weatherIcon = new St.Icon({
        icon_size: 14,
        style: 'margin-right: 4px;',
    });
    const weatherTempLabel = new St.Label({
        text: '--°',
        style: `${fontCss}color: ${textColor}; font-weight: 600;`,
        y_align: Clutter.ActorAlign.CENTER,
    });
    weatherRow.add_child(weatherTempLabel);
    weatherRow.add_child(weatherIcon);
    taskHeaderBox.add_child(weatherRow);

    const scrollView = new St.ScrollView({
        hscrollbar_policy: St.PolicyType.NEVER,
        vscrollbar_policy: St.PolicyType.AUTOMATIC,
        overlay_scrollbars: true, // Ne foglaljon fix helyet a layoutban!
        x_expand: true,
        y_expand: true,
    });
    rightColumn.add_child(scrollView);

    const listContainer = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
    });
    scrollView.set_child(listContainer);

    // ==========================================
    // LOGIKA
    // ==========================================
    let refreshSourcesTimerId = null;

    const requestDayEventsRefresh = () => {
        if (isDisposed || isActorDestroyed(container)) return;
        if (refreshSourcesTimerId) GLib.source_remove(refreshSourcesTimerId);
        refreshSourcesTimerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 80, () => {
            refreshSourcesTimerId = null;
            if (!isDisposed && !isActorDestroyed(container)) loadDayEvents();
            return GLib.SOURCE_REMOVE;
        });
    };

    const loadCalendarSourcesMapAsync = () => {
        const homeDir = GLib.get_home_dir();
        const dirs = [
            Gio.File.new_for_path(`${homeDir}/.config/evolution/sources`),
            Gio.File.new_for_path(`${homeDir}/.cache/evolution/sources`),
        ];
        let pendingReads = 0;

        const scanDirectoryAsync = (dirFile) => {
            if (isDisposed) return;
            pendingReads++;
            dirFile.enumerate_children_async('standard::name,standard::type', Gio.FileQueryInfoFlags.NONE, GLib.PRIORITY_LOW, null, (file, res) => {
                try {
                    const enumerator = file.enumerate_children_finish(res);
                    const readNext = () => {
                        if (isDisposed) {
                            pendingReads = Math.max(0, pendingReads - 1);
                            return;
                        }
                        enumerator.next_files_async(1, GLib.PRIORITY_LOW, null, (e, nRes) => {
                            try {
                                const files = e.next_files_finish(nRes);
                                if (!files || files.length === 0) {
                                    pendingReads = Math.max(0, pendingReads - 1);
                                    if (pendingReads === 0 && cachedCalMap.size > 0) requestDayEventsRefresh();
                                    return;
                                }
                                const info = files[0];
                                const child = dirFile.get_child(info.get_name());
                                if (info.get_file_type() === Gio.FileType.DIRECTORY) {
                                    scanDirectoryAsync(child);
                                    readNext();
                                } else if (info.get_name().endsWith('.source')) {
                                    pendingReads++;
                                    child.load_contents_async(null, (cf, cRes) => {
                                        try {
                                            const [ok, bytes] = cf.load_contents_finish(cRes);
                                            if (ok && bytes) {
                                                const content = new TextDecoder().decode(bytes);
                                                if (content.includes('[Calendar]')) {
                                                    const colorMatch = content.match(/Color=([^\r\n]+)/);
                                                    if (colorMatch && colorMatch[1]) {
                                                        const uid = info.get_name().replace(/\.source$/, '');
                                                        cachedCalMap.set(uid, colorMatch[1].trim());
                                                        requestDayEventsRefresh();
                                                    }
                                                }
                                            }
                                        } catch (_) {}
                                        pendingReads = Math.max(0, pendingReads - 1);
                                        readNext();
                                    });
                                } else {
                                    readNext();
                                }
                            } catch (_) {
                                pendingReads = Math.max(0, pendingReads - 1);
                            }
                        });
                    };
                    readNext();
                } catch (_) {
                    pendingReads = Math.max(0, pendingReads - 1);
                }
            });
        };

        for (const dir of dirs) {
            if (GLib.file_test(dir.get_path(), GLib.FileTest.EXISTS)) scanDirectoryAsync(dir);
        }
    };

    const loadDayEvents = () => {
        if (isActorDestroyed(container) || isDisposed) return;
        listContainer.destroy_all_children();

        const now = GLib.DateTime.new_now_local();
        const isSelectedToday = (
            selectedDate.get_year() === now.get_year() &&
            selectedDate.get_month() === now.get_month() &&
            selectedDate.get_day_of_month() === now.get_day_of_month()
        );

        if (isSelectedToday) {
            taskDateLabel.text = 'TODAY';
        } else {
            taskDateLabel.text = selectedDate.format('%b %e, %a').toUpperCase();
        }

        const cardPadding = Math.max(4, Math.round(5 * scale));
        const cardRadius = Math.max(4, Math.round(6 * scale));
        const rowGap = Math.max(2, Math.round(4 * scale));
        const rightScrollGap = Math.max(2, Math.round(4 * scale));
        const titleFontSize = Math.max(9, Math.round(10.5 * scale));
        const timeFontSize = Math.max(8, Math.round(9.5 * scale));

        let rawEvents = [];
        try {
            const dateMenu = Main.panel?.statusArea?.dateMenu;
            const eventSource = dateMenu?._eventSource || dateMenu?._calendar?._eventSource;
            if (eventSource && typeof eventSource.getEvents === 'function') {
                const sJs = new Date(selectedDate.get_year(), selectedDate.get_month() - 1, selectedDate.get_day_of_month(), 0, 0, 0);
                const eJs = new Date(selectedDate.get_year(), selectedDate.get_month() - 1, selectedDate.get_day_of_month() + 1, 0, 0, 0);
                rawEvents = eventSource.getEvents(sJs, eJs) || [];
            }
        } catch (e) {}

        if (!rawEvents || rawEvents.length === 0) {
            const emptyLabel = new St.Label({
                text: 'No events',
                style: `${fontCss}color: ${textColor}; font-size: ${titleFontSize}px; opacity: 0.5; margin-top: 14px;`,
                x_align: Clutter.ActorAlign.CENTER,
            });
            listContainer.add_child(emptyLabel);
            return;
        }

        const parsed = [];
        for (const ev of rawEvents) {
            let calColor = '#4a90d9';
            if (ev.id) {
                const sourceUid = ev.id.split('\n')[0].trim();
                if (cachedCalMap.has(sourceUid)) {
                    calColor = cachedCalMap.get(sourceUid);
                } else {
                    for (const [sUid, color] of cachedCalMap.entries()) {
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

        for (const item of parsed) {
            const rowBox = new St.BoxLayout({
                orientation: Clutter.Orientation.HORIZONTAL,
                x_expand: true,
                y_align: Clutter.ActorAlign.CENTER,
                style: `background-color: ${item.color}; `
                    + `border-radius: ${cardRadius}px; `
                    + `padding: ${cardPadding}px ${Math.round(7 * scale)}px; `
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

    function fillCalendarGrid() {
        const now = GLib.DateTime.new_now_local();
        calMonthLabel.text = `${MONTH_NAMES_ABBREVIATED[viewMonth - 1]} ${viewYear}`;

        const firstDayCol = (GLib.DateTime.new_local(viewYear, viewMonth, 1, 12, 0, 0).get_day_of_week() + 6) % 7;
        const daysInMonth = getDaysInMonth(viewYear, viewMonth);
        const fontSize = Math.round(10.5 * scale);

        for (let cell = 0; cell < dayButtons.length; cell++) {
            const btn = dayButtons[cell];
            const lbl = dayButtonLabels[cell];
            const dayNumber = cell - firstDayCol + 1;

            let cellDate = null;
            let isCurrentMonth = true;

            if (dayNumber < 1) {
                isCurrentMonth = false;
                const prevM = viewMonth === 1 ? 12 : viewMonth - 1;
                const prevY = viewMonth === 1 ? viewYear - 1 : viewYear;
                const prevDays = getDaysInMonth(prevY, prevM);
                const d = prevDays + dayNumber;
                cellDate = GLib.DateTime.new_local(prevY, prevM, d, 12, 0, 0);
                lbl.text = String(d);
            } else if (dayNumber > daysInMonth) {
                isCurrentMonth = false;
                const nextM = viewMonth === 12 ? 1 : viewMonth + 1;
                const nextY = viewMonth === 12 ? viewYear + 1 : viewYear;
                const d = dayNumber - daysInMonth;
                cellDate = GLib.DateTime.new_local(nextY, nextM, d, 12, 0, 0);
                lbl.text = String(d);
            } else {
                cellDate = GLib.DateTime.new_local(viewYear, viewMonth, dayNumber, 12, 0, 0);
                lbl.text = String(dayNumber);
            }

            btn._cellDate = cellDate;
            btn._targetMonth = cellDate.get_month();
            btn._targetYear = cellDate.get_year();

            const isToday = (
                cellDate.get_year() === now.get_year() &&
                cellDate.get_month() === now.get_month() &&
                cellDate.get_day_of_month() === now.get_day_of_month()
            );

            const isSelected = (
                selectedDate &&
                cellDate.get_year() === selectedDate.get_year() &&
                cellDate.get_month() === selectedDate.get_month() &&
                cellDate.get_day_of_month() === selectedDate.get_day_of_month()
            );

            if (isSelected) {
                const todayTextColor = resolveTextOnAccentColor(accentColor);
                btn.style = `background-color: ${cssColorToRgba(accentColor, 1)}; border-radius: 999px;`;
                lbl.style = `${fontCss}font-size: ${fontSize}px; color: ${todayTextColor}; font-weight: bold;`;
            } else if (isToday) {
                btn.style = `background-color: ${cssColorToRgba(accentColor, 0.2)}; border-radius: 999px;`;
                lbl.style = `${fontCss}font-size: ${fontSize}px; color: ${accentColor}; font-weight: bold;`;
            } else {
                btn.style = 'background-color: transparent; border-radius: 999px;';
                if (!isCurrentMonth) {
                    lbl.style = `${fontCss}color: ${textColor}; font-size: ${fontSize}px; opacity: 0.25; font-weight: normal;`;
                } else {
                    const isWeekend = (cell % 7 === 5 || cell % 7 === 6);
                    lbl.style = `${fontCss}font-size: ${fontSize}px; color: ${isWeekend ? accentColor : textColor}; opacity: ${isWeekend ? 0.95 : 0.85}; font-weight: 500;`;
                }
            }
        }
    }

    // Gombok eseményei
    const buttonSignals = [];
    dayButtons.forEach(btn => {
        const sig = btn.connect('clicked', () => {
            if (btn._cellDate) {
                selectedDate = btn._cellDate;
                // Ha másik hónapbeli napra kattintott, a nézet lapozzon is át!
                if (btn._targetMonth !== viewMonth || btn._targetYear !== viewYear) {
                    viewMonth = btn._targetMonth;
                    viewYear = btn._targetYear;
                }
                fillCalendarGrid();
                loadDayEvents();
            }
        });
        buttonSignals.push({ btn, sig });
    });

    const sigPrev = prevMonthBtn.connect('clicked', () => {
        viewMonth -= 1;
        if (viewMonth < 1) {
            viewMonth = 12;
            viewYear -= 1;
        }
        fillCalendarGrid();
    });

    const sigNext = nextMonthBtn.connect('clicked', () => {
        viewMonth += 1;
        if (viewMonth > 12) {
            viewMonth = 1;
            viewYear += 1;
        }
        fillCalendarGrid();
    });

    function applyLayout(currentWidth) {
        if (!currentWidth || currentWidth <= 0) return;
        const s = scale;
        const pad = Math.round(12 * s);
        const colGap = Math.round(14 * s);

        rootLayout.style = `padding: ${pad}px; spacing: ${colGap}px;`;

        // Szigorúan rögzített bal oldali naptárszélesség:
        const leftFixedW = Math.round(175 * s);
        leftColumn.width = leftFixedW;
        leftColumn.set_width(leftFixedW);
        divider.width = 1;

        calHeaderBox.style = `margin-bottom: ${Math.round(4 * s)}px;`;
        calMonthLabel.style = `${fontCss}color: ${textColor}; font-size: ${Math.round(12 * s)}px; font-weight: 700;`;

        const navBtnStyle = `${fontCss}font-size: ${Math.round(13 * s)}px; font-weight: bold; padding: 0px ${Math.round(5 * s)}px; border-radius: 4px; background-color: rgba(255,255,255,0.06); color: ${textColor};`;
        prevMonthBtn.style = navBtnStyle;
        nextMonthBtn.style = navBtnStyle;

        const cellW = Math.max(1, Math.floor(leftFixedW / 7));
        weekdayCells.forEach(slot => { slot.width = cellW; });
        dayButtons.forEach(btn => {
            btn.width = cellW;
            btn.height = Math.round(21 * s); // fix cellamagasság, hogy a kijelölés se ugrassza a sort
        });

        const now = GLib.DateTime.new_now_local();
        const currentMondayIndex = now.get_day_of_week() - 1;

        weekdaySlots.forEach((label, idx) => {
            const isTodayHeader = (idx === currentMondayIndex && viewMonth === now.get_month() && viewYear === now.get_year());
            label.style = `${fontCss}font-size: ${Math.round(8.5 * s)}px; `
                + `color: ${isTodayHeader ? accentColor : textColor}; `
                + `font-weight: 700; opacity: ${isTodayHeader ? 1.0 : 0.4};`;
        });

        daysGrid.style = `spacing: ${Math.round(2 * s)}px;`;

        taskHeaderBox.style = `margin-bottom: ${Math.round(6 * s)}px;`;
        taskDateLabel.style = `${fontCss}color: ${accentColor}; font-size: ${Math.round(11 * s)}px; font-weight: 800;`;
        weatherIcon.icon_size = Math.round(14 * s);
        weatherTempLabel.style = `${fontCss}color: ${textColor}; font-size: ${Math.round(11 * s)}px; font-weight: 600;`;

        fillCalendarGrid();
    }

    // Időjárás kontextus
    const weatherContext = {
        widgetData: config,
        widgetNode: container,
        bgImageActor: dummyBgActor,
        isDynamicColor: false,
        isDynamicImage: false,
        uiElements: {
            isCardsLayout: true,
            conditionIcon: weatherIcon,
            updateCards: (json, useFahrenheit) => {
                if (!json || !json.current) return;
                const cur = json.current;
                const curTemp = Math.round(cur.temp_c !== undefined ? (useFahrenheit ? cur.temp_f : cur.temp_c) : 0);

                let highLow = '';
                if (json.forecast?.forecastday?.[0]?.day) {
                    const d = json.forecast.forecastday[0].day;
                    const hi = Math.round(useFahrenheit ? d.maxtemp_f : d.maxtemp_c);
                    const lo = Math.round(useFahrenheit ? d.mintemp_f : d.mintemp_c);
                    highLow = `${hi}°/${lo}°`;
                }

                weatherTempLabel.text = highLow ? `${highLow}` : `${curTemp}°`;

                const condCode = resolveConditionCode(cur.condition?.code, cur.condition?.text);
                const isDay = cur.is_day !== undefined ? (cur.is_day === 1 || cur.is_day === true) : true;
                const assets = getWeatherAssets(config.extensionPath, condCode, isDay, '3x3', cur.condition?.text);
                if (assets && assets.iconPath) {
                    weatherIcon.gicon = new Gio.FileIcon({ file: Gio.File.new_for_path(assets.iconPath) });
                }
            }
        },
        extensionPath: config.extensionPath,
    };

    const updateWeather = () => {
        try {
            fetchWeatherViaOpenMeteo(weatherContext);
        } catch (e) {}
    };

    loadCalendarSourcesMapAsync();
    fillCalendarGrid();
    loadDayEvents();
    updateWeather();

    let weatherTimerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, WEATHER_POLL_INTERVAL_S, () => {
        updateWeather();
        return GLib.SOURCE_CONTINUE;
    });

    const state = { timerId: null };
    startPollingTimer(() => {
        const n = GLib.DateTime.new_now_local();
        if (selectedDate.get_year() === n.get_year() && selectedDate.get_month() === n.get_month() && selectedDate.get_day_of_month() === n.get_day_of_month()) {
            loadDayEvents();
        }
        return GLib.SOURCE_CONTINUE;
    }, DATE_POLL_INTERVAL_MS, state);

    attachResponsiveScaler(container, BASE_WIDTH, BASE_HEIGHT, (_ratio, w) => {
        scale = Math.max(0.65, Math.min(w / BASE_WIDTH, height / BASE_HEIGHT));
        applyLayout(w);
    });

    registerWidgetCleanup(container, () => {
        isDisposed = true;
        if (weatherTimerId) {
            GLib.source_remove(weatherTimerId);
            weatherTimerId = null;
        }
        if (refreshSourcesTimerId) {
            GLib.source_remove(refreshSourcesTimerId);
            refreshSourcesTimerId = null;
        }
        try { prevMonthBtn.disconnect(sigPrev); } catch (_) {}
        try { nextMonthBtn.disconnect(sigNext); } catch (_) {}
        buttonSignals.forEach(({ btn, sig }) => {
            try { btn.disconnect(sig); } catch (_) {}
        });
        releaseWeatherSession(container);
        cachedCalMap.clear();
    });
    connectTimerCleanup(container, state);

    return container;
}