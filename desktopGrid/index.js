import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {
    COLUMNS_COUNT,
    ROWS_COUNT,
    GRID_MARGIN_PX,
    checkOverlap,
    findEmptySpot,
    getWidgets,
    saveWidgets,
    serializeWidgets,
    resolveWidgetOverrides,
    readGlobalSettings,
    calculateGridDimensions,
    parseCssColor,
    cssColorToRgba,
    resolveAccentColor,
    resolveWidgetSizePreset,
    deleteCacheFile,
} from '../utils/widgetUtils.js';
import {
    DEFAULT_STAGE_WIDTH,
    DEFAULT_STAGE_HEIGHT,
    BUTTON_PRIMARY,
    BUTTON_SECONDARY,
} from './constants.js';
import {
    getWidgetsForMonitor,
    getPanelHeight,
    getTargetMonitor,
    getEffectiveMonitorIndex,
} from './helpers.js';
import { createGridOverlay } from './gridRenderer.js';
import { createWidgetNode } from './widgetFactory.js';
import { attachDragHandlers } from './dragDrop.js';
import {
    openContextMenu,
    removeContextMenu,
    previewWithSushi,
    trashFile,
    openMultiSelectionContextMenu,
} from './contextMenu.js';
import { isActorDestroyed, watchActorLifecycle } from '../utils/actorLifecycle.js';
import { resolveWeatherLayoutVariant } from '../widgets/weather/weatherCommon.js';

import { syncDesktopIcons, monitorDesktop, stopMonitor } from '../utils/desktopIcons.js';


const GRID_LINE_ALPHA = 0.45;
const EDIT_OVERLAY_ALPHA = 0.45;

