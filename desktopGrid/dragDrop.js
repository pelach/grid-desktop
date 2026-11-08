import Clutter from 'gi://Clutter';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {
    COLUMNS_COUNT,
    ROWS_COUNT,
    GRID_MARGIN_PX,
    GRID_GAP_PX,
    checkOverlap,
    calculateResizedDimensions,
    calculateGridDimensions,
    getWidgets,
    saveWidgets,
    deleteCacheFile,
    cssColorToRgba,
    resolveAccentColor,
} from '../utils/widgetUtils.js';
import { getWidgetsForMonitor, getPanelHeight, getEffectiveMonitorIndex } from './helpers.js';
import { registerWidgetCleanup } from '../shell/widgetUIUtils.js';
import { openWidgetContextMenu } from './contextMenu.js';
import {
    BUTTON_PRIMARY,
    BUTTON_SECONDARY,
    DRAG_MOTION_THRESHOLD_PX,
} from './constants.js';

/** Segédfüggvény a célterület előnézeti keretének (Drop Placeholder) kezelésére */
function updateDropPlaceholder(grid, targetCol, targetRow, colSpan, rowSpan, isValid, key = 'single') {
    if (!grid._dropPlaceholders)
        grid._dropPlaceholders = new Map();

    let placeholder = grid._dropPlaceholders.get(key);
    if (!placeholder) {
        placeholder = new St.Widget({
            name: 'dropPlaceholder',
            reactive: false
        });
        grid.add_child(placeholder);
        grid._dropPlaceholders.set(key, placeholder);
    }

    const cellSize = grid.cellSize || (grid.cellTotalWidth - GRID_GAP_PX);
    const columnGap = Math.max(0, grid.cellTotalWidth - cellSize);
    const rowGap = Math.max(0, grid.cellTotalHeight - cellSize);
    const margin = grid.gridMargin ?? GRID_MARGIN_PX;

    const width = Math.max(1, Math.round((colSpan * cellSize) + ((colSpan - 1) * columnGap)));
    const height = Math.max(1, Math.round((rowSpan * cellSize) + ((rowSpan - 1) * rowGap)));
    const x = Math.max(0, Math.round(margin + (targetCol * grid.cellTotalWidth)));
    const y = Math.max(0, Math.round(margin + (targetRow * grid.cellTotalHeight)));

    placeholder.set_size(width, height);
    placeholder.set_position(x, y);

    const accentColor = resolveAccentColor(grid.settings, grid.interfaceSettings);
    
    // Zöld/Kék ha szabad, Piros ha ütközik
    if (isValid) {
        placeholder.set_style(`
            background-color: ${cssColorToRgba(accentColor, 0.4)};
            border: 2px dashed ${accentColor};
            border-radius: 12px;
        `);
    } else {
        placeholder.set_style(`
            background-color: rgba(224, 27, 36, 0.25);
            border: 2px dashed #e01b24;
            border-radius: 12px;
        `);
    }
    placeholder.show();
}

function removeDropPlaceholder(grid) {
    if (grid._dropPlaceholders) {
        for (const placeholder of grid._dropPlaceholders.values())
            placeholder.destroy();
        grid._dropPlaceholders.clear();
    }
}

function resolveWidgetMonitor(grid, currentMonitor) {
    if (currentMonitor) return currentMonitor;

    const globalMonitor = grid.settings.get_string('global-monitor') || 'primary';
    
    // Ha a beállításokban egy konkrét monitor van kiválasztva ('primary' vagy szám)
    if (globalMonitor !== 'each' && globalMonitor !== 'all') {
        return globalMonitor;
    }

    // Ha 'each' módban vagyunk, a grid aktuális monitor indexét rendeljük hozzá:
    const primaryIdx = global.display ? global.display.get_primary_monitor() : 0;
    if (grid.targetMonitorIndex === null || grid.targetMonitorIndex === primaryIdx) {
        return 'primary';
    }

    return String(grid.targetMonitorIndex);
}

