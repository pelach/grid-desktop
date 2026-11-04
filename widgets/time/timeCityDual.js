import St from 'gi://St';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import Cairo from 'cairo';
import Pango from 'gi://Pango';
import { 
    resolveWidgetForegroundColor, 
    resolveExplicitFontFamily, 
    resolveUse24h,
    CAIRO_OPERATOR_CLEAR,
    CAIRO_OPERATOR_OVER
} from '../../utils/widgetUtils.js';
import { 
    createWidgetContainer, 
    attachResponsiveScaler, 
    connectTimerCleanup,
    formatTimeParts
} from '../../shell/widgetUIUtils.js';
import { isActorDestroyed } from '../../utils/actorLifecycle.js';

const BASE_WIDTH = 360;
const BASE_HEIGHT = 176;
const TICK_INTERVAL_MS = 1000;

const DEFAULT_TARGET_CITY = {
    name: 'Pensacola',
    admin1: 'Florida',
    country: 'US',
    timezone: 'America/Chicago'
};

function setRgb(cr, r, g, b) {
    if (typeof cr.setSourceRGB === 'function') {
        cr.setSourceRGB(r, g, b);
    } else if (typeof cr.setSourceRgb === 'function') {
        cr.setSourceRgb(r, g, b);
    } else if (typeof cr.set_source_rgb === 'function') {
        cr.set_source_rgb(r, g, b);
    }
}

function setFontSize(cr, size) {
    if (typeof cr.setFontSize === 'function') {
        cr.setFontSize(size);
    } else if (typeof cr.set_font_size === 'function') {
        cr.set_font_size(size);
    }
}

// ── Időeltolódás és nap-különbség kiszámítása a helyi géphez képest ──
function calculateRelativeOffset(nowTarget) {
    const nowLocal = GLib.DateTime.new_now_local();

    // UTC eltolódások mikroszekundumban
    const offsetDiffMicro = nowTarget.get_utc_offset() - nowLocal.get_utc_offset();
    const diffHours = Math.round(offsetDiffMicro / 3600000000);

    // Dátum eltérés (napváltás)
    let dayPrefix = 'Today';
    const dayDiff = nowTarget.get_day_of_year() - nowLocal.get_day_of_year();
    if (dayDiff === 1 || dayDiff < -300) {
        dayPrefix = 'Tomorrow';
    } else if (dayDiff === -1 || dayDiff > 300) {
        dayPrefix = 'Yesterday';
    }

    if (diffHours === 0) {
        return 'Same time';
    }

    const sign = diffHours > 0 ? `+${diffHours}` : `${diffHours}`;
    const hrUnit = Math.abs(diffHours) === 1 ? 'hr' : 'hrs';
    return `${dayPrefix}, ${sign}${hrUnit}`;
}