export const DesktopGrid = GObject.registerClass(
    class DesktopGrid extends St.Widget {
        _init(extensionPath, settings, metadata, targetMonitorIndex = null, interfaceSettings = null) {
            super._init({
                name: 'desktopGrid',
                reactive: true,
                x: 0,
                y: 0,
                width: DEFAULT_STAGE_WIDTH,
                height: DEFAULT_STAGE_HEIGHT,
            });

            this.extensionPath = extensionPath;
            this.settings = settings;
            this.metadata = metadata;

            let desktopMonitorIdleId = 0;
            monitorDesktop(this.settings, () => {
                if (desktopMonitorIdleId) {
                    GLib.Source.remove(desktopMonitorIdleId);
                }
                desktopMonitorIdleId = GLib.timeout_add(GLib.PRIORITY_DEFAULT_IDLE, 100, () => {
                    desktopMonitorIdleId = 0;
                    if (!isActorDestroyed(this)) {
                        this._applyWidgetChanges();
                    }
                    return GLib.SOURCE_REMOVE;
                });
            });

            this._ownInterfaceSettings = !interfaceSettings;
            this.interfaceSettings = interfaceSettings || Gio.Settings.new('org.gnome.desktop.interface');
            this.targetMonitorIndex = targetMonitorIndex;
            this.signalIds = [];
            this.widgetNodes = new Map();
            this._nodeConfigs = new Map();
            this._gridLineCanvas = null;
            this.editOverlayCanvases = [];
            this.contextMenu = null;
            this._menuManager = null;
            this._lastAppliedWidgetsJson = null;
            this._selectedWidgetIds = new Set();
            this._selectionIndicators = new Map();
            this._selectionDrag = null;
            this._pendingDesktopOpenId = 0;
            this._lastClickTime = 0;

            if (!DesktopGrid._activeInstances) {
                DesktopGrid._activeInstances = new Set();
            }
            DesktopGrid._activeInstances.add(this);

            this._setupSettingsListeners();
            this._rebuildGrid();

            this.can_focus = true;

            this._keyPressId = this.connect('key-press-event', (_actor, event) => {
                const symbol = event.get_key_symbol();

                // DELETE: Egyedi vagy csoportos törlés biztonsági szűréssel
                if (symbol === Clutter.KEY_Delete || symbol === Clutter.KEY_KP_Delete) {
                    if (this._selectedWidgetIds && this._selectedWidgetIds.size > 0) {
                        this._deleteSelectedWidgets();
                        return Clutter.EVENT_STOP;
                    }
                }

                if (symbol === Clutter.KEY_space) {
                    const selection = this._selectedWidgetIds;
                    
                    // Csak akkor indítjuk, ha pontosan 1 widget van kijelölve
                    if (selection && selection.size === 1) {
                        const selectedId = [...selection][0];
                        const node = this.widgetNodes.get(selectedId);
                        const widgetData = node?.widgetData;

                        if (widgetData && widgetData.isDesktopIcon) {
                            const uri = widgetData.uri || '';
                            const isDesktop = uri.endsWith('.desktop');

                            if (uri && !isDesktop && !widgetData.isSpecial) {
                                previewWithSushi(uri);
                                return Clutter.EVENT_STOP;
                            }
                        }
                    }
                }
                if (symbol === Clutter.KEY_Escape) {
                    this._clearWidgetSelection();
                    return Clutter.EVENT_STOP;
                }
                return Clutter.EVENT_PROPAGATE;
            });
            
            this._backgroundPressId = this.connect('button-press-event', (_actor, event) => {
                const btn = event.get_button();

                if (btn === BUTTON_SECONDARY) {
                    if (this._selectedWidgetIds && this._selectedWidgetIds.size > 1) {
                        openMultiSelectionContextMenu(this, event);
                    } else {
                        openContextMenu(this, event);
                    }
                    return Clutter.EVENT_STOP;
                }

                if (btn === BUTTON_PRIMARY) {
                    global.stage.set_key_focus(this);
                    removeContextMenu(this);

                    const [clickX, clickY] = event.get_coords();

                    let clickedOnWidget = false;
                    for (const [, node] of this.widgetNodes) {
                        if (!node || node.is_finalized?.()) continue;

                        const box = node.get_transformed_extents();
                        const x1 = box.get_x();
                        const y1 = box.get_y();
                        const x2 = x1 + box.get_width();
                        const y2 = y1 + box.get_height();

                        if (clickX >= x1 && clickX <= x2 && clickY >= y1 && clickY <= y2) {
                            clickedOnWidget = true;
                            break;
                        }
                    }

                    if (clickedOnWidget) {
                        return Clutter.EVENT_PROPAGATE;
                    }

                    this._clearWidgetSelection();
                    
                    const now = event.get_time();
                    if (now - this._lastClickTime < 400) {
                        this._lastClickTime = 0; 
                        this._pendingDesktopOpenId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 400, () => {
                            this._pendingDesktopOpenId = 0;
                            try {
                                const desktopPath = GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_DESKTOP) || `${GLib.get_home_dir()}/Desktop`;
                                const file = Gio.File.new_for_path(desktopPath);
                                Gio.AppInfo.launch_default_for_uri(file.get_uri(), global.create_app_launch_context(0, -1));
                            } catch (e) {
                                console.error('Failed to open the desktop folder:', e);
                            }
                            return GLib.SOURCE_REMOVE;
                        });
                        this._startSelectionDrag(event);
                        return Clutter.EVENT_STOP;
                    }

                    this._lastClickTime = now;
                    this._startSelectionDrag(event);
                }
                return Clutter.EVENT_PROPAGATE;
            });
        }

        static toggleAllGridOverlays(show) {
            if (DesktopGrid._activeInstances) {
                DesktopGrid._activeInstances.forEach(grid => grid._toggleGridOverlay(show));
            }
        }

        destroy() {
            stopMonitor();
            if (this._contextMenuCloseIdleId) {
                GLib.Source.remove(this._contextMenuCloseIdleId);
                this._contextMenuCloseIdleId = null;
            }

            if (DesktopGrid._activeInstances) {
                DesktopGrid._activeInstances.delete(this);
            }

            if (this.signalIds && this.settings) {
                this.signalIds.forEach(id => this.settings.disconnect(id));
                this.signalIds = [];
            }

            this.interfaceSettings = null;

            removeContextMenu(this);

            if (this._backgroundPressId) {
                this.disconnect(this._backgroundPressId);
                this._backgroundPressId = 0;
            }
            this._cancelSelectionDrag();
            this._clearWidgetSelection();
            if (this._pendingDesktopOpenId) {
                GLib.Source.remove(this._pendingDesktopOpenId);
                this._pendingDesktopOpenId = 0;
            }

            this._menuManager = null;

            this.editOverlayCanvases.forEach(box => {
                if (!isActorDestroyed(box)) box.destroy();
            });
            this.editOverlayCanvases = [];

            if (this._gridLineCanvas) {
                if (!isActorDestroyed(this._gridLineCanvas)) {
                    this._gridLineCanvas.destroy();
                }
                this._gridLineCanvas = null;
            }

            this.widgetNodes.forEach(node => {
                if (!isActorDestroyed(node)) node.destroy();
            });
            this.widgetNodes.clear();
            this._nodeConfigs.clear();

            if (this._keyPressId) {
                this.disconnect(this._keyPressId);
                this._keyPressId = 0;
            }

            super.destroy();
        }

        _setupSettingsListeners() {
            const connectSetting = (key, callback) => {
                const id = this.settings.connect(`changed::${key}`, callback);
                this.signalIds.push(id);
            };

            connectSetting('show-desktop-icons', () => {
                if (this.settings.get_boolean('show-desktop-icons')) {
                    syncDesktopIcons(this.settings, true); // Bekapcsoláskor rendezze el
                }
                this._rebuildGrid();
            });

            connectSetting('desktop-icons-show-labels', () => {
                syncDesktopIcons(this.settings, false);
                this._rebuildGrid();
            });

            connectSetting('desktop-icons-side', () => {
                syncDesktopIcons(this.settings, true);
                this._rebuildGrid();
            });
            connectSetting('desktop-icons-direction', () => {
                syncDesktopIcons(this.settings, true);
                this._rebuildGrid();
            });

            connectSetting('desktop-icons-show-home', () => {
                syncDesktopIcons(this.settings, false);
                this._rebuildGrid();
            });
            connectSetting('desktop-icons-show-trash', () => {
                syncDesktopIcons(this.settings, false);
                this._rebuildGrid();
            });
            connectSetting('desktop-icons-show-mounts', () => {
                syncDesktopIcons(this.settings, false);
                this._rebuildGrid();
            });
            connectSetting('desktop-icons-show-networks', () => {
                syncDesktopIcons(this.settings, false);
                this._rebuildGrid();
            });

            connectSetting('widgets', () => {
                const widgetsJson = this.settings.get_string('widgets');
                if (widgetsJson === this._lastAppliedWidgetsJson)
                    return;
                this._applyWidgetChanges();
            });

            connectSetting('global-background-color', () => this._rebuildGrid());
            connectSetting('global-foreground-color', () => this._rebuildGrid());
            connectSetting('global-font-family', () => this._rebuildGrid());
            connectSetting('accent-color-override', () => this._rebuildGrid());
            connectSetting('accent-color-override-enabled', () => this._rebuildGrid());
            connectSetting('image-animate-gif', () => this._rebuildGrid());
            connectSetting('image-show-caption', () => this._rebuildGrid());
            connectSetting('slideshow-show-caption', () => this._rebuildGrid());
            connectSetting('weather-use-fahrenheit', () => this._rebuildGrid());
            connectSetting('weather-dynamic-color', () => this._rebuildGrid());
            connectSetting('weather-dynamic-image', () => this._rebuildGrid());
            connectSetting('grid-cell-size', () => this._rebuildGrid());
            connectSetting('grid-gap-size', () => this._rebuildGrid());
            connectSetting('show-grid', () => this._toggleGridLines());
        }

        _startSelectionDrag(event) {
            this._cancelSelectionDrag();
            const [stageX, stageY] = event.get_coords();
            const [gridX, gridY] = this.get_transformed_position();
            const startX = stageX - gridX;
            const startY = stageY - gridY;
            const accentColor = resolveAccentColor(this.settings, this.interfaceSettings);
            const selection = new St.Widget({
                name: 'widgetSelectionRectangle',
                reactive: false,
                style: `background-color: ${cssColorToRgba(accentColor, 0.22)}; border: 1px solid ${accentColor}; border-radius: 4px;`,
            });
            selection.hide();
            this.add_child(selection);

            const state = { startX, startY, endX: startX, endY: startY, selection, didDrag: false, motionId: 0, releaseId: 0 };
            const finish = () => this._finishSelectionDrag(state);
            state.motionId = global.stage.connect('motion-event', (_stage, motionEvent) => {
                if (!(motionEvent.get_state() & Clutter.ModifierType.BUTTON1_MASK)) {
                    finish();
                    return Clutter.EVENT_PROPAGATE;
                }

                const [x, y] = motionEvent.get_coords();
                state.endX = x - gridX;
                state.endY = y - gridY;
                const left = Math.min(startX, state.endX);
                const top = Math.min(startY, state.endY);
                const width = Math.abs(state.endX - startX);
                const height = Math.abs(state.endY - startY);
                if (!state.didDrag && (width > 3 || height > 3)) {
                    state.didDrag = true;
                    this._lastClickTime = 0;
                    if (this._pendingDesktopOpenId) {
                        GLib.Source.remove(this._pendingDesktopOpenId);
                        this._pendingDesktopOpenId = 0;
                    }
                }
                if (state.didDrag) {
                    selection.set_position(left, top);
                    selection.set_size(width, height);
                    selection.show();
                    return Clutter.EVENT_STOP;
                }
                return Clutter.EVENT_PROPAGATE;
            });
            state.releaseId = global.stage.connect('button-release-event', (_stage, releaseEvent) => {
                if (releaseEvent.get_button() === BUTTON_PRIMARY)
                    finish();
                return Clutter.EVENT_PROPAGATE;
            });
            this._selectionDrag = state;
        }

        _finishSelectionDrag(state) {
            if (this._selectionDrag !== state)
                return;
            this._cancelSelectionDrag();

            if (state.didDrag) {
                const left = Math.min(state.startX, state.endX);
                const top = Math.min(state.startY, state.endY);
                const right = Math.max(state.startX, state.endX);
                const bottom = Math.max(state.startY, state.endY);
                const allowAllSizes = this.settings.get_boolean('multi-select-all-widget-sizes');
                const selectedIds = [];

                for (const [widgetId, node] of this.widgetNodes) {
                    const widgetData = node.widgetData;
                    if (!allowAllSizes && (widgetData.width !== 1 || widgetData.height !== 1))
                        continue;
                    if (node.x >= left && node.x + node.width <= right &&
                        node.y >= top && node.y + node.height <= bottom)
                        selectedIds.push(widgetId);
                }
                this._setWidgetSelection(selectedIds);
            } else {
                this._clearWidgetSelection();
            }

            if (!isActorDestroyed(state.selection))
                state.selection.destroy();
            state.selection = null;
        }

        _cancelSelectionDrag() {
            const state = this._selectionDrag;
            if (!state)
                return;
            if (state.motionId) {
                global.stage.disconnect(state.motionId);
                state.motionId = 0;
            }
            if (state.releaseId) {
                global.stage.disconnect(state.releaseId);
                state.releaseId = 0;
            }
            if (state.selection && !isActorDestroyed(state.selection))
                state.selection.destroy();
            state.selection = null;
            this._selectionDrag = null;
        }

        _setWidgetSelection(widgetIds) {
            this._clearWidgetSelection();
            this._selectedWidgetIds = new Set(widgetIds);
            const accentColor = resolveAccentColor(this.settings, this.interfaceSettings);
            for (const widgetId of this._selectedWidgetIds) {
                const node = this.widgetNodes.get(widgetId);
                if (!node || isActorDestroyed(node))
                    continue;
                const indicator = new St.Widget({
                    name: 'selectedWidgetIndicator',
                    reactive: false,
                    style: `background-color: ${cssColorToRgba(accentColor, 0.08)}; border: 2px solid ${accentColor}; border-radius: 8px;`,
                });
                indicator.set_size(node.width, node.height);
                indicator.set_position(node.x, node.y);
                this.add_child(indicator);
                this._selectionIndicators.set(widgetId, indicator);
            }
        }

        _clearWidgetSelection() {
            for (const indicator of this._selectionIndicators.values()) {
                if (!isActorDestroyed(indicator))
                    indicator.destroy();
            }
            this._selectionIndicators.clear();
            this._selectedWidgetIds.clear();
        }


        _deleteSelectedWidgets() {
            const selection = this._selectedWidgetIds;
            if (!selection || selection.size === 0)
                return;

            const toDeleteIds = new Set(selection);
            const filesToTrash = [];
            const trashingIconNodeIds = []; // Csak a ténylegesen kukázandó ikonok node ID-jai
            const normalWidgetIds = [];

            const homeUri = Gio.File.new_for_path(GLib.get_home_dir()).get_uri();

            for (const widgetId of toDeleteIds) {
                const node = this.widgetNodes.get(widgetId);
                const widgetData = node?.widgetData;
                if (!widgetData)
                    continue;

                if (widgetData.isDesktopIcon) {
                    const uri = widgetData.uri || '';
                    const isTrash = uri.startsWith('trash:') || widgetData.name === 'Kuka';
                    const isHome = (uri === homeUri || uri === `${homeUri}/`);

                    const isNetworkOrMountUri = uri.startsWith('google-drive:') ||
                                                uri.startsWith('smb:') ||
                                                uri.startsWith('sftp:') ||
                                                uri.startsWith('nfs:') ||
                                                uri.startsWith('dav:') ||
                                                uri.startsWith('davs:');

                    const isMount = (!isTrash && !isHome) && (Boolean(widgetData.isSpecial) || isNetworkOrMountUri);

                    // Csak a valódi, nem védett fájlok mehetnek a kukába
                    if (!widgetData.isSpecial && !isTrash && !isHome && !isMount && uri) {
                        filesToTrash.push(uri);
                        trashingIconNodeIds.push(widgetId);
                    }
                } else {
                    normalWidgetIds.push(widgetId);
                }
            }

            // 1. Csak a ténylegesen törölhető fájlok mennek a kukába
            for (const uri of filesToTrash) {
                trashFile(uri, () => {});
            }

            // 2. Csak a ténylegesen törölt asztali ikonok node-jait távolítjuk el
            for (const widgetId of trashingIconNodeIds) {
                const node = this.widgetNodes.get(widgetId);
                if (node) {
                    node.destroy();
                    this.widgetNodes.delete(widgetId);
                    this._nodeConfigs.delete(widgetId);
                }
            }

            // 3. Normál widgetek törlése (óra, időjárás, jegyzet stb.)
            if (normalWidgetIds.length > 0) {
                const normalSet = new Set(normalWidgetIds);

                for (const widgetId of normalWidgetIds) {
                    const node = this.widgetNodes.get(widgetId);
                    const type = node?.widgetData?.type;
                    if (type === 'notes' || type === 'clipboard' || type === 'todo' || type === 'github') {
                        deleteCacheFile(type === 'todo' ? 'todos' : type, widgetId);
                    }
                }

                for (const widgetId of normalWidgetIds) {
                    const node = this.widgetNodes.get(widgetId);
                    if (node) {
                        node.destroy();
                        this.widgetNodes.delete(widgetId);
                        this._nodeConfigs.delete(widgetId);
                    }
                }

                const currentWidgets = getWidgets(this.settings);
                const remaining = currentWidgets.filter(w => !normalSet.has(w.id));
                saveWidgets(this.settings, remaining);
            }

            // 4. Kijelölési keretek törlése
            this._clearWidgetSelection();
        }

        _syncSelectionIndicators() {
            for (const [widgetId, indicator] of [...this._selectionIndicators]) {
                const node = this.widgetNodes.get(widgetId);
                if (!node || isActorDestroyed(node) || isActorDestroyed(indicator)) {
                    if (!isActorDestroyed(indicator))
                        indicator.destroy();
                    this._selectionIndicators.delete(widgetId);
                    this._selectedWidgetIds.delete(widgetId);
                    continue;
                }
                indicator.set_size(node.width, node.height);
                indicator.set_position(node.x, node.y);
            }
        }

        _updateStageSize() {
            const target = getTargetMonitor(this.targetMonitorIndex, this.settings);
            const panelHeight = getPanelHeight();

            if (target) {
                const primaryIdx = global.display.get_primary_monitor();
                const topOffset = (target.index === primaryIdx) ? panelHeight : 0;
                this.set_position(target.geom.x, target.geom.y + topOffset);
                this.set_size(target.geom.width, target.geom.height - topOffset);
            } else {
                this.set_position(0, panelHeight);
                this.set_size(
                    global.stage.width || DEFAULT_STAGE_WIDTH,
                    (global.stage.height || DEFAULT_STAGE_HEIGHT) - panelHeight
                );
            }
        }

        _repositionNode(widgetId, newCols, newRows, newX, newY) {
            const node = this.widgetNodes.get(widgetId);
            if (!node || isActorDestroyed(node)) return;

            const currentGap = this.settings.get_int('grid-gap-size') || 16;
            const cellSize = this.cellTotalWidth - currentGap;
            const widgetWidth = Math.round((newCols * cellSize) + ((newCols - 1) * currentGap));
            const widgetHeight = Math.round((newRows * cellSize) + ((newRows - 1) * currentGap));
            const posX = Math.round(GRID_MARGIN_PX + (newX * this.cellTotalWidth));
            const posY = Math.round(GRID_MARGIN_PX + (newY * this.cellTotalHeight));

            node.set_size(widgetWidth, widgetHeight);
            node.set_position(posX, posY);
        }

        _resolveGridLayout() {
            const target = getTargetMonitor(this.targetMonitorIndex, this.settings);
            const panelHeight = getPanelHeight();

            let currentW = target ? target.geom.width : (global.stage.width || DEFAULT_STAGE_WIDTH);
            let currentH = target ? (target.geom.height - ((target.index === global.display.get_primary_monitor()) ? panelHeight : 0)) : ((global.stage.height || DEFAULT_STAGE_HEIGHT) - panelHeight);

            if (Number.isFinite(this.width) && this.width > 100) currentW = this.width;
            if (Number.isFinite(this.height) && this.height > 100) currentH = this.height;

            const customCellSize = this.settings.get_int('grid-cell-size') || 80; 
            const customGap = this.settings.get_int('grid-gap-size') || 16;       

            const { cellSize, cellTotalWidth, cellTotalHeight, gridCols, gridRows } = calculateGridDimensions(
                currentW, 
                currentH, 
                COLUMNS_COUNT, 
                customCellSize,
                customGap 
            );
            return { gridCols, gridRows, cellSize, cellTotalWidth, cellTotalHeight };
        }

        _layoutWidgetsOnGrid(activeWidgets, gridCols, gridRows, cellSize, cellTotalWidth, cellTotalHeight) {
            let modified = false;
            const placedWidgets = [];

            const sortedWidgets = activeWidgets.slice().sort((a, b) => {
                const posA = ((a.y || 0) * gridCols) + (a.x || 0);
                const posB = ((b.y || 0) * gridCols) + (b.x || 0);
                return posA - posB;
            });

            sortedWidgets.forEach(widgetData => {
                const effectiveWidth = Math.max(1, Math.min(widgetData.width || 2, gridCols));
                const effectiveHeight = Math.max(1, Math.min(widgetData.height || 2, gridRows));

                let effectiveX = Math.max(0, Math.min(widgetData.x || 0, gridCols - effectiveWidth));
                let effectiveY = Math.max(0, Math.min(widgetData.y || 0, gridRows - effectiveHeight));

                if (checkOverlap(effectiveX, effectiveY, effectiveWidth, effectiveHeight, placedWidgets)) {
                    const freeSpot = findEmptySpot(placedWidgets, effectiveWidth, effectiveHeight, gridCols, gridRows);
                    if (freeSpot) {
                        effectiveX = freeSpot.x;
                        effectiveY = freeSpot.y;
                    }
                }

                if (effectiveX !== widgetData.x || effectiveY !== widgetData.y || effectiveWidth !== widgetData.width || effectiveHeight !== widgetData.height) {
                    widgetData.x = effectiveX;
                    widgetData.y = effectiveY;
                    widgetData.width = effectiveWidth;
                    widgetData.height = effectiveHeight;
                    modified = true;
                }

                placedWidgets.push(widgetData);
            });

            return { sortedWidgets, modified };
        }

        _createAndAttachWidget(widgetData, cellSize, cellTotalWidth, cellTotalHeight, globalSettings) {
            const safeCellSize = (Number.isFinite(cellSize) && cellSize > 0) ? cellSize : 80;
            const currentGap = (cellTotalWidth && cellSize) ? (cellTotalWidth - cellSize) : 16;
            const safeCellW = (Number.isFinite(cellTotalWidth) && cellTotalWidth > 0) ? cellTotalWidth : (safeCellSize + currentGap);
            const safeCellH = (Number.isFinite(cellTotalHeight) && cellTotalHeight > 0) ? cellTotalHeight : (safeCellSize + currentGap);

            const wUnits = Math.max(1, widgetData.width || 1);
            const hUnits = Math.max(1, widgetData.height || 1);
            const xUnits = Math.max(0, widgetData.x || 0);
            const yUnits = Math.max(0, widgetData.y || 0);

            const widgetWidth = Math.round((wUnits * safeCellSize) + ((wUnits - 1) * currentGap));
            const widgetHeight = Math.round((hUnits * safeCellSize) + ((hUnits - 1) * currentGap));
            const posX = Math.round(GRID_MARGIN_PX + (xUnits * safeCellW));
            const posY = Math.round(GRID_MARGIN_PX + (yUnits * safeCellH));

            const resolvedData = Object.assign({}, resolveWidgetOverrides(widgetData, globalSettings), {
                globalAnimateGif: globalSettings.globalAnimateGif,
                globalImageShowCaption: globalSettings.globalImageShowCaption,
                globalSlideshowShowCaption: globalSettings.globalSlideshowShowCaption,
                globalUseFahrenheit: globalSettings.globalUseFahrenheit,
                globalWeatherDynamicColor: globalSettings.globalWeatherDynamicColor,
                globalWeatherDynamicImage: globalSettings.globalWeatherDynamicImage,
                globalWeatherCity: globalSettings.globalWeatherCity,
                globalUse24h: globalSettings.globalUse24h,
                globalAccentColor: globalSettings.globalAccentColor,
                extensionPath: this.extensionPath,
            });

            const node = createWidgetNode(resolvedData, widgetWidth, widgetHeight, posX, posY);
            if (node) {
                watchActorLifecycle(node);
                node.widgetData = widgetData;
                node.gridOverlayCallback = (showOverlay) => DesktopGrid.toggleAllGridOverlays(showOverlay);
                attachDragHandlers(this, node, widgetData);
                this.add_child(node);
                this.widgetNodes.set(widgetData.id, node);
                this._nodeConfigs.set(widgetData.id, JSON.stringify(widgetData));
            }
        }

        applyLocalWidgetLayout(widgets) {
            this._saveLocalWidgets(widgets);
        }

        _syncGridLines() {
            if (this._gridLineCanvas) {
                this._gridLineCanvas.destroy();
                this._gridLineCanvas = null;
            }

            if (this.settings.get_boolean('show-grid')) {
                const accentColor = resolveAccentColor(this.settings, this.interfaceSettings);
                const accent = parseCssColor(accentColor);
                this._gridLineCanvas = createGridOverlay(
                    this.gridCols || COLUMNS_COUNT,
                    this.gridRows || ROWS_COUNT,
                    this.cellTotalWidth,
                    this.cellSize,
                    this.gridMargin,
                    accent.r, accent.g, accent.b, GRID_LINE_ALPHA
                );
                this.insert_child_at_index(this._gridLineCanvas, 0);
            }
        }

        _saveLocalWidgets(widgets) {
            this._lastAppliedWidgetsJson = serializeWidgets(widgets);
            saveWidgets(this.settings, widgets);
            this.widgetNodes.forEach((node, widgetId) => {
                const latest = widgets.find(widget => widget.id === widgetId);
                if (latest && node.widgetData) {
                    node.widgetData.x = latest.x;
                    node.widgetData.y = latest.y;
                    node.widgetData.width = latest.width;
                    node.widgetData.height = latest.height;
                    node.widgetData.monitor = latest.monitor;
                }
            });
        }

        _resolveActiveWidgets() {
            const monitorMode = this.settings.get_string('global-monitor') || 'primary';
            const isEachMode = (monitorMode === 'each');
            const showDesktop = this.settings.get_boolean('show-desktop-icons');

            let widgets = getWidgets(this.settings);
            
            let activeWidgets = widgets.filter(w => {
                if (w.isDesktopIcon && !showDesktop) return false;
                
                return getWidgetsForMonitor([w], getEffectiveMonitorIndex(this.targetMonitorIndex, this.settings), isEachMode).length > 0;
            });

            return { widgets, activeWidgets };
        }

        _applyGridLayout(layout) {
            this.cellTotalWidth = layout.cellTotalWidth;
            this.cellTotalHeight = layout.cellTotalHeight;
            this.cellSize = layout.cellSize;
            this._layout = layout;
            this.gridMargin = GRID_MARGIN_PX;
            this.gridCols = layout.gridCols;
            this.gridRows = layout.gridRows;

            this._syncGridLines();
        }

        applySizePreset(widgetId, sizeIndex) {
            const { widgets, activeWidgets } = this._resolveActiveWidgets();
            const target = widgets.find(widget => widget.id === widgetId);
            if (!target)
                return;

            const size = resolveWidgetSizePreset(target, sizeIndex);
            if (!size)
                return;

            const others = activeWidgets.filter(widget => widget.id !== widgetId);
            if (target.type === 'weather')
                target.layout = resolveWeatherLayoutVariant(target);
            target.width = size.width;
            target.height = size.height;
            target.x = Math.max(0, Math.min(target.x || 0, this.gridCols - size.width));
            target.y = Math.max(0, Math.min(target.y || 0, this.gridRows - size.height));
            if (checkOverlap(target.x, target.y, size.width, size.height, others)) {
                const spot = findEmptySpot(others, size.width, size.height, this.gridCols, this.gridRows);
                if (spot) {
                    target.x = spot.x;
                    target.y = spot.y;
                }
            }

            const node = this.widgetNodes.get(widgetId);
            if (node) {
                node.destroy();
                this.widgetNodes.delete(widgetId);
                this._nodeConfigs.delete(widgetId);
            }
            this._saveLocalWidgets(widgets);

            const globalSettings = readGlobalSettings(this.settings, this.interfaceSettings);
            this._createNodeFactory(this._layout, globalSettings)(target);
        }

        _createNodeFactory(layout, globalSettings) {
            return (widgetData) => {
                try {
                    this._createAndAttachWidget(widgetData, layout.cellSize, layout.cellTotalWidth, layout.cellTotalHeight, globalSettings);
                } catch (error) {
                    console.error(`Failed to create widget ${widgetData.id} (${widgetData.type}):`, error);
                }
            };
        }

        _applyWidgetChanges() {
            this._clearWidgetSelection();
            this._lastAppliedWidgetsJson = this.settings.get_string('widgets');

            const previousCellTotalWidth = this.cellTotalWidth;
            const previousCellTotalHeight = this.cellTotalHeight;

            const { widgets, activeWidgets } = this._resolveActiveWidgets();

            const layout = this._resolveGridLayout();
            if (layout.cellTotalWidth !== previousCellTotalWidth || layout.cellTotalHeight !== previousCellTotalHeight) {
                this._rebuildGrid();
                return;
            }

            this._applyGridLayout(layout);

            const globalSettings = readGlobalSettings(this.settings, this.interfaceSettings);
            const createNode = this._createNodeFactory(layout, globalSettings);

            const { sortedWidgets, modified } = this._layoutWidgetsOnGrid(activeWidgets, layout.gridCols, layout.gridRows, layout.cellSize, layout.cellTotalWidth, layout.cellTotalHeight);

            sortedWidgets.forEach(widgetData => {
                if (this.widgetNodes.has(widgetData.id) && this._nodeConfigs.get(widgetData.id) === JSON.stringify(widgetData)) {
                    return; 
                }
                const existingNode = this.widgetNodes.get(widgetData.id);
                if (existingNode) {
                    existingNode.destroy();
                    this.widgetNodes.delete(widgetData.id);
                    this._nodeConfigs.delete(widgetData.id);
                }
                createNode(widgetData);
            });

            for (const [widgetId, node] of [...this.widgetNodes]) {
                if (!sortedWidgets.some(widgetData => widgetData.id === widgetId)) {
                    node.destroy();
                    this.widgetNodes.delete(widgetId);
                    this._nodeConfigs.delete(widgetId);
                }
            }

            if (modified) {
                this._saveLocalWidgets(widgets);
            }
        }
        _rebuildGrid() {
            this._clearWidgetSelection();
            this._lastAppliedWidgetsJson = this.settings.get_string('widgets');

            this.widgetNodes.forEach(node => {
                if (!isActorDestroyed(node)) node.destroy();
            });
            this.widgetNodes.clear();
            this._nodeConfigs.clear();

            if (this._gridLineCanvas) {
                if (!isActorDestroyed(this._gridLineCanvas)) this._gridLineCanvas.destroy();
                this._gridLineCanvas = null;
            }

            this.editOverlayCanvases.forEach(box => {
                if (!isActorDestroyed(box)) box.destroy();
            });
            this.editOverlayCanvases = [];

            this._updateStageSize();

            const { widgets, activeWidgets } = this._resolveActiveWidgets();
            const layout = this._resolveGridLayout();

            this._applyGridLayout(layout);

            const globalSettings = readGlobalSettings(this.settings, this.interfaceSettings);
            const createNode = this._createNodeFactory(layout, globalSettings);

            const { sortedWidgets, modified } = this._layoutWidgetsOnGrid(
                activeWidgets,
                layout.gridCols,
                layout.gridRows,
                layout.cellSize,
                layout.cellTotalWidth,
                layout.cellTotalHeight
            );

            sortedWidgets.forEach(createNode);

            if (modified) {
                this._saveLocalWidgets(widgets);
            }
        }

        _toggleGridOverlay(show) {
            if (show) {
                if (this.editOverlayCanvases.length > 0) return;

                const accentColor = resolveAccentColor(this.settings, this.interfaceSettings);
                const accent = parseCssColor(accentColor);
                const canvas = createGridOverlay(
                    this.gridCols || COLUMNS_COUNT,
                    this.gridRows || ROWS_COUNT,
                    this.cellTotalWidth,
                    this.cellSize,
                    this.gridMargin,
                    accent.r, accent.g, accent.b, EDIT_OVERLAY_ALPHA
                );
                this.insert_child_at_index(canvas, 0);
                this.editOverlayCanvases.push(canvas);
            } else {
                this.editOverlayCanvases.forEach(box => box.destroy());
                this.editOverlayCanvases = [];
            }
        }

        _toggleGridLines() {
            this._syncGridLines();
        }

    }
);
