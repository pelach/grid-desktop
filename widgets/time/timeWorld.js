import St from 'gi://St';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import { 
    resolveWidgetForegroundColor, 
    resolveExplicitFontFamily, 
    resolveUse24h, 
    SECONDARY_OPACITY 
} from '../../utils/widgetUtils.js';
import { 
    attachResponsiveScaler, 
    connectTimerCleanup, 
    createWidgetContainer, 
    formatTimeParts, 
    startMinuteAlignedTimer 
} from '../../shell/widgetUIUtils.js';
import { isActorDestroyed } from '../../utils/actorLifecycle.js';

const REF_WIDTH = 200;
const REF_HEIGHT = 200;

const DEFAULT_CITIES = [
    { name: 'London', timezone: 'Europe/London', country: 'GB', primary: true },
    { name: 'New York', timezone: 'America/New_York', country: 'US', primary: false },
    { name: 'Moscow', timezone: 'Europe/Moscow', country: 'RU', primary: false },
];

const KNOWN_CODES = {
    'london': 'LON',
    'east london': 'LON',
    'new york': 'NYC',
    'east new york': 'NYC',
    'los angeles': 'LAX',
    'east los angeles': 'LAX',
    'tokyo': 'TYO',
    'paris': 'PAR',
    'berlin': 'BER',
    'budapest': 'BUD',
    'moscow': 'MOW',
    'sydney': 'SYD',
    'beijing': 'PEK',
    'hong kong': 'HKG',
    'dubai': 'DXB',
    'chicago': 'ORD',
    'toronto': 'YYZ',
    'san francisco': 'SFO',
    'singapore': 'SIN',
};

function getCityShortCode(name) {
    if (!name) return '---';
    const clean = name.trim().toLowerCase();
    if (KNOWN_CODES[clean]) return KNOWN_CODES[clean];

    const words = name.trim().split(/\s+/);
    if (words.length > 1) {
        return words.map(w => w[0].toUpperCase()).join('').slice(0, 3);
    }
    return name.slice(0, 3).toUpperCase();
}

function getFormattedTimeAndGmt(timezoneId, is24h) {
    const tz = timezoneId
        ? (GLib.TimeZone.new_identifier(timezoneId) || GLib.TimeZone.new(timezoneId))
        : GLib.TimeZone.new_local();
    const now = GLib.DateTime.new_now(tz || GLib.TimeZone.new_local());

    const { time: timeStr, ampm: ampmStr } = formatTimeParts(now, is24h);

    const offsetMicrosec = now.get_utc_offset();
    const totalOffsetSec = Math.floor(offsetMicrosec / 1000000);
    const totalOffsetMinutes = Math.round(totalOffsetSec / 60);

    const sign = totalOffsetMinutes >= 0 ? '+' : '-';
    const absMinutes = Math.abs(totalOffsetMinutes);
    const hours = Math.floor(absMinutes / 60);
    const minutes = absMinutes % 60;

    let gmtStr = 'GMT';
    if (hours !== 0 || minutes !== 0) {
        if (minutes === 0) {
            gmtStr = `GMT ${sign}${hours}`;
        } else {
            const formattedMinutes = minutes < 10 ? `0${minutes}` : `${minutes}`;
            gmtStr = `GMT ${sign}${hours}:${formattedMinutes}`;
        }
    }

    return { timeStr, ampmStr, gmtStr };
}

