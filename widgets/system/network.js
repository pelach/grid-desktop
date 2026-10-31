import {
    resolveWidgetForegroundColor,
    resolveExplicitFontFamily,
    parseCssColor,
    SECONDARY_OPACITY,
} from '../../utils/widgetUtils.js';
import { createWidgetContainer, registerWidgetCleanup, drawSparkline, attachResponsiveScaler, SPARK_SAMPLE_CAPACITY } from '../../shell/widgetUIUtils.js';
import { networkEngine } from '../../utils/systemMonitorEngine.js';
import { createSparklineTile, createTilesRow, BASE_CONTAINER_WIDTH, BASE_CONTAINER_HEIGHT, TILE_GAP_PX, TILE_MARGIN_PX } from './sparkTile.js';
import { isActorDestroyed } from '../../utils/actorLifecycle.js';

const SPARK_BASELINE_BYTES = 1024;
const NETWORK_TILE_ROW_SPACING_PX = 4;

export function formatBytesPerSecond(bytesPerSec) {
    const bytes = Math.max(0, bytesPerSec);
    if (bytes < 1000) {
        return `${Math.round(bytes)} B/s`;
    }
    const kb = bytes / 1024;
    if (kb < 100) {
        return `${kb.toFixed(1)} KB/s`;
    }
    if (kb < 1000) {
        return `${Math.round(kb)} KB/s`;
    }
    const mb = kb / 1024;
    return `${mb.toFixed(1)} MB/s`;
}

export function createNetworkSpeedNode(config, width, height, xPosition, yPosition) {
    const textColor = resolveWidgetForegroundColor(config);
    const fontFamily = resolveExplicitFontFamily(config);
    const fontCss = fontFamily ? `font-family: ${fontFamily}; ` : '';
    const accentRgb = parseCssColor(config.globalAccentColor || '#3584e4');
    const textRgb = parseCssColor(textColor);
    const container = createWidgetContainer(config, width, height, xPosition, yPosition);

    let scale = Math.max(0.65, Math.min(width / BASE_CONTAINER_WIDTH, height / BASE_CONTAINER_HEIGHT));

    const drawSpeedSparkline = (context, surfaceWidth, surfaceHeight, samples, lineColor, lineOpacity) => {
        const peak = Math.max(SPARK_BASELINE_BYTES, ...samples);
        drawSparkline(context, surfaceWidth, surfaceHeight, samples, peak,
            lineColor.r, lineColor.g, lineColor.b, lineOpacity);
    };

    let downloadTile = null;
    let uploadTile = null;
    let tilesRow = null;

    function buildTiles() {
        if (tilesRow) {
            container.remove_child(tilesRow);
            tilesRow.destroy();
        }

        downloadTile = createSparklineTile({
            labelText: 'Download',
            unitText: 'B/s',
            lineColor: accentRgb,
            lineOpacity: 1.0,
            unitOpacity: SECONDARY_OPACITY,
            fontCss,
            textColor,
            scale,
            rowSpacingPx: NETWORK_TILE_ROW_SPACING_PX,
            drawSamples: drawSpeedSparkline,
        });

        uploadTile = createSparklineTile({
            labelText: 'Upload',
            unitText: 'B/s',
            lineColor: textRgb,
            lineOpacity: SECONDARY_OPACITY,
            unitOpacity: SECONDARY_OPACITY,
            fontCss,
            textColor,
            scale,
            rowSpacingPx: NETWORK_TILE_ROW_SPACING_PX,
            drawSamples: drawSpeedSparkline,
        });

        tilesRow = createTilesRow(
            [downloadTile.tile, uploadTile.tile],
            Math.max(1, Math.round(TILE_GAP_PX * scale)),
            Math.max(1, Math.round(TILE_MARGIN_PX * scale))
        );
        container.add_child(tilesRow);
    }

    buildTiles();

    const onDataUpdate = (data) => {
        if (isActorDestroyed(container) || !downloadTile || !uploadTile) return;

        for (const [tile, bytesPerSec] of [[downloadTile, data.downloadSpeed], [uploadTile, data.uploadSpeed]]) {
            const [value, unit] = formatBytesPerSecond(bytesPerSec).split(' ');
            tile.valueLabel.set_text(value);
            tile.unitLabel.set_text(unit);
            tile.samples.push(bytesPerSec);
            if (tile.samples.length > SPARK_SAMPLE_CAPACITY)
                tile.samples.shift();
            tile.sparkArea.queue_repaint();
        }
    };

    const releaseEngine = networkEngine.subscribe(onDataUpdate);
    registerWidgetCleanup(container, releaseEngine);

    attachResponsiveScaler(container, BASE_CONTAINER_WIDTH, BASE_CONTAINER_HEIGHT, (_ratio, w, h) => {
        if (isActorDestroyed(container)) return;
        scale = Math.max(0.65, Math.min(w / BASE_CONTAINER_WIDTH, h / BASE_CONTAINER_HEIGHT));
        buildTiles();
    });

    return container;
}