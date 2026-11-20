import os
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


def ensure_emblem_icons():
    emblem_dir = os.path.expanduser('~/.local/share/icons/hicolor/scalable/emblems')
    os.makedirs(emblem_dir, exist_ok=True)
    for key, hex_color in TAGS:
        svg_path = os.path.join(emblem_dir, f'tag-{key.lower()}.svg')
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


ensure_emblem_icons()


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

    def get_file_items(self, *args):
        files = args[-1]
        if not files:
            return []

        local_files = []
        for f in files:
            gfile = f.get_location()
            if gfile and gfile.get_uri_scheme() == 'file':
                local_files.append(f)

        if not local_files:
            return []

        first_tags = set(get_file_tags(local_files[0].get_location()))

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
            gfile = f.get_location()
            current = get_file_tags(gfile)
            if tag_key in current:
                current = [t for t in current if t != tag_key]
            else:
                current.append(tag_key)
            set_file_tags(gfile, current)
            f.invalidate_extension_info()

    def _on_clear_tags(self, _menu, files):
        for f in files:
            gfile = f.get_location()
            set_file_tags(gfile, [])
            f.invalidate_extension_info()