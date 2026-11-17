import St from 'gi://St';
import Clutter from 'gi://Clutter';
import { parseCssColor } from '../../utils/widgetUtils.js';

export class CapsuleSlider {
    constructor(activeColorHex, onChangeCallback) {
        this.value = 0.0;
        this.activeColor = parseCssColor(activeColorHex);
        this.trackColor = { r: 1, g: 1, b: 1, a: 0.12 };
        this.onChangeCallback = onChangeCallback;
        this._signalIds = [];

        this.actor = new St.DrawingArea({
            reactive: true,
            can_focus: true,
            track_hover: true,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });

        this._signalIds.push(this.actor.connect('repaint', (area) => this._draw(area)));

        this._signalIds.push(this.actor.connect('button-press-event', (_actor, event) => {
            this._handlePointer(event);
            return Clutter.EVENT_STOP;
        }));

        this._signalIds.push(this.actor.connect('motion-event', (_actor, event) => {
            if (event.get_state() & Clutter.ModifierType.BUTTON1_MASK) {
                this._handlePointer(event);
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        }));

        this._signalIds.push(this.actor.connect('scroll-event', (_actor, event) => {
            const dir = event.get_scroll_direction();
            const step = 0.05;
            if (dir === Clutter.ScrollDirection.UP) {
                this.setValue(this.value + step);
            } else if (dir === Clutter.ScrollDirection.DOWN) {
                this.setValue(this.value - step);
            }
            if (this.onChangeCallback) this.onChangeCallback(this.value);
            return Clutter.EVENT_STOP;
        }));
    }

    _handlePointer(event) {
        if (!this.actor) return;
        const [x] = event.get_coords();
        const [actorX] = this.actor.get_transformed_position();
        const width = this.actor.get_width();
        if (width <= 0) return;

        const relX = Math.max(0, Math.min(width, x - actorX));
        this.setValue(relX / width);
        if (this.onChangeCallback) {
            this.onChangeCallback(this.value);
        }
    }

    setValue(val) {
        this.value = Math.max(0.0, Math.min(1.0, val));
        if (this.actor) {
            this.actor.queue_repaint();
        }
    }

    updateStyle(height, trackColorRgba) {
        if (!this.actor) return;
        this.actor.height = height;
        this.trackColor = parseCssColor(trackColorRgba);
        this.actor.queue_repaint();
    }

    _drawRoundedRect(cr, x, y, width, height, radius) {
        const r = Math.min(radius, height / 2, width / 2);
        cr.newSubPath();
        cr.arc(x + width - r, y + r, r, -Math.PI / 2, 0);
        cr.arc(x + width - r, y + height - r, r, 0, Math.PI / 2);
        cr.arc(x + r, y + height - r, r, Math.PI / 2, Math.PI);
        cr.arc(x + r, y + r, r, Math.PI, 3 * Math.PI / 2);
        cr.closePath();
    }

    _draw(area) {
        const cr = area.get_context();
        const [width, height] = area.get_surface_size();
        if (width <= 0 || height <= 0) return;

        const radius = height / 2;
        this._drawRoundedRect(cr, 0, 0, width, height, radius);
        cr.setSourceRGBA(
            this.trackColor.r ?? 1,
            this.trackColor.g ?? 1,
            this.trackColor.b ?? 1,
            this.trackColor.a ?? 0.12
        );
        cr.fill();

        if (this.value > 0.01) {
            const effectiveWidth = Math.min(width, Math.max(height, width * this.value));
            this._drawRoundedRect(cr, 0, 0, effectiveWidth, height, radius);
            cr.setSourceRGBA(
                this.activeColor.r ?? 0.7,
                this.activeColor.g ?? 0.88,
                this.activeColor.b ?? 0.97,
                1.0
            );
            cr.fill();
        }
    }

    destroy() {
        if (this.actor) {
            for (const sigId of this._signalIds) {
                if (sigId) {
                    try { this.actor.disconnect(sigId); } catch (_) {}
                }
            }
            this._signalIds = [];
            this.actor.destroy();
            this.actor = null;
        }
        this.onChangeCallback = null;
    }
}