// ── Jobb oldali lebegő analóg számlap kirajzolása ──
function drawAnalogDial(cr, size, nowTarget, fontFamily, showSecondHand = true) {
    if (!size || size <= 0) return;

    cr.setOperator(CAIRO_OPERATOR_CLEAR);
    cr.paint();
    cr.setOperator(CAIRO_OPERATOR_OVER);

    const hours = nowTarget.get_hour();
    const minutes = nowTarget.get_minute();
    const seconds = nowTarget.get_second();

    const cx = size / 2;
    const cy = size / 2;
    const radius = Math.max(15, (size / 2) - 4);

    // 12 számlap-pozíció kirajzolása körben
    try {
        if (typeof cr.selectFontFace === 'function') {
            cr.selectFontFace(fontFamily || 'Sans', Cairo.FontSlant.NORMAL, Cairo.FontWeight.BOLD);
        }
        setFontSize(cr, radius * 0.17);
        setRgb(cr, 1.0, 1.0, 1.0); // Fehér számok

        for (let i = 1; i <= 12; i++) {
            const angle = (i * 30) * (Math.PI / 180);
            const numDist = radius * 0.82;
            const numX = cx + Math.sin(angle) * numDist;
            const numY = cy - Math.cos(angle) * numDist;

            const text = `${i}`;
            const ext = cr.textExtents ? cr.textExtents(text) : { width: radius * 0.12, height: radius * 0.12 };
            cr.moveTo(numX - (ext.width / 2), numY + (ext.height / 2.2));
            cr.showText(text);
        }
    } catch (e) {}

    // Óramutató (fehér, vastag, kerekített vég)
    const hourAngle = ((hours % 12) + (minutes / 60)) * 30 * (Math.PI / 180);
    const hourLen = radius * 0.44;
    cr.setLineWidth(Math.max(2.5, radius * 0.085));
    cr.setLineCap(Cairo.LineCap.ROUND);
    setRgb(cr, 1.0, 1.0, 1.0);
    cr.moveTo(cx, cy);
    cr.lineTo(cx + Math.sin(hourAngle) * hourLen, cy - Math.cos(hourAngle) * hourLen);
    cr.stroke();

    // Percmutató (fehér, kicsit hosszabb, kerekített vég)
    const minAngle = (minutes + (seconds / 60)) * 6 * (Math.PI / 180);
    const minLen = radius * 0.68;
    cr.setLineWidth(Math.max(2.0, radius * 0.065));
    cr.moveTo(cx, cy);
    cr.lineTo(cx + Math.sin(minAngle) * minLen, cy - Math.cos(minAngle) * minLen);
    cr.stroke();

    // Másodpercmutató (Apple-féle narancssárga, kis ellensúllyal)
    if (showSecondHand) {
        const secAngle = seconds * 6 * (Math.PI / 180);
        const secLen = radius * 0.84;
        const secTailLen = radius * 0.16;

        cr.setLineWidth(Math.max(1.2, radius * 0.035));
        setRgb(cr, 1.0, 0.62, 0.22); // Narancs mutató

        cr.moveTo(cx - Math.sin(secAngle) * secTailLen, cy + Math.cos(secAngle) * secTailLen);
        cr.lineTo(cx + Math.sin(secAngle) * secLen, cy - Math.cos(secAngle) * secLen);
        cr.stroke();

        // Középső narancs kis pötty
        cr.arc(cx, cy, Math.max(2.2, radius * 0.055), 0, 2 * Math.PI);
        cr.fill();
    }
}

