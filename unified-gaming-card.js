// Unified Gaming Card v1.4.0
if (!customElements.get("ha-panel-lovelace")) {
  await customElements.whenDefined("ha-panel-lovelace");
}
const LitElement = Object.getPrototypeOf(
  customElements.get("ha-panel-lovelace")
);
const html = LitElement.prototype.html;
const css = LitElement.prototype.css;

class UnifiedGamingCard extends LitElement {
  static _steamCache = new Map();
  static _fetching = new Set();
  static _lookupListeners = new Set();

  static getConfigElement() {
    return document.createElement("unified-gaming-card-editor");
  }

  static get properties() {
    return {
      hass: {},
      config: {},
      _hideOffline: { type: Boolean },
      _selectedPlayer: { state: true },
    };
  }

  constructor() {
    super();
    this._hideOffline = false;
    this._selectedPlayer = null;
    this._sessionObservations = new Map();
    this._imageFallbacks = new Map();
    this._sessionCache = null;
    this._sessionCacheKey = null;
  }

  static getStubConfig() {
    return {
      title: "Gaming",
      users: [],
      hide_offline: false,
      show_toggle: true,
      max_online: 0,
      max_offline: 0,
      sort_by: "status",
      click_action: "popup",
      click_action_target: "",
      compact_mode: false,
      voice_highlight_color: "",
      voice_text_color: "",
      voice_status_style: "inline",
      view_mode: "grid",
      image_source: "auto",
      game_images: {},
    };
  }

  setConfig(config) {
    if (!Array.isArray(config.users) || config.users.some(user => !user || typeof user !== "object")) {
      throw new Error("users must be a list of player profiles");
    }
    if (config.users.some(user => user.session_entities != null && !Array.isArray(user.session_entities))) {
      throw new Error("session_entities must be a list of entity IDs");
    }
    if (config.game_images != null && (typeof config.game_images !== "object" || Array.isArray(config.game_images) ||
        Object.values(config.game_images).some(url => typeof url !== "string"))) {
      throw new Error("game_images must map game titles to image URLs");
    }
    if (!["auto", "standard"].includes(config.image_source ?? "auto")) {
      throw new Error('image_source must be "auto" or "standard"');
    }
    this._closeDetails();
    this._sessionObservations.clear();
    this._sessionCache = null;
    this._sessionCacheKey = null;
    this._imageFallbacks.clear();
    this._relevantStates = null;
    this._hideOffline = config.hide_offline === true || config.show_offline === false;
    this.config = config;
    if (this._hass) this.hass = this._hass;
  }

  set hass(hass) {
    this._hass = hass;
    // One shared index per HA update; unrelated entity updates do not rebuild players.
    const prefixes = (this.config?.users || []).flatMap(profile => [profile.discord, profile.xbox].filter(Boolean));
    const direct = new Set((this.config?.users || []).flatMap(profile => [profile.discord, profile.xbox,
      ...(Array.isArray(profile.steam) ? profile.steam : [profile.steam]), ...(profile.session_entities || [])].filter(Boolean)));
    const relevant = new Map();
    const discord = new Map(prefixes.map(prefix => [prefix, []]));
    const gaming = [];
    for (const [id, state] of Object.entries(hass.states)) {
      const gs = id.startsWith("sensor.gaming_status_");
      const matches = prefixes.filter(prefix => id.startsWith(prefix + "_") ||
        (prefix.startsWith("binary_sensor.") && id.split(".")[1]?.startsWith(prefix.split(".")[1] + "_")));
      if (gs || direct.has(id) || matches.length) relevant.set(id, state);
      if (gs) gaming.push([id, state]);
      for (const prefix of matches) discord.get(prefix).push([id, state]);
    }
    const previous = this._relevantStates;
    const same = previous && previous.size === relevant.size && [...relevant].every(([id, state]) => previous.get(id) === state);
    const zone = hass.config?.time_zone;
    const zoneChanged = zone !== this._timeZone;
    this._timeZone = zone;
    if (same) { if (zoneChanged) this.requestUpdate(); return; }
    this._relevantStates = relevant;
    this._discordIndex = discord;
    this._gamingIndex = gaming;
    this._sessionCache = null;
    this._sessionCacheKey = null;
    this._entities = this._buildEntities(hass);
    this._checkSteamFallbacks(this._entities);
    this._syncSessionTimer();
    this.requestUpdate();
  }

  connectedCallback() {
    super.connectedCallback();
    UnifiedGamingCard._lookupListeners.add(this);
    this._checkSteamFallbacks(this._entities || []);
    this._syncSessionTimer();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    UnifiedGamingCard._lookupListeners.delete(this);
    clearInterval(this._sessionTimer);
    this._sessionTimer = null;
    this._closeDetails();
  }

  _syncSessionTimer() {
    const active = this.isConnected && this._entities?.some(e => e.session_start);
    if (active && !this._sessionTimer) {
      this._sessionTimer = setInterval(() => this.requestUpdate(), 60000);
    } else if (!active) {
      clearInterval(this._sessionTimer);
      this._sessionTimer = null;
    }
  }

  get hass() {
    return this._hass;
  }

