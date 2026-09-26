import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { DEFAULT_PANEL_HEIGHT_PX } from './constants.js';

export function getWidgetsForMonitor(widgets, effectiveMonitorIndex, isEachMode = false) {
    if (effectiveMonitorIndex === null || effectiveMonitorIndex === undefined) return widgets;

    const monitors = Main.layoutManager.monitors;
    const primaryMon = Main.layoutManager.primaryMonitor;
    const primaryIndex = monitors.length ? Math.max(0, monitors.indexOf(primaryMon)) : 0;
    const isTargetingPrimaryMonitor = (effectiveMonitorIndex === primaryIndex);

    return widgets.filter(widget => {
        if (!widget.monitor || widget.monitor === 'global') {
            return isEachMode ? isTargetingPrimaryMonitor : true;
        }
        if (widget.monitor === 'primary') {
            return isTargetingPrimaryMonitor;
        }
        const monitorIndex = parseInt(widget.monitor, 10);
        if (!isNaN(monitorIndex)) {
            return monitorIndex === effectiveMonitorIndex;
        }
        return true;
    });
}

export function getPanelHeight() {
    if (Main.panel.height > 0)
        return Main.panel.height;
    if (Main.layoutManager.panelBox.height > 0)
        return Main.layoutManager.panelBox.height;
    return DEFAULT_PANEL_HEIGHT_PX;
}

function resolveMonitorIndex(targetMonitorIndex, settings) {
    const monitorSetting = settings ? (settings.get_string('global-monitor') || 'primary') : 'primary';
    const nMonitors = global.display.get_n_monitors();
    if (nMonitors === 0) return null;

    // 1. Ha a beállítás "primary", akkor MINDIG a dinamikus primary monitort adjuk vissza
    if (monitorSetting === 'primary') {
        return global.display.get_primary_monitor();
    }

    // 2. Ha az "all" van beállítva
    if (monitorSetting === 'all') {
        return null;
    }

    // 3. Ha "each" módban van (ekkor a targetMonitorIndex a konkrét monitor indexe), 
    //    vagy kifejezetten egy adott indexet adtunk meg:
    if (targetMonitorIndex !== null && typeof targetMonitorIndex === 'number') {
        if (targetMonitorIndex >= 0 && targetMonitorIndex < nMonitors) {
            return targetMonitorIndex;
        }
    }

    // 4. Ha a beállításban egy fix szám van (pl. "0" vagy "1")
    const monitorIndex = parseInt(monitorSetting, 10);
    if (!isNaN(monitorIndex) && monitorIndex >= 0 && monitorIndex < nMonitors) {
        return monitorIndex;
    }

    return global.display.get_primary_monitor();
}
export function getTargetMonitor(targetMonitorIndex, settings) {
    const nMonitors = global.display.get_n_monitors();
    if (nMonitors === 0) return null;

    const index = resolveMonitorIndex(targetMonitorIndex, settings);
    if (index === null) return null;

    return { geom: global.display.get_monitor_geometry(index), index };
}

export function getEffectiveMonitorIndex(targetMonitorIndex, settings) {
    return resolveMonitorIndex(targetMonitorIndex, settings);
}
