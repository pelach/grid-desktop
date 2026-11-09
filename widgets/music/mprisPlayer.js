import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const MPRIS_ROOT_IFACE = `
<node>
  <interface name="org.mpris.MediaPlayer2">
    <method name="Raise"/>
    <method name="Quit"/>
    <property name="CanQuit" type="b" access="read"/>
    <property name="CanRaise" type="b" access="read"/>
    <property name="HasTrackList" type="b" access="read"/>
    <property name="Identity" type="s" access="read"/>
    <property name="DesktopEntry" type="s" access="read"/>
    <property name="SupportedUriSchemes" type="as" access="read"/>
    <property name="SupportedMimeTypes" type="as" access="read"/>
  </interface>
</node>`;

const MPRIS_PLAYER_IFACE = `
<node>
  <interface name="org.mpris.MediaPlayer2.Player">
    <method name="Next"/>
    <method name="Previous"/>
    <method name="Pause"/>
    <method name="PlayPause"/>
    <method name="Stop"/>
    <method name="Play"/>
    <method name="Seek">
      <arg direction="in" name="Offset" type="x"/>
    </method>
    <method name="SetPosition">
      <arg direction="in" name="TrackId" type="o"/>
      <arg direction="in" name="Position" type="x"/>
    </method>
    <method name="OpenUri">
      <arg direction="in" name="Uri" type="s"/>
    </method>
    <signal name="Seeked">
      <arg name="Position" type="x"/>
    </signal>
    <property name="PlaybackStatus" type="s" access="read"/>
    <property name="LoopStatus" type="s" access="readwrite"/>
    <property name="Rate" type="d" access="readwrite"/>
    <property name="Shuffle" type="b" access="readwrite"/>
    <property name="Metadata" type="a{sv}" access="read"/>
    <property name="Volume" type="d" access="readwrite"/>
    <property name="Position" type="x" access="read"/>
    <property name="MinimumRate" type="d" access="read"/>
    <property name="MaximumRate" type="d" access="read"/>
    <property name="CanGoNext" type="b" access="read"/>
    <property name="CanGoPrevious" type="b" access="read"/>
    <property name="CanPlay" type="b" access="read"/>
    <property name="CanPause" type="b" access="read"/>
    <property name="CanSeek" type="b" access="read"/>
    <property name="CanControl" type="b" access="read"/>
  </interface>
</node>`;

export class RadioMprisService {
    constructor(callbacks) {
        this._callbacks = callbacks || {};
        this._ownerId = 0;
        this._exportedRootId = 0;
        this._exportedPlayerId = 0;

        this._playbackStatus = 'Stopped';
        this._stationName = 'Web Radio';
        this._trackTitle = 'No signal';
        this._artUrl = '';
        this._volume = 0.8;

        this._rootNode = Gio.DBusNodeInfo.new_for_xml(MPRIS_ROOT_IFACE);
        this._playerNode = Gio.DBusNodeInfo.new_for_xml(MPRIS_PLAYER_IFACE);

        this._initBus();
    }

    _initBus() {
        this._ownerId = Gio.bus_own_name(
            Gio.BusType.SESSION,
            'org.mpris.MediaPlayer2.GridRadio',
            Gio.BusNameOwnerFlags.REPLACE,
            (connection) => this._onBusAcquired(connection),
            null,
            null
        );
    }

    _onBusAcquired(connection) {
        this._connection = connection;

        // Root felület exportálása (invocation lezárással)
        this._exportedRootId = connection.register_object(
            '/org/mpris/MediaPlayer2',
            this._rootNode.interfaces[0],
            (_conn, _sender, _path, _iface, method, _params, invocation) => {
                try {
                    if (method === 'Quit' && this._callbacks.onQuit) this._callbacks.onQuit();
                    if (method === 'Raise' && this._callbacks.onRaise) this._callbacks.onRaise();
                    invocation.return_value(null);
                } catch (e) {
                    invocation.return_error_literal(Gio.DBusError, Gio.DBusError.FAILED, e.message);
                }
            },
            (_conn, _sender, _path, _iface, prop) => this._handleGetRootProperty(prop),
            null
        );

        // Player felület exportálása (invocation lezárással)
        this._exportedPlayerId = connection.register_object(
            '/org/mpris/MediaPlayer2',
            this._playerNode.interfaces[0],
            (_conn, _sender, _path, _iface, method, _params, invocation) => {
                try {
                    if (method === 'PlayPause' && this._callbacks.onPlayPause) this._callbacks.onPlayPause();
                    if (method === 'Stop' && this._callbacks.onStop) this._callbacks.onStop();
                    if (method === 'Play' && this._callbacks.onPlay) this._callbacks.onPlay();
                    if (method === 'Pause' && this._callbacks.onPause) this._callbacks.onPause();
                    if (method === 'Next' && this._callbacks.onNext) this._callbacks.onNext();
                    if (method === 'Previous' && this._callbacks.onPrevious) this._callbacks.onPrevious();
                    invocation.return_value(null);
                } catch (e) {
                    invocation.return_error_literal(Gio.DBusError, Gio.DBusError.FAILED, e.message);
                }
            },
            (_conn, _sender, _path, _iface, prop) => this._handleGetPlayerProperty(prop),
            (_conn, _sender, _path, _iface, prop, value) => this._handleSetPlayerProperty(prop, value)
        );
    }

