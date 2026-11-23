import os
import hashlib
import gi

gi.require_version('GObject', '2.0')
gi.require_version('Gio', '2.0')
from gi.repository import Nautilus, GObject, Gio

TAGS = [
    ("Red",    "#ff3b30"),
    ("Orange", "#ff9500"),
    ("Yellow", "#ffcc00"),
    ("Green",  "#34c759"),
    ("Blue",   "#007aff"),
    ("Purple", "#af52de"),
    ("Gray",   "#8e8e93"),
]

VALID_KEYS = {key for key, _ in TAGS}
EMBLEM_DIR = os.path.expanduser('~/.local/share/icons/hicolor/scalable/emblems')
TAG_VIEWS_DIR = os.path.expanduser('~/.local/share/grid-desktop/tags')
BOOKMARKS_FILE = os.path.expanduser('~/.config/gtk-3.0/bookmarks')


def ensure_emblem_icons():
    os.makedirs(EMBLEM_DIR, exist_ok=True)
    for key, hex_color in TAGS:
        svg_path = os.path.join(EMBLEM_DIR, f'tag-{key.lower()}.svg')
        if not os.path.exists(svg_path):
            svg_content = (
                f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">'
                f'<circle cx="8" cy="8" r="6" fill="{hex_color}" stroke="#ffffff" stroke-width="1.5"/>'
                f'</svg>\n'
            )
            try:
                with open(svg_path, 'w', encoding='utf-8') as f:
                    f.write(svg_content)
            except OSError:
                pass


def ensure_sidebar_bookmarks():
    os.makedirs(TAG_VIEWS_DIR, exist_ok=True)
    os.makedirs(os.path.dirname(BOOKMARKS_FILE), exist_ok=True)

    existing_lines = []
    if os.path.exists(BOOKMARKS_FILE):
        try:
            with open(BOOKMARKS_FILE, 'r', encoding='utf-8') as f:
                existing_lines = [line.rstrip('\n') for line in f]
        except OSError:
            pass

    existing_uris = {line.split(' ')[0] for line in existing_lines if line.strip()}
    new_lines = list(existing_lines)
    changed = False

    for key, _ in TAGS:
        folder_path = os.path.join(TAG_VIEWS_DIR, key)
        os.makedirs(folder_path, exist_ok=True)

        # Egyedi színes pötty ikon beállítása a mappára
        gfolder = Gio.File.new_for_path(folder_path)
        svg_uri = Gio.File.new_for_path(os.path.join(EMBLEM_DIR, f'tag-{key.lower()}.svg')).get_uri()
        try:
            gfolder.set_attribute_string('metadata::custom-icon', svg_uri, Gio.FileQueryInfoFlags.NONE, None)
        except Exception:
            pass

        folder_uri = gfolder.get_uri()
        if folder_uri not in existing_uris:
            new_lines.append(f"{folder_uri} {key}")
            changed = True

    if changed:
        try:
            with open(BOOKMARKS_FILE, 'w', encoding='utf-8') as f:
                f.write('\n'.join(new_lines) + '\n')
        except OSError:
            pass


def _symlink_name_for_path(target_path):
    """Egyedi symlink nevet képez, hogy két különböző mappából származó azonos nevű fájl se ütközzön."""
    base = os.path.basename(target_path)
    parent_hash = hashlib.md5(os.path.dirname(target_path).encode('utf-8')).hexdigest()[:6]
    # Ha nincs névütközés, sima fájlnév, különben hash-sel kiegészítve
    return base, f"{base} ({parent_hash})"


def sync_file_symlinks(target_path, active_tags):
    if not target_path or not os.path.exists(target_path):
        return

    active_set = set(active_tags)
    plain_name, hashed_name = _symlink_name_for_path(target_path)

    for key, _ in TAGS:
        tag_dir = os.path.join(TAG_VIEWS_DIR, key)
        os.makedirs(tag_dir, exist_ok=True)

        plain_link = os.path.join(tag_dir, plain_name)
        hashed_link = os.path.join(tag_dir, hashed_name)

        if key in active_set:
            # Ellenőrizzük, létezik-e már link erre a célfájlra
            already_linked = False
            for candidate in (plain_link, hashed_link):
                if os.path.islink(candidate) and os.path.realpath(candidate) == os.path.realpath(target_path):
                    already_linked = True
                    break

            if not already_linked:
                link_to_create = plain_link if not os.path.exists(plain_link) else hashed_link
                try:
                    os.symlink(target_path, link_to_create)
                except OSError:
                    pass
        else:
            # Töröljük a linket, ha a tag lekerült a fájlról
            for candidate in (plain_link, hashed_link):
                if os.path.islink(candidate) and os.path.realpath(candidate) == os.path.realpath(target_path):
                    try:
                        os.unlink(candidate)
                    except OSError:
                        pass


