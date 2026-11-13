import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {
    resolveExplicitFontFamily,
    resolveWidgetForegroundColor,
    resolveWidgetBackgroundColor,
    cssColorToRgba,
    parseCssColor,
    isDarkBackgroundColor,
} from '../../utils/widgetUtils.js';

import {
    createWidgetContainer,
    registerWidgetCleanup,
    attachResponsiveScaler,
} from '../../shell/widgetUIUtils.js';

import { isActorDestroyed } from '../../utils/actorLifecycle.js';
import { fetchF1HubData, loadHubCache, getTeamColor, clearF1Session } from '../../utils/f1Api.js';

const BASE_CONTAINER_WIDTH_PX = 400;
const BASE_CONTAINER_HEIGHT_PX = 400;
const ACCENT_RED = '#FF3B30';

function formatCountdown(diffMs) {
    const totalSec = Math.max(0, Math.floor(diffMs / 1000));
    const days = Math.floor(totalSec / 86400);
    const hours = Math.floor((totalSec % 86400) / 3600);
    const mins = Math.floor((totalSec % 3600) / 60);
    const secs = totalSec % 60;

    if (days >= 1) return `${days}d ${hours}h`;
    if (hours >= 1) return `${hours}h ${String(mins).padStart(2, '0')}m`;
    return `${mins}:${String(secs).padStart(2, '0')}`;
}

function formatWeekendDates(weekend) {
    if (!weekend?.sessions?.length) return '';
    const start = weekend.sessions[0].start;
    const end = weekend.race.start;
    const fmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });
    return `${fmt.format(start)} – ${fmt.format(end)}`;
}

function formatSessionDay(date) {
    return new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(date);
}

function formatSessionTime(date) {
    return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
}