  _buildEntities(hass) {
    const users = this.config?.users || [];
    const entities = [];

    for (const profile of users) {
      const entry = {
        profile_index: entities.length,
        name: profile.name || "Unknown",
        discord_entity: null,
        steam_entities: [],
        discord_state: null,
        discord_game: null,
        discord_game_details: null,
        discord_game_images: {},
        discord_voice: null,
        discord_voice_sensor: null,
        discord_voice_mute: false,
        discord_voice_deaf: false,
        discord_voice_stream: false,
        discord_voice_duration: null,
        discord_avatar: null,
        discord_activity_state: null,
        discord_watching: null,
        discord_watching_details: null,
        discord_watching_url: null,
        discord_watching_image_large: null,
        discord_streaming: null,
        discord_streaming_details: null,
        discord_streaming_url: null,
        discord_listening: null,
        discord_listening_details: null,
        discord_listening_url: null,
        discord_spotify_artists: null,
        discord_spotify_title: null,
        discord_spotify_album: null,
        discord_spotify_album_cover_url: null,
        discord_custom_status: null,
        discord_custom_emoji: null,
        steam_states: [],
        steam_games: [],
        steam_game_images: [],
        steam_avatars: [],
        xbox_entity: null,
        xbox_state: null,
        xbox_game: null,
        xbox_avatar: null,
        xbox_game_images: {},
        xbox_status: null,
        xbox_last_online: null,
      };

      // Discord entity lookup
      if (profile.discord) {
        const baseState = hass.states[profile.discord];
        if (baseState) {
          entry.discord_entity = baseState;
          entry.discord_state = baseState.state;
          entry.discord_avatar = baseState.attributes?.entity_picture || null;

          const prefix = profile.discord;
          for (const [entityId, state] of (this._discordIndex?.get(prefix) || Object.entries(hass.states))) {
            if (entityId === prefix || !entityId.startsWith(prefix + "_")) continue;
            const suffix = entityId.slice(prefix.length + 1);
            if (suffix === "game") entry.discord_game = state.state !== "unknown" && state.state !== "None" ? state.state : null;
            else if (suffix === "game_details") entry.discord_game_details = state.state !== "unknown" && state.state !== "None" ? state.state : null;
            else if (suffix === "game_image_header") entry.discord_game_images.header = state.state;
            else if (suffix === "game_image_capsule_231x87") entry.discord_game_images.capsule = state.state;
            else if (suffix === "game_image_large") entry.discord_game_images.large = state.state;
            else if (suffix === "game_image_library_hero") entry.discord_game_images.hero = state.state;
            else if (suffix === "voice_channel") entry.discord_voice_sensor = state.state;
            else if (suffix === "voice_self_mute") entry.discord_voice_mute = state.state === "True";
            else if (suffix === "voice_self_deaf") entry.discord_voice_deaf = state.state === "True";
            else if (suffix === "voice_self_stream") entry.discord_voice_stream = state.state === "True";
            else if (suffix === "voice_duration") entry.discord_voice_duration = state.state !== "unknown" && state.state !== "None" ? state.state : null;
            else if (suffix === "watching") entry.discord_watching = state.state;
            else if (suffix === "watching_details") entry.discord_watching_details = state.state;
            else if (suffix === "watching_url") entry.discord_watching_url = state.state;
            else if (suffix === "watching_image_large") entry.discord_watching_image_large = state.state;
            else if (suffix === "streaming") entry.discord_streaming = state.state;
            else if (suffix === "streaming_details") entry.discord_streaming_details = state.state;
            else if (suffix === "streaming_url") entry.discord_streaming_url = state.state;
            else if (suffix === "listening") entry.discord_listening = state.state;
            else if (suffix === "listening_details") entry.discord_listening_details = state.state;
            else if (suffix === "listening_url") entry.discord_listening_url = state.state;
            else if (suffix === "spotify_artists") entry.discord_spotify_artists = state.state;
            else if (suffix === "spotify_title") entry.discord_spotify_title = state.state;
            else if (suffix === "spotify_album") entry.discord_spotify_album = state.state;
            else if (suffix === "spotify_album_cover_url") entry.discord_spotify_album_cover_url = state.state;
            else if (suffix === "custom_status") entry.discord_custom_status = state.state !== "unknown" && state.state !== "None" ? state.state : null;
            else if (suffix === "custom_emoji") entry.discord_custom_emoji = state.state !== "unknown" && state.state !== "None" ? state.state : null;
          }
          if ("activity_state" in (baseState.attributes || {})) {
            entry.discord_activity_state = baseState.attributes.activity_state;
          }
          if ("voice_channel" in (baseState.attributes || {})) {
            entry.discord_voice = baseState.attributes.voice_channel;
          } else if (entry.discord_voice_sensor !== "unknown" && entry.discord_voice_sensor !== "None") {
            entry.discord_voice = entry.discord_voice_sensor;
          }
          const attrs = baseState.attributes || {};
          if (typeof attrs.voice_self_muted === "boolean") entry.discord_voice_mute = attrs.voice_self_muted;
          if (typeof attrs.voice_self_deafened === "boolean") entry.discord_voice_deaf = attrs.voice_self_deafened;
          if (typeof attrs.voice_streaming === "boolean") entry.discord_voice_stream = attrs.voice_streaming;
          entry.discord_voice_self_video = attrs.voice_broadcasting_video === true;
        }
      }

      // Steam entity lookup (supports string or array)
      const steamIds = Array.isArray(profile.steam) ? profile.steam : (profile.steam ? [profile.steam] : []);
      for (const steamId of steamIds) {
        const steamState = hass.states[steamId];
        if (steamState) {
          entry.steam_entities.push(steamState);
          const rawState = steamState.state;
          const stateMap = { online: "online", busy: "dnd", looking_to_play: "online", looking_to_trade: "online", away: "idle", snooze: "dnd", offline: "offline" };
          entry.steam_states.push(stateMap[rawState] || "offline");
          entry.steam_avatars.push(steamState.attributes?.entity_picture || null);
          const game = steamState.attributes?.game || null;
          entry.steam_games.push(game);
          const imgs = {};
          if (steamState.attributes?.game_image_header) imgs.header = steamState.attributes.game_image_header;
          if (steamState.attributes?.game_image_main) imgs.main = steamState.attributes.game_image_main;
          imgs.hero = this._steamHero(steamState.attributes);
          entry.steam_game_images.push(imgs);
        }
      }

      // Xbox entity lookup (official Xbox integration or gaming_status)
      if (profile.xbox) {
        const xboxState = hass.states[profile.xbox];
        if (xboxState) {
          entry.xbox_entity = xboxState;
          const isGamingStatus = profile.xbox.startsWith("sensor.gaming_status_") && profile.xbox.endsWith("_xbox");

          if (isGamingStatus) {
            // gaming_status Xbox sensor
            const rawState = xboxState.state;
            const stateMap = { "Online": "online", "Offline": "offline", "online": "online", "offline": "offline" };
            entry.xbox_state = stateMap[rawState] || (rawState && rawState !== "unknown" && rawState !== "unavailable" ? "online" : "offline");
            entry.xbox_game = xboxState.attributes?.current_game && xboxState.attributes.current_game !== "unknown" ? xboxState.attributes.current_game : null;
            entry.xbox_avatar = xboxState.attributes?.entity_picture || null;
            entry.xbox_status = xboxState.attributes?.secondary || null;
            entry.xbox_last_online = xboxState.attributes?.last_online_valid_timestamp || null;
            // Gaming Status artwork is appended after native sources in _mergeImages.
          } else {
            // Official Xbox integration: binary_sensor.{gamertag}
            entry.xbox_state = xboxState.state === "on" ? "online" : "offline";
            entry.xbox_avatar = xboxState.attributes?.entity_picture || null;

            // Derive related entities from gamertag
            const parts = profile.xbox.split(".");
            const gamertag = parts[parts.length - 1];
            const nowPlayingId = `sensor.${gamertag}_now_playing`;
            const statusId = `sensor.${gamertag}_status`;
            const lastOnlineId = `sensor.${gamertag}_last_online`;
            const gamerpicId = `image.${gamertag}_gamerpic`;
            const nowPlayingImgId = `image.${gamertag}_now_playing`;

            const nowPlaying = hass.states[nowPlayingId];
            if (nowPlaying && nowPlaying.state && nowPlaying.state !== "unknown") {
              entry.xbox_game = nowPlaying.state;
            }
            const statusEnt = hass.states[statusId];
            if (statusEnt && statusEnt.state && statusEnt.state !== "unknown") {
              entry.xbox_status = statusEnt.state;
            }
            const lastOnline = hass.states[lastOnlineId];
            if (lastOnline && lastOnline.state && lastOnline.state !== "unknown") {
              entry.xbox_last_online = lastOnline.state;
            }
            const gamerpic = hass.states[gamerpicId];
            if (gamerpic && gamerpic.attributes?.entity_picture) {
              entry.xbox_avatar = gamerpic.attributes.entity_picture;
            }
            const nowPlayingImg = hass.states[nowPlayingImgId];
            const imgs = {};
            if (nowPlayingImg && nowPlayingImg.attributes?.entity_picture) {
              imgs.header = nowPlayingImg.attributes.entity_picture;
              imgs.hero = nowPlayingImg.attributes.entity_picture;
            }
            entry.xbox_game_images = imgs;
          }
        }
      }

      entry.merged_status = this._mergeStatus(entry);
      entry.merged_game = this._mergeGame(entry);
      entry.session_start = this._sessionStart(profile, entry, hass);
      entry.merged_activity = this._mergeActivity(entry);
      entry.merged_images = this._mergeImages(entry, hass);
      entry.merged_avatar = entry.discord_avatar || entry.xbox_avatar || entry.steam_avatars.find(a => a) || null;
      entry.platform = this._getPlatform(entry);

      entities.push(entry);
    }

    return entities;
  }

  _timestamp(value) {
    // Only sourced, timezone-qualified timestamps; never presence last_changed.
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
    const [year, month, day, hour] = value.match(/\d+/g).map(Number);
    if (month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate() || hour > 23) return null;
    const time = Date.parse(value);
    return Number.isFinite(time) && time > 0 && time <= Date.now() ? time : null;
  }

  _avatarIdentity(value) {
    // The picture URL of a Discord or Steam account names that account, so two
    // players can only share an identity when it is genuinely the same account.
    if (typeof value !== "string" || !value) return null;
    try {
      const url = new URL(value, "https://localhost");
      const path = url.pathname.replace(/\.(?:png|jpe?g|webp|gif)$/i, "");
      const discord = path.match(/^\/avatars\/(\d{15,25})\/([a-f0-9]{16,})$/i);
      if (discord) return `discord:${discord[1]}:${discord[2].toLowerCase()}`;
      const steam = path.match(/^\/([a-f0-9]{32,64})(?:_[a-z0-9]+)?$/i);
      if (steam && /^(?:[a-z0-9-]+\.)*steamstatic\.com$|^(?:[a-z0-9-]+\.)*steamcdn-a\.akamaihd\.net$/i.test(url.hostname)) {
        return `steam:${steam[1].toLowerCase()}`;
      }
    } catch (_) { /* No comparable account identity in this picture. */ }
    return null;
  }

