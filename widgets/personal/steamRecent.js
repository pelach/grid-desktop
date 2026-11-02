import St from 'gi://St';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
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
        // A widget teljes belső hasznos szélessége a paddingok levonásával:
        const cardWidth = Math.max(120, Math.round(currentContainerWidth - (pad * 2)));
        // Steam header pontos 460 x 215 aránya:
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
                // Megtartjuk az eredeti háttérképet, csak a méreteket frissítjük átméretezéskor:
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

        // St CSS-hez kötelező a file:// URI séma:
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
                   `border: 1px solid rgba(255, 255, 255, 0.1);`
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

    function fetchRecentGames() {
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

        // Max 3-4 játék bannere az álló dobozba
        const bashCmd = `
CACHE="\$1"; URL="\$2";
APPIDS=\$(curl -s -L -A "Mozilla/5.0" "\$URL" | grep -oE "steam/apps/[0-9]+" | cut -d"/" -f3 | sort -u | head -n 4);

for id in \$APPIDS; do
  IMG="\$CACHE/\${id}_header.jpg";
  if [ ! -s "\$IMG" ]; then
    curl -s -L "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/\${id}/header.jpg" -o "\$IMG"
    if ! file "\$IMG" | grep -qi "JPEG"; then
      curl -s -L "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/\${id}/capsule_184x69.jpg" -o "\$IMG"
    fi
  fi
  if [ -s "\$IMG" ] && file "\$IMG" | grep -qi "JPEG"; then
    echo "\${id}:\${IMG}"
  fi
done
`;

        try {
            const proc = new Gio.Subprocess({
                argv: ['bash', '-c', bashCmd, 'bash', cacheDir, profileUrl],
                flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
            });
            proc.init(null);

            proc.communicate_utf8_async(null, null, (source, res) => {
                try {
                    const [ok, stdout, stderr] = source.communicate_utf8_finish(res);
                    if (isActorDestroyed(container)) return;

                    const lines = (stdout || '').trim().split('\n').filter(Boolean);
                    if (lines.length === 0) {
                        statusLabel.text = 'No recent games found';
                        return;
                    }

                    cardsCol.destroy_all_children();

                    for (const line of lines) {
                        const [appId, imgPath] = line.split(':');
                        if (appId && imgPath && GLib.file_test(imgPath, GLib.FileTest.EXISTS)) {
                            const bannerBtn = createBannerButton(appId, imgPath);
                            cardsCol.add_child(bannerBtn);
                        }
                    }

                    updateCardSizes();
                } catch (e) {
                    if (!isActorDestroyed(container)) {
                        statusLabel.text = 'Error fetching games';
                    }
                }
            });
        } catch (e) {
            statusLabel.text = 'Failed to start fetcher';
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