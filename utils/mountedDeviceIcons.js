import Gio from 'gi://Gio';

export function getMountedDeviceIcons() {
    const icons = [];
    try {
        const mounts = Gio.VolumeMonitor.get().get_mounts();
        mounts.forEach(mount => {
            const root = mount.get_root();
            if (!root) return;

            const uri = root.get_uri();
            // Csak a valódi lokális mountok kellenek, a gyökér (/) kivételével
            if (!uri || !uri.startsWith('file://') || root.get_path() === '/')
                return;

            icons.push({
                name: mount.get_name(),
                uri: uri,
                icon: mount.get_icon() ? mount.get_icon().to_string() : 'drive-harddisk',
                isSpecial: true,
                isMount: true,
            });
        });
    } catch (e) {}

    return icons;
}