export function createF1HubNode(config, width, height, xPosition, yPosition) {
    const fontFamily = resolveExplicitFontFamily(config);
    const fontCss = fontFamily ? `font-family: ${fontFamily}; ` : '';
    const textColor = resolveWidgetForegroundColor(config);
    const container = createWidgetContainer(config, width, height, xPosition, yPosition);

    const isDarkSurface = isDarkBackgroundColor(resolveWidgetBackgroundColor(config));
    const stripBgColor = cssColorToRgba(textColor, isDarkSurface ? 0.06 : 0.05);
    const dividerColor = cssColorToRgba(textColor, isDarkSurface ? 0.12 : 0.10);

    let scale = Math.max(0.65, Math.min(width / BASE_CONTAINER_WIDTH_PX, height / BASE_CONTAINER_HEIGHT_PX));
    let isDisposed = false;
    let isFetching = false;
    let cancellable = new Gio.Cancellable();

    let state = {
        weekend: null,
        afterRound: 0,
        drivers: [],
        track: null,
        trackFor: null,
        status: 'Loading F1…',
    };

    const cached = loadHubCache();
    if (cached) {
        state.weekend = cached.weekend;
        state.afterRound = cached.standings?.afterRound || 0;
        state.drivers = cached.standings?.drivers || [];
        state.track = cached.track;
        state.trackFor = cached.trackFor;
        state.status = null;
    }

    const contentBox = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
    });
    container.add_child(contentBox);

    // ── 1. Fejléc + Cairo pályarajz ──
    const headerRow = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_expand: true,
        y_align: Clutter.ActorAlign.START,
    });

    const headerInfoBox = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
    });

    const roundLabel = new St.Label({ text: '' });
    const placeLabel = new St.Label({ text: '' });
    placeLabel.clutter_text.set_ellipsize(3);
    const datesLabel = new St.Label({ text: '' });

    headerInfoBox.add_child(roundLabel);
    headerInfoBox.add_child(placeLabel);
    headerInfoBox.add_child(datesLabel);
    headerRow.add_child(headerInfoBox);

    const trackArea = new St.DrawingArea({
        y_align: Clutter.ActorAlign.CENTER,
    });

    trackArea.connect('repaint', (area) => {
        const cr = area.get_context();
        const w = area.get_width();
        const h = area.get_height();
        if (w <= 0 || h <= 0 || !state.track || state.track.length < 2) {
            cr.$dispose();
            return;
        }

        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (const p of state.track) {
            if (p.x < minX) minX = p.x;
            if (p.x > maxX) maxX = p.x;
            if (p.y < minY) minY = p.y;
            if (p.y > maxY) maxY = p.y;
        }

        const pad = Math.max(4, 5 * scale);
        const spanX = Math.max(0.01, maxX - minX);
        const spanY = Math.max(0.01, maxY - minY);
        const drawScale = Math.min((w - pad * 2) / spanX, (h - pad * 2) / spanY);
        const ox = (w - spanX * drawScale) / 2;
        const oy = (h - spanY * drawScale) / 2;

        const fg = parseCssColor(textColor);
        cr.setSourceRGBA(fg.r ?? 1, fg.g ?? 1, fg.b ?? 1, 0.55);
        cr.setLineWidth(Math.max(1.5, 2.2 * scale));
        cr.setLineJoin(1); // CAIRO_LINE_JOIN_ROUND

        state.track.forEach((p, idx) => {
            const sx = ox + (p.x - minX) * drawScale;
            const sy = oy + (p.y - minY) * drawScale;
            if (idx === 0) cr.moveTo(sx, sy);
            else cr.lineTo(sx, sy);
        });
        cr.closePath();
        cr.stroke();

        // Rajt/cél egyenes piros pontja
        const startX = ox + (state.track[0].x - minX) * drawScale;
        const startY = oy + (state.track[0].y - minY) * drawScale;
        const red = parseCssColor(ACCENT_RED);
        cr.setSourceRGBA(red.r ?? 1, red.g ?? 0.23, red.b ?? 0.19, 1.0);
        cr.arc(startX, startY, Math.max(2.5, 3.2 * scale), 0, Math.PI * 2);
        cr.fill();

        cr.$dispose();
    });

    headerRow.add_child(trackArea);
    contentBox.add_child(headerRow);

    // ── 2. Következő esemény visszaszámláló ──
    const countdownBox = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
    });
    const nextSessionTitle = new St.Label({ text: '' });
    const countdownValue = new St.Label({ text: '' });
    countdownBox.add_child(nextSessionTitle);
    countdownBox.add_child(countdownValue);
    contentBox.add_child(countdownBox);

    // ── 3. Hétvégi menetrend sáv ──
    const stripBox = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_expand: true,
    });
    contentBox.add_child(stripBox);

    // ── Elválasztó vonal ──
    const mainDivider = new St.Widget({ x_expand: true, height: 1 });
    contentBox.add_child(mainDivider);

    // ── 4. Bajnoki tabella (Top 5) ──
    const standingsHeader = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_expand: true,
    });
    const driversTitleLabel = new St.Label({ text: 'DRIVERS', x_expand: true });
    const afterRoundLabel = new St.Label({ text: '' });
    standingsHeader.add_child(driversTitleLabel);
    standingsHeader.add_child(afterRoundLabel);
    contentBox.add_child(standingsHeader);

    const standingsList = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
    });
    contentBox.add_child(standingsList);

    function getNextSession(weekend, now) {
        if (!weekend?.sessions) return null;
        return weekend.sessions.find(s => s.end.getTime() > now.getTime()) || null;
    }

    function renderUI() {
        if (isDisposed || isActorDestroyed(container)) return;

        const now = new Date();
        const pad = Math.max(10, Math.round(14 * scale));
        const smallFont = Math.max(9, Math.round(11 * scale));
        const medFont = Math.max(11, Math.round(13 * scale));
        const titleFont = Math.max(16, Math.round(20 * scale));
        const heroFont = Math.max(22, Math.round(28 * scale));

        contentBox.style = `padding: ${pad}px;`;
        mainDivider.style = `background-color: ${dividerColor}; height: 1px; margin-top: ${Math.round(10 * scale)}px; margin-bottom: ${Math.round(8 * scale)}px;`;

        const w = state.weekend;
        if (!w && state.drivers.length === 0) {
            roundLabel.text = state.status || 'Loading F1…';
            roundLabel.style = `${fontCss}color: ${textColor}; font-size: ${medFont}px; font-weight: 600;`;
            placeLabel.text = '';
            datesLabel.text = '';
            trackArea.visible = false;
            countdownBox.visible = false;
            stripBox.visible = false;
            mainDivider.visible = false;
            standingsHeader.visible = false;
            standingsList.visible = false;
            return;
        }

        mainDivider.visible = true;
        standingsHeader.visible = true;
        standingsList.visible = true;

        if (!w) {
            roundLabel.text = 'SEASON COMPLETE';
            roundLabel.style = `${fontCss}color: ${ACCENT_RED}; font-size: ${smallFont}px; font-weight: 700;`;
            placeLabel.text = 'See you next year.';
            placeLabel.style = `${fontCss}color: ${textColor}; font-size: ${titleFont}px; font-weight: 600;`;
            datesLabel.text = '';
            trackArea.visible = false;
            countdownBox.visible = false;
            stripBox.visible = false;
        } else {
            const started = now.getTime() >= w.sessions[0].start.getTime();
            roundLabel.text = `ROUND ${w.round} · ${started ? 'RACE WEEKEND' : 'NEXT RACE'}`;
            roundLabel.style = `${fontCss}color: ${ACCENT_RED}; font-size: ${smallFont}px; font-weight: 700;`;

            placeLabel.text = w.place;
            placeLabel.style = `${fontCss}color: ${textColor}; font-size: ${titleFont}px; font-weight: 600; margin-top: ${Math.round(2 * scale)}px;`;

            const statusSuffix = state.status ? `  ·  ${state.status}` : '';
            datesLabel.text = `${formatWeekendDates(w)}${statusSuffix}`;
            datesLabel.style = `${fontCss}color: ${textColor}; opacity: 0.65; font-size: ${medFont}px; margin-top: ${Math.round(2 * scale)}px;`;

            if (state.track && state.track.length > 2) {
                trackArea.visible = true;
                trackArea.width = Math.round(135 * scale);
                trackArea.height = Math.round(64 * scale);
                trackArea.queue_repaint();
            } else {
                trackArea.visible = false;
            }

            countdownBox.visible = true;
            countdownBox.style = `margin-top: ${Math.round(10 * scale)}px; margin-bottom: ${Math.round(8 * scale)}px;`;
            const nextSess = getNextSession(w, now);
            if (!nextSess) {
                nextSessionTitle.text = 'Weekend';
                countdownValue.text = 'Finished';
            } else if (now.getTime() >= nextSess.start.getTime()) {
                nextSessionTitle.text = nextSess.name;
                countdownValue.text = 'Live now';
            } else {
                nextSessionTitle.text = `${nextSess.name} in`;
                countdownValue.text = formatCountdown(nextSess.start.getTime() - now.getTime());
            }

            nextSessionTitle.style = `${fontCss}color: ${textColor}; opacity: 0.65; font-size: ${smallFont}px;`;
            countdownValue.style = `${fontCss}color: ${textColor}; font-size: ${heroFont}px; font-weight: 600;`;

            // Hétvégi menetrend sáv
            stripBox.visible = true;
            stripBox.destroy_all_children();
            stripBox.style = `background-color: ${stripBgColor}; border-radius: ${Math.round(10 * scale)}px; padding: ${Math.round(6 * scale)}px ${Math.round(4 * scale)}px;`;

            for (const s of w.sessions) {
                const done = now.getTime() >= s.end.getTime();
                const current = s === nextSess;
                const col = new St.BoxLayout({
                    orientation: Clutter.Orientation.VERTICAL,
                    x_expand: true,
                    x_align: Clutter.ActorAlign.CENTER,
                });

                const shortLbl = new St.Label({
                    text: s.short,
                    x_align: Clutter.ActorAlign.CENTER,
                    style: `${fontCss}color: ${current ? ACCENT_RED : textColor}; opacity: ${done && !current ? 0.5 : 1.0}; font-size: ${smallFont}px; font-weight: 700;`,
                });
                const dayLbl = new St.Label({
                    text: formatSessionDay(s.start),
                    x_align: Clutter.ActorAlign.CENTER,
                    style: `${fontCss}color: ${textColor}; opacity: ${done ? 0.5 : 0.9}; font-size: ${smallFont}px;`,
                });
                const timeLbl = new St.Label({
                    text: formatSessionTime(s.start),
                    x_align: Clutter.ActorAlign.CENTER,
                    style: `${fontCss}color: ${textColor}; opacity: 0.6; font-size: ${smallFont}px;`,
                });

                col.add_child(shortLbl);
                col.add_child(dayLbl);
                col.add_child(timeLbl);
                stripBox.add_child(col);
            }
        }

        // Tabella fejléc
        standingsHeader.style = `margin-bottom: ${Math.round(4 * scale)}px;`;
        driversTitleLabel.style = `${fontCss}color: ${textColor}; opacity: 0.65; font-size: ${smallFont}px; font-weight: 700;`;
        afterRoundLabel.text = state.afterRound > 0 ? `After round ${state.afterRound}` : '';
        afterRoundLabel.style = `${fontCss}color: ${textColor}; opacity: 0.65; font-size: ${smallFont}px;`;

        // Top 5 versenyző
        standingsList.destroy_all_children();
        const top5 = state.drivers.slice(0, 5);
        const leaderPts = top5.length > 0 ? top5[0].points : 0;

        top5.forEach((d, idx) => {
            if (idx > 0) {
                const rowSep = new St.Widget({
                    x_expand: true,
                    height: 1,
                    style: `background-color: ${dividerColor}; height: 1px; margin-left: ${Math.round(28 * scale)}px;`,
                });
                standingsList.add_child(rowSep);
            }

            const row = new St.BoxLayout({
                orientation: Clutter.Orientation.HORIZONTAL,
                x_expand: true,
                y_expand: true,
                y_align: Clutter.ActorAlign.CENTER,
            });

            const posLbl = new St.Label({
                text: String(d.position),
                y_align: Clutter.ActorAlign.CENTER,
                style: `${fontCss}color: ${textColor}; opacity: 0.65; font-size: ${medFont}px; font-weight: 600; min-width: ${Math.round(16 * scale)}px; text-align: right;`,
            });

            const teamBar = new St.Widget({
                y_align: Clutter.ActorAlign.CENTER,
                width: Math.max(3, Math.round(3 * scale)),
                height: Math.round(13 * scale),
                style: `background-color: ${getTeamColor(d.team)}; border-radius: 2px; margin-left: ${Math.round(6 * scale)}px; margin-right: ${Math.round(7 * scale)}px;`,
            });

            const codeLbl = new St.Label({
                text: d.code,
                y_align: Clutter.ActorAlign.CENTER,
                style: `${fontCss}color: ${textColor}; font-size: ${medFont}px; font-weight: 700; min-width: ${Math.round(38 * scale)}px;`,
            });

            const familyLbl = new St.Label({
                text: d.family,
                x_expand: true,
                y_align: Clutter.ActorAlign.CENTER,
                style: `${fontCss}color: ${textColor}; opacity: 0.7; font-size: ${medFont}px;`,
            });
            familyLbl.clutter_text.set_ellipsize(3);

            const ptsLbl = new St.Label({
                text: String(d.points),
                y_align: Clutter.ActorAlign.CENTER,
                style: `${fontCss}color: ${textColor}; font-size: ${medFont}px; font-weight: 600; min-width: ${Math.round(32 * scale)}px; text-align: right;`,
            });

            const gapVal = idx === 0 ? '' : `−${Number((leaderPts - d.points).toFixed(1))}`;
            const gapLbl = new St.Label({
                text: gapVal,
                y_align: Clutter.ActorAlign.CENTER,
                style: `${fontCss}color: ${textColor}; opacity: 0.6; font-size: ${medFont}px; min-width: ${Math.round(40 * scale)}px; text-align: right;`,
            });

            row.add_child(posLbl);
            row.add_child(teamBar);
            row.add_child(codeLbl);
            row.add_child(familyLbl);
            row.add_child(ptsLbl);
            row.add_child(gapLbl);
            standingsList.add_child(row);
        });
    }

    async function refreshData() {
        if (isDisposed || isFetching || isActorDestroyed(container)) return;
        isFetching = true;

        try {
            const res = await fetchF1HubData(cancellable, state.track, state.trackFor);
            if (isDisposed || cancellable.is_cancelled() || isActorDestroyed(container)) return;

            state.weekend = res.weekend;
            state.afterRound = res.standings.afterRound;
            state.drivers = res.standings.drivers;
            state.track = res.track;
            state.trackFor = res.trackFor;
            state.status = null;
            renderUI();
        } catch (e) {
            if (!isDisposed && !cancellable.is_cancelled()) {
                state.status = 'Offline';
                renderUI();
            }
        } finally {
            isFetching = false;
        }
    }

    // Dinamikus visszaszámláló frissítés (1 órán belül másodpercenként, egyébként 15 mp-enként)
    let tickTimeoutId = 0;
    function scheduleTick() {
        if (isDisposed) return;
        const now = new Date();
        const nextSess = getNextSession(state.weekend, now);
        let delayMs = 15000;

        if (nextSess && nextSess.start.getTime() > now.getTime()) {
            const diff = nextSess.start.getTime() - now.getTime();
            if (diff < 3600000) {
                delayMs = (diff % 1000) + 20;
            }
        }

        tickTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delayMs, () => {
            tickTimeoutId = 0;
            if (isDisposed || isActorDestroyed(container)) return GLib.SOURCE_REMOVE;
            renderUI();
            scheduleTick();
            return GLib.SOURCE_REMOVE;
        });
    }

    // API adatok frissítése 15 percenként
    const fetchTimeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 15 * 60, () => {
        if (isDisposed) return GLib.SOURCE_REMOVE;
        refreshData();
        return GLib.SOURCE_CONTINUE;
    });

    registerWidgetCleanup(container, () => {
        isDisposed = true;
        if (cancellable) {
            cancellable.cancel();
            cancellable = null;
        }
        clearF1Session();
        if (tickTimeoutId) {
            GLib.source_remove(tickTimeoutId);
            tickTimeoutId = 0;
        }
        if (fetchTimeoutId) {
            GLib.source_remove(fetchTimeoutId);
        }
    });

    renderUI();
    scheduleTick();
    refreshData();

    attachResponsiveScaler(container, BASE_CONTAINER_WIDTH_PX, BASE_CONTAINER_HEIGHT_PX, (_ratio, w, h) => {
        if (isActorDestroyed(container)) return;
        scale = Math.max(0.65, Math.min(w / BASE_CONTAINER_WIDTH_PX, h / BASE_CONTAINER_HEIGHT_PX));
        renderUI();
    });

    return container;
}