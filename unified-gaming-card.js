const LitElement = Object.getPrototypeOf(
  customElements.get("ha-panel-lovelace")
);
const html = LitElement.prototype.html;
const css = LitElement.prototype.css;

class UnifiedGamingCard extends LitElement {
  static _steamCache = new Map();
  static _fetching = new Set();

  static get properties() {
    return {
      hass: {},
      config: {},
      _hideOffline: { type: Boolean },
    };
  }

  constructor() {
    super();
    this._hideOffline = false;
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
    };
  }

  setConfig(config) {
    this.config = config;
  }

  set hass(hass) {
    this._hass = hass;
    this._entities = this._buildEntities(hass);
    this._checkSteamFallbacks(this._entities);
    this.requestUpdate();
  }

  get hass() {
    return this._hass;
  }

  _buildEntities(hass) {
    const users = this.config.users || [];
    const entities = [];

    for (const profile of users) {
      const entry = {
        name: profile.name || "Unknown",
        discord_entity: null,
        steam_entities: [],
        discord_state: null,
        discord_game: null,
        discord_game_images: {},
        discord_voice: null,
        discord_voice_mute: false,
        discord_voice_deaf: false,
        discord_voice_stream: false,
        discord_avatar: null,
        steam_states: [],
        steam_games: [],
        steam_game_images: [],
        steam_avatars: [],
      };

      // Discord entity lookup
      if (profile.discord) {
        const baseState = hass.states[profile.discord];
        if (baseState) {
          entry.discord_entity = baseState;
          entry.discord_state = baseState.state;
          entry.discord_avatar = baseState.attributes?.entity_picture || null;

          const prefix = profile.discord;
          for (const [entityId, state] of Object.entries(hass.states)) {
            if (entityId === prefix || !entityId.startsWith(prefix + "_")) continue;
            const suffix = entityId.slice(prefix.length + 1);
            if (suffix === "game") entry.discord_game = state.state;
            else if (suffix === "game_image_header") entry.discord_game_images.header = state.state;
            else if (suffix === "game_image_capsule_231x87") entry.discord_game_images.capsule = state.state;
            else if (suffix === "game_image_large") entry.discord_game_images.large = state.state;
            else if (suffix === "game_image_library_hero") entry.discord_game_images.hero = state.state;
            else if (suffix === "voice_channel") entry.discord_voice = state.state;
            else if (suffix === "voice_self_mute") entry.discord_voice_mute = state.state === "True";
            else if (suffix === "voice_self_deaf") entry.discord_voice_deaf = state.state === "True";
            else if (suffix === "voice_self_stream") entry.discord_voice_stream = state.state === "True";
          }
        }
      }

      // Steam entity lookup (supports string or array)
      const steamIds = Array.isArray(profile.steam) ? profile.steam : (profile.steam ? [profile.steam] : []);
      for (const steamId of steamIds) {
        const steamState = hass.states[steamId];
        if (steamState) {
          entry.steam_entities.push(steamState);
          const rawState = steamState.state;
          const stateMap = { online: "online", away: "idle", snooze: "dnd", offline: "offline" };
          entry.steam_states.push(stateMap[rawState] || "offline");
          entry.steam_avatars.push(steamState.attributes?.entity_picture || null);
          const game = steamState.attributes?.game || null;
          entry.steam_games.push(game);
          const imgs = {};
          if (steamState.attributes?.game_image_header) imgs.header = steamState.attributes.game_image_header;
          if (steamState.attributes?.game_image_main) imgs.main = steamState.attributes.game_image_main;
          entry.steam_game_images.push(imgs);
        }
      }

      entry.merged_status = this._mergeStatus(entry);
      entry.merged_game = this._mergeGame(entry);
      entry.merged_images = this._mergeImages(entry);
      entry.merged_avatar = entry.discord_avatar || entry.steam_avatars.find(a => a) || null;
      entry.platform = this._getPlatform(entry);

      entities.push(entry);
    }

    return entities;
  }

  _mergeStatus(entry) {
    const ds = entry.discord_state;
    const sStates = entry.steam_states;
    const isOnline = (s) => s && s !== "offline" && s !== "unavailable" && s !== "unknown";

    const discordOnline = isOnline(ds);
    const steamOnline = sStates.some(s => isOnline(s));

    const hasDiscord = !!entry.discord_entity;
    const hasSteam = entry.steam_entities.length > 0;

    if (discordOnline && steamOnline) return { status: ds, platforms: "both" };
    if (discordOnline) return { status: ds, platforms: hasSteam ? "both" : "discord" };
    if (steamOnline) {
      const bestSteam = sStates.find(s => isOnline(s)) || "offline";
      return { status: bestSteam, platforms: hasDiscord ? "both" : "steam" };
    }

    // Both offline
    const platforms = hasDiscord && hasSteam ? "both" : hasDiscord ? "discord" : "steam";
    return { status: "offline", platforms };
  }

  _mergeGame(entry) {
    const dg = entry.discord_game && entry.discord_game !== "unknown" && entry.discord_game !== "None" ? entry.discord_game : null;
    for (const sg of entry.steam_games) {
      const game = sg && sg !== "unknown" && sg !== "None" ? sg : null;
      if (dg && game) return { game: dg, source: "discord" };
      if (dg) return { game: dg, source: "discord" };
      if (game) return { game, source: "steam" };
    }
    if (dg) return { game: dg, source: "discord" };
    return null;
  }

  _mergeImages(entry) {
    const di = entry.discord_game_images;
    const hasReal = (obj) => obj && Object.values(obj).some(v => v && v !== "unknown");

    if (hasReal(di)) {
      return {
        header: di.header || di.capsule || null,
        large: di.large || di.header || null,
        hero: di.hero || di.header || null,
        source: "discord",
      };
    }
    for (const si of entry.steam_game_images) {
      if (hasReal(si)) {
        return {
          header: si.header || si.main || null,
          large: si.header || si.main || null,
          hero: si.header || si.main || null,
          source: "steam",
        };
      }
    }
    return null;
  }

  _getPlatform(entry) {
    const hasDiscord = !!entry.discord_entity;
    const hasSteam = entry.steam_entities.length > 0;
    if (hasDiscord && hasSteam) return "both";
    if (hasDiscord) return "discord";
    if (hasSteam) return "steam";
    return null;
  }

  _checkSteamFallbacks(entities) {
    const ts = Math.floor(Date.now() / 1000);
    for (const entry of entities) {
      if (entry.merged_images) continue;
      const game = entry.merged_game;
      if (!game) continue;

      const cacheKey = game.game.toLowerCase().trim();
      if (UnifiedGamingCard._steamCache.has(cacheKey)) {
        const cached = UnifiedGamingCard._steamCache.get(cacheKey);
        if (cached) this._applySteamImages(entry, cached, ts);
        continue;
      }
      if (!UnifiedGamingCard._fetching.has(cacheKey)) {
        this._fetchSteamImages(game.game, cacheKey);
      }
    }
  }

  _applySteamImages(entry, baseUrl, ts) {
    const sep = baseUrl.includes("?") ? "&" : "?";
    const t = `${sep}t=${ts}`;
    entry.merged_images = {
      header: `${baseUrl}/header.jpg${t}`,
      large: `${baseUrl}/capsule_616x353.jpg${t}`,
      hero: `${baseUrl}/library_hero.jpg${t}`,
      source: "steam_lookup",
    };
  }

  async _fetchSteamImages(gameName, cacheKey) {
    UnifiedGamingCard._fetching.add(cacheKey);
    try {
      const url = `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(gameName)}&l=english&cc=US`;
      const resp = await fetch(url);
      if (!resp.ok) return;
      const data = await resp.json();
      if (!data.items || data.items.length === 0) return;
      const appId = data.items[0].id;
      const baseUrl = `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}`;
      UnifiedGamingCard._steamCache.set(cacheKey, baseUrl);
      this.requestUpdate();
    } catch (e) {
      UnifiedGamingCard._steamCache.set(cacheKey, null);
    } finally {
      UnifiedGamingCard._fetching.delete(cacheKey);
    }
  }

  _filterByStatus(entities) {
    const hideOffline = this.config.hide_offline || this._hideOffline || (this.config.show_offline === false);
    if (!hideOffline) return entities;
    return entities.filter(e => e.merged_status.status !== "offline");
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
          const ag = a.merged_game ? a.merged_game.game : "";
          const bg = b.merged_game ? b.merged_game.game : "";
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

  _handleAction(entry) {
    const action = this.config.click_action || "popup";
    const target = this.config.click_action_target || "";
    const entity = entry.discord_entity || entry.steam_entities[0];
    if (!entity) return;

    if (action === "navigate" && target) {
      history.pushState(null, "", target);
      window.dispatchEvent(new Event("location-changed", { composed: true }));
    } else if (action === "toggle" && target) {
      this.hass.callService(target.split(".")[0], "toggle", { entity_id: target });
    } else {
      const event = new Event("hass-more-info", { composed: true });
      event.detail = { entityId: entity.entity_id };
      this.dispatchEvent(event);
    }
  }

  _renderUserItem(entry) {
    const state = entry.merged_status.status;
    const platform = entry.merged_status.platforms;
    const game = entry.merged_game;
    const images = entry.merged_images;
    const avatar = entry.merged_avatar;
    const voice = entry.discord_voice;
    const compact = this.config.compact_mode;

    let bgImg = compact ? null : (images ? (images.hero || images.header || images.large) : null);

    return html`
      <div class="steam-multi ${voice ? "in-voice" : state} ${compact ? "compact" : ""}" @click=${() => this._handleAction(entry)}>
        ${bgImg ? html`<img src="${bgImg}" class="steam-game-bg" onerror="this.style.display='none'">` : ""}
        <div class="steam-user ${compact ? "compact" : ""}">
          <div class="avatar-wrap ${state}">
            ${avatar ? html`<img src="${avatar}${entry.discord_entity ? '?size=128' : ''}" class="steam-avatar ${state}" onerror="this.style.display='none'">` : html`<div class="steam-avatar ${state}"></div>`}
            <div class="platform-badge">
              ${(platform === "discord" || platform === "both") ? html`<ha-icon icon="mdi:discord" class="pf-icon discord"></ha-icon>` : ""}
              ${(platform === "steam" || platform === "both") ? html`<ha-icon icon="mdi:steam" class="pf-icon steam"></ha-icon>` : ""}
            </div>
          </div>
          <div class="user-container">
            <div class="steam-username ${voice ? "voice" : state}">${entry.name}</div>
            ${!compact ? html`
            <div class="steam-value ${voice ? "voice" : state}">
              ${voice ? html`<ha-icon icon="mdi:phone" class="mic-icon"></ha-icon>${" " + voice}` : ""}
              ${voice && entry.discord_voice_stream ? html`<ha-icon icon="mdi:monitor-shimmer" class="mic-icon"></ha-icon>` : ""}
              ${voice && entry.discord_voice_deaf ? html`<ha-icon icon="mdi:volume-off" class="mic-icon"></ha-icon>` : ""}
              ${voice && entry.discord_voice_mute ? html`<ha-icon icon="mdi:microphone-off" class="mic-icon"></ha-icon>` : ""}
              ${game ? html`<ha-icon icon="mdi:gamepad-variant" class="mic-icon"></ha-icon>${" " + game.game}` : ""}
              ${!voice && !game ? this._stateLabel(state) : ""}
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

    const hideOffline = this.config.hide_offline || this._hideOffline || (this.config.show_offline === false);
    const showToggle = this.config.show_toggle !== false;
    const maxOnline = this.config.max_online || 0;
    const maxOffline = this.config.max_offline || 0;
    const compact = this.config.compact_mode;
    const voiceColor = this.config.voice_highlight_color || "";

    let cardStyle = "";
    if (voiceColor) {
      cardStyle = `--voice-color: ${voiceColor}; --voice-shadow: ${voiceColor}88;`;
    }

    const filtered = this._filterByStatus(this._entities);
    const groups = this._sortByStatus(filtered);
    const allUsers = [...groups.online, ...groups.idle, ...groups.dnd, ...groups.unavailable, ...groups.offline];
    const inVoice = allUsers.filter(e => e.discord_voice);
    const notInVoice = allUsers.filter(e => !e.discord_voice);
    let offlineNotInVoice = notInVoice.filter(e => e.merged_status.status === "offline");
    if (maxOffline > 0) offlineNotInVoice = offlineNotInVoice.slice(0, maxOffline);
    let activeNotInVoice = notInVoice.filter(e => e.merged_status.status !== "offline");
    if (maxOnline > 0) activeNotInVoice = activeNotInVoice.slice(0, maxOnline);

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
        ${inVoice.length > 0
          ? html`
              <div class="status-category">I opkald (${inVoice.length})</div>
              <div class="user-grid ${compact ? "compact" : ""}">
                ${inVoice.map(e => this._renderUserItem(e))}
              </div>`
          : ""}
        ${activeNotInVoice.length > 0
          ? html`<div class="user-grid ${compact ? "compact" : ""}">
              ${activeNotInVoice.map(e => this._renderUserItem(e))}
            </div>`
          : ""}
        ${!hideOffline && offlineNotInVoice.length > 0
          ? html`
              <div class="status-category">Offline (${offlineNotInVoice.length})</div>
              <div class="user-grid ${compact ? "compact" : ""}">
                ${offlineNotInVoice.map(e => this._renderUserItem(e))}
              </div>`
          : ""}
      </ha-card>
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
      .steam-multi {
        position: relative;
        overflow: hidden;
        border-radius: 8px;
        min-height: 48px;
        cursor: pointer;
        transition: opacity 0.15s;
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
        gap: 0;
        background: rgba(0, 0, 0, 0.7);
        border-radius: 6px;
        padding: 1px 2px;
        line-height: 0;
      }
      .pf-icon {
        --mdc-icon-size: 10px;
      }
      .pf-icon.discord {
        color: #5865f2;
      }
      .pf-icon.steam {
        color: #b8b8b8;
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
        overflow: hidden;
        align-content: center;
      }
      .steam-username {
        width: 100%;
        font-weight: 600;
        font-size: 0.85em;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .steam-multi.compact .steam-username {
        font-size: 0.78em;
      }
      .steam-username.offline {
        opacity: 0.5;
      }
      .steam-value {
        width: 100%;
        font-size: 0.72em;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .steam-value.offline {
        opacity: 0.5;
      }
      .steam-username.voice {
        opacity: 1;
      }
      .steam-value.voice {
        color: #4081e4;
        display: flex;
        align-items: center;
        gap: 3px;
        opacity: 1;
      }
      .mic-icon {
        --mdc-icon-size: 12px;
      }
    `;
  }
}

customElements.define("unified-gaming-card", UnifiedGamingCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "unified-gaming-card",
  name: "Unified Gaming Card",
  description: "Combines Discord and Steam users into one card with platform indicators, game status, and voice features.",
});