export function createCityDualTimeNode(widgetData, width, height, xPosition, yPosition) {
    const fontFamily = resolveExplicitFontFamily(widgetData) || 'Sans';
    const fontCss = fontFamily ? `font-family: ${fontFamily}; ` : '';
    const textColor = resolveWidgetForegroundColor(widgetData);

    const container = createWidgetContainer(widgetData, width, height, xPosition, yPosition);

    let scale = Math.max(0.65, height / BASE_HEIGHT);

    // Célváros meghatározása (támogatja a widgetData.cities[0]-t és a widgetData.city-t is)
    const targetCity = (widgetData.cities && widgetData.cities[0]) || widgetData.city || DEFAULT_TARGET_CITY;

    // ── Vízszintes elrendezés (Bal: Digitális adatok, Jobb: Analóg óra) ──
    const mainLayout = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_expand: true,
        y_expand: true,
    });
    container.add_child(mainLayout);

    // Bal oldali függőleges doboz
    const leftBox = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
        x_align: Clutter.ActorAlign.START,
        y_align: Clutter.ActorAlign.CENTER,
    });
    mainLayout.add_child(leftBox);

    // Digitális idő sor (idő + AM/PM)
    const timeBox = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_align: Clutter.ActorAlign.START,
        y_align: Clutter.ActorAlign.END,
    });

    const timeLabel = new St.Label({
        text: '00:00',
    });
    timeBox.add_child(timeLabel);

    const ampmLabel = new St.Label({
        text: '',
        y_align: Clutter.ActorAlign.END,
    });
    timeBox.add_child(ampmLabel);
    leftBox.add_child(timeBox);

    // Városnév és állam / zóna
    const cityNameLabel = new St.Label({ text: '' });
    cityNameLabel.clutter_text.ellipsize = Pango.EllipsizeMode.END;
    leftBox.add_child(cityNameLabel);

    // Relatív időeltérés sor (pl. "Today, -1hr")
    const relativeLabel = new St.Label({ text: '' });
    relativeLabel.clutter_text.ellipsize = Pango.EllipsizeMode.END;
    leftBox.add_child(relativeLabel);

    // Jobb oldali analóg óra rajzterület
    const clockArea = new St.DrawingArea({
        x_expand: false,
        y_expand: true,
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
    });
    mainLayout.add_child(clockArea);

    let nowTarget = GLib.DateTime.new_now_local();

    // ── Rajzolás esemény bekötése ──
    clockArea.connect('repaint', (area) => {
        const cr = area.get_context();
        const [w, h] = area.get_surface_size();
        const drawSize = Math.min(w, h);
        if (drawSize > 0) {
            drawAnalogDial(cr, drawSize, nowTarget, fontFamily, widgetData.showSecondHand !== false);
        }
        //cr.$dispose();
    });

    // ── Idő és szövegek frissítése másodpercenként ──
    const updateTimeDisplay = () => {
        if (isActorDestroyed(container)) return GLib.SOURCE_REMOVE;

        const tz = targetCity.timezone
            ? (GLib.TimeZone.new_identifier(targetCity.timezone) || GLib.TimeZone.new(targetCity.timezone))
            : GLib.TimeZone.new_local();

        nowTarget = GLib.DateTime.new_now(tz || GLib.TimeZone.new_local());

        const is24h = resolveUse24h(widgetData);
        const { time: timeStr, ampm: ampmStr } = formatTimeParts(nowTarget, is24h);

        timeLabel.set_text(timeStr);
        ampmLabel.set_text(ampmStr);
        ampmLabel.visible = (!is24h && ampmStr !== '');

        // Város és zóna felirat összeállítása
        const tzAbbr = nowTarget.format('%Z') || '';
        let locationDesc = targetCity.name || 'City';
        if (targetCity.admin1) {
            locationDesc += `, ${targetCity.admin1}`;
        } else if (targetCity.country) {
            locationDesc += `, ${targetCity.country}`;
        }
        if (tzAbbr) {
            locationDesc += ` (${tzAbbr})`;
        }
        cityNameLabel.set_text(locationDesc);

        // Relatív eltérés kiszámítása
        relativeLabel.set_text(calculateRelativeOffset(nowTarget));

        clockArea.queue_repaint();
        return GLib.SOURCE_CONTINUE;
    };

    updateTimeDisplay();

    if (widgetData.settings && typeof widgetData.settings.connect === 'function') {
        const changeId = widgetData.settings.connect('changed::time-format-24h', () => {
            if (!isActorDestroyed(container)) {
                widgetData.globalUse24h = widgetData.settings.get_boolean('time-format-24h');
                updateTimeDisplay();
            }
        });
        container.connect('destroy', () => {
            try {
                widgetData.settings.disconnect(changeId);
            } catch (e) {}
        });
    }

    // Másodperces időzítő a folytonos analóg járáshoz
    const state = { timerId: null };
    state.timerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, TICK_INTERVAL_MS, updateTimeDisplay);
    connectTimerCleanup(container, state);

    // ── Reszponzív méretezés és stílusok ──
    function applyScale(newScale, curH) {
        scale = newScale;
        const pad = Math.max(10, Math.round(16 * scale));
        mainLayout.style = `padding: ${pad}px;`;

        const timeSize = Math.max(22, Math.round(36 * scale));
        const ampmSize = Math.max(11, Math.round(14 * scale));
        const citySize = Math.max(10, Math.round(13.5 * scale));
        const relSize = Math.max(10, Math.round(12.5 * scale));
        const ampmBottomMargin = Math.max(2, Math.round(5 * scale));
        
        timeLabel.style = `${fontCss}font-size: ${timeSize}px; color: ${textColor}; font-weight: 300; margin-right: 4px;`;
        ampmLabel.style = `${fontCss}font-size: ${ampmSize}px; color: ${textColor}; opacity: 0.7; margin-bottom: ${ampmBottomMargin}px; font-weight: 500;`;
        cityNameLabel.style = `${fontCss}font-size: ${citySize}px; color: ${textColor}; opacity: 0.75; font-weight: 500; margin-top: ${Math.round(4 * scale)}px;`;
        relativeLabel.style = `${fontCss}font-size: ${relSize}px; color: ${textColor}; opacity: 0.6; font-weight: 400; margin-top: ${Math.round(2 * scale)}px;`;

        // Analóg óra mérete (négyzetes méret a magassághoz igazítva)
        const clockDim = Math.max(60, Math.round(curH - (pad * 2)));
        clockArea.width = clockDim;
        clockArea.height = clockDim;

        clockArea.queue_repaint();
    }

    applyScale(scale, height);

    attachResponsiveScaler(container, BASE_WIDTH, BASE_HEIGHT, (_ratio, w, h) => {
        if (isActorDestroyed(container)) return;
        applyScale(Math.max(0.65, h / BASE_HEIGHT), h);
    });

    return container;
}