import Gio from 'gi://Gio';

function isMountActuallyActive(uri) {
    if (!uri) return false;
    try {
        const file = Gio.File.new_for_uri(uri);
        // Csak alapadatokat kérünk le, nem listázzuk a teljes könyvtártartalmat
        const info = file.query_info('standard::name', Gio.FileQueryInfoFlags.NONE, null);
        return info !== null;
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
            if (!root) return;

            const uri = root.get_uri();
            // Csak akkor lépünk tovább, ha NEM lokális fájlrendszer (nem file://)
            if (!uri || uri.startsWith('file://'))
                return;

            if (!isMountActuallyActive(uri))
                return;

            icons.push({
                name: mount.get_name(),
                uri: uri,
                icon: mount.get_icon() ? mount.get_icon().to_string() : 'network-server',
                isSpecial: true,
                isMount: true,
            });
        });
    } catch (e) {}

    return icons;
}