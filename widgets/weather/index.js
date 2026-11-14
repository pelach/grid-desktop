import GLib from 'gi://GLib';
import { connectTimerCleanup, createWidgetContainer, registerWidgetCleanup } from '../../shell/widgetUIUtils.js';
import {
    REFRESH_INTERVAL_SECONDS,
    createBackgroundImageActor,
    createMainLayout,
    fetchWeatherViaOpenMeteo,
    getExtensionSettings,
    releaseWeatherSession,
    resolveWeatherLayoutVariant,
    updateWeatherUi,
} from './weatherCommon.js';
import { buildForecastLayout, attachForecastScaler } from './weatherForecast.js';
import { buildSimpleLayout, attachSimpleScaler } from './weatherSimple.js';
import { buildStandardLayout, attachStandardScaler } from './weatherStandard.js';
import { buildBarsLayout, attachBarsScaler } from './weatherBars.js';
import { isActorDestroyed } from '../../utils/actorLifecycle.js';
import { buildCardsLayout, attachCardsScaler } from './weatherCards.js';

export { createMoonNode } from './moon.js';
export { createSunScheduleNode } from './solarSchedule.js';

export function createWeatherNode(widgetData, width, height, xPosition, yPosition, isDynamicColor, isDynamicImage) {
    const extensionPath = widgetData.extensionPath || '';
    const widgetNode = createWidgetContainer(widgetData, width, height, xPosition, yPosition);

    const bgImageActor = createBackgroundImageActor(widgetNode);
    widgetNode.add_child(bgImageActor);

    const layout = createMainLayout(widgetNode);
    const layoutVariant = resolveWeatherLayoutVariant(widgetData);

    let uiElements;
    if (widgetData.type === 'weather_cards' || layoutVariant === 'cards') {
        uiElements = buildCardsLayout(layout, widgetData, extensionPath);
        attachCardsScaler(widgetNode, uiElements, widgetData);
    } else if (widgetData.type === 'weather_bars' || layoutVariant === 'bars') {
        uiElements = buildBarsLayout(layout, widgetData, extensionPath);
        attachBarsScaler(widgetNode, uiElements, widgetData);
    } else if (layoutVariant === 'forecast') {
        uiElements = buildForecastLayout(layout, widgetData, extensionPath);
        attachForecastScaler(widgetNode, uiElements, widgetData);
    } else if (layoutVariant === 'simple') {
        uiElements = buildSimpleLayout(layout, widgetData);
        attachSimpleScaler(widgetNode, uiElements, widgetData);
    } else {
        uiElements = buildStandardLayout(layout, widgetData, extensionPath);
        attachStandardScaler(widgetNode, uiElements, widgetData);
    }

    widgetNode.add_child(layout);

    const isCards = widgetData.type === 'weather_cards' || layoutVariant === 'cards';

    const context = {
        widgetData,
        uiElements,
        widgetNode,
        bgImageActor,
        isDynamicColor: isCards ? false : isDynamicColor,
        isDynamicImage: isCards ? false : isDynamicImage,
        extensionPath,
    };
    
    if (isCards) {
        bgImageActor.hide();
    }

    const triggerWeatherFetch = () => {
        if (isActorDestroyed(widgetNode)) return;
        fetchWeatherViaOpenMeteo(context);
    };

    triggerWeatherFetch();

    const extSettings = widgetData.settings || getExtensionSettings();
    if (extSettings) {
        const timeFormatSigId = extSettings.connect('changed::time-format-24h', () => {
            if (!isActorDestroyed(widgetNode) && context.lastWeatherJson) {
                updateWeatherUi(context.lastWeatherJson, context);
            }
        });
        registerWidgetCleanup(widgetNode, () => extSettings.disconnect(timeFormatSigId));
    }

    const state = { timerId: null };
    state.timerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, REFRESH_INTERVAL_SECONDS, () => {
        if (isActorDestroyed(widgetNode)) return GLib.SOURCE_REMOVE;
        triggerWeatherFetch();
        return GLib.SOURCE_CONTINUE;
    });

    connectTimerCleanup(widgetNode, state);
    registerWidgetCleanup(widgetNode, () => releaseWeatherSession(widgetNode));

    return widgetNode;
}