function endDrag(state, grid, node, widgetData) {
    if (state.dragMotionId) { global.stage.disconnect(state.dragMotionId); state.dragMotionId = 0; }
    if (state.dragReleaseId) { global.stage.disconnect(state.dragReleaseId); state.dragReleaseId = 0; }
    
    removeDropPlaceholder(grid);

    if (!state.isDragging)
        return;
    state.isDragging = false;
    if (state.groupItems?.length > 1) {
        endGroupDrag(state, grid);
        return;
    }

    const widgets = getWidgets(grid.settings).map(widget => {
        if (!widget.monitor)
            widget.monitor = resolveWidgetMonitor(grid, widget.monitor);
        return widget;
    });
    const targetWidget = widgets.find(widget => widget.id === widgetData.id);
    if (!targetWidget)
        return;

    const monitorSetting = grid.settings.get_string('global-monitor') || 'primary';
    const monitors = Main.layoutManager.monitors || [];
    const widgetStageX = grid.x + node.x;
    const widgetStageY = grid.y + node.y;
    const widgetCenterX = widgetStageX + node.width / 2;
    const widgetCenterY = widgetStageY + node.height / 2;
    let targetMonitorIndex = null;
    let targetMonitor = null;

    if (monitorSetting === 'each' && monitors.length > 1) {
        for (let i = 0; i < monitors.length; i++) {
            const monitor = monitors[i];
            if (widgetCenterX >= monitor.x && widgetCenterX < monitor.x + monitor.width &&
                widgetCenterY >= monitor.y && widgetCenterY < monitor.y + monitor.height) {
                targetMonitorIndex = i;
                targetMonitor = monitor;
                break;
            }
        }
    }

    if (targetMonitorIndex !== null && targetMonitor) {
        const primaryMonitor = Main.layoutManager.primaryMonitor;
        const isPrimary = primaryMonitor ? targetMonitor === primaryMonitor : targetMonitorIndex === 0;
        const topOffset = isPrimary ? getPanelHeight() : 0;
        const localX = widgetStageX - targetMonitor.x;
        const localY = widgetStageY - (targetMonitor.y + topOffset);
        const targetWidgets = getWidgetsForMonitor(widgets, targetMonitorIndex, true);
        const otherWidgets = targetWidgets.filter(widget => widget.id !== widgetData.id);
        const gridCols = grid.gridCols || COLUMNS_COUNT;
        const { cellTotalWidth, cellTotalHeight, gridRows } = calculateGridDimensions(
            targetMonitor.width,
            targetMonitor.height - topOffset,
            gridCols
        );
        const targetCol = Math.max(0, Math.min(gridCols - targetWidget.width, Math.round((localX - GRID_MARGIN_PX) / cellTotalWidth)));
        const targetRow = Math.max(0, Math.min(gridRows - targetWidget.height, Math.round((localY - GRID_MARGIN_PX) / cellTotalHeight)));

        if (!checkOverlap(targetCol, targetRow, targetWidget.width, targetWidget.height, otherWidgets)) {
            targetWidget.x = targetCol;
            targetWidget.y = targetRow;
            targetWidget.monitor = isPrimary ? 'primary' : String(targetMonitorIndex);
            const movedNode = grid.widgetNodes.get(targetWidget.id);
            if (movedNode) {
                movedNode.destroy();
                grid.widgetNodes.delete(targetWidget.id);
                grid._nodeConfigs.delete(targetWidget.id);
            }
            grid.applyLocalWidgetLayout(widgets);
        } else {
            grid._repositionNode(targetWidget.id, targetWidget.width, targetWidget.height, state.origGridX, state.origGridY);
        }
    } else {
        const activeWidgets = getWidgetsForMonitor(widgets, grid.targetMonitorIndex, true);
        const allOccupiedWidgets = [...activeWidgets];
        if (Array.isArray(grid._desktopIconWidgets)) {
            for (const icon of grid._desktopIconWidgets) {
                if (!allOccupiedWidgets.some(widget => widget.id === icon.id))
                    allOccupiedWidgets.push(icon);
            }
        }
        const otherWidgets = allOccupiedWidgets.filter(widget => widget.id !== widgetData.id);
        const gridCols = grid.gridCols || COLUMNS_COUNT;
        const targetCol = Math.max(0, Math.min(gridCols - targetWidget.width, Math.round((node.x - GRID_MARGIN_PX) / grid.cellTotalWidth)));
        const targetRow = Math.max(0, Math.min((grid.gridRows || ROWS_COUNT) - targetWidget.height, Math.round((node.y - GRID_MARGIN_PX) / grid.cellTotalHeight)));

        if (!checkOverlap(targetCol, targetRow, targetWidget.width, targetWidget.height, otherWidgets)) {
            targetWidget.x = targetCol;
            targetWidget.y = targetRow;
            grid.applyLocalWidgetLayout(widgets);
            grid._repositionNode(targetWidget.id, targetWidget.width, targetWidget.height, targetCol, targetRow);
        } else {
            grid._repositionNode(targetWidget.id, targetWidget.width, targetWidget.height, state.origGridX, state.origGridY);
        }
    }
    grid._syncSelectionIndicators();
}

