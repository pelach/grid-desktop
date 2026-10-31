import St from 'gi://St';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import Pango from 'gi://Pango';
import { 
    cssColorToRgba, 
    resolveExplicitFontFamily, 
    resolveWidgetBackgroundColor, 
    resolveWidgetForegroundColor 
} from '../../utils/widgetUtils.js';
import { 
    createWidgetContainer, 
    registerWidgetCleanup, 
    attachResponsiveScaler, 
    connectTimerCleanup 
} from '../../shell/widgetUIUtils.js';
import { subscribeToFeed } from '../../utils/rssEngine.js';
import { isActorDestroyed } from '../../utils/actorLifecycle.js';

const BASE_CONTAINER_WIDTH_PX = 200;
const BASE_CONTAINER_HEIGHT_PX = 200;

const ARTICLE_TITLE_MAX_CHARS = 160;
const SOURCE_NAME_MAX_CHARS = 30;

const ROTATE_INTERVAL_SECONDS = 15;
const FADE_DURATION_MS = 150;
const MAX_VISIBLE_DOTS = 5;
const MIN_REFRESH_MINUTES = 5;
const DEFAULT_REFRESH_MINUTES = 15;

function clampText(text, maxChars) {
    if (!text) return '';
    return text.length <= maxChars ? text : `${text.slice(0, Math.max(1, maxChars - 1)).trimEnd()}…`;
}

function sourceNameFromUrl(feedUrl) {
    try {
        const host = new URL(feedUrl).hostname.replace(/^www\./, '');
        return clampText(host, SOURCE_NAME_MAX_CHARS);
    } catch (_urlErr) {
        return 'Feed';
    }
}

