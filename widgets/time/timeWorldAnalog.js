import St from 'gi://St';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import Cairo from 'cairo';
import { 
    resolveWidgetBackgroundColor, 
    resolveWidgetForegroundColor, 
    resolveExplicitFontFamily, 
    cssColorToRgba 
} from '../../utils/widgetUtils.js';
import { 
    createWidgetContainer, 
    attachResponsiveScaler, 
    connectTimerCleanup 
} from '../../shell/widgetUIUtils.js';
import { isActorDestroyed } from '../../utils/actorLifecycle.js';

const BASE_WIDTH = 240;
const BASE_HEIGHT = 240;
const BORDER_ALPHA = 0.14;
const TICK_INTERVAL_MS = 1000;

const DEFAULT_ANALOG_CITIES = [
    { code: 'TOR', name: 'Toronto', timezone: 'America/Toronto' },
    { code: 'VAN', name: 'Vancouver', timezone: 'America/Vancouver' },
    { code: 'CGY', name: 'Calgary', timezone: 'America/Edmonton' },
    { code: 'WPG', name: 'Winnipeg', timezone: 'America/Winnipeg' },
];

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

function drawSingleClock(cr, size, city, fontFamily) {
    if (!size || size <= 0) return;

    const tz = city && city.timezone 
        ? (GLib.TimeZone.new_identifier(city.timezone) || GLib.TimeZone.new(city.timezone)) 
        : GLib.TimeZone.new_local();
    const now = GLib.DateTime.new_now(tz || GLib.TimeZone.new_local());

    const hours = now.get_hour();
    const minutes = now.get_minute();
    const seconds = now.get_second();

    const isDay = hours >= 6 && hours < 18;

    const cx = size / 2;
    const cy = size / 2;
    const radius = Math.max(10, (size / 2) - 4);

    // 1. Számlap kör háttér
    cr.arc(cx, cy, radius, 0, 2 * Math.PI);
    if (isDay) {
        setRgb(cr, 1.0, 1.0, 1.0);
    } else {
        setRgb(cr, 0.15, 0.17, 0.22);
    }
    cr.fill();

    const handColor = isDay ? { r: 0.1, g: 0.1, b: 0.1 } : { r: 1.0, g: 1.0, b: 1.0 };
    const numColor = isDay ? { r: 0.15, g: 0.15, b: 0.15 } : { r: 0.95, g: 0.95, b: 0.95 };
    const labelColor = isDay ? { r: 0.45, g: 0.45, b: 0.45 } : { r: 0.7, g: 0.7, b: 0.7 };

    // 2. Városkód
    try {
        if (typeof cr.selectFontFace === 'function') {
            cr.selectFontFace(fontFamily || 'Sans', Cairo.FontSlant.NORMAL, Cairo.FontWeight.BOLD);
        }
        setFontSize(cr, radius * 0.24);
        setRgb(cr, labelColor.r, labelColor.g, labelColor.b);

        const cityText = city?.code || (city?.name ? city.name.substring(0, 3).toUpperCase() : 'UTC');
        const extCity = cr.textExtents ? cr.textExtents(cityText) : { width: radius * 0.4, height: radius * 0.2 };
        cr.moveTo(cx - (extCity.width / 2), cy - (radius * 0.35));
        cr.showText(cityText);

        // 3. Fő óraszámok (12, 3, 6, 9)
        setFontSize(cr, radius * 0.22);
        setRgb(cr, numColor.r, numColor.g, numColor.b);

        const cardinalNumbers = [
            { num: '12', x: cx, y: cy - radius * 0.65 },
            { num: '3',  x: cx + radius * 0.68, y: cy + radius * 0.08 },
            { num: '6',  x: cx, y: cy + radius * 0.78 },
            { num: '9',  x: cx - radius * 0.68, y: cy + radius * 0.08 },
        ];

        for (const item of cardinalNumbers) {
            const ext = cr.textExtents ? cr.textExtents(item.num) : { width: radius * 0.15, height: radius * 0.15 };
            cr.moveTo(item.x - (ext.width / 2), item.y);
            cr.showText(item.num);
        }
    } catch (e) {
        // Fallback ha a szövegrajzolás hibát dobna bizonyos fontoknál
    }

    // 4. Óramutató
    const hourAngle = ((hours % 12) + (minutes / 60)) * 30 * (Math.PI / 180);
    const hourLen = radius * 0.48;
    cr.setLineWidth(Math.max(2, radius * 0.08));
    cr.setLineCap(Cairo.LineCap.ROUND);
    setRgb(cr, handColor.r, handColor.g, handColor.b);
    cr.moveTo(cx, cy);
    cr.lineTo(cx + Math.sin(hourAngle) * hourLen, cy - Math.cos(hourAngle) * hourLen);
    cr.stroke();

    // 5. Percmutató
    const minAngle = minutes * 6 * (Math.PI / 180);
    const minLen = radius * 0.70;
    cr.setLineWidth(Math.max(1.5, radius * 0.055));
    cr.moveTo(cx, cy);
    cr.lineTo(cx + Math.sin(minAngle) * minLen, cy - Math.cos(minAngle) * minLen);
    cr.stroke();

    // 6. Narancssárga másodpercmutató
    const secAngle = seconds * 6 * (Math.PI / 180);
    const secLen = radius * 0.80;
    const secBackLen = radius * 0.18;
    cr.setLineWidth(Math.max(1, radius * 0.03));
    setRgb(cr, 1.0, 0.62, 0.04);
    cr.moveTo(cx - Math.sin(secAngle) * secBackLen, cy + Math.cos(secAngle) * secBackLen);
    cr.lineTo(cx + Math.sin(secAngle) * secLen, cy - Math.cos(secAngle) * secLen);
    cr.stroke();

    // Közép kör
    cr.arc(cx, cy, Math.max(2, radius * 0.06), 0, 2 * Math.PI);
    cr.fill();
}

