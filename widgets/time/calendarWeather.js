import St from 'gi://St';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Clutter from 'gi://Clutter';
import {
    resolveWidgetForegroundColor,
    resolveExplicitFontFamily,
    cssColorToRgba,
    resolveTextOnAccentColor,
} from '../../utils/widgetUtils.js';
import {
    createWidgetContainer,
    attachResponsiveScaler,
    connectTimerCleanup,
    startPollingTimer,
    registerWidgetCleanup,
} from '../../shell/widgetUIUtils.js';
import {
    fetchWeatherViaOpenMeteo,
    releaseWeatherSession,
    resolveConditionCode,
    getWeatherAssets,
} from '../weather/weatherCommon.js';

const BASE_WIDTH = 400;
const BASE_HEIGHT = 200;
const DATE_POLL_INTERVAL_MS = 60000;
const WEATHER_POLL_INTERVAL_S = 1800;

const fullMonthFormatter = new Intl.DateTimeFormat(undefined, { month: 'long' });
const fullWeekdayFormatter = new Intl.DateTimeFormat(undefined, { weekday: 'long' });
const narrowWeekdayFormatter = new Intl.DateTimeFormat(undefined, { weekday: 'narrow' });

const WEEKDAY_LABELS = Array.from({ length: 7 }, (_, i) =>
    narrowWeekdayFormatter.format(new Date(2024, 0, 1 + i)).toUpperCase()
);

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const WEEKS_IN_GRID = 6;

function getDaysInMonth(year, month) {
    if (month === 2 && ((year % 4 === 0 && year % 100 !== 0) || year % 400 === 0))
        return 29;
    return DAYS_IN_MONTH[month - 1];
}

export function createCalendarWeatherNode(config, width, height, xPosition, yPosition) {
    const textColor = resolveWidgetForegroundColor(config);
    const fontFamily = resolveExplicitFontFamily(config);
    const fontCss = fontFamily ? `font-family: ${fontFamily}; ` : '';
    const accentColor = config.globalAccentColor || '#3584e4';
    const container = createWidgetContainer(config, width, height, xPosition, yPosition);

    // Dummy bgImageActor a weatherCommon hibamentes hívásához:
    const dummyBgActor = new St.Widget({ visible: false });
    container.add_child(dummyBgActor);

    const state = {
        scale: Math.max(0.65, Math.min(width / BASE_WIDTH, height / BASE_HEIGHT)),
        timerId: null,
        weatherTimerId: null,
        dayEntries: [],
        daySlots: [],
        weekdayCells: [],
    };

    const rootLayout = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_expand: true,
        y_expand: true,
    });
    container.add_child(rootLayout);

    // ==========================================
    // 1. BAL OLDAL
    // ==========================================
    const leftColumn = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        y_expand: true,
        x_align: Clutter.ActorAlign.END,
    });
    rootLayout.add_child(leftColumn);

    const monthLabel = new St.Label({
        text: '',
        x_align: Clutter.ActorAlign.END,
        style: `${fontCss}color: ${textColor}; font-weight: 800; opacity: 0.6;`,
    });
    const weekdayLabel = new St.Label({
        text: '',
        x_align: Clutter.ActorAlign.END,
        style: `${fontCss}color: ${accentColor}; font-weight: 700;`,
    });
    leftColumn.add_child(monthLabel);
    leftColumn.add_child(weekdayLabel);

    const bigDayBox = new St.Bin({
        x_expand: true,
        y_expand: true,
        x_align: Clutter.ActorAlign.END,
        y_align: Clutter.ActorAlign.CENTER,
    });
    const bigDayLabel = new St.Label({
        text: '',
        style: `${fontCss}color: ${textColor}; font-weight: 300;`,
    });
    bigDayBox.set_child(bigDayLabel);
    leftColumn.add_child(bigDayBox);

    const weatherRow = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_align: Clutter.ActorAlign.END,
        y_align: Clutter.ActorAlign.CENTER,
    });
    const weatherIcon = new St.Icon({
        icon_size: 18,
        style: 'margin-right: 6px;',
    });
    const weatherTempLabel = new St.Label({
        text: '--°',
        style: `${fontCss}color: ${textColor}; font-weight: 600;`,
        y_align: Clutter.ActorAlign.CENTER,
    });
    weatherRow.add_child(weatherIcon);
    weatherRow.add_child(weatherTempLabel);
    leftColumn.add_child(weatherRow);


    // ==========================================
    // 2. JOBB OLDAL (Naptárrács)
    // ==========================================
    
    const rightColumn = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
    });
    rootLayout.add_child(rightColumn);

    const weekdaysRow = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_expand: true,
    });
    rightColumn.add_child(weekdaysRow);
    const headerUnderline = new St.Widget({
        style: `background-color: ${cssColorToRgba(textColor, 0.12)}; height: 1px; margin-top: 3px; margin-bottom: 4px;`,
        x_expand: true,
        height: 1,
    });
    rightColumn.add_child(headerUnderline);

    const weekdaySlots = [];
    for (let i = 0; i < 7; i++) {
        const slot = new St.Widget({
            layout_manager: new Clutter.BinLayout(),
            x_expand: true,
        });
        const label = new St.Label({
            text: WEEKDAY_LABELS[i],
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        slot.add_child(label);
        weekdaysRow.add_child(slot);
        weekdaySlots.push(label);
        state.weekdayCells.push(slot);
    }

    const daysGrid = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        y_expand: true,
        x_expand: true,
    });
    rightColumn.add_child(daysGrid);

    for (let row = 0; row < WEEKS_IN_GRID; row++) {
        const rowBox = new St.BoxLayout({
            orientation: Clutter.Orientation.HORIZONTAL,
            y_expand: true,
            x_expand: true,
        });
        daysGrid.add_child(rowBox);

        for (let col = 0; col < 7; col++) {
            const slot = new St.Widget({
                layout_manager: new Clutter.BinLayout(),
                x_expand: true,
                y_expand: true,
            });
            const label = new St.Label({
                text: '',
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
            });
            slot.add_child(label);
            rowBox.add_child(slot);
            state.daySlots.push(slot);
            state.dayEntries.push(label);
        }
    }

    function fillCalendar() {
        const now = GLib.DateTime.new_now_local();
        const year = now.get_year();
        const month = now.get_month();
        const today = now.get_day_of_month();

        // GLib get_day_of_week(): 1 = Hétfő ... 7 = Vasárnap
        const dow = now.get_day_of_week();
        const mondayBasedIndex = dow - 1; // 0 = Hétfő ... 6 = Vasárnap

        const nowJs = new Date();
        monthLabel.text = fullMonthFormatter.format(nowJs).toUpperCase();
        const rawWeekday = fullWeekdayFormatter.format(nowJs);
        weekdayLabel.text = rawWeekday.charAt(0).toUpperCase() + rawWeekday.slice(1); // "Hétfő"
        bigDayLabel.text = String(nowJs.getDate());

        // Hétfővel kezdődő hónapkezdés
        const firstDayCol = (GLib.DateTime.new_local(year, month, 1, 12, 0, 0).get_day_of_week() + 6) % 7;
        const daysInMonth = getDaysInMonth(year, month);
        const fontSize = Math.round(11 * state.scale);

        for (let cell = 0; cell < state.dayEntries.length; cell++) {
            const dayNumber = cell - firstDayCol + 1;
            const label = state.dayEntries[cell];

            if (dayNumber < 1 || dayNumber > daysInMonth) {
                let outDay = '';
                if (dayNumber < 1) {
                    const prevMonthDays = getDaysInMonth(month === 1 ? year - 1 : year, month === 1 ? 12 : month - 1);
                    outDay = String(prevMonthDays + dayNumber);
                } else {
                    outDay = String(dayNumber - daysInMonth);
                }
                label.text = outDay;
                label.style = `${fontCss}color: ${textColor}; font-size: ${fontSize}px; opacity: 0.25;`;
                continue;
            }

            if (dayNumber === today) {
                const padY = Math.round(2 * state.scale);
                const padX = Math.round(6 * state.scale);
                const radius = Math.round(6 * state.scale);
                label.text = String(dayNumber);
                const todayTextColor = resolveTextOnAccentColor(accentColor);
                label.style = `${fontCss}font-size: ${fontSize}px; color: ${todayTextColor}; `
                    + `background-color: ${cssColorToRgba(accentColor, 1)}; `
                    + `border-radius: ${radius}px; padding: ${padY}px ${padX}px; font-weight: bold;`;
                continue;
            }

            const isWeekend = (cell % 7 === 5 || cell % 7 === 6);
            label.text = String(dayNumber);
            label.style = `${fontCss}font-size: ${fontSize}px; color: ${isWeekend ? accentColor : textColor}; opacity: ${isWeekend ? 0.95 : 0.85};`;
        }
    }

    function applyLayout(currentWidth, currentHeight) {
        if (!currentWidth || currentWidth <= 0) return;
        const s = state.scale;
        const pad = Math.round(14 * s);
        const colGap = Math.round(14 * s);

        rootLayout.style = `padding: ${pad}px; spacing: ${colGap}px;`;

        const leftWidth = Math.round(115 * s);
        leftColumn.width = leftWidth;
        leftColumn.set_width(leftWidth);
       
        monthLabel.style = `${fontCss}color: ${textColor}; font-size: ${Math.round(10.5 * s)}px; font-weight: 800; opacity: 0.6;`;
        weekdayLabel.style = `${fontCss}color: ${accentColor}; font-size: ${Math.round(15 * s)}px; font-weight: 700; margin-bottom: 2px;`;
        bigDayLabel.style = `${fontCss}color: ${textColor}; font-size: ${Math.round(52 * s)}px; font-weight: 300; line-height: 1;`;

        weatherIcon.icon_size = Math.round(16 * s);
        weatherTempLabel.style = `${fontCss}color: ${textColor}; font-size: ${Math.round(12 * s)}px; font-weight: 600;`;

        // 2. Jobb oszlop: a fennmaradó hely teljes szélességét kitölti arányosan
        const rightAvailableW = Math.max(140, currentWidth - (pad * 2) - leftWidth - colGap);
        const cellWidth = Math.floor(rightAvailableW / 7);
        const cellHeight = Math.round(21 * s);

        rightColumn.set_x_align(Clutter.ActorAlign.FILL);
        rightColumn.width = cellWidth * 7;

        state.weekdayCells.forEach(slot => {
            slot.width = cellWidth;
            slot.set_width(cellWidth);
        });

        state.daySlots.forEach(slot => {
            slot.width = cellWidth;
            slot.height = cellHeight;
            slot.set_width(cellWidth);
            slot.set_height(cellHeight);
        });

        const now = GLib.DateTime.new_now_local();
        const currentMondayIndex = now.get_day_of_week() - 1;

        weekdaySlots.forEach((label, idx) => {
            const isTodayHeader = (idx === currentMondayIndex);
            label.style = `${fontCss}font-size: ${Math.round(9.5 * s)}px; `
                + `color: ${isTodayHeader ? accentColor : textColor}; `
                + `font-weight: 700; opacity: ${isTodayHeader ? 1.0 : 0.45};`;
        });

        daysGrid.style = `spacing: ${Math.round(2 * s)}px;`;
        fillCalendar();
    }

    const weatherContext = {
        widgetData: config,
        widgetNode: container,
        bgImageActor: dummyBgActor,
        isDynamicColor: false,
        isDynamicImage: false,
        uiElements: {
            isCardsLayout: true, // <-- EZ KELL, HOGY A weatherCommon LEFUTTASSA AZ updateCards-OT!
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

                // Ikon betöltése
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

    fillCalendar();
    updateWeather();

    state.weatherTimerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, WEATHER_POLL_INTERVAL_S, () => {
        updateWeather();
        return GLib.SOURCE_CONTINUE;
    });

    startPollingTimer(() => {
        fillCalendar();
        return GLib.SOURCE_CONTINUE;
    }, DATE_POLL_INTERVAL_MS, state);

    attachResponsiveScaler(container, BASE_WIDTH, BASE_HEIGHT, (_ratio, w, h) => {
        state.scale = Math.max(0.65, Math.min(w / BASE_WIDTH, h / BASE_HEIGHT));
        applyLayout(w, h);
    });

    registerWidgetCleanup(container, () => {
        if (state.weatherTimerId) {
            GLib.source_remove(state.weatherTimerId);
            state.weatherTimerId = null;
        }
        releaseWeatherSession(container);
    });
    connectTimerCleanup(container, state);

    return container;
}