  _gamingSlugs(hass) {
    const index = this._gamingIndex || Object.entries(hass?.states || {});
    const siblings = new Map();
    const byIdentity = new Map();
    const shared = new Set();
    for (const [id, state] of index) {
      if (typeof id !== "string" || !id.startsWith("sensor.gaming_status_")) continue;
      const slug = id.slice("sensor.gaming_status_".length).replace(/_(?:steam|discord|xbox|pc|master)$/, "");
      if (!slug) continue;
      if (!siblings.has(slug)) siblings.set(slug, []);
      siblings.get(slug).push(id);
      // Only the account platforms carry a comparable picture, never the aggregated ones.
      const identity = this._avatarIdentity(state?.attributes?.entity_picture);
      if (!identity) continue;
      if (byIdentity.has(identity) && byIdentity.get(identity) !== slug) shared.add(identity);
      else byIdentity.set(identity, slug);
    }
    for (const identity of shared) byIdentity.delete(identity);
    return { siblings, byIdentity };
  }

  _sessionCandidates(profile, hass) {
    const index = this._gamingIndex;
    const key = index ?? hass?.states;
    if (this._sessionCache && this._sessionCacheKey === key) return this._sessionCache;
    const profiles = this.config?.users || [];
    const { siblings, byIdentity } = this._gamingSlugs(hass);
    const slugs = profiles.map(profile => {
      const identities = [profile.discord, profile.steam, profile.xbox].flatMap(list => (Array.isArray(list) ? list : [list]))
        .filter(id => typeof id === "string")
        .map(id => this._avatarIdentity(hass?.states?.[id]?.attributes?.entity_picture));
      return [...new Set(identities.map(identity => byIdentity.get(identity)).filter(Boolean))];
    });
    // Two profiles claiming one account is unresolvable, so neither may use it.
    const owners = new Map();
    slugs.forEach((claimed, index2) => claimed.forEach(slug => owners.set(slug, owners.has(slug) ? null : index2)));
    this._sessionCache = slugs.map((claimed, index2) => claimed.filter(slug => owners.get(slug) === index2)
      .flatMap(slug => siblings.get(slug) || []));
    this._sessionCacheKey = key;
    return this._sessionCache;
  }

  _sessionStart(profile, entry, hass) {
    const configured = Array.isArray(profile.session_entities) ? profile.session_entities : [];
    let result = null;

    // A shared game title does not identify a player, so only sensors tied to
    // this account count. Explicit links are kept as written, and matching the
    // account itself adds any platform the list happened to leave out.
    let ids = [...new Set([...configured, ...(this._sessionCandidates(profile, hass)[entry.profile_index] || [])])];
    if (!ids.length && profile.xbox?.startsWith("sensor.gaming_status_")) {
      ids.push(profile.xbox);
    }

    for (const id of ids) {
      if (typeof id !== "string" || !id.startsWith("sensor.gaming_status_")) continue;
      const sensor = hass.states[id];
      const attrs = sensor?.attributes || {};
      const key = `${entry.profile_index}:${id}`;
      const previous = this._sessionObservations.get(key);
      const stale = previous?.start === attrs.play_start_time &&
        (previous?.stale || previous?.game !== attrs.current_game);
      this._sessionObservations.set(key, { start: attrs.play_start_time, game: attrs.current_game, stale });
      if (stale || !entry.merged_game || entry.merged_status.status === "offline" ||
          !sensor || ["unknown", "unavailable", "offline"].includes(sensor.state.toLowerCase()) ||
          attrs.timer_status !== "Running" || this._artTitle(attrs.current_game) !== this._artTitle(entry.merged_game.game)) continue;
      const start = this._timestamp(attrs.play_start_time);
      if (start && !result) result = start;
    }
    return result;
  }