function endGroupDrag(state, grid) {
    const items = state.groupItems;
    const deltaCols = Math.round((items[0].node.x - items[0].startX) / grid.cellTotalWidth);
    const deltaRows = Math.round((items[0].node.y - items[0].startY) / grid.cellTotalHeight);
    const widgets = getWidgets(grid.settings).map(widget => {
        if (!widget.monitor)
            widget.monitor = resolveWidgetMonitor(grid, widget.monitor);
        return widget;
    });
    const itemIds = new Set(items.map(item => item.widgetData.id));
    const targets = items.map(item => widgets.find(widget => widget.id === item.widgetData.id));
    const gridCols = grid.gridCols || COLUMNS_COUNT;
    const gridRows = grid.gridRows || ROWS_COUNT;
    const activeWidgets = getWidgetsForMonitor(widgets, grid.targetMonitorIndex, true);
    const occupiedWidgets = [...activeWidgets];
    if (Array.isArray(grid._desktopIconWidgets)) {
        for (const icon of grid._desktopIconWidgets) {
            if (!occupiedWidgets.some(widget => widget.id === icon.id))
                occupiedWidgets.push(icon);
        }
    }

    let valid = targets.every(Boolean);
    const outsideGroup = occupiedWidgets.filter(widget => !itemIds.has(widget.id));
    const placedTargets = [];
    if (valid) {
        for (const target of targets) {
            const x = target.x + deltaCols;
            const y = target.y + deltaRows;
            if (x < 0 || y < 0 || x + target.width > gridCols || y + target.height > gridRows ||
                checkOverlap(x, y, target.width, target.height, [...outsideGroup, ...placedTargets])) {
                valid = false;
                break;
            }
            target.x = x;
            target.y = y;
            placedTargets.push(target);
        }
    }

    if (valid) {
        grid.applyLocalWidgetLayout(widgets);
        for (const target of targets)
            grid._repositionNode(target.id, target.width, target.height, target.x, target.y);
    } else {
        for (const item of items)
            grid._repositionNode(item.widgetData.id, item.widgetData.width, item.widgetData.height, item.widgetData.x, item.widgetData.y);
    }
    grid._syncSelectionIndicators();
}

function getActiveDrag(grid) {
    if (!grid._activeDrag) grid._activeDrag = null;
    return grid._activeDrag;
}

function setActiveDrag(grid, value) {
    grid._activeDrag = value;
}

function updateGroupDropPlaceholders(grid, state, dx, dy) {
    const deltaCols = Math.round(dx / grid.cellTotalWidth);
    const deltaRows = Math.round(dy / grid.cellTotalHeight);
    const gridCols = grid.gridCols || COLUMNS_COUNT;
    const gridRows = grid.gridRows || ROWS_COUNT;
    const widgets = getWidgets(grid.settings).map(widget => {
        if (!widget.monitor)
            widget.monitor = resolveWidgetMonitor(grid, widget.monitor);
        return widget;
    });
    const groupIds = new Set(state.groupItems.map(item => item.widgetData.id));
    const occupiedWidgets = getWidgetsForMonitor(widgets, grid.targetMonitorIndex, true);
    if (Array.isArray(grid._desktopIconWidgets)) {
        for (const icon of grid._desktopIconWidgets) {
            if (!occupiedWidgets.some(widget => widget.id === icon.id))
                occupiedWidgets.push(icon);
        }
    }

    const outsideGroup = occupiedWidgets.filter(widget => !groupIds.has(widget.id));
    const placedTargets = [];
    const targets = state.groupItems.map(item => ({
        widgetData: item.widgetData,
        x: item.widgetData.x + deltaCols,
        y: item.widgetData.y + deltaRows,
    }));
    let isValid = true;

    for (const target of targets) {
        const { width, height } = target.widgetData;
        if (target.x < 0 || target.y < 0 || target.x + width > gridCols || target.y + height > gridRows ||
            checkOverlap(target.x, target.y, width, height, [...outsideGroup, ...placedTargets])) {
            isValid = false;
            break;
        }
        placedTargets.push({ ...target.widgetData, x: target.x, y: target.y });
    }

    for (const target of targets) {
        const { width, height } = target.widgetData;
        const visibleCol = Math.max(0, Math.min(gridCols - width, target.x));
        const visibleRow = Math.max(0, Math.min(gridRows - height, target.y));
        updateDropPlaceholder(
            grid,
            visibleCol,
            visibleRow,
            width,
            height,
            isValid,
            target.widgetData.id
        );
    }
}