function buildWorldClockUI(layoutBox, fontCss, textColor, cities) {
    const primaryCity = cities[0] || DEFAULT_CITIES[0];
    const sec1City = cities[1] || DEFAULT_CITIES[1];
    const sec2City = cities[2] || DEFAULT_CITIES[2];

    const mainContainer = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
    });
    layoutBox.add_child(mainContainer);

    const topRow = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_expand: true,
        y_align: Clutter.ActorAlign.START,
    });

    const topInfoBox = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        x_align: Clutter.ActorAlign.START,
        y_align: Clutter.ActorAlign.CENTER,
    });

    const topCityLabel = new St.Label({ text: primaryCity.name });
    topCityLabel.clutter_text.ellipsize = Pango.EllipsizeMode.END;

    const topGmtLabel = new St.Label({ text: 'GMT +0' });

    topInfoBox.add_child(topCityLabel);
    topInfoBox.add_child(topGmtLabel);

    const topTimeBox = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_align: Clutter.ActorAlign.END,
        y_align: Clutter.ActorAlign.CENTER,
    });
    const topTimeLabel = new St.Label({ text: '00:00' });
    topTimeLabel.clutter_text.set_line_alignment(Pango.Alignment.RIGHT);

    const topAmpmLabel = new St.Label({ text: '', y_align: Clutter.ActorAlign.END });
    topTimeBox.add_child(topTimeLabel);
    topTimeBox.add_child(topAmpmLabel);

    topRow.add_child(topInfoBox);
    topRow.add_child(topTimeBox);
    mainContainer.add_child(topRow);

    const flexSpacer = new St.Widget({
        y_expand: true,
        x_expand: true,
    });
    mainContainer.add_child(flexSpacer);

    const secondaryBox = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_expand: true,
    });

    const sec1Box = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
    });
    const sec1CityLabel = new St.Label({ text: sec1City.name });
    sec1CityLabel.clutter_text.ellipsize = Pango.EllipsizeMode.END;

    const sec1TimeBox = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        y_align: Clutter.ActorAlign.CENTER,
    });
    const sec1TimeLabel = new St.Label({ text: '00:00' });
    const sec1AmpmLabel = new St.Label({ text: '', y_align: Clutter.ActorAlign.END });
    sec1TimeBox.add_child(sec1TimeLabel);
    sec1TimeBox.add_child(sec1AmpmLabel);

    const sec1GmtLabel = new St.Label({ text: 'GMT +0' });
    sec1Box.add_child(sec1CityLabel);
    sec1Box.add_child(sec1TimeBox);
    sec1Box.add_child(sec1GmtLabel);

    const sec2Box = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
    });
    const sec2CityLabel = new St.Label({ text: sec2City.name });
    sec2CityLabel.clutter_text.ellipsize = Pango.EllipsizeMode.END;

    const sec2TimeBox = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        y_align: Clutter.ActorAlign.CENTER,
    });
    const sec2TimeLabel = new St.Label({ text: '00:00' });
    const sec2AmpmLabel = new St.Label({ text: '', y_align: Clutter.ActorAlign.END });
    sec2TimeBox.add_child(sec2TimeLabel);
    sec2TimeBox.add_child(sec2AmpmLabel);

    const sec2GmtLabel = new St.Label({ text: 'GMT +0' });
    sec2Box.add_child(sec2CityLabel);
    sec2Box.add_child(sec2TimeBox);
    sec2Box.add_child(sec2GmtLabel);

    secondaryBox.add_child(sec1Box);
    secondaryBox.add_child(sec2Box);
    mainContainer.add_child(secondaryBox);

    return {
        mainContainer,
        topRow,
        topCityLabel,
        topTimeLabel,
        topAmpmLabel,
        topGmtLabel,
        secondaryBox,
        sec1Box,
        sec1CityLabel,
        sec1TimeBox,
        sec1TimeLabel,
        sec1AmpmLabel,
        sec1GmtLabel,
        sec2Box,
        sec2CityLabel,
        sec2TimeBox,
        sec2TimeLabel,
        sec2AmpmLabel,
        sec2GmtLabel,
        primaryCity,
        sec1City,
        sec2City,
    };
}