  _sessionElapsed(entry) {
    const start = entry.session_start;
    if (!Number.isFinite(start) || start <= 0 || start > Date.now()) return null;
    const minutes = Math.floor((Date.now() - start) / 60000);
    if (minutes < 1) return "< 1 min";
    return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} t ${minutes % 60} min`;
  }

  _mergeStatus(entry) {
    const ds = entry.discord_state;
    const sStates = entry.steam_states;
    const isOnline = (s) => s && s !== "offline" && s !== "unavailable" && s !== "unknown";

    const discordOnline = isOnline(ds);
    const steamOnline = sStates.some(s => isOnline(s));
    const xboxOnline = entry.xbox_state === "online";

    const hasDiscord = !!entry.discord_entity;
    const hasSteam = entry.steam_entities.length > 0;
    const hasXbox = !!entry.xbox_entity;

    const onlinePlatforms = [];
    if (discordOnline) onlinePlatforms.push("discord");
    if (xboxOnline) onlinePlatforms.push("xbox");
    if (steamOnline) onlinePlatforms.push("steam");

    if (onlinePlatforms.length > 0) {
      const status = discordOnline ? ds : (xboxOnline ? "online" : (sStates.find(s => isOnline(s)) || "online"));
      return { status, platforms: onlinePlatforms };
    }

    const allPlatforms = [];
    if (hasDiscord) allPlatforms.push("discord");
    if (hasXbox) allPlatforms.push("xbox");
    if (hasSteam) allPlatforms.push("steam");
    return { status: "offline", platforms: allPlatforms };
  }

  _mergeGame(entry) {
    const valid = value => typeof value === "string" && value.trim() && !["unknown", "unavailable", "none"].includes(value.toLowerCase()) ? value : null;
    const dg = valid(entry.discord_game);
    const dgDetails = valid(entry.discord_game_details);
    const xg = valid(entry.xbox_game);
    for (const sg of entry.steam_games) {
      const game = valid(sg);
      if (dg && game) return { game: dg, details: dgDetails, source: "discord" };
      if (dg) return { game: dg, details: dgDetails, source: "discord" };
      if (xg && game) return { game: xg, details: null, source: "xbox" };
      if (xg) return { game: xg, details: null, source: "xbox" };
      if (game) return { game, details: null, source: "steam" };
    }
    if (dg) return { game: dg, details: dgDetails, source: "discord" };
    if (xg) return { game: xg, details: null, source: "xbox" };
    return null;
  }

  _imageUrl(value) {
    if (typeof value !== "string") return null;
    value = value.trim();
    if (!value || /^(unknown|unavailable|none|null)$/i.test(value)) return null;
    try {
      const url = new URL(value, window.location.origin);
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
      // HA cache artwork belongs to this HA origin, never a third-party proxy/CDN.
      if (url.pathname.startsWith("/local/gaming_status_cache/")) return url.pathname + url.search;
      if (!/^https?:\/\//i.test(value) && !/^\/(?!\/)/.test(value)) return null;
      return value;
    } catch (_) {
      return null;
    }
  }

  _artTitle(value) {
    // Artwork only: do not broaden the separate session timestamp matching.
    return typeof value === "string" ? value.replace(/[\u2122\u00ae]/g, "").toLowerCase().replace(/\s+/g, " ").trim() : "";
  }

  _steamHero(attrs = {}) {
    let appId = /^[1-9]\d*$/.test(String(attrs.game_id)) ? String(attrs.game_id) : null;
    for (const value of [attrs.game_image_header, attrs.game_image_main]) {
      if (appId) break;
      try {
        const url = new URL(value);
        if (url.protocol !== "https:" || url.username || url.password ||
            !/^(?:[a-z0-9-]+\.)*(?:steamstatic\.com|steamcdn-a\.akamaihd\.net|steampowered\.com)$/.test(url.hostname)) continue;
        appId = url.pathname.match(/^\/(?:steam\/apps|store_item_assets\/steam\/apps|app)\/([1-9]\d*)(?:\/|$)/)?.[1];
      } catch (_) { /* No trusted app ID in this URL. */ }
    }
    return appId ? `https://cdn.akamai.steamstatic.com/steam/apps/${appId}/library_hero.jpg` : null;
  }

  _mergeImages(entry, hass) {
    const di = entry.discord_game_images;
    const xi = entry.xbox_game_images;
    const title = this._artTitle(entry.merged_game?.game);
    const matches = game => title && this._artTitle(game) === title;
    const groups = [
      ["discord", matches(entry.discord_game) ? [di.hero, di.header, di.large, di.capsule] : []],
      ["watching", !title ? [entry.discord_watching_image_large] : []],
      ["xbox", matches(entry.xbox_game) ? [xi.hero, xi.header, xi.logo] : []],
      ...entry.steam_game_images.map((si, i) => ["steam", matches(entry.steam_games[i]) ? [si.header, si.main] : []]),
      ...entry.steam_game_images.map((si, i) => ["steam", matches(entry.steam_games[i]) ? [si.hero] : []]),
      ["spotify", !title ? [entry.discord_spotify_album_cover_url] : []],
    ];
    let source = null;
    let candidates = [];
    const sources = {};
    for (const [game, image] of Object.entries(this.config.game_images || {})) {
      const url = matches(game) ? this._imageUrl(image) : null;
      if (url) { candidates.push(url); sources[url] = "custom"; source = "custom"; }
    }
    // Keep every matching native candidate, with supplied art before derived heroes.
    for (const [name, urls] of groups) {
      const valid = urls.map(url => this._imageUrl(url)).filter(Boolean);
      if (valid.length) {
        source ||= name;
        candidates.push(...valid);
        for (const url of valid) sources[url] ||= name;
      }
    }
    if (this.config.image_source !== "standard" && title) {
      const artwork = [];
      for (const [id, sensor] of (this._gamingIndex || Object.entries(hass?.states || {}))) {
        if (!id.startsWith("sensor.gaming_status_") || ["unknown", "unavailable"].includes(sensor.state?.toLowerCase())) continue;
        const attrs = sensor.attributes || {};
        if (this._artTitle(attrs.current_game) !== title) continue;
        artwork.push(...[attrs.game_hero_art, attrs.game_cover_art].map(url => this._imageUrl(url)).filter(Boolean));
      }
      if (artwork.length) {
        candidates.push(...artwork); source ||= "gaming_status";
        for (const url of artwork) sources[url] ||= "gaming_status";
      }
    }
    candidates = [...new Set(candidates)];
    return candidates.length ? { hero: candidates[0], header: candidates[1] || candidates[0], large: candidates[2] || candidates[0], candidates, source, sources } : null;
  }

  _backgroundImage(entry) {
    const images = entry.merged_images;
    const candidates = [...new Set((images?.candidates || [images?.hero, images?.header, images?.large]).map(url => this._imageUrl(url)).filter(Boolean))];
    const key = JSON.stringify([this.config.image_source || "auto", entry.merged_game?.game, images?.source, candidates]);
    let fallback = this._imageFallbacks.get(entry.profile_index);
    if (fallback?.key !== key) {
      fallback = { key, candidates, index: 0 };
      this._imageFallbacks.set(entry.profile_index, fallback);
    }
    return fallback;
  }

  _imageError(entry, fallback, url) {
    if (this._imageFallbacks.get(entry.profile_index) !== fallback || fallback.candidates[fallback.index] !== url) return;
    fallback.index++;
    this.requestUpdate();
  }

  _mergeActivity(entry) {
    const has = (v) => v && v !== "unknown" && v !== "None";
    const nameOr = (...vals) => vals.find(has);

    if (entry.merged_game) {
      const details = entry.merged_game.details || entry.discord_activity_state;
      return { 
        text: entry.merged_game.game, 
        subtitle: details,
        icon: null, 
        type: "game" 
      };
    }
    if (has(entry.discord_spotify_title)) {
      const artist = entry.discord_spotify_artists;
      return {
        text: artist ? `${artist} - ${entry.discord_spotify_title}` : entry.discord_spotify_title,
        icon: "mdi:spotify",
        type: "spotify",
      };
    }
    if (has(entry.discord_watching_details) || has(entry.discord_watching)) {
      const name = nameOr(entry.discord_watching_details, entry.discord_watching);
      const ep = entry.discord_activity_state;
      return {
        text: `${name}${ep && has(ep) ? " - " + ep : ""}`,
        icon: "mdi:television-play",
        type: "watching",
      };
    }
    if (has(entry.discord_streaming)) {
      const name = entry.discord_streaming;
      const det = entry.discord_streaming_details;
      return {
        text: `${name}${det && has(det) ? " - " + det : ""}`,
        icon: "mdi:stream",
        type: "streaming",
      };
    }
    if (has(entry.discord_listening)) {
      const name = entry.discord_listening;
      const det = entry.discord_listening_details;
      return {
        text: `${name}${det && has(det) ? " - " + det : ""}`,
        icon: "mdi:headphones",
        type: "listening",
      };
    }
    if (has(entry.discord_custom_status)) {
      const emoji = entry.discord_custom_emoji;
      return {
        text: `${emoji ? emoji + " " : ""}${entry.discord_custom_status}`,
        icon: null,
        type: "custom",
      };
    }
    return null;
  }

  _getPlatform(entry) {
    const isOnline = (s) => s && s !== "offline" && s !== "unavailable" && s !== "unknown";
    const hasDiscord = !!entry.discord_entity;
    const hasSteam = entry.steam_entities.length > 0;
    const hasXbox = !!entry.xbox_entity;
    const discordOnline = hasDiscord && isOnline(entry.discord_state);
    const steamOnline = hasSteam && entry.steam_states.some(s => isOnline(s));
    const xboxOnline = hasXbox && entry.xbox_state === "online";

    const platforms = [];
    if (discordOnline) platforms.push("discord");
    if (xboxOnline) platforms.push("xbox");
    if (steamOnline) platforms.push("steam");
    return platforms.length > 0 ? platforms : null;
  }

  _checkSteamFallbacks(entities) {
    for (const entry of entities) {
      if (entry.merged_images) continue;
      const game = entry.merged_game;
      if (!game) continue;

      const cacheKey = this._artTitle(game.game);
      if (UnifiedGamingCard._steamCache.has(cacheKey)) {
        const cached = UnifiedGamingCard._steamCache.get(cacheKey);
        if (cached.expires > Date.now()) {
          if (cached.url) this._applySteamImages(entry, cached.url);
          continue;
        }
        UnifiedGamingCard._steamCache.delete(cacheKey);
      }
      if (!UnifiedGamingCard._fetching.has(cacheKey)) {
        this._fetchSteamImages(game.game, cacheKey);
      }
    }
  }

  _applySteamImages(entry, baseUrl) {
    entry.merged_images = {
      header: `${baseUrl}/header.jpg`,
      large: `${baseUrl}/capsule_616x353.jpg`,
      hero: `${baseUrl}/library_hero.jpg`,
      source: "steam_lookup",
    };
  }

  async _fetchSteamImages(gameName, cacheKey) {
    UnifiedGamingCard._fetching.add(cacheKey);
    // Failures and empty/ambiguous results receive a ten-minute negative cache.
    let cached = { url: null, expires: Date.now() + 600000 };
    try {
      const url = `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(gameName)}&l=english&cc=US`;
      const resp = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!resp.ok) return;
      const data = await resp.json();
      if (!data.items || data.items.length === 0) return;
      const matches = data.items.filter(item => this._artTitle(item.name) === cacheKey && /^[1-9]\d*$/.test(String(item.id)));
      if (matches.length !== 1) return;
      const appId = matches[0].id;
      const baseUrl = `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}`;
      cached = { url: baseUrl, expires: Date.now() + 86400000 };
    } catch (_) {
      // Network/CORS/timeout failures use the same bounded negative cache.
    } finally {
      UnifiedGamingCard._steamCache.set(cacheKey, cached);
      while (UnifiedGamingCard._steamCache.size > 200) UnifiedGamingCard._steamCache.delete(UnifiedGamingCard._steamCache.keys().next().value);
      UnifiedGamingCard._fetching.delete(cacheKey);
      for (const card of new Set([this, ...UnifiedGamingCard._lookupListeners])) {
        card._checkSteamFallbacks(card._entities || []);
        card.requestUpdate();
      }
    }
  }

  _filterByStatus(entities) {
    const hideOffline = this._hideOffline;
    if (!hideOffline) return entities;
    return entities.filter(e => e.merged_status.status !== "offline" || (e.discord_voice && e.discord_voice !== "unknown"));
  }

  _sortByStatus(entities) {
    const sortBy = this.config.sort_by || "status";
    const groups = { online: [], idle: [], dnd: [], offline: [], unavailable: [] };
    for (const e of entities) {
      const group = groups[e.merged_status.status] || groups.offline;
      group.push(e);
    }
    for (const key of Object.keys(groups)) {
      groups[key].sort((a, b) => {
        const aVoice = a.discord_voice ? 0 : 1;
        const bVoice = b.discord_voice ? 0 : 1;
        if (aVoice !== bVoice) return aVoice - bVoice;
        if (sortBy === "name") return a.name.localeCompare(b.name);
        if (sortBy === "game") {
          const ag = a.merged_activity ? a.merged_activity.text : (a.merged_game ? a.merged_game.game : "");
          const bg = b.merged_activity ? b.merged_activity.text : (b.merged_game ? b.merged_game.game : "");
          if (ag && !bg) return -1;
          if (!ag && bg) return 1;
          return ag.localeCompare(bg) || a.name.localeCompare(b.name);
        }
        return a.name.localeCompare(b.name);
      });
    }
    return groups;
  }

  _stateLabel(state) {
    switch (state) {
      case "online": return "Online";
      case "idle": return "Inaktiv";
      case "dnd": return "Forstyr ikke";
      case "offline": return "Offline";
      default: return state && state !== "unknown" ? state : "Offline";
    }
  }

  _handleAction(entry, trigger) {
    const action = this.config.click_action || "popup";
    const target = this.config.click_action_target || "";
    if (action === "navigate") {
      if (!target) return;
      history.pushState(null, "", target);
      window.dispatchEvent(new Event("location-changed", { composed: true }));
    } else if (action === "toggle") {
      if (!target) return;
      this.hass.callService(target.split(".")[0], "toggle", { entity_id: target });
    } else if (action === "more-info") {
      const entity = entry.discord_entity || entry.xbox_entity || entry.steam_entities[0];
      if (!entity) return;
      const event = new Event("hass-more-info", { composed: true });
      event.detail = { entityId: entity.entity_id };
      this.dispatchEvent(event);
    } else if (action === "popup") {
      this._popupTrigger = trigger;
      this._selectedPlayer = entry.profile_index;
    }
  }

  updated() {
    const dialog = this.renderRoot?.querySelector("dialog");
    if (this._selectedPlayer != null && dialog && !dialog.open) dialog.showModal();
  }

  _closeDetails() {
    this._selectedPlayer = null;
    this.renderRoot?.querySelector("dialog")?.close();
    this._popupTrigger?.focus();
    this._popupTrigger = null;
  }

  _renderDetails() {
    const entry = this._selectedPlayer == null ? null : this._entities?.find(e => e.profile_index === this._selectedPlayer);
    if (!entry) return "";
    const has = value => typeof value === "string" && value.trim() && !["unknown", "unavailable", "none"].includes(value.toLowerCase());
    const elapsed = this._sessionElapsed(entry);
    const background = this._backgroundImage(entry);
    const imageUrl = background.candidates[background.index];
    const imageSource = entry.merged_images?.sources?.[imageUrl] || entry.merged_images?.source;
    const sourceLabel = { custom: "Eget billede", discord: "Discord", xbox: "Xbox", steam: "Steam",
      steam_lookup: "Steam-søgning", gaming_status: "Gaming Status", watching: "Discord video", spotify: "Spotify" };
    const lastOnline = value => {
      const time = this._timestamp(value);
      return time ? new Intl.DateTimeFormat("da-DK", {
        dateStyle: "medium", timeStyle: "short", timeZone: this.hass.config?.time_zone || "Europe/Copenhagen",
      }).format(time) : null;
    };
    const platforms = [
      ...(entry.discord_entity ? [{ name: "Discord", state: entry.discord_state, game: entry.discord_game }] : []),
      ...entry.steam_entities.map((sensor, i) => ({ name: entry.steam_entities.length > 1 ? `Steam ${i + 1}` : "Steam", state: sensor.state, game: entry.steam_games[i], last: lastOnline(sensor.attributes?.last_online) })),
      ...(entry.xbox_entity ? [{ name: "Xbox", state: ["unknown", "unavailable"].includes(entry.xbox_entity.state) ? entry.xbox_entity.state : entry.xbox_state, game: entry.xbox_game, last: lastOnline(entry.xbox_last_online) }] : []),
    ];
    return html`
      <dialog aria-labelledby="player-details-title" @cancel=${event => { event.preventDefault(); this._closeDetails(); }}
        @close=${this._closeDetails} @click=${event => {
          if (event.target !== event.currentTarget) return;
          const rect = event.currentTarget.getBoundingClientRect();
          if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) this._closeDetails();
        }}>
        <div class="details-header"><h2 id="player-details-title">${entry.name}</h2>
          <button type="button" autofocus @click=${this._closeDetails} aria-label="Luk spillerdetaljer">Luk</button></div>
        ${entry.merged_game ? html`<p class="details-game">${entry.merged_game.game}${elapsed ? html`<span class="session-elapsed"> · ${elapsed}</span>` : ""}</p>` : ""}
        ${elapsed ? html`<p class="details-note">Sessionstid fra Gaming Status</p>` : ""}
        ${has(entry.merged_game?.details) ? html`<p>${entry.merged_game.details}</p>` : ""}
        <dl>${platforms.map(platform => html`
          <dt>${platform.name}</dt><dd>${platform.state === "unavailable" ? "Utilgængelig" : platform.state === "unknown" ? "Ukendt" : this._stateLabel(({ away: "idle", snooze: "dnd" })[platform.state] || platform.state)}
            ${has(platform.game) ? html`<div>${platform.game}</div>` : ""}
            ${platform.last ? html`<div class="details-note">Sidst online: ${platform.last}</div>` : ""}</dd>`)}
          <dt>Billedkilde</dt><dd>${imageUrl ? html`${sourceLabel[imageSource] || imageSource}
            <a href=${imageUrl} target="_blank" rel="noopener noreferrer">Åbn billede</a>` : "Intet tilgængeligt billede"}</dd>
          ${has(entry.discord_voice) ? html`<dt>Voice</dt><dd>${entry.discord_voice}
            ${has(entry.discord_voice_duration) ? html`<div>${entry.discord_voice_duration}</div>` : ""}
            ${entry.discord_voice_mute ? html`<div>Mikrofon slået fra</div>` : ""}
            ${entry.discord_voice_deaf ? html`<div>Lyd slået fra</div>` : ""}
            ${entry.discord_voice_stream ? html`<div>Deler skærm</div>` : ""}
            ${entry.discord_voice_self_video ? html`<div>Kamera aktivt</div>` : ""}</dd>` : ""}
        </dl>
      </dialog>`;
  }

  _renderUserItem(entry) {
    const state = entry.merged_status.status;
    const platform = entry.platform;
    const game = entry.merged_game;
    const activity = entry.merged_activity;
    const avatar = entry.merged_avatar;
    const voice = entry.discord_voice;
    const compact = this.config.compact_mode;
    const voiceStyle = this.config.voice_status_style || "inline";
    const elapsed = game ? this._sessionElapsed(entry) : null;

    const fallback = this._backgroundImage(entry);
    const bgImg = compact ? null : fallback.candidates[fallback.index];

    return html`
      <div class="steam-multi ${voice ? "in-voice" : state} ${compact ? "compact" : ""} ${activity ? "has-activity" : ""}" role="button" tabindex="0" aria-label=${entry.name}
        @click=${event => this._handleAction(entry, event.currentTarget)} @keydown=${event => {
          if (event.key === "Enter" || event.key === " ") { event.preventDefault(); this._handleAction(entry, event.currentTarget); }
        }}>
        ${bgImg ? html`<img src="${bgImg}" class="steam-game-bg" @error=${() => this._imageError(entry, fallback, bgImg)}>` : ""}
        <div class="steam-user ${compact ? "compact" : ""}">
          <div class="avatar-wrap ${state}">
            ${avatar ? html`<img src="${avatar}${entry.discord_entity ? '?size=128' : ''}" class="steam-avatar ${state}" onerror="this.style.display='none'">` : html`<div class="steam-avatar ${state}"></div>`}
            ${voice && voiceStyle === "overlay" ? html`
            <div class="voice-status-overlay voice-status-left">
              ${entry.discord_voice_mute ? html`<ha-icon icon="mdi:microphone-off" class="voice-status-icon"></ha-icon>` : ""}
              ${entry.discord_voice_deaf ? html`<ha-icon icon="mdi:volume-off" class="voice-status-icon"></ha-icon>` : ""}
            </div>
            <div class="voice-status-overlay voice-status-right">
              ${entry.discord_voice_stream ? html`<ha-icon icon="mdi:monitor-shimmer" class="voice-status-icon"></ha-icon>` : ""}
              ${entry.discord_voice_self_video ? html`<ha-icon icon="mdi:webcam" class="voice-status-icon"></ha-icon>` : ""}
            </div>` : ""}
            
            <div class="platform-badge">
              ${(platform && platform.includes("discord")) ? html`<svg class="pf-icon discord" viewBox="0 0 24 24" fill="currentColor"><path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/></svg>` : ""}
              ${(platform && platform.includes("xbox")) ? html`<ha-icon icon="mdi:microsoft-xbox" class="pf-icon xbox"></ha-icon>` : ""}
              ${(platform && platform.includes("steam")) ? html`<ha-icon icon="mdi:steam" class="pf-icon steam"></ha-icon>` : ""}
            </div>
          </div>
          <div class="user-container">
            <div class="steam-name-row">
              <div class="steam-username ${voice ? "voice" : state}">${entry.name}</div>
              ${voice && voiceStyle === "inline" ? html`
              <div class="steam-voice-inline">
                ${entry.discord_voice_stream ? html`<ha-icon icon="mdi:monitor-shimmer" class="voice-inline-icon"></ha-icon>` : ""}
                ${entry.discord_voice_self_video ? html`<ha-icon icon="mdi:webcam" class="voice-inline-icon"></ha-icon>` : ""}
                ${entry.discord_voice_mute ? html`<ha-icon icon="mdi:microphone-off" class="voice-inline-icon"></ha-icon>` : ""}
                ${entry.discord_voice_deaf ? html`<ha-icon icon="mdi:volume-off" class="voice-inline-icon"></ha-icon>` : ""}
              </div>` : ""}
            </div>
            ${!compact ? html`
            <div class="steam-value ${voice ? "voice" : state}">
              ${activity ? html`
                <div class="activity-text">
                  ${activity.icon ? html`<ha-icon icon="${activity.icon}" class="mic-icon"></ha-icon>` : ""}
                  <span class="activity-name">${activity.text}</span>
                  ${elapsed && activity.type === "game" ? html`<span class="session-elapsed" title="Sessionstid fra Gaming Status"> · ${elapsed}</span>` : ""}
                </div>
                ${activity.subtitle ? html`<div class="activity-subtitle">${activity.subtitle}</div>` : ""}
              ` : ""}
              ${!voice && !activity ? this._stateLabel(state) : ""}
            </div>` : ""}
          </div>
        </div>
      </div>
    `;
  }

  render() {
    if (!this._hass || !this._entities || this._entities.length === 0) {
      return html`<ha-card><div class="empty">Ingen brugere fundet</div></ha-card>`;
    }

    const hideOffline = this._hideOffline;
    const showToggle = this.config.show_toggle !== false;
    const maxOnline = this.config.max_online || 0;
    const maxOffline = this.config.max_offline || 0;
    const compact = this.config.compact_mode;
    const voiceColor = this.config.voice_highlight_color || "";

    let cardStyle = "";
    const voiceTextColor = this.config.voice_text_color || "";
    if (voiceColor || voiceTextColor) {
      cardStyle = `--voice-color: ${voiceColor ? voiceColor : "#e44040"}; --voice-shadow: ${(voiceColor || "#e44040")}88; --voice-text-color: ${voiceTextColor ? voiceTextColor : "#4081e4"};`;
    }

    const filtered = this._filterByStatus(this._entities);
    const groups = this._sortByStatus(filtered);
    const allUsers = [...groups.online, ...groups.idle, ...groups.dnd, ...groups.unavailable, ...groups.offline];
    const inVoice = allUsers.filter(e => e.discord_voice && e.discord_voice !== "unknown");
    const gamingFirst = (a, b) => Number(!!b.merged_game) - Number(!!a.merged_game);
    const notInVoice = allUsers.filter(e => !e.discord_voice || e.discord_voice === "unknown").sort(gamingFirst);
    const voiceChannels = new Map();
    for (const e of inVoice) {
      const ch = e.discord_voice;
      if (!voiceChannels.has(ch)) voiceChannels.set(ch, { users: [], duration: null });
      const channelData = voiceChannels.get(ch);
      channelData.users.push(e);
      if (e.discord_voice_duration) {
        channelData.duration = e.discord_voice_duration;
      }
    }
    let offlineNotInVoice = notInVoice.filter(e => e.merged_status.status === "offline");
    if (maxOffline > 0) offlineNotInVoice = offlineNotInVoice.slice(0, maxOffline);
    let activeNotInVoice = notInVoice.filter(e => e.merged_status.status !== "offline");
    if (maxOnline > 0) activeNotInVoice = activeNotInVoice.slice(0, maxOnline);

    const viewMode = this.config.view_mode || "grid";
    const visibleUsers = [...activeNotInVoice, ...(!hideOffline ? offlineNotInVoice : [])].sort(gamingFirst);

    return html`
      <ha-card style="${cardStyle}">
        <div class="card-header">
          ${this.config.title ? html`<div class="name">${this.config.title}</div>` : html`<div></div>`}
          ${showToggle && groups.offline.length > 0
            ? html`<div class="toggle-btn" @click=${this._toggleOffline}>
                <ha-icon icon="${hideOffline ? "mdi:eye-off" : "mdi:eye"}"></ha-icon>
                <span>${hideOffline ? "Vis offline (" + groups.offline.length + ")" : "Skjul offline"}</span>
              </div>`
            : ""}
        </div>
        ${voiceChannels.size > 0
          ? html`${Array.from(voiceChannels.entries()).map(([channel, data]) => html`
              <div class="status-category">${channel} (${data.users.length})${data.duration ? html`<span class="voice-duration"> · ${data.duration}</span>` : ""}</div>
              <div class="user-grid ${compact ? "compact" : ""} ${viewMode === "list" ? "list-view" : ""}">
                ${[...data.users].sort(gamingFirst).map(e => this._renderUserItem(e))}
              </div>`)}`
          : ""}
        ${voiceChannels.size > 0
          ? html`<div class="voice-divider"></div>` : ""}
        ${visibleUsers.length > 0
          ? html`<div class="user-grid ${compact ? "compact" : ""} ${viewMode === "list" ? "list-view" : ""}">
              ${visibleUsers.map(e => this._renderUserItem(e))}
            </div>`
          : ""}
      </ha-card>
      ${this._renderDetails()}
    `;
  }

  _toggleOffline() {
    this._hideOffline = !this._hideOffline;
  }

  getCardSize() {
    return 3;
  }

  static get styles() {
    return css`
      dialog {
        box-sizing: border-box;
        width: min(480px, calc(100vw - 32px));
        max-height: calc(100dvh - 32px);
        overflow: auto;
        padding: 20px;
        border: 1px solid var(--divider-color, #555);
        border-radius: 16px;
        color: var(--primary-text-color);
        background: var(--card-background-color, #1c1c1c);
        box-shadow: 0 12px 48px #0008;
        overflow-wrap: anywhere;
      }
      dialog::backdrop { background: #0009; }
      .details-header { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
      .details-header h2 { margin: 0; font-size: 1.3em; }
      .details-header button { min-height: 44px; padding: 8px 16px; border-radius: 8px; border: 1px solid var(--divider-color, #777); background: transparent; color: inherit; font: inherit; cursor: pointer; }
      .steam-multi:focus-visible, button:focus-visible { outline: 2px solid var(--primary-color, #03a9f4); outline-offset: -2px; }
      .details-game { font-weight: 600; margin-bottom: 4px; }
      .details-note { font-size: 0.85em; color: var(--secondary-text-color); }
      dialog dl { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 16px; margin-bottom: 0; }
      dialog dt { font-weight: 600; }
      dialog dd { margin: 0; }
      .activity-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
      .session-elapsed { flex-shrink: 0; white-space: nowrap; font-variant-numeric: tabular-nums; }
      ha-card {
        padding: 16px;
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }
      .card-header {
        width: 100%;
        padding-bottom: 8px;
        display: flex;
        align-items: center;
        justify-content: space-between;
      }
      .card-header .name {
        font-size: 1.2em;
        font-weight: 600;
      }
      .toggle-btn {
        display: flex;
        align-items: center;
        gap: 4px;
        font-size: 0.75em;
        opacity: 0.6;
        cursor: pointer;
        padding: 4px 8px;
        border-radius: 6px;
        transition: opacity 0.15s, background 0.15s;
        user-select: none;
      }
      .toggle-btn:hover {
        opacity: 1;
        background: rgba(255, 255, 255, 0.08);
      }
      .toggle-btn ha-icon {
        --mdc-icon-size: 16px;
      }
      .empty {
        text-align: center;
        padding: 16px;
        opacity: 0.5;
      }
      .status-category {
        text-align: left;
        width: 100%;
        font-size: 0.75em;
        font-weight: 600;
        text-transform: uppercase;
        opacity: 0.6;
        margin: 6px 0 4px 0;
        letter-spacing: 0.5px;
        display: flex;
        align-items: center;
        gap: 4px;
      }
      .voice-duration {
        font-weight: 400;
        opacity: 0.8;
        text-transform: none;
        letter-spacing: 0;
      }
      .voice-divider {
        width: 100%;
        height: 1px;
        background: var(--divider-color, #e0e0e0);
        margin: 16px 0;
        opacity: 0.6;
      }
      .user-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 4px;
        margin-bottom: 4px;
      }
      .user-grid.compact {
        gap: 2px;
        margin-bottom: 2px;
      }
      .user-grid.list-view {
        grid-template-columns: 1fr;
        gap: 2px;
      }
      .user-grid.list-view .steam-multi {
        min-height: 40px;
      }
      .user-grid.list-view .steam-user {
        padding: 4px 8px;
      }
      .steam-multi {
        position: relative;
        overflow: hidden;
        border-radius: 8px;
        min-height: 48px;
        cursor: pointer;
        transition: opacity 0.15s;
      }
      .steam-multi.has-activity {
        min-height: 64px;
      }
      .steam-multi.compact {
        min-height: 36px;
        border-radius: 6px;
      }
      .steam-multi.offline {
        opacity: 0.45;
      }
      .steam-multi.in-voice {
        opacity: 1;
      }
      .steam-multi:hover {
        opacity: 1;
      }
      .steam-game-bg {
        z-index: 0;
        position: absolute;
        top: 0;
        right: 0;
        height: 100%;
        width: 100%;
        object-fit: cover;
        opacity: 0.4;
        mask-image: linear-gradient(to right, transparent 5%, black 70%);
        -webkit-mask-image: linear-gradient(to right, transparent 5%, black 70%);
      }
      .steam-user {
        display: flex;
        align-items: center;
        padding: 6px 8px;
        position: relative;
        z-index: 1;
        gap: 8px;
      }
      .steam-user.compact {
        padding: 4px 6px;
        gap: 6px;
      }
      .avatar-wrap {
        flex-shrink: 0;
        position: relative;
      }
      .voice-status-overlay {
        position: absolute;
        display: flex;
        flex-direction: row;
        gap: 3px;
        z-index: 2;
        flex-wrap: wrap;
      }
      .voice-status-left {
        top: -4px;
        left: -4px;
        max-width: 60px;
      }
      .voice-status-right {
        top: -4px;
        right: -4px;
        max-width: 60px;
      }
      .voice-status-icon {
        --mdc-icon-size: 16px;
        color: white;
        background: rgba(0, 0, 0, 0.85);
        border-radius: 50%;
        padding: 3px;
        display: block;
        flex-shrink: 0;
      }
      .steam-avatar {
        width: 36px;
        height: 36px;
        min-width: 36px;
        min-height: 36px;
        border-radius: 50%;
        border-style: solid;
        border-width: 2px;
        object-fit: cover;
      }
      .steam-multi.compact .steam-avatar {
        width: 28px;
        height: 28px;
        min-width: 28px;
        min-height: 28px;
      }
      .platform-badge {
        position: absolute;
        bottom: -3px;
        right: -3px;
        display: flex;
        gap: 1px;
        background: rgba(0, 0, 0, 0.8);
        border-radius: 8px;
        padding: 2px 4px;
        align-items: center;
      }
      .pf-icon {
        --mdc-icon-size: 14px;
        width: 14px;
        height: 14px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
      }
      .pf-icon.discord {
        color: #5865f2;
      }
      .pf-icon.steam {
        color: #b8b8b8;
        --mdc-icon-color: #b8b8b8;
      }
      .pf-icon.xbox {
        color: #107c10;
        --mdc-icon-color: #107c10;
      }
      .steam-avatar.online {
        border-color: #6cff4f9d;
        box-shadow: 1px 0.5px 3px #6cff4f88;
      }
      .steam-avatar.idle {
        border-color: #d6ca1c9d;
        box-shadow: 1px 0.5px 3px #d6ca1c88;
      }
      .steam-avatar.dnd {
        border-color: #4081e49d;
        box-shadow: 1px 0.5px 3px #4081e488;
      }
      .steam-avatar.offline {
        border-color: #aaaaaa9d;
        box-shadow: 1px 0.5px 3px #aaaaaa88;
      }
      .steam-multi.in-voice .steam-avatar.offline {
        box-shadow: 0 0 0 2px var(--voice-color, #e44040), 1px 0.5px 3px var(--voice-shadow, #e4404088);
      }
      .user-container {
        margin-left: 0;
        width: 100%;
        min-width: 0;
        align-content: center;
      }
      .steam-name-row {
        display: flex;
        align-items: center;
        gap: 3px;
        width: 100%;
        min-width: 0;
      }
      .steam-username {
        font-weight: 600;
        font-size: 0.85em;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        flex: 0 1 auto;
        min-width: 0;
      }
      .steam-multi.compact .steam-username {
        font-size: 0.78em;
      }
      .steam-username.offline {
        opacity: 0.5;
      }
      .steam-voice-inline {
        display: flex;
        align-items: center;
        gap: 1px;
        flex-shrink: 0;
      }
      .voice-inline-icon {
        --mdc-icon-size: 14px;
        color: var(--voice-text-color, #4081e4);
        opacity: 0.85;
      }
      .steam-value {
        width: 100%;
        font-size: 0.72em;
        white-space: normal;
        word-break: break-word;
        line-height: 1.3;
        margin-top: 2px;
        overflow: visible;
      }
      .steam-value.offline {
        opacity: 0.5;
      }
      .steam-username.voice {
        opacity: 1;
      }
      .steam-value.voice {
        color: var(--voice-text-color, #4081e4);
        display: flex;
        align-items: center;
        gap: 3px;
        opacity: 1;
      }
      .activity-text {
        display: flex;
        align-items: center;
        gap: 4px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .activity-subtitle {
        font-size: 0.9em;
        opacity: 0.7;
        margin-top: 1px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .mic-icon {
        --mdc-icon-size: 12px;
      }
    `;
  }
}

