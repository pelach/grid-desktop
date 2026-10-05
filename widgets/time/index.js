import { createDigitalTimeNode } from './timeDigital.js';
import { createWorldTimeNode } from './timeWorld.js';
import { createAnalogTimeNode } from './timeAnalog.js';
import { createTimerNode } from './timerWidget.js';
import { createCountdownNode } from './countdownWidget.js';

export {
    createDigitalTimeNode,
    createWorldTimeNode,
    createAnalogTimeNode,
    createTimerNode,
    createCountdownNode,
};

export function createTimeNode(widgetData, width, height, xPosition, yPosition) {
    if (widgetData.layout === 'analog' || widgetData.type === 'analogClock') {
        return createAnalogTimeNode(widgetData, width, height, xPosition, yPosition);
    }
    if (widgetData.layout === 'world' || widgetData.type === 'worldClock') {
        return createWorldTimeNode(widgetData, width, height, xPosition, yPosition);
    }
    if (widgetData.layout === 'timer') {
        return createTimerNode(widgetData, width, height, xPosition, yPosition);
    }
    if (widgetData.layout === 'countdown') {
        return createCountdownNode(widgetData, width, height, xPosition, yPosition);
    }
    return createDigitalTimeNode(widgetData, width, height, xPosition, yPosition);
}