export function createWorldTimeAnalogNode(config, width, height, xPosition, yPosition) {
    const bgColor = resolveWidgetBackgroundColor(config);
    const textColor = resolveWidgetForegroundColor(config);
    const fontFamily = resolveExplicitFontFamily(config) || 'Sans';
    const borderRadius = config.appliedBorderRadius || 0;

    const container = createWidgetContainer(config, width, height, xPosition, yPosition);
    container.style += ` border: 1px solid ${cssColorToRgba(textColor, BORDER_ALPHA)};`;

    const cities = config.cities || DEFAULT_ANALOG_CITIES;

    const mainBox = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
        style: `background-color: ${bgColor}; border-radius: ${borderRadius}px; padding: 6px;`,
    });
    container.add_child(mainBox);

    const rowTop = new St.BoxLayout({ orientation: Clutter.Orientation.HORIZONTAL, x_expand: true, y_expand: true });
    const rowBottom = new St.BoxLayout({ orientation: Clutter.Orientation.HORIZONTAL, x_expand: true, y_expand: true });
    mainBox.add_child(rowTop);
    mainBox.add_child(rowBottom);

    const clockAreas = [];

    // Kiszámítjuk a kezdeti cellaméretet a kapott konténer alapján
    const initialCellSize = Math.max(40, Math.floor((Math.min(width, height) - 24) / 2));

    for (let i = 0; i < 4; i++) {
        const city = cities[i] || DEFAULT_ANALOG_CITIES[i];
        const drawingArea = new St.DrawingArea({
            x_expand: true,
            y_expand: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            width: initialCellSize,
            height: initialCellSize,
        });

        drawingArea.connect('repaint', (area) => {
            const cr = area.get_context();
            const [w, h] = area.get_surface_size();
            const drawSize = Math.min(w, h);
            if (drawSize > 0) {
                drawSingleClock(cr, drawSize, city, fontFamily);
            }
            cr.$dispose();
        });

        if (i < 2) rowTop.add_child(drawingArea);
        else rowBottom.add_child(drawingArea);

        clockAreas.push(drawingArea);
    }

    const state = { timerId: null };

    const updateAll = () => {
        if (isActorDestroyed(container)) return GLib.SOURCE_REMOVE;
        clockAreas.forEach(area => area.queue_repaint());
        return GLib.SOURCE_CONTINUE;
    };

    state.timerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, TICK_INTERVAL_MS, updateAll);
    connectTimerCleanup(container, state);

    attachResponsiveScaler(container, BASE_WIDTH, BASE_HEIGHT, (scale, w, h) => {
        if (isActorDestroyed(container)) return;
        const pad = Math.max(4, Math.round(6 * scale));
        mainBox.style = `background-color: ${bgColor}; border-radius: ${borderRadius}px; padding: ${pad}px;`;

        const newCellSize = Math.max(40, Math.floor((Math.min(w, h) - (pad * 4)) / 2));
        clockAreas.forEach(area => {
            area.width = newCellSize;
            area.height = newCellSize;
            area.queue_repaint();
        });
    });

    // Kezdeti kirajzolás kikényszerítése
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => {
        updateAll();
        return GLib.SOURCE_REMOVE;
    });

    return container;
}