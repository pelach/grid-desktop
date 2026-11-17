import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import { registerWidgetCleanup } from '../../shell/widgetUIUtils.js';
import { isActorDestroyed } from '../../utils/actorLifecycle.js';
import { handlePlayPauseAction, connectControlButton } from './controls.js';

const ARM_ANGLE_REST = 0;

function getAssetPath(relativePath) {
    const currentFilePath = Gio.File.new_for_uri(import.meta.url).get_path();
    const currentDir = GLib.path_get_dirname(currentFilePath);
    return GLib.build_filenamev([currentDir, relativePath]);
}

/**
 * Közös lemezjátszó-építő a 2x2 (musicSmall) és 2x4 (musicLarge) elrendezéshez.
 * A `params` adja meg az elrendezés-specifikus méreteket, szögeket és a pozicionáló függvényt.
 */
export function createVinylTurntable(state, parentActor, params) {
    const {
        baseVinylSize,
        baseCenterSize,
        baseArmWidth,
        baseArmHeight,
        armAngleStart,
        armAngleEnd,
        positionElements,
    } = params;

    const turntableBox = new St.Widget({ x_expand: true, y_expand: true });

    const discActor = new St.Widget({
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
        reactive: true,
        can_focus: true,
        track_hover: true,
    });
    discActor.set_pivot_point(0.5, 0.5);

    const vinylCoverActor = new St.Widget({
        style: 'border-radius: 999px; background-color: #1a1a1a;',
    });
    state.vinylCoverActor = vinylCoverActor;

    const vinylTexture = new St.Icon({
        gicon: Gio.FileIcon.new(Gio.File.new_for_path(getAssetPath('vinyl/vinyl.svg'))),
    });

    discActor.add_child(vinylCoverActor);
    discActor.add_child(vinylTexture);

    const sheenActor = new St.Icon({
        gicon: Gio.FileIcon.new(Gio.File.new_for_path(getAssetPath('vinyl/vinyl_sheen.svg'))),
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
        reactive: false,
    });
    state.sheenActor = sheenActor;
    sheenActor.hide();

    const armUrl = Gio.File.new_for_path(getAssetPath('vinyl/tonearm.svg')).get_uri();
    const armActor = new St.Widget({
        style: `background-image: url("${armUrl}"); background-size: contain; background-repeat: no-repeat;`,
        reactive: false,
    });
    armActor.set_pivot_point(25 / 70, 25 / 220);
    armActor.rotation_angle_z = ARM_ANGLE_REST;

    turntableBox.add_child(discActor);
    turntableBox.add_child(sheenActor);
    turntableBox.add_child(armActor);
    parentActor.add_child(turntableBox);

    let spinTimerId = null;

    const startSpinning = () => {
        if (spinTimerId) return;
        spinTimerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 33, () => {
            if (!discActor || isActorDestroyed(discActor)) {
                spinTimerId = null;
                return GLib.SOURCE_REMOVE;
            }
            discActor.rotation_angle_z = (discActor.rotation_angle_z + 2.0) % 360;
            return GLib.SOURCE_CONTINUE;
        });
    };

    const stopSpinning = () => {
        if (spinTimerId) {
            GLib.Source.remove(spinTimerId);
            spinTimerId = null;
        }
    };

    state.stopSpinning = stopSpinning;
    registerWidgetCleanup(state.container, stopSpinning);

    const calculateArmAngle = (progress) => {
        const p = Math.max(0, Math.min(1, progress || 0));
        return armAngleStart + (armAngleEnd - armAngleStart) * p;
    };

    state.updateArmProgress = (progress) => {
        if (!armActor || isActorDestroyed(armActor) || state.playbackStatus !== 'Playing')
            return;

        const targetAngle = calculateArmAngle(progress);
        if (Math.abs(targetAngle - armActor.rotation_angle_z) > 1.0) {
            const isMapped = discActor && discActor.is_mapped() && discActor.get_stage() !== null;
            if (isMapped) {
                armActor.remove_all_transitions();
                armActor.ease({
                    rotation_angle_z: targetAngle,
                    duration: 350,
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                });
                return;
            }
        }
        armActor.rotation_angle_z = targetAngle;
    };

    state.onPlaybackStatusChanged = (status) => {
        if (!discActor || isActorDestroyed(discActor)) return;
        const isMapped = discActor.is_mapped() && discActor.get_stage() !== null;

        if (status === 'Playing') {
            const pos = state.currentPositionMicro || 0;
            const len = state.trackLengthMicro || 0;
            const startAngle = calculateArmAngle(len > 0 ? pos / len : 0);

            if (isMapped) {
                startSpinning();
                armActor.remove_all_transitions();
                armActor.ease({
                    rotation_angle_z: startAngle,
                    duration: 500,
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                });
            } else {
                armActor.rotation_angle_z = startAngle;
            }
        } else {
            stopSpinning();
            if (isMapped) {
                armActor.remove_all_transitions();
                armActor.ease({
                    rotation_angle_z: ARM_ANGLE_REST,
                    duration: 500,
                    mode: Clutter.AnimationMode.EASE_IN_QUAD,
                });
            } else {
                armActor.rotation_angle_z = ARM_ANGLE_REST;
            }
        }
    };

    discActor.connect('notify::mapped', () => {
        if (discActor.is_mapped() && discActor.get_stage() !== null && state.playbackStatus === 'Playing') {
            startSpinning();
        } else {
            stopSpinning();
        }
    });

    connectControlButton(discActor, state, () => handlePlayPauseAction(state));

    return (scale, panelW, panelH) => {
        turntableBox.set_size(panelW, panelH);

        const vinylSize = Math.round(baseVinylSize * scale);
        const centerSize = Math.round(baseCenterSize * scale);
        const armW = Math.round(baseArmWidth * scale);
        const armH = Math.round(baseArmHeight * scale);
        const { vinylX, vinylY, armX, armY } = positionElements(scale, panelW, panelH, vinylSize);

        discActor.set_size(vinylSize, vinylSize);
        discActor.set_position(vinylX, vinylY);

        vinylTexture.set_icon_size(vinylSize);
        vinylTexture.set_size(vinylSize, vinylSize);

        vinylCoverActor.set_size(centerSize, centerSize);
        vinylCoverActor.set_position(
            Math.round((vinylSize - centerSize) / 2),
            Math.round((vinylSize - centerSize) / 2)
        );

        sheenActor.set_icon_size(vinylSize);
        sheenActor.set_size(vinylSize, vinylSize);
        sheenActor.set_position(vinylX, vinylY);

        armActor.set_size(armW, armH);
        armActor.set_position(armX, armY);
    };
}