    _handleGetRootProperty(prop) {
        switch (prop) {
            case 'CanQuit': return new GLib.Variant('b', false);
            case 'CanRaise': return new GLib.Variant('b', false);
            case 'HasTrackList': return new GLib.Variant('b', false);
            case 'Identity': return new GLib.Variant('s', 'Grid Radio');
            case 'DesktopEntry': return new GLib.Variant('s', 'grid-desktop');
            case 'SupportedUriSchemes': return new GLib.Variant('as', ['http', 'https']);
            case 'SupportedMimeTypes': return new GLib.Variant('as', ['audio/mpeg', 'audio/aac']);
            default: return null;
        }
    }

    _handleGetPlayerProperty(prop) {
        switch (prop) {
            case 'PlaybackStatus':
                return new GLib.Variant('s', this._playbackStatus);
            case 'Volume':
                return new GLib.Variant('d', this._volume);
            case 'Position':
                return new GLib.Variant('x', 0);
            case 'CanControl':
            case 'CanPlay':
            case 'CanPause':
            case 'CanGoNext':
            case 'CanGoPrevious':
                return new GLib.Variant('b', true);
            case 'CanSeek':
                return new GLib.Variant('b', false);
            case 'Metadata':
                return this._buildMetadataVariant();
            default:
                return null;
        }
    }

    _handleSetPlayerProperty(prop, value) {
        if (prop === 'Volume') {
            this._volume = value.unpack();
            if (this._callbacks.onSetVolume) {
                this._callbacks.onSetVolume(this._volume);
            }
            this.emitPropertyChanged('Volume', new GLib.Variant('d', this._volume));
            return true;
        }
        return false;
    }

    _buildMetadataVariant() {
        const metadata = {
            'mpris:trackid': new GLib.Variant('o', '/org/mpris/MediaPlayer2/CurrentTrack'),
            'xesam:title': new GLib.Variant('s', this._trackTitle || this._stationName),
            'xesam:album': new GLib.Variant('s', this._stationName),
            'xesam:artist': new GLib.Variant('as', [this._stationName]),
        };

        if (this._artUrl && this._artUrl.trim() !== '') {
            metadata['mpris:artUrl'] = new GLib.Variant('s', this._artUrl);
        }

        return new GLib.Variant('a{sv}', metadata);
    }

    updateState({ playbackStatus, stationName, trackTitle, volume, artUrl }) {
        const changedProps = {};

        if (playbackStatus !== undefined && this._playbackStatus !== playbackStatus) {
            this._playbackStatus = playbackStatus;
            changedProps['PlaybackStatus'] = new GLib.Variant('s', this._playbackStatus);
        }

        if (volume !== undefined && Math.abs(this._volume - volume) > 0.01) {
            this._volume = volume;
            changedProps['Volume'] = new GLib.Variant('d', this._volume);
        }

        let metaChanged = false;
        if (stationName !== undefined && this._stationName !== stationName) {
            this._stationName = stationName;
            metaChanged = true;
        }
        if (trackTitle !== undefined && this._trackTitle !== trackTitle) {
            this._trackTitle = trackTitle;
            metaChanged = true;
        }
        if (artUrl !== undefined && this._artUrl !== artUrl) {
            this._artUrl = artUrl;
            metaChanged = true;
        }

        if (metaChanged) {
            changedProps['Metadata'] = this._buildMetadataVariant();
        }

        if (Object.keys(changedProps).length > 0 && this._connection) {
            this._emitPropertiesChanged(changedProps);
        }
    }

    _emitPropertiesChanged(changedProps) {
        try {
            const parameters = new GLib.Variant('(sa{sv}as)', [
                'org.mpris.MediaPlayer2.Player',
                changedProps,
                [],
            ]);

            this._connection.emit_signal(
                null,
                '/org/mpris/MediaPlayer2',
                'org.freedesktop.DBus.Properties',
                'PropertiesChanged',
                parameters
            );
        } catch (_e) {
            // Szétkapcsoláskor nem kritikus
        }
    }

    emitPropertyChanged(propName, variantVal) {
        this._emitPropertiesChanged({ [propName]: variantVal });
    }

    destroy() {
        if (this._connection) {
            if (this._exportedRootId) {
                this._connection.unregister_object(this._exportedRootId);
                this._exportedRootId = 0;
            }
            if (this._exportedPlayerId) {
                this._connection.unregister_object(this._exportedPlayerId);
                this._exportedPlayerId = 0;
            }
        }
        if (this._ownerId) {
            Gio.bus_unown_name(this._ownerId);
            this._ownerId = 0;
        }
    }
}