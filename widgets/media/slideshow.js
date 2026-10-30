import St from 'gi://St';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import { createAnimatedImageNode } from './gif.js';
import { listImagesInFolder, attachCaptionOverlay } from './mediaCommon.js';
import { resolveWidgetBackgroundColor, resolveWidgetForegroundColor, resolveExplicitFontFamily, buildBaseWidgetStyle } from '../../utils/widgetUtils.js';
import { WidgetActor, connectTimerCleanup, resolveWidgetGlassHighlight } from '../../shell/widgetUIUtils.js';
import { isActorDestroyed, watchActorLifecycle } from '../../utils/actorLifecycle.js';


const DEFAULT_SLIDE_INTERVAL_SECONDS = 10;
const MILLISECONDS_PER_SECOND = 1000;
const CROSSFADE_DURATION_MS = 800;
const CLUTTER_OPACITY_OPAQUE = 255;
const CLUTTER_OPACITY_TRANSPARENT = 0;
function createImageLayer(imagePath, borderRadius, width, height, animateGif) {
    if (imagePath.toLowerCase().endsWith('.gif')) {
        const gifWidget = createAnimatedImageNode({
            imagePath: imagePath,
            appliedBorderRadius: borderRadius
        }, width, height, 0, 0, animateGif);

        gifWidget.x_expand = true;
        gifWidget.y_expand = true;
        gifWidget.x_align = Clutter.ActorAlign.FILL;
        gifWidget.y_align = Clutter.ActorAlign.FILL;
        gifWidget.opacity = CLUTTER_OPACITY_OPAQUE;
        return gifWidget;
    }

    return new St.Widget({
        style: `
            background-image: url("file://${imagePath}");
            background-size: cover;
            border-radius: ${borderRadius}px;
        `,
        x_expand: true,
        y_expand: true,
        x_align: Clutter.ActorAlign.FILL,
        y_align: Clutter.ActorAlign.FILL,
        opacity: CLUTTER_OPACITY_OPAQUE,
    });
}