function cancelInterruptedDrag(grid) {
    const activeDrag = getActiveDrag(grid);
    if (!activeDrag) return;
    const { state, node, widgetData } = activeDrag;
    setActiveDrag(grid, null);
    endDrag(state, grid, node, widgetData);
}

export function attachDragHandlers(grid, node, widgetData) {
    let pressX = 0;
    let pressY = 0;
    const state = { isDragging: false, dragMotionId: 0, dragReleaseId: 0, startX: 0, startY: 0, origGridX: 0, origGridY: 0, groupItems: null };

    const finishDrag = () => {
        const currentDrag = getActiveDrag(grid);
        if (currentDrag && currentDrag.state === state) setActiveDrag(grid, null);
        endDrag(state, grid, node, widgetData);
    };

    node.connect('button-press-event', (_actor, event) => {
        if (event.get_button() === BUTTON_SECONDARY) {
            openWidgetContextMenu(grid, event, node, widgetData);
            return Clutter.EVENT_STOP;
        }

        if (event.get_button() === BUTTON_PRIMARY) {
            cancelInterruptedDrag(grid);

            const selection = grid._selectedWidgetIds || new Set();
            if (!selection.has(widgetData.id) && selection.size > 0)
                grid._clearWidgetSelection();

            [pressX, pressY] = event.get_coords();
            state.startX = node.x;
            state.startY = node.y;
            state.origGridX = widgetData.x;
            state.origGridY = widgetData.y;
            if (selection.has(widgetData.id) && selection.size > 1) {
                state.groupItems = [...selection].map(id => {
                    const selectedNode = grid.widgetNodes.get(id);
                    const selectedData = selectedNode?.widgetData;
                    return selectedNode && selectedData ? {
                        node: selectedNode,
                        widgetData: selectedData,
                        startX: selectedNode.x,
                        startY: selectedNode.y,
                    } : null;
                }).filter(Boolean);
            } else {
                state.groupItems = null;
            }

            if (state.dragMotionId) { global.stage.disconnect(state.dragMotionId); state.dragMotionId = 0; }
            if (state.dragReleaseId) { global.stage.disconnect(state.dragReleaseId); state.dragReleaseId = 0; }

            state.dragMotionId = global.stage.connect('motion-event', (_stage, ev) => {
                const evState = ev.get_state();
                if (!(evState & Clutter.ModifierType.BUTTON1_MASK)) {
                    finishDrag();
                    return Clutter.EVENT_PROPAGATE;
                }

                const [curX, curY] = ev.get_coords();
                const dx = curX - pressX;
                const dy = curY - pressY;

                if (!state.isDragging && (Math.abs(dx) > DRAG_MOTION_THRESHOLD_PX || Math.abs(dy) > DRAG_MOTION_THRESHOLD_PX)) {
                    state.isDragging = true;
                    //grid.constructor.toggleAllGridOverlays(true);
                }

                if (state.isDragging) {
                    if (state.groupItems?.length > 1) {
                        for (const item of state.groupItems)
                            item.node.set_position(item.startX + dx, item.startY + dy);
                        grid._syncSelectionIndicators();
                        updateGroupDropPlaceholders(grid, state, dx, dy);
                        return Clutter.EVENT_STOP;
                    }

                    const newPosX = state.startX + dx;
                    const newPosY = state.startY + dy;
                    node.set_position(newPosX, newPosY);

                    // Drop Target Placeholder frissítése a rácson
                    const gridCols = grid.gridCols || COLUMNS_COUNT;
                    const gridRows = grid.gridRows || ROWS_COUNT;
                    const targetCol = Math.max(0, Math.min(gridCols - widgetData.width, Math.round((newPosX - GRID_MARGIN_PX) / grid.cellTotalWidth)));
                    const targetRow = Math.max(0, Math.min(gridRows - widgetData.height, Math.round((newPosY - GRID_MARGIN_PX) / grid.cellTotalHeight)));

                    const widgets = getWidgets(grid.settings).map(w => {
                        if (!w.monitor) {
                            w.monitor = resolveWidgetMonitor(grid, w.monitor);
                        }
                        return w;
                    });

                    const activeWidgets = getWidgetsForMonitor(widgets, grid.targetMonitorIndex, true);
                    const otherWidgets = activeWidgets.filter(w => w.id !== widgetData.id);
                    const isValid = !checkOverlap(targetCol, targetRow, widgetData.width, widgetData.height, otherWidgets);

                    updateDropPlaceholder(grid, targetCol, targetRow, widgetData.width, widgetData.height, isValid);

                    return Clutter.EVENT_STOP;
                }
                return Clutter.EVENT_PROPAGATE;
            });

            state.dragReleaseId = global.stage.connect('button-release-event', (_stage, ev) => {
                if (ev.get_button() === BUTTON_PRIMARY) {
                    finishDrag();
                }
                return Clutter.EVENT_PROPAGATE;
            });

            setActiveDrag(grid, { state, grid, node, widgetData });
        }
        return Clutter.EVENT_PROPAGATE;
    });

    registerWidgetCleanup(node, () => {
        const currentDrag = getActiveDrag(grid);
        if (currentDrag && currentDrag.state === state) setActiveDrag(grid, null);
        cancelInterruptedDragForState(state);
        removeDropPlaceholder(grid);
    });
}

