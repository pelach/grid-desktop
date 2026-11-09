import St from 'gi://St';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import Soup from 'gi://Soup?version=3.0';

import { 
    resolveExplicitFontFamily, 
    resolveWidgetForegroundColor 
} from '../../utils/widgetUtils.js';
import { createWidgetContainer, attachResponsiveScaler, attachButtonFeedback } from '../../shell/widgetUIUtils.js';
import { isActorDestroyed } from '../../utils/actorLifecycle.js';

const BASE_CONTAINER_WIDTH_PX = 200;
const BASE_CONTAINER_HEIGHT_PX = 400;

export function createSteamRecentNode(config, width, height, xPosition, yPosition) {
    const textColor = resolveWidgetForegroundColor(config);
    const fontFamily = resolveExplicitFontFamily(config);
    const fontCss = fontFamily ? `font-family: ${fontFamily}; ` : '';
    const container = createWidgetContainer(config, width, height, xPosition, yPosition);

    let scale = Math.max(0.65, Math.min(width / BASE_CONTAINER_WIDTH_PX, height / BASE_CONTAINER_HEIGHT_PX));

    const mainBox = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
    });
    container.add_child(mainBox);

    // ── 1. Fejléc: Steam Recent ──
    const headerRow = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        y_align: Clutter.ActorAlign.CENTER,
        x_expand: true,
    });
    mainBox.add_child(headerRow);

    const headerIcon = new St.Icon({
        icon_name: 'applications-games-symbolic',
        style: `color: ${textColor};`,
        y_align: Clutter.ActorAlign.CENTER,
    });
    headerRow.add_child(headerIcon);

    const titleLabel = new St.Label({
        text: 'Steam Recent',
        y_align: Clutter.ActorAlign.CENTER,
    });
    titleLabel.clutter_text.ellipsize = 0;
    headerRow.add_child(titleLabel);

    // ── 2. Függőleges oszlop a fekvő bannereknek ──
    const cardsCol = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_align: Clutter.ActorAlign.FILL,
        y_align: Clutter.ActorAlign.CENTER,
        x_expand: true,
        y_expand: true,
    });
    mainBox.add_child(cardsCol);

    const statusLabel = new St.Label({
        text: 'Loading games...',
        style: `${fontCss}color: ${textColor}; opacity: 0.6;`,
        y_align: Clutter.ActorAlign.CENTER,
        x_align: Clutter.ActorAlign.CENTER,
        x_expand: true,
        y_expand: true,
    });
    cardsCol.add_child(statusLabel);

    let currentContainerWidth = width;

    function getCardDimensions() {
        const pad = Math.max(8, Math.round(10 * scale));
        const cardWidth = Math.max(120, Math.round(currentContainerWidth - (pad * 2)));
        const cardHeight = Math.round(cardWidth * (215 / 460));
        const borderRadius = Math.round(8 * scale);

        return { cardWidth, cardHeight, borderRadius };
    }

    function updateCardSizes() {
        const { cardWidth, cardHeight, borderRadius } = getCardDimensions();

        const children = cardsCol.get_children();
        for (const child of children) {
            if (child instanceof St.Button) {
                child.set_size(cardWidth, cardHeight);
                child.width = cardWidth;
                child.height = cardHeight;
                const currentBg = child.style.match(/background-image:[^;]+;/);
                const bgRule = currentBg ? currentBg[0] : '';
                child.style = `width: ${cardWidth}px; ` +
                              `height: ${cardHeight}px; ` +
                              `border-radius: ${borderRadius}px; ` +
                              `${bgRule} ` +
                              `background-size: cover; ` +
                              `background-position: center; ` +
                              `border: 1px solid rgba(255, 255, 255, 0.1);`;
            }
        }
    }

    function createBannerButton(appId, imagePath) {
        const { cardWidth, cardHeight, borderRadius } = getCardDimensions();
        const fileUrl = imagePath.startsWith('/') ? `file://${imagePath}` : imagePath;

        const btn = new St.Button({
            reactive: true,
            can_focus: true,
            track_hover: true,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
            width: cardWidth,
            height: cardHeight,
            style: `width: ${cardWidth}px; ` +
                   `height: ${cardHeight}px; ` +
                   `border-radius: ${borderRadius}px; ` +
                   `background-image: url("${fileUrl}"); ` +
                   `background-size: cover; ` +
                   `background-position: center; ` +
                   `border: 1px solid rgba(255, 255, 255, 0.1);`,
        });
        attachButtonFeedback(btn);

        btn.connect('clicked', () => {
            try {
                Gio.AppInfo.launch_default_for_uri(`steam://run/${appId}`, null);
            } catch (err) {
                logError(err, 'Failed to launch Steam game');
            }
        });

        return btn;
    }

    async function downloadFileAsync(session, url, targetFilePath) {
        return new Promise((resolve) => {
            const targetFile = Gio.File.new_for_path(targetFilePath);
            if (targetFile.query_exists(null)) {
                return resolve(true);
            }

            try {
                const message = Soup.Message.new('GET', url);
                message.request_headers.append('User-Agent', 'Mozilla/5.0');

                session.send_and_read_async(message, GLib.PRIORITY_LOW, null, (s, res) => {
                    try {
                        const bytes = s.send_and_read_finish(res);
                        if (message.status_code === 200 && bytes && bytes.get_size() > 500) {
                            targetFile.replace_contents(
                                bytes.get_data(),
                                null,
                                false,
                                Gio.FileCreateFlags.REPLACE_DESTINATION,
                                null
                            );
                            resolve(true);
                            return;
                        }
                    } catch {}
                    resolve(false);
                });
            } catch {
                resolve(false);
            }
        });
    }

    async function fetchRecentGames() {
        const rawId = (config.steamId || '').trim();
        if (!rawId) {
            statusLabel.text = 'No Steam ID configured';
            return;
        }

        const isNumeric = /^[0-9]+$/.test(rawId);
        const profileUrl = isNumeric
            ? `https://steamcommunity.com/profiles/${rawId}/`
            : `https://steamcommunity.com/id/${rawId}/`;

        const cacheDir = GLib.build_filenamev([GLib.get_user_cache_dir(), 'grid-desktop', 'steam']);
        GLib.mkdir_with_parents(cacheDir, 0o755);

        try {
            const session = new Soup.Session();
            const message = Soup.Message.new('GET', profileUrl);
            message.request_headers.append('User-Agent', 'Mozilla/5.0');

            session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null, async (s, res) => {
                if (isActorDestroyed(container)) return;

                try {
                    const bytes = s.send_and_read_finish(res);
                    if (message.status_code !== 200 || !bytes) {
                        statusLabel.text = 'Failed to load profile';
                        return;
                    }

                    const html = new TextDecoder('utf-8').decode(bytes.get_data());
                    const matches = [...html.matchAll(/steam\/apps\/([0-9]+)/g)];
                    const appIds = [...new Set(matches.map(m => m[1]))].slice(0, 4);

                    if (appIds.length === 0) {
                        statusLabel.text = 'No recent games found';
                        return;
                    }

                    const loadedBanners = [];

                    for (const id of appIds) {
                        const imgPath = GLib.build_filenamev([cacheDir, `${id}_header.jpg`]);
                        const urlHeader = `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${id}/header.jpg`;
                        
                        let ok = await downloadFileAsync(session, urlHeader, imgPath);
                        if (!ok) {
                            const urlCapsule = `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${id}/capsule_184x69.jpg`;
                            ok = await downloadFileAsync(session, urlCapsule, imgPath);
                        }

                        if (ok && GLib.file_test(imgPath, GLib.FileTest.EXISTS)) {
                            loadedBanners.push({ id, imgPath });
                        }
                    }

                    if (isActorDestroyed(container)) return;

                    if (loadedBanners.length === 0) {
                        statusLabel.text = 'Could not load banners';
                        return;
                    }

                    cardsCol.destroy_all_children();
                    for (const item of loadedBanners) {
                        const bannerBtn = createBannerButton(item.id, item.imgPath);
                        cardsCol.add_child(bannerBtn);
                    }

                    updateCardSizes();
                } catch {
                    if (!isActorDestroyed(container)) {
                        statusLabel.text = 'Error fetching games';
                    }
                }
            });
        } catch {
            statusLabel.text = 'Failed to initialize request';
        }
    }

    function applyScale(newScale, actualWidth) {
        scale = newScale;
        if (actualWidth) {
            currentContainerWidth = actualWidth;
        }

        const pad = Math.max(8, Math.round(10 * scale));
        mainBox.style = `padding: ${pad}px;`;

        headerRow.style = `margin-bottom: ${Math.round(8 * scale)}px;`;
        headerIcon.icon_size = Math.round(16 * scale);
        headerIcon.style = `color: ${textColor}; margin-right: 6px;`;
        titleLabel.style = `${fontCss}font-size: ${Math.max(11, Math.round(13 * scale))}px; font-weight: bold; color: ${textColor}; opacity: 0.9;`;

        cardsCol.style = `spacing: ${Math.round(12 * scale)}px;`;
        updateCardSizes();
    }

    applyScale(scale, width);
    fetchRecentGames();

    attachResponsiveScaler(container, BASE_CONTAINER_WIDTH_PX, BASE_CONTAINER_HEIGHT_PX, (_ratio, w, h) => {
        if (isActorDestroyed(container)) return;
        applyScale(Math.max(0.65, Math.min(w / BASE_CONTAINER_WIDTH_PX, h / BASE_CONTAINER_HEIGHT_PX)), w);
    });

    return container;
}