function relativeTimeFromIso(dateIso) {
    const publishedMs = dateIso ? Date.parse(dateIso) : NaN;
    if (isNaN(publishedMs)) return '';
    const deltaMinutes = Math.max(0, Math.floor((Date.now() - publishedMs) / 60000));
    if (deltaMinutes < 1) return 'Just now';
    if (deltaMinutes < 60) return `${deltaMinutes}m ago`;
    const hours = Math.floor(deltaMinutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
}

export function createRssHeadlinesNode(config, width, height, xPosition, yPosition) {
    const textColor = resolveWidgetForegroundColor(config);
    const fontFamily = resolveExplicitFontFamily(config);
    const fontCss = fontFamily ? `font-family: ${fontFamily}; ` : '';
    const container = createWidgetContainer(config, width, height, xPosition, yPosition);

    const hasFeed = typeof config.feedUrl === 'string' && config.feedUrl.startsWith('http');
    const refreshIntervalSeconds = Math.max(MIN_REFRESH_MINUTES, config.refreshMinutes || DEFAULT_REFRESH_MINUTES) * 60;

    const state = { timerId: null, releaseFeed: null };
    let articles = [];
    let currentIndex = 0;
    let dotWidgets = [];
    let scale = Math.max(0.65, Math.min(width / BASE_CONTAINER_WIDTH_PX, height / BASE_CONTAINER_HEIGHT_PX));

    const mainLayout = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
    });
    container.add_child(mainLayout);

    // ── 1. Fejléc ──
    const headerBox = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_expand: true,
        y_align: Clutter.ActorAlign.CENTER,
    });

    const headerIcon = new St.Icon({
        icon_name: 'feed-subscribe-symbolic',
        y_align: Clutter.ActorAlign.CENTER,
    });

    const sourceLabel = new St.Label({
        text: 'Feed',
        x_expand: true,
        y_align: Clutter.ActorAlign.CENTER,
    });
    sourceLabel.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
    
    headerBox.add_child(headerIcon);
    headerBox.add_child(sourceLabel);
    mainLayout.add_child(headerBox);

    // ── 2. Törzs: Kattintható hír cím doboz (nincs scroll) ──
    const bodyBox = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
        reactive: true,
        can_focus: true,
        track_hover: true,
    });
    mainLayout.add_child(bodyBox);

    const articleTitle = new St.Label({
        text: '',
        x_expand: true,
        y_align: Clutter.ActorAlign.CENTER,
    });
    articleTitle.clutter_text.line_wrap = true;
    articleTitle.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
    articleTitle.clutter_text.ellipsize = Pango.EllipsizeMode.END;
    bodyBox.add_child(articleTitle);

    // Kattintásra külső link megnyitása
    bodyBox.connect('button-press-event', () => {
        if (articles.length === 0) return Clutter.EVENT_PROPAGATE;
        const currentArticle = articles[currentIndex % articles.length];
        const link = currentArticle?.link || currentArticle?.url;
        if (link) {
            try {
                Gio.AppInfo.launch_default_for_uri(link, null);
            } catch (err) {
                console.error('Failed to open feed URL:', err);
            }
        }
        return Clutter.EVENT_STOP;
    });

    // ── 3. Lábléc: Időbélyeg + Lapozó pöttyök ──
    const footerBox = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_expand: true,
        y_align: Clutter.ActorAlign.CENTER,
    });

    const timeLabel = new St.Label({
        text: '',
        x_expand: true,
        y_align: Clutter.ActorAlign.CENTER,
    });

    const dotsRow = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        y_align: Clutter.ActorAlign.CENTER,
    });

    footerBox.add_child(timeLabel);
    footerBox.add_child(dotsRow);
    mainLayout.add_child(footerBox);

    function renderDots() {
        dotsRow.destroy_all_children();
        dotWidgets = [];
        const visibleCount = Math.min(articles.length, MAX_VISIBLE_DOTS);
        for (let index = 0; index < visibleCount; index++) {
            const dot = new St.Button({
                reactive: true,
                can_focus: true,
                y_align: Clutter.ActorAlign.CENTER,
            });
            dot.connect('clicked', () => {
                currentIndex = index;
                applyArticle();
                restartRotationTimer();
            });
            dotsRow.add_child(dot);
            dotWidgets.push(dot);
        }
        updateActiveDot();
    }

    function updateActiveDot() {
        if (!dotWidgets.length) return;
        const activeIndex = currentIndex % MAX_VISIBLE_DOTS;
        dotWidgets.forEach((dot, index) => {
            if (isActorDestroyed(container)) return;
            const isActive = index === activeIndex;
            dot.style = `width: ${isActive ? Math.round(10 * scale) : Math.round(4 * scale)}px; `
                + `height: ${Math.round(4 * scale)}px; border-radius: ${Math.round(2 * scale)}px; `
                + `background-color: ${textColor}; margin: 0 ${Math.round(2 * scale)}px; `
                + `opacity: ${isActive ? 1 : 0.27};`;
        });
    }

    function applyArticle() {
        if (!hasFeed) {
            sourceLabel.text = 'Feed';
            articleTitle.text = 'No feed configured';
            timeLabel.text = '';
            renderDots();
            return;
        }
        if (articles.length === 0) {
            articleTitle.text = 'Waiting for updates…';
            timeLabel.text = '';
            renderDots();
            return;
        }
        const article = articles[currentIndex % articles.length];
        articleTitle.text = clampText(article.title, ARTICLE_TITLE_MAX_CHARS);
        timeLabel.text = relativeTimeFromIso(article.dateIso);

        const visibleCount = Math.min(articles.length, MAX_VISIBLE_DOTS);
        if (visibleCount !== dotWidgets.length) {
            renderDots();
        } else {
            updateActiveDot();
        }
    }

    function rotateArticle(step) {
        if (articles.length === 0 || isActorDestroyed(container)) return;
        currentIndex = ((currentIndex + step) % articles.length + articles.length) % articles.length;
        applyArticle();
        if (!bodyBox.mapped) return;
        bodyBox.opacity = 0;
        bodyBox.ease({
            opacity: 255,
            duration: FADE_DURATION_MS,
            mode: Clutter.AnimationMode.EASE_IN_QUAD,
        });
    }

    function restartRotationTimer() {
        if (state.timerId) {
            GLib.source_remove(state.timerId);
            state.timerId = null;
        }
        state.timerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, ROTATE_INTERVAL_SECONDS, () => {
            if (isActorDestroyed(container)) return GLib.SOURCE_REMOVE;
            rotateArticle(1);
            return GLib.SOURCE_CONTINUE;
        });
    }

    connectTimerCleanup(container, state);
    registerWidgetCleanup(container, () => {
        if (state.releaseFeed) state.releaseFeed();
        state.releaseFeed = null;
    });

    if (hasFeed && !state.releaseFeed) {
        sourceLabel.text = sourceNameFromUrl(config.feedUrl);
        state.releaseFeed = subscribeToFeed(config.feedUrl, refreshIntervalSeconds, (items) => {
            if (isActorDestroyed(container)) return;
            articles = Array.isArray(items) ? items : [];
            currentIndex = 0;
            applyArticle();
        });
    }

    restartRotationTimer();

    // ── Reszponzív skálázás (200x200 bázis) ──
    function applyLayout(currentWidth, currentHeight) {
        if (!currentWidth || !currentHeight) return;
        scale = Math.max(0.65, Math.min(currentWidth / BASE_CONTAINER_WIDTH_PX, currentHeight / BASE_CONTAINER_HEIGHT_PX));

        const pad = Math.max(8, Math.round(10 * scale));
        const iconSize = Math.round(14 * scale);
        const titleFontSize = Math.max(10, Math.round(12 * scale));
        const articleTitleSize = Math.max(12, Math.round(14.5 * scale));
        const footerFontSize = Math.max(8, Math.round(9 * scale));

        mainLayout.style = `padding: ${pad}px; spacing: ${Math.round(4 * scale)}px;`;

        headerBox.style = `margin-bottom: ${Math.round(4 * scale)}px;`;
        headerIcon.icon_size = iconSize;
        headerIcon.style = `color: ${textColor}; margin-right: 5px; opacity: 0.85;`;
        sourceLabel.style = `${fontCss}color: ${textColor}; font-size: ${titleFontSize}px; font-weight: bold; letter-spacing: 0.5px; opacity: 0.9;`;

        bodyBox.style = `padding: 0px 2px;`;
        articleTitle.style = `${fontCss}color: ${textColor}; font-size: ${articleTitleSize}px; line-height: 1.3;`;

        footerBox.style = `margin-top: ${Math.round(2 * scale)}px;`;
        timeLabel.style = `${fontCss}color: ${textColor}; font-size: ${footerFontSize}px; opacity: 0.45;`;

        updateActiveDot();
        applyArticle();
    }

    applyLayout(width, height);
    attachResponsiveScaler(container, BASE_CONTAINER_WIDTH_PX, BASE_CONTAINER_HEIGHT_PX, (_ratio, w, h) => {
        if (isActorDestroyed(container)) return;
        applyLayout(w, h);
    });

    return container;
}