export function createSlideshowNode(widgetData, width, height, xPosition, yPosition) {
    const glassHighlight = resolveWidgetGlassHighlight(widgetData);
    const baseStyle = buildBaseWidgetStyle(widgetData);
    const borderRadius = widgetData.appliedBorderRadius || 0;
    const slideInterval = (widgetData.intervalSeconds || DEFAULT_SLIDE_INTERVAL_SECONDS) * MILLISECONDS_PER_SECOND;
    const folderPath = widgetData.slideshowFolder || '';
    const backgroundColor = resolveWidgetBackgroundColor(widgetData);

    const container = new WidgetActor({
        style: `background-color: ${backgroundColor}; ${baseStyle} ${glassHighlight}`,
        x: xPosition,
        y: yPosition,
        width: width,
        height: height,
        reactive: true,
        layout_manager: new Clutter.BinLayout(),
    });
    container.set_clip_to_allocation(true);
    watchActorLifecycle(container);

    const state = {
        timerId: null,
    };

    const fontFamily = resolveExplicitFontFamily(widgetData);
    const fontCss = fontFamily ? `font-family: ${fontFamily}; ` : '';
    const textColor = resolveWidgetForegroundColor(widgetData);
    const placeholderLabel = new St.Label({
        text: 'Loading images\u2026',
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
        x_expand: true,
        y_expand: true,
        style: `${fontCss}color: ${textColor}; font-size: 14px; opacity: 0.6;`,
    });
    container.add_child(placeholderLabel);

    listImagesInFolder(folderPath).then((images) => {
        if (isActorDestroyed(container)) return;

        if (images.length === 0) {
            placeholderLabel.text = 'No images found in folder';
            return;
        }

        container.remove_child(placeholderLabel);
        placeholderLabel.destroy();

        const imageContainer = new St.Widget({
            x_expand: true,
            y_expand: true,
            layout_manager: new Clutter.BinLayout(),
        });
        container.add_child(imageContainer);

        const shouldAnimateGif = widgetData.animateGif !== undefined ? widgetData.animateGif : (widgetData.globalAnimateGif !== false);

        let currentIndex = 0;
        let currentLayer = watchActorLifecycle(createImageLayer(images[0], borderRadius, width, height, shouldAnimateGif));
        imageContainer.add_child(currentLayer);

        const transitionType = widgetData.transitionType || 'crossfade';

        const advanceSlide = () => {
            if (isActorDestroyed(container) || images.length <= 1) return;

            currentIndex = (currentIndex + 1) % images.length;
            const nextImage = images[currentIndex];

            const incomingLayer = watchActorLifecycle(createImageLayer(nextImage, borderRadius, width, height, shouldAnimateGif));
            const outgoingLayer = currentLayer;
            currentLayer = incomingLayer;

            imageContainer.add_child(incomingLayer);

            switch (transitionType) {
                case 'slide_horizontal':
                    incomingLayer.set_translation(width, 0, 0);
                    incomingLayer.set_opacity(CLUTTER_OPACITY_OPAQUE);

                    incomingLayer.ease({
                        translation_x: 0,
                        duration: CROSSFADE_DURATION_MS,
                        mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
                    });

                    outgoingLayer.ease({
                        translation_x: -width,
                        duration: CROSSFADE_DURATION_MS,
                        mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
                        onComplete: () => {
                            if (outgoingLayer && !isActorDestroyed(outgoingLayer))
                                outgoingLayer.destroy();
                        }
                    });
                    break;

                case 'slide_vertical':
                    incomingLayer.set_translation(0, height, 0);
                    incomingLayer.set_opacity(CLUTTER_OPACITY_OPAQUE);

                    incomingLayer.ease({
                        translation_y: 0,
                        duration: CROSSFADE_DURATION_MS,
                        mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
                    });

                    outgoingLayer.ease({
                        translation_y: -height,
                        duration: CROSSFADE_DURATION_MS,
                        mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
                        onComplete: () => {
                            if (outgoingLayer && !isActorDestroyed(outgoingLayer))
                                outgoingLayer.destroy();
                        }
                    });
                    break;

                case 'zoom_in':
                    incomingLayer.set_pivot_point(0.5, 0.5);
                    incomingLayer.set_scale(1.15, 1.15);
                    incomingLayer.set_opacity(CLUTTER_OPACITY_TRANSPARENT);

                    incomingLayer.ease({
                        scale_x: 1.0,
                        scale_y: 1.0,
                        opacity: CLUTTER_OPACITY_OPAQUE,
                        duration: CROSSFADE_DURATION_MS,
                        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                    });

                    outgoingLayer.ease({
                        opacity: CLUTTER_OPACITY_TRANSPARENT,
                        duration: CROSSFADE_DURATION_MS,
                        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                        onComplete: () => {
                            if (outgoingLayer && !isActorDestroyed(outgoingLayer))
                                outgoingLayer.destroy();
                        }
                    });
                    break;

                case 'crossfade':
                default:
                    incomingLayer.set_opacity(CLUTTER_OPACITY_TRANSPARENT);

                    incomingLayer.ease({
                        opacity: CLUTTER_OPACITY_OPAQUE,
                        duration: CROSSFADE_DURATION_MS,
                        mode: Clutter.AnimationMode.EASE_IN_OUT_QUAD,
                    });

                    outgoingLayer.ease({
                        opacity: CLUTTER_OPACITY_TRANSPARENT,
                        duration: CROSSFADE_DURATION_MS,
                        mode: Clutter.AnimationMode.EASE_IN_OUT_QUAD,
                        onComplete: () => {
                            if (outgoingLayer && !isActorDestroyed(outgoingLayer))
                                outgoingLayer.destroy();
                        }
                    });
                    break;
            }
        };

        const validInterval = Math.max(1000, Math.floor(slideInterval));
        state.timerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, validInterval, () => {
            if (isActorDestroyed(container)) return GLib.SOURCE_REMOVE;
            advanceSlide();
            return GLib.SOURCE_CONTINUE;
        });

        connectTimerCleanup(container, state);
        attachCaptionOverlay(container, widgetData, width, height);
    });

    return container;
}
