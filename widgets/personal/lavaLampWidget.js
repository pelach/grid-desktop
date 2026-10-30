import St from 'gi://St';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Rsvg from 'gi://Rsvg';

import {
    resolveWidgetForegroundColor,
    CAIRO_OPERATOR_CLEAR,
    CAIRO_OPERATOR_OVER,
} from '../../utils/widgetUtils.js';
import {
    createWidgetContainer,
    registerWidgetCleanup,
} from '../../shell/widgetUIUtils.js';
import { isActorDestroyed } from '../../utils/actorLifecycle.js';
import { LAVA_THEMES } from '../../utils/lavaThemes.js';

/**
 * Segédfüggvény SVG fájlok egyszerű beolvasásához az assets mappából.
 */

function getAssetPath(filename) {
    try {
        const currentFilePath = Gio.File.new_for_uri(import.meta.url).get_path();
        const currentDir = GLib.path_get_dirname(currentFilePath);
        return GLib.build_filenamev([currentDir, 'lavalamp', filename]);
    } catch (e) {
        console.warn('LavaLamp: Hiba az útvonal lekérésekor:', e.message);
        return null;
    }
}

export function createLavaLampNode(config, width, height, xPosition, yPosition) {
    const textColor = resolveWidgetForegroundColor(config);
    const container = createWidgetContainer(config, width, height, xPosition, yPosition);
    
    container.style += ' background-color: transparent; border: none; box-shadow: none;';

    const themeKey = config.lavaTheme || 'classic';
    const theme = LAVA_THEMES[themeKey] || LAVA_THEMES.classic;

    const drawingArea = new St.DrawingArea({
        x_expand: true,
        y_expand: true,
        width: width,
        height: height,
    });
    container.add_child(drawingArea);

    // Assetek előre betöltése (egyszer, inicializáláskor)
    // 1. Üveg 
    // 2. Fém váz
    // 3. Fénycsillanás
    const glassPathData = 'M 72,70 C 90,66 110,66 128,70 C 144,145 158,205 158,225 C 158,242 144,250 136,268 C 112,272 85,272 60,268 C 52,250 42,242 42,225 C 42,205 56,145 72,70 Z';
    

    // 2. Fém váz és Csillanás betöltése
    let lampHandle = null;
    let glintHandle = null;
    try {
        const lampPath = getAssetPath('lamp.svg');
        if (lampPath && GLib.file_test(lampPath, GLib.FileTest.EXISTS)) {
            lampHandle = Rsvg.Handle.new_from_file(lampPath);
        }

        const glintPath = getAssetPath('glint.svg');
        if (glintPath && GLib.file_test(glintPath, GLib.FileTest.EXISTS)) {
            glintHandle = Rsvg.Handle.new_from_file(glintPath);
        }
    } catch (e) {
        console.error(`[LavaLamp] Hiba a Handle betöltésekor: ${e.message}`);
    }

    // Cseppek állapota - az üveg formájához igazított x és y határok
    const blobs = [
        // 0: Alsó massza (kicsit mélyebben az új alsó maszkhoz)
        { x: 100, y: 250, r: 42, baseR: 42, phase: 0 },
        // 1-4: Lebegő cseppek (yMin megnövelve, hogy a kupak alatt ne lapuljanak el)
        { x: 95,  y: 220, r: 24, baseR: 24, yMin: 90,  yMax: 240, speed: 0.0032, progress: 0.5, phase: 0.2 },
        { x: 105, y: 180, r: 20, baseR: 20, yMin: 95,  yMax: 245, speed: 0.0042, progress: 2.1, phase: 1.5 },
        { x: 90,  y: 140, r: 25, baseR: 25, yMin: 85,  yMax: 235, speed: 0.0028, progress: 4.2, phase: 3.1 },
        { x: 110, y: 110, r: 18, baseR: 18, yMin: 90,  yMax: 240, speed: 0.0050, progress: 5.6, phase: 4.2 },
        // 5: Felső massza
        { x: 100, y: 74,  r: 26, baseR: 26, phase: 2.0 },
    ];

    const rgbHex = (rgb) => {
        const r = Math.round(rgb[0] * 255).toString(16).padStart(2, '0');
        const g = Math.round(rgb[1] * 255).toString(16).padStart(2, '0');
        const b = Math.round(rgb[2] * 255).toString(16).padStart(2, '0');
        return `#${r}${g}${b}`;
    };

    const lavaColorHex = rgbHex(theme.lava);
    const bgColorHex = rgbHex(theme.bg);
    const glowColorHex = rgbHex(theme.glow);

    drawingArea.connect('repaint', (area) => {
        const ctx = area.get_context();
        const [w, h] = area.get_surface_size();
        if (w <= 0 || h <= 0) {
            ctx.$dispose();
            return;
        }

        ctx.setOperator(CAIRO_OPERATOR_CLEAR);
        ctx.paint();
        ctx.setOperator(CAIRO_OPERATOR_OVER);

        // Dinamikus buborékok generálása
        const circlesSvg = blobs.map(b => 
            `<circle cx="${b.x.toFixed(1)}" cy="${b.y.toFixed(1)}" r="${b.r.toFixed(1)}" fill="${lavaColorHex}" />`
        ).join('\n');

        // SVG összeállítása:
        // 1. glassClip: a glass.svg belső formája
        // 2. A buborékok szigorúan ezen a clip-pathen belül renderelődnek
        const svgData = `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 400" width="${w}" height="${h}">
            <defs>
                <filter id="goo">
                    <feGaussianBlur in="SourceGraphic" stdDeviation="12" result="blur" />
                    <feColorMatrix in="blur" mode="matrix" 
                        values="1 0 0 0 0  
                                0 1 0 0 0  
                                0 0 1 0 0  
                                0 0 0 22 -9" result="goo" />
                    <feComposite in="SourceGraphic" in2="goo" operator="atop" />
                </filter>
                <linearGradient id="bgGlow" x1="0" y1="1" x2="0" y2="0">
                    <stop offset="0%" stop-color="${glowColorHex}" stop-opacity="0.5" />
                    <stop offset="80%" stop-color="${glowColorHex}" stop-opacity="0.0" />
                </linearGradient>

                <!-- VÁGÓMASZK: közvetlenül az üveg formájára zárjuk a lávát -->
                <clipPath id="glassClip">
                    <path d="${glassPathData}" />
                </clipPath>
            </defs>

            <!-- Csak az üveg belsejébe rajzolunk -->
            <g clip-path="url(#glassClip)">
                <rect width="200" height="400" fill="${bgColorHex}" opacity="0.3" />
                <rect width="200" height="400" fill="url(#bgGlow)" />
                <g filter="url(#goo)">
                    ${circlesSvg}
                </g>
            </g>
        </svg>
        `;

        const viewport = new Rsvg.Rectangle({ x: 0, y: 0, width: w, height: h });

        try {
            // 1. RÉTEG: Dinamikus láva buborékok a maszkon belül
            const svgBytes = new TextEncoder().encode(svgData);
            const lavaHandle = Rsvg.Handle.new_from_data(svgBytes);

            // Megjelenítés (modern render_document vagy cairo fallback)
            if (lavaHandle.render_document) {
                lavaHandle.render_document(ctx, viewport);
            } else {
                lavaHandle.render_cairo(ctx);
            }

            // 2. RÉTEG: Fém váz (lamp.svg)
            if (lampHandle) {
                if (lampHandle.render_document) {
                    lampHandle.render_document(ctx, viewport);
                } else {
                    lampHandle.render_cairo(ctx);
                }
            }

            // 3. RÉTEG: Csillanás (glint.svg) legfelül
            if (glintHandle) {
                if (glintHandle.render_document) {
                    glintHandle.render_document(ctx, viewport);
                } else {
                    glintHandle.render_cairo(ctx);
                }
            }
        } catch (e) {
            console.error(`[LavaLamp] Render hiba: ${e.message}`);
        }

        ctx.$dispose();
    });

    let lastTime = GLib.get_monotonic_time() / 1000.0;
    let isDisposed = false;

    // Időzítő (30 FPS)[cite: 5]
    const timerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 33, () => {
        if (isDisposed || isActorDestroyed(container) || isActorDestroyed(drawingArea)) {
            return GLib.SOURCE_REMOVE;
        }

        const now = GLib.get_monotonic_time() / 1000.0;
        const dt = Math.min((now - lastTime) / 16.6, 2.0);
        lastTime = now;

        // Alsó massza finom lélegzése
        blobs[0].r = blobs[0].baseR + Math.sin(now * 0.0008) * 2.5;

        for (let i = 1; i <= 4; i++) {
            const b = blobs[i];
            b.progress += b.speed * dt;

            // Szinuszos fel-le lebegés
            const t = (1.0 - Math.cos(b.progress)) * 0.5;
            b.y = b.yMin + t * (b.yMax - b.yMin);

            // Méretváltozás
            b.r = b.baseR * (0.92 + t * 0.20);

            // Ringatózás: az üveg hasánál (középen) szélesebb kilengés, alul-felül szűkebb
            const spread = (b.y > 140 && b.y < 280) ? 18 : 8;
            b.phase += 0.004 * dt;
            b.x = 100 + Math.sin(b.phase) * spread;
        }

        drawingArea.queue_repaint();
        return GLib.SOURCE_CONTINUE;
    });

    registerWidgetCleanup(container, () => {
        isDisposed = true;
        if (timerId) {
            GLib.source_remove(timerId);
        }
    });

    return container;
}