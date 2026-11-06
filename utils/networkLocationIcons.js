import Gio from 'gi://Gio';

function isMountActuallyActive(uri) {
    if (!uri) return false;
    try {
        const file = Gio.File.new_for_uri(uri);
        const mount = file.find_enclosing_mount(null);
        if (!mount) return false;

        const enumerator = file.enumerate_children(
            'standard::name',
            Gio.FileQueryInfoFlags.NONE,
            null
        );

        if (enumerator) {
            enumerator.close(null);
            return true;
        }
        return false;
    } catch (e) {
        return false;
    }
}

export function getNetworkLocationIcons() {
    const icons = [];
    try {
        const mounts = Gio.VolumeMonitor.get().get_mounts();
        mounts.forEach(mount => {
            const root = mount.get_root();
            if (!root || root.get_path() === '/' || root.get_uri().startsWith('file://'))
                return;

            const uri = root.get_uri();
            if (!isMountActuallyActive(uri))
                return;

            icons.push({
                name: mount.get_name(),
                uri,
                icon: mount.get_icon() ? mount.get_icon().to_string() : 'network-server',
                isSpecial: true,
                isMount: true,
            });
        });
    } catch (e) {}

    return icons;
}