class UnifiedGamingCardEditor extends LitElement {
  static get properties() { return { hass: {}, _config: { state: true }, _error: { state: true } }; }

  setConfig(config) { this._config = { ...config }; this._error = ""; }

  _emit(config) {
    this._config = config;
    this.dispatchEvent(new CustomEvent("config-changed", { detail: { config }, bubbles: true, composed: true }));
  }

  _field(key, value) { this._emit({ ...this._config, [key]: value }); }

  _user(index, key, value) {
    const users = (this._config.users || []).map(user => ({ ...user }));
    if (value === "" || (Array.isArray(value) && !value.length)) delete users[index][key];
    else users[index][key] = value;
    this._field("users", users);
  }

  _image(index, key, value) {
    const entries = Object.entries(this._config.game_images || {});
    if (key === 0 && entries.some(([name], i) => i !== index && name === value)) {
      this._error = "Spilnavnet findes allerede. Vælg et andet navn.";
      return;
    }
    this._error = "";
    entries[index][key] = value;
    this._field("game_images", Object.fromEntries(entries));
  }

  _select(key, label, values, fallback) {
    return html`<label>${label}<select .value=${this._config[key] ?? fallback}
      @change=${event => this._field(key, event.target.value)}>
      ${values.map(([value, text]) => html`<option value=${value} ?selected=${value === (this._config[key] ?? fallback)}>${text}</option>`)}</select></label>`;
  }

