import Gio from 'gi://Gio';

export function getMountedDeviceIcons() {
    const icons = [];
    try {
        const mounts = Gio.VolumeMonitor.get().get_mounts();
        mounts.forEach(mount => {
            const root = mount.get_root();
            if (!root || root.get_path() === '/' || !root.get_uri().startsWith('file://'))
                return;

            icons.push({
                name: mount.get_name(),
                uri: root.get_uri(),
                icon: mount.get_icon() ? mount.get_icon().to_string() : 'drive-harddisk',
                isSpecial: true,
                isMount: true,
            });
        });
    } catch (e) {}

    return icons;
}