function updateWorldTimes(ui, is24h, isCompact) {
    if (!ui) return;

    const primaryData = getFormattedTimeAndGmt(ui.primaryCity.timezone, is24h);
    ui.topCityLabel.set_text(isCompact ? getCityShortCode(ui.primaryCity.name) : ui.primaryCity.name);
    ui.topTimeLabel.set_text(primaryData.timeStr);
    ui.topAmpmLabel.set_text(primaryData.ampmStr);
    ui.topAmpmLabel.visible = (!is24h && primaryData.ampmStr !== '');
    ui.topGmtLabel.set_text(primaryData.gmtStr);

    const sec1Data = getFormattedTimeAndGmt(ui.sec1City.timezone, is24h);
    ui.sec1CityLabel.set_text(isCompact ? getCityShortCode(ui.sec1City.name) : ui.sec1City.name);
    ui.sec1TimeLabel.set_text(sec1Data.timeStr);
    ui.sec1AmpmLabel.set_text(sec1Data.ampmStr);
    ui.sec1AmpmLabel.visible = (!is24h && sec1Data.ampmStr !== '');
    ui.sec1GmtLabel.set_text(sec1Data.gmtStr);

    const sec2Data = getFormattedTimeAndGmt(ui.sec2City.timezone, is24h);
    ui.sec2CityLabel.set_text(isCompact ? getCityShortCode(ui.sec2City.name) : ui.sec2City.name);
    ui.sec2TimeLabel.set_text(sec2Data.timeStr);
    ui.sec2AmpmLabel.set_text(sec2Data.ampmStr);
    ui.sec2AmpmLabel.visible = (!is24h && sec2Data.ampmStr !== '');
    ui.sec2GmtLabel.set_text(sec2Data.gmtStr);
}