function cancelInterruptedDragForState(state) {
    if (state.dragMotionId) { global.stage.disconnect(state.dragMotionId); state.dragMotionId = 0; }
    if (state.dragReleaseId) { global.stage.disconnect(state.dragReleaseId); state.dragReleaseId = 0; }
}

export function onWidgetResized(grid, widgetId, newCols, newRows, newX) {
    const allWidgets = getWidgets(grid.settings);
    const monitorMode = grid.settings.get_string('global-monitor') || 'primary';
    const isEachMode = (monitorMode === 'each');
    const activeWidgets = getWidgetsForMonitor(allWidgets, getEffectiveMonitorIndex(grid.targetMonitorIndex, grid.settings), isEachMode);
    const widget = activeWidgets.find(activeWidget => activeWidget.id === widgetId);
    if (!widget) return;

    const otherWidgets = activeWidgets.filter(activeWidget => activeWidget.id !== widgetId);
    const gridCols = grid.gridCols || COLUMNS_COUNT;
    const gridRows = grid.gridRows || ROWS_COUNT;
    const { validCols, validRows, validX } = calculateResizedDimensions(widget, newCols, newRows, newX, otherWidgets, gridCols, gridRows);

    if (!checkOverlap(validX, widget.y, validCols, validRows, otherWidgets)) {
        const targetWidget = allWidgets.find(existingWidget => existingWidget.id === widgetId);
        if (targetWidget) {
            targetWidget.width = validCols;
            targetWidget.height = validRows;
            targetWidget.x = validX;
            grid.applyLocalWidgetLayout(allWidgets);
            grid._repositionNode(widgetId, validCols, validRows, validX, widget.y);
            grid._syncSelectionIndicators();
        }
    }
}

export function onWidgetDeleted(grid, widgetId) {
    const widgets = getWidgets(grid.settings);
    const targetWidget = widgets.find(widget => widget.id === widgetId);
    if (targetWidget) {
        if (targetWidget.type === 'notes') {
            deleteCacheFile('notes', widgetId);
        } else if (targetWidget.type === 'clipboard') {
            deleteCacheFile('clipboard', widgetId);
        } else if (targetWidget.type === 'todo') {
            deleteCacheFile('todos', widgetId);
        } else if (targetWidget.type === 'github') {
            deleteCacheFile('github', widgetId);
        }
    }
    const remainingWidgets = widgets.filter(widget => widget.id !== widgetId);
    saveWidgets(grid.settings, remainingWidgets);
}