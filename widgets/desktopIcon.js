import St from 'gi://St';
import Gio from 'gi://Gio';
import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
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
        clip_to_allocation: false, // ne vágja le az árnyékot vagy az alsó túlnyúlást
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
    });

    // DINAMIKUS IKONMÉRET A CELLÁHOZ KÖTVE:
    // Felirattal a cella kb. 55%-a (68px-nél ~38px, 80px-nél ~44px, 96px-nél ~52px)
    // Felirat nélkül a cella kb. 75%-a (68px-nél ~50px, 80px-nél ~60px)
    const baseCell = Math.min(w, h);
    const iconSize = data.showLabel
        ? Math.round(baseCell * 0.55)
        : Math.round(baseCell * 0.75);

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
        // Dinamikus betűméret: 68px alatt 10px, 68-80px között 11px, felette 12px
        const fontSize = baseCell <= 68 ? 10 : (baseCell <= 80 ? 11 : 12);

        const label = new St.Label({
            text: data.name || '',
            style_class: 'desktop-icon-label',
            style: `font-size: ${fontSize}px; font-weight: 500; color: #ffffff; text-align: center; text-shadow: 0 1px 2px rgba(0, 0, 0, 0.85); margin-top: 2px;`,
            x_align: Clutter.ActorAlign.CENTER,
            reactive: false,
        });

        label.clutter_text.set_line_wrap(true);
        label.clutter_text.set_line_wrap_mode(Pango.WrapMode.WORD_CHAR);
        label.clutter_text.set_ellipsize(Pango.EllipsizeMode.END);

        // Picit szélesebb lehet, mint maga a cella, hogy kényelmesen tördeljen:
        label.set_width(w + 12);

        box.add_child(label);
    }

    rootContainer.add_child(box);

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
        return Clutter.EVENT_PROPAGATE;
    });

    rootContainer.registerCleanup(() => {
        if (pressId) {
            rootContainer.disconnect(pressId);
        }
    });

    // A queue_relayout() innen törölve! A szülő konténer intézi, amint bekerül a stage-re.
    return watchActorLifecycle(rootContainer);
}