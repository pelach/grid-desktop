import St from 'gi://St';
import Gio from 'gi://Gio';
import Clutter from 'gi://Clutter';
import { WidgetActor } from '../shell/widgetUIUtils.js';
import { watchActorLifecycle } from '../utils/actorLifecycle.js';
import { launchFileUri } from '../desktopGrid/contextMenu.js';

export function createDesktopIconNode(data, w, h, x, y) {
    const rootContainer = new WidgetActor({
        style_class: 'gridgets-widget desktop-icon-widget',
        style: 'background-color: transparent; border: none; box-shadow: none;',
        x: x || 0,
        y: y || 0,
        width: w,
        height: h,
        reactive: true,
        can_focus: true,
        track_hover: true,
        layout_manager: new Clutter.BinLayout(),
    });

    const box = new St.BoxLayout({
        vertical: true,
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
        x_expand: true,
        y_expand: true,
        reactive: false, 
        width: w,  
        height: h,
    });

    const iconSize = data.showLabel ? 48 : 64;
    let gicon;
    try {
        gicon = Gio.Icon.new_for_string(data.icon || 'text-x-generic');
    } catch (e) {
        gicon = Gio.ThemedIcon.new('text-x-generic');
    }

    const icon = new St.Icon({
        gicon: gicon,
        icon_size: iconSize,
        reactive: false,
    });
    box.add_child(icon);

    if (data.showLabel) {
        const label = new St.Label({
            text: data.name || '',
            style_class: 'desktop-icon-label',
            x_align: Clutter.ActorAlign.CENTER,
            reactive: false,
        });
        box.add_child(label);
    }

    rootContainer.add_child(box);

    // Dupla klikk kezelése közvetlenül a rootContainer-en
    let lastClickTime = 0;
    const pressId = rootContainer.connect('button-press-event', (actor, event) => {
        if (event.get_button() === 1) {
            const currentTime = Date.now();
            if (currentTime - lastClickTime < 400) {
                lastClickTime = 0;
                launchFileUri(data.uri);
                return Clutter.EVENT_STOP;
            }
            lastClickTime = currentTime;
        }
        // Vonszoláshoz TOVÁBB KELL ENGEDNI az eseményt a dragDrop figyelőnek!
        return Clutter.EVENT_PROPAGATE;
    });

    rootContainer.registerCleanup(() => {
        if (pressId) {
            rootContainer.disconnect(pressId);
        }
    });
    
    rootContainer.queue_relayout();
    return watchActorLifecycle(rootContainer);
}