  render() {
    if (!this._config) return html``;
    const list = value => Array.isArray(value) ? value.join("\n") : value || "";
    const parse = value => value.split(/[\n,]+/).map(id => id.trim()).filter(Boolean);
    return html`<div class="editor">
      <label>Titel<input .value=${this._config.title || ""} @change=${e => this._field("title", e.target.value)}></label>
      <div class="grid">
        ${this._select("image_source", "Billedkilder", [["auto", "Platforme først, Gaming Status som backup"], ["standard", "Kun platforme (uden Gaming Status)"]], "auto")}
        ${this._select("voice_status_style", "Voice-ikoner", [["inline", "Efter navn"], ["overlay", "På avatar"]], "inline")}
        ${this._select("view_mode", "Layout", [["grid", "Gitter"], ["list", "Liste"]], "grid")}
        ${this._select("sort_by", "Sortering", [["status", "Status"], ["name", "Navn"], ["game", "Spil"]], "status")}
        ${this._select("click_action", "Klik på spiller", [["popup", "Spillerdetaljer"], ["more-info", "Entity-detaljer"], ["navigate", "Navigation"], ["toggle", "Skift entity"], ["none", "Ingen handling"]], "popup")}
      </div>
      ${["navigate", "toggle"].includes(this._config.click_action) ? html`<label>Mål (sti eller entity-ID)
        <input .value=${this._config.click_action_target || ""} @change=${e => this._field("click_action_target", e.target.value)}></label>` : ""}
      ${[["hide_offline", "Skjul offline ved åbning", false], ["show_toggle", "Vis offline-knap", true], ["compact_mode", "Kompakt visning", false]].map(([key, label, fallback]) => html`
        <label class="check"><input type="checkbox" .checked=${this._config[key] ?? fallback}
          @change=${e => this._field(key, e.target.checked)}>${label}</label>`)}
      <h3>Spillere</h3>
      <p>Vælg entity-ID'er. Sessionstid kræver Gaming Status-sensorer for netop denne spiller.</p>
      <datalist id="entities">${Object.keys(this.hass?.states || {}).filter(id => /^(sensor|binary_sensor)\./.test(id))
        .map(id => html`<option value=${id}></option>`)}</datalist>
      ${(this._config.users || []).map((user, index) => html`<details>
        <summary>${user.name || `Spiller ${index + 1}`}</summary>
        <label>Navn<input .value=${user.name || ""} @change=${e => this._user(index, "name", e.target.value)}></label>
        ${[["discord", "Discord-entity"], ["xbox", "Xbox-entity"]].map(([key, label]) => html`<label>${label}
          <input list="entities" .value=${user[key] || ""} @change=${e => this._user(index, key, e.target.value.trim())}></label>`)}
        <label>Steam-entities (ét ID pr. linje)<textarea rows="2" .value=${list(user.steam)}
          @change=${e => { const ids = parse(e.target.value); this._user(index, "steam", ids.length === 1 ? ids[0] : ids); }}></textarea></label>
        <label>Session-sensorer (ét ID pr. linje)<textarea rows="2" .value=${list(user.session_entities)}
          @change=${e => this._user(index, "session_entities", parse(e.target.value))}></textarea></label>
        <button type="button" @click=${() => this._field("users", this._config.users.filter((_, i) => i !== index))}>Fjern spiller</button>
      </details>`)}
      <button type="button" @click=${() => this._field("users", [...(this._config.users || []), { name: "Ny spiller" }])}>Tilføj spiller</button>
      <h3>Egne spilbilleder</h3>
      ${this._error ? html`<p role="alert">${this._error}</p>` : ""}
      <p>Prøves først. Brug en HTTPS-URL eller /local/sti. Fejler billedet, bruges de normale billedkilder.</p>
      ${Object.entries(this._config.game_images || {}).map(([game, url], index) => html`<div class="image-row">
        <label>Spilnavn<input .value=${game} @change=${e => this._image(index, 0, e.target.value)}></label>
        <label>Billed-URL<input .value=${url} @change=${e => this._image(index, 1, e.target.value)}></label>
        <button type="button" @click=${() => this._field("game_images", Object.fromEntries(Object.entries(this._config.game_images).filter((_, i) => i !== index)))}>Fjern billede</button>
      </div>`)}
      <button type="button" ?disabled=${Object.hasOwn(this._config.game_images || {}, "")}
        @click=${() => this._field("game_images", { ...this._config.game_images, "": "" })}>Tilføj spilbillede</button>
      <p>Øvrige YAML-indstillinger bevares, når du redigerer her.</p>
    </div>`;
  }

  static get styles() { return css`
    .editor { display: grid; gap: 12px; color: var(--primary-text-color); }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; }
    label { display: grid; gap: 5px; margin: 8px 0; }
    input, select, textarea, button { font: inherit; color: var(--primary-text-color); background: var(--card-background-color); border: 1px solid var(--divider-color); border-radius: 6px; padding: 9px; box-sizing: border-box; min-width: 0; }
    input, select, textarea { width: 100%; }
    .check { display: flex; align-items: center; } .check input { width: auto; }
    details, .image-row { border: 1px solid var(--divider-color); border-radius: 8px; padding: 12px; }
    summary, button { cursor: pointer; } p { color: var(--secondary-text-color); margin: 0; font-size: 0.9em; }
    button:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible { outline: 2px solid var(--primary-color); }
  `; }
}

customElements.define("unified-gaming-card-editor", UnifiedGamingCardEditor);
customElements.define("unified-gaming-card", UnifiedGamingCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "unified-gaming-card",
  name: "Unified Gaming Card",
  description: "Combines Discord, Xbox, and Steam users into one card with platform indicators, game status, and voice features.",
});