def cleanup_broken_symlinks():
    """Eltávolítja a törölt vagy átnevezett fájlokra mutató árva linkeket."""
    if not os.path.exists(TAG_VIEWS_DIR):
        return
    for key, _ in TAGS:
        tag_dir = os.path.join(TAG_VIEWS_DIR, key)
        if not os.path.isdir(tag_dir):
            continue
        for entry in os.listdir(tag_dir):
            full_path = os.path.join(tag_dir, entry)
            if os.path.islink(full_path) and not os.path.exists(full_path):
                try:
                    os.unlink(full_path)
                except OSError:
                    pass


ensure_emblem_icons()
ensure_sidebar_bookmarks()
cleanup_broken_symlinks()


def get_file_tags(gfile):
    try:
        info = gfile.query_info('xattr::user.xdg.tags', Gio.FileQueryInfoFlags.NONE, None)
        raw = info.get_attribute_string('xattr::user.xdg.tags')
        if not raw:
            return []
        return [t.strip() for t in raw.split(',') if t.strip() in VALID_KEYS]
    except Exception:
        return []


def set_file_tags(gfile, tags):
    try:
        if tags:
            gfile.set_attribute_string(
                'xattr::user.xdg.tags',
                ','.join(tags),
                Gio.FileQueryInfoFlags.NONE,
                None
            )
        else:
            path = gfile.get_path()
            if path and hasattr(os, 'removexattr'):
                try:
                    os.removexattr(path, 'user.xdg.tags')
                except OSError:
                    gfile.set_attribute_string('xattr::user.xdg.tags', '', Gio.FileQueryInfoFlags.NONE, None)

        path = gfile.get_path()
        if path:
            sync_file_symlinks(path, tags)
    except Exception as e:
        print(f"[grid-desktop-tags] Failed to save tags: {e}")


class GridDesktopTagsExtension(GObject.GObject, Nautilus.MenuProvider, Nautilus.InfoProvider):
    def update_file_info(self, file):
        gfile = file.get_location()
        if not gfile or gfile.get_uri_scheme() != 'file':
            return
        tags = get_file_tags(gfile)
        for tag in tags:
            file.add_emblem(f'tag-{tag.lower()}')

        # Ha a grid-desktop asztalon állítottad be a taget, itt is szinkronba kerül a symlink
        path = gfile.get_path()
        if path and not path.startswith(TAG_VIEWS_DIR):
            sync_file_symlinks(path, tags)

    def get_file_items(self, *args):
        files = args[-1]
        if not files:
            return []

        local_files = []
        for f in files:
            gfile = f.get_location()
            if gfile and gfile.get_uri_scheme() == 'file':
                # Ha a virtuális tag mappában kattintunk jobb gombbal, az eredeti fájlt módosítsuk
                local_files.append(f)

        if not local_files:
            return []

        first_target = Gio.File.new_for_path(os.path.realpath(local_files[0].get_location().get_path()))
        first_tags = set(get_file_tags(first_target))

        top_item = Nautilus.MenuItem(
            name='GridDesktopTags::RootMenu',
            label='Tags',
            tip='Assign color tags (synced with Grid Desktop)'
        )

        submenu = Nautilus.Menu()
        top_item.set_submenu(submenu)

        for key, _ in TAGS:
            is_active = key in first_tags
            prefix = "✓ " if is_active else "    "
            item = Nautilus.MenuItem(
                name=f'GridDesktopTags::Toggle_{key}',
                label=f'{prefix}{key}',
                icon=f'tag-{key.lower()}',
            )
            item.connect('activate', self._on_toggle_tag, local_files, key)
            submenu.append_item(item)

        if first_tags:
            clear_item = Nautilus.MenuItem(
                name='GridDesktopTags::ClearAll',
                label='✕ Clear All Tags',
            )
            clear_item.connect('activate', self._on_clear_tags, local_files)
            submenu.append_item(clear_item)

        return [top_item]

    def _on_toggle_tag(self, _menu, files, tag_key):
        for f in files:
            real_path = os.path.realpath(f.get_location().get_path())
            gfile = Gio.File.new_for_path(real_path)
            current = get_file_tags(gfile)
            if tag_key in current:
                current = [t for t in current if t != tag_key]
            else:
                current.append(tag_key)
            set_file_tags(gfile, current)
            f.invalidate_extension_info()

    def _on_clear_tags(self, _menu, files):
        for f in files:
            real_path = os.path.realpath(f.get_location().get_path())
            gfile = Gio.File.new_for_path(real_path)
            set_file_tags(gfile, [])
            f.invalidate_extension_info()