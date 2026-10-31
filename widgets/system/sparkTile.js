import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import { cssColorToRgba } from '../../utils/widgetUtils.js';

export const BASE_CONTAINER_WIDTH = 400;
export const BASE_CONTAINER_HEIGHT = 200;
export const TILE_GAP_PX = 10;
export const TILE_MARGIN_PX = 10;

const LABEL_FONT_SIZE_PX = 12;
const TILE_PADDING_BASE_PX = 12;
const TILE_RADIUS_BASE_PX = 12;
const TILE_BG_ALPHA = 0.06;
const TILE_BORDER_ALPHA = 0.08;

export function createSparklineTile({
    labelText,
    unitText,
    lineColor,
    lineOpacity,
    unitOpacity,
    fontCss,
    textColor,
    scale,
    rowSpacingPx = 4,
    drawSamples,
}) {
    const tilePadding = Math.max(8, Math.round(TILE_PADDING_BASE_PX * scale));
    const tileRadius = Math.max(8, Math.round(TILE_RADIUS_BASE_PX * scale));
    const valueFontSize = Math.max(26, Math.round(44 * scale)); // Testes, jól látható számok!
    const labelFontSize = Math.max(10, Math.round(LABEL_FONT_SIZE_PX * scale));
    const unitFontSize = Math.max(11, Math.round(valueFontSize * 0.38));

    const tile = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
        y_expand: true,
        style: `background-color: ${cssColorToRgba(textColor, TILE_BG_ALPHA)};`
            + `border: 1px solid ${cssColorToRgba(textColor, TILE_BORDER_ALPHA)};`
            + `border-radius: ${tileRadius}px;`
            + `padding: ${tilePadding}px;`,
    });

    // Felső rész: érték + mértékegység
    const valueRow = new St.BoxLayout({
        orientation: Clutter.Orientation.HORIZONTAL,
        x_align: Clutter.ActorAlign.START,
        y_align: Clutter.ActorAlign.END,
    });

    const valueLabel = new St.Label({
        text: '0',
        style: `${fontCss}color: ${textColor}; font-size: ${valueFontSize}px; font-weight: 300; line-height: 1.0;`,
    });
    valueLabel.clutter_text.set_ellipsize(Pango.EllipsizeMode.NONE);

    const unitLabel = new St.Label({
        text: unitText,
        y_align: Clutter.ActorAlign.END,
        style: `${fontCss}color: ${textColor}; opacity: ${unitOpacity}; `
            + `font-size: ${unitFontSize}px; font-weight: 400; line-height: 1.1; `
            + `margin-left: ${Math.round(4 * scale)}px; margin-bottom: ${Math.round(4 * scale)}px;`,
    });
    unitLabel.clutter_text.set_ellipsize(Pango.EllipsizeMode.NONE);

    valueRow.add_child(valueLabel);
    valueRow.add_child(unitLabel);
    tile.add_child(valueRow);

    // Felirat (CPU / Memory / Download / Upload)
    const nameLabel = new St.Label({
        text: labelText,
        style: `${fontCss}color: ${textColor}; font-size: ${labelFontSize}px; opacity: ${unitOpacity}; margin-top: 2px; font-weight: 500;`,
    });
    tile.add_child(nameLabel);

    // Rugalmas térköz, hogy a chart leüljön az aljára
    tile.add_child(new St.Widget({ y_expand: true }));

    // Alsó diagram: arányos fix magasság a túlnyúlás ellen
    const sparkHeight = Math.max(30, Math.round(50 * scale));
    const sparkArea = new St.DrawingArea({
        x_expand: true,
        height: sparkHeight,
    });

    tile.add_child(sparkArea);

    const samples = [];

    sparkArea.connect('repaint', (area) => {
        const context = area.get_context();
        const [surfaceWidth, surfaceHeight] = area.get_surface_size();
        drawSamples(context, surfaceWidth, surfaceHeight, samples, lineColor, lineOpacity);
        context.$dispose();
    });

    return { tile, valueLabel, unitLabel, sparkArea, samples };
}

export function createTilesRow(tiles, gapPx, marginPx) {
    const tilesBox = new St.Widget({
        layout_manager: new Clutter.BoxLayout({
            orientation: Clutter.Orientation.HORIZONTAL,
            spacing: gapPx,
        }),
        x_expand: true,
        y_expand: true,
        style: `margin: ${marginPx}px;`,
    });
    for (const child of tiles)
        tilesBox.add_child(child);
    return tilesBox;
}