export function createWorldTimeNode(widgetData, width, height, xPosition, yPosition) {
    const fontFamily = resolveExplicitFontFamily(widgetData) || 'Sans';
    const fontCss = fontFamily ? `font-family: ${fontFamily}; ` : '';
    const textColor = resolveWidgetForegroundColor(widgetData);

    const widgetNode = createWidgetContainer(widgetData, width, height, xPosition, yPosition);

    const cities = widgetData.cities || DEFAULT_CITIES;
    const ui = buildWorldClockUI(widgetNode, fontCss, textColor, cities);

    let isCompact = false;
    const state = { timerId: null };

    const updateDisplay = () => {
        if (isActorDestroyed(widgetNode)) return GLib.SOURCE_REMOVE;
        const is24h = resolveUse24h(widgetData);
        updateWorldTimes(ui, is24h, isCompact);
        return GLib.SOURCE_CONTINUE;
    };

    function applyScale(scale, curWidth) {
        isCompact = (curWidth < 190 || scale < 0.85);

        const pad = Math.max(8, Math.round(12 * scale));
        ui.mainContainer.style = `padding: ${pad}px;`;

        const topCitySize = Math.max(10, Math.round(14 * scale));
        const topTimeSize = Math.max(22, Math.round(34 * scale));
        const topGmtSize = Math.max(8, Math.round(11 * scale));

        const secCitySize = Math.max(9, Math.round(12 * scale));
        const secTimeSize = Math.max(14, Math.round(18 * scale));
        const secGmtSize = Math.max(8, Math.round(10 * scale));

        ui.topCityLabel.style = `${fontCss}font-size: ${topCitySize}px; color: ${textColor}; opacity: ${SECONDARY_OPACITY}; font-weight: 500;`;
        ui.topTimeLabel.style = `${fontCss}font-size: ${topTimeSize}px; color: ${textColor}; font-weight: 300; text-align: right;`;
        ui.topAmpmLabel.style = `${fontCss}font-size: ${topGmtSize}px; color: ${textColor}; opacity: ${SECONDARY_OPACITY}; margin-left: 3px; margin-bottom: 4px;`;
        ui.topGmtLabel.style = `${fontCss}font-size: ${topGmtSize}px; color: ${textColor}; opacity: ${SECONDARY_OPACITY};`;

        if (isCompact) {
            ui.secondaryBox.set_vertical(true);
            ui.secondaryBox.style = `spacing: ${Math.round(4 * scale)}px; margin-top: 4px;`;

            [ui.sec1Box, ui.sec2Box].forEach(b => {
                b.set_vertical(false);
                b.x_align = Clutter.ActorAlign.FILL;
                b.x_expand = true;
            });

            ui.sec1GmtLabel.visible = false;
            ui.sec2GmtLabel.visible = false;

            ui.sec1CityLabel.x_align = Clutter.ActorAlign.START;
            ui.sec1CityLabel.x_expand = true;
            ui.sec1CityLabel.style = `${fontCss}font-size: ${secCitySize}px; color: ${textColor}; font-weight: bold; opacity: 0.85; text-align: left;`;
            ui.sec1TimeBox.x_align = Clutter.ActorAlign.END;
            ui.sec1TimeLabel.style = `${fontCss}font-size: ${secTimeSize}px; color: ${textColor}; font-weight: 400; text-align: right;`;
            ui.sec1AmpmLabel.style = `${fontCss}font-size: ${secGmtSize}px; color: ${textColor}; opacity: ${SECONDARY_OPACITY}; margin-left: 2px;`;

            ui.sec2CityLabel.x_align = Clutter.ActorAlign.START;
            ui.sec2CityLabel.x_expand = true;
            ui.sec2CityLabel.style = `${fontCss}font-size: ${secCitySize}px; color: ${textColor}; font-weight: bold; opacity: 0.85; text-align: left;`;
            ui.sec2TimeBox.x_align = Clutter.ActorAlign.END;
            ui.sec2TimeLabel.style = `${fontCss}font-size: ${secTimeSize}px; color: ${textColor}; font-weight: 400; text-align: right;`;
            ui.sec2AmpmLabel.style = `${fontCss}font-size: ${secGmtSize}px; color: ${textColor}; opacity: ${SECONDARY_OPACITY}; margin-left: 2px;`;

        } else {
            ui.secondaryBox.set_vertical(false);
            ui.secondaryBox.style = '';

            [ui.sec1Box, ui.sec2Box].forEach(b => {
                b.set_vertical(true);
            });

            ui.sec1Box.x_align = Clutter.ActorAlign.START;
            ui.sec2Box.x_align = Clutter.ActorAlign.END;

            ui.sec1GmtLabel.visible = true;
            ui.sec2GmtLabel.visible = true;

            ui.sec1CityLabel.x_align = Clutter.ActorAlign.START;
            ui.sec1CityLabel.x_expand = false;
            ui.sec1CityLabel.style = `${fontCss}font-size: ${secCitySize}px; color: ${textColor}; opacity: ${SECONDARY_OPACITY}; text-align: left;`;
            ui.sec1TimeBox.x_align = Clutter.ActorAlign.START;
            ui.sec1TimeLabel.style = `${fontCss}font-size: ${secTimeSize}px; color: ${textColor}; text-align: left;`;
            ui.sec1AmpmLabel.style = `${fontCss}font-size: ${secGmtSize}px; color: ${textColor}; opacity: ${SECONDARY_OPACITY}; margin-left: 3px;`;
            ui.sec1GmtLabel.style = `${fontCss}font-size: ${secGmtSize}px; color: ${textColor}; opacity: ${SECONDARY_OPACITY};`;

            ui.sec2CityLabel.x_align = Clutter.ActorAlign.END;
            ui.sec2CityLabel.x_expand = false;
            ui.sec2CityLabel.style = `${fontCss}font-size: ${secCitySize}px; color: ${textColor}; opacity: ${SECONDARY_OPACITY}; text-align: right;`;
            ui.sec2TimeBox.x_align = Clutter.ActorAlign.END;
            ui.sec2TimeLabel.style = `${fontCss}font-size: ${secTimeSize}px; color: ${textColor}; text-align: right;`;
            ui.sec2AmpmLabel.style = `${fontCss}font-size: ${secGmtSize}px; color: ${textColor}; opacity: ${SECONDARY_OPACITY}; margin-left: 3px; text-align: right;`;
            ui.sec2GmtLabel.style = `${fontCss}font-size: ${secGmtSize}px; color: ${textColor}; opacity: ${SECONDARY_OPACITY}; text-align: right;`;
        }

        updateDisplay();
    }

    applyScale(Math.max(0.65, Math.min(width / REF_WIDTH, height / REF_HEIGHT)), width);

    attachResponsiveScaler(widgetNode, REF_WIDTH, REF_HEIGHT, (_ratio, w, h) => {
        if (isActorDestroyed(widgetNode)) return;
        applyScale(Math.max(0.65, Math.min(w / REF_WIDTH, h / REF_HEIGHT)), w);
    });

    startMinuteAlignedTimer(state, widgetNode, updateDisplay);
    connectTimerCleanup(widgetNode, state);

    return widgetNode;
}