# Unified Gaming Card

Custom [Home Assistant](https://www.home-assistant.io/) Lovelace card that combines [Discord Game](https://github.com/3rob3/Discord-Game), [Xbox](https://www.home-assistant.io/integrations/xbox/), [gaming_status](https://github.com/3rob3/gaming-steam-status), and [Steam](https://github.com/3rob3/gaming-steam-status) users into one unified card with platform indicators, session times, and player details.

## Features

- Combines Discord, Xbox, and Steam users in a single card
- Dynamic platform icons — shows Discord/Xbox/Steam icons for active platforms
- Multiple Steam accounts per user
- Discord status prioritized over Xbox, Xbox over Steam
- Game activity from all platforms (Discord > Xbox > Steam)
- **Rich Discord activity support** — shows Watching (TV/streaming), Listening (Spotify), and Streaming activities with images
- **Game details** — shows subtitle under game name (e.g., "Ranked Match" under "Escape from Tarkov")
- **Gamers-first layout** — users currently playing a game are listed first, even across voice-channel grouping
- **Voice channel grouping** — users grouped by voice channel name (e.g., "Tale 1 (5) · 3:38")
- **Voice duration tracking** — shows how long voice call has been active (updates every minute)
- **Game grouping** — groups users playing the same game when `sort_by: game`
- Voice status icons — mute, deaf, stream, and webcam indicators on avatars (overlay or inline)
- Voice channel fallback — reads from base entity attributes when sub-entity is unknown
- Offline users in voice calls get red avatar highlight
- **Session time** — shows elapsed play time per player from gaming_status `play_start_time`
- **Player details popup** — click a player for platform status, game, session time, voice info, and last-online
- Automatic game artwork with cascade fallback (local gaming_status cache, Steam lookup)
- Works fully **without** the gaming_status integration installed
- Compact 2-column grid layout
- **List view mode** — single-column layout for tablets/mobile
- Avatar with colored status border
- Game/activity background images
- Toggle offline users
- Sort by status, name, or game
- Click actions (popup, navigate, toggle)
- Custom status display with emoji

## Installation

### HACS (recommended)

1. Add this repository as a custom repository in HACS (type: Lovelace)
2. Search for "Unified Gaming Card" and install

### Manual

Copy `unified-gaming-card.js` to your `www/community/unified-gaming-card/` directory.

Then add the resource in **Settings > Dashboards > Resources**:

| URL | Type |
|-----|------|
| `/local/community/unified-gaming-card/unified-gaming-card.js` | JavaScript Module |

## Configuration

### Users

Define users manually with optional Discord, Steam, and Xbox entity references:

```yaml
type: custom:unified-gaming-card
title: "Gaming"
users:
  - name: "Player 1"
    discord: sensor.discord_user_123456789
    steam: sensor.steam_player_1
  - name: "Player 2"
    discord: sensor.discord_user_987654321
  - name: "Player 3"
    steam: sensor.steam_player_2
```

Multiple Steam accounts per user:

```yaml
users:
  - name: "Player 4"
    discord: sensor.discord_user_123456789
    steam:
      - sensor.steam_player_3_second
      - sensor.steam_player_4
```

### Options

| Name | Type | Default | Description |
|------|------|---------|-------------|
| `title` | string | `"Gaming"` | Card header title |
| `users` | list | `[]` | List of user profiles (see below) |
| `hide_offline` | boolean | `false` | Start with offline users hidden |
| `show_toggle` | boolean | `true` | Show the eye toggle button |
| `max_online` | number | `0` | Max active users to show (0 = unlimited) |
| `max_offline` | number | `0` | Max offline users to show (0 = unlimited) |
| `sort_by` | string | `"status"` | Sort by `status`, `name`, or `game` (game groups users by activity) |
| `click_action` | string | `"popup"` | Click action: `popup`, `navigate`, `toggle`, `more-info`, or `none` |
| `click_action_target` | string | `""` | Target for navigate/toggle |
| `compact_mode` | boolean | `false` | Minimal layout without background images |
| `view_mode` | string | `"grid"` | Layout: `grid` (2-column) or `list` (single-column) |
| `voice_highlight_color` | string | `""` | Custom color for voice user accent |
| `voice_text_color` | string | `""` | Custom color for voice channel text (default: `#4081e4`) |
| `voice_status_style` | string | `"inline"` | Voice status icon position: `inline` (after name) or `overlay` (on avatar) |
| `image_source` | string | `"auto"` | Artwork source priority: `auto` (native Discord/Xbox/Steam, then gaming_status as backup) or `standard` (never use gaming_status) |

### User Profile

| Key | Type | Required | Description |
|-----|------|----------|-------------|
| `name` | string | Yes | Display name |
| `discord` | string | No | Discord entity ID (e.g. `sensor.discord_user_123456789`) |
| `xbox` | string | No | Xbox entity ID — either official Xbox integration (`binary_sensor.gamertag`) or gaming_status (`sensor.gaming_status_username_xbox`) |
| `steam` | string/list | No | Steam entity ID or list of Steam entity IDs |
| `session_entities` | list | No | gaming_status sensors for session time (optional; auto-discovered if omitted) |

At least one of `discord`, `xbox`, or `steam` must be provided. `session_entities` is optional — matching gaming_status sensors are auto-discovered by game when omitted.

## Session Time

The card shows each player's elapsed play time from [gaming_status](https://github.com/3rob3/gaming-steam-status) `play_start_time` attributes, shown next to the game name and in the details popup.

- Automatically discovers matching `sensor.gaming_status_*` sensors via the currently displayed game, so **no configuration is needed** when gaming_status is installed.
- To pin specific sensors (e.g. when only certain platforms should count), set `session_entities`:

```yaml
users:
  - name: "Player 1"
    steam: sensor.steam_player_1
    session_entities:
      - sensor.gaming_status_player_1_steam
      - sensor.gaming_status_player_1_discord
```

Session time is only shown when the source sensor reports `timer_status: Running`, the sensor's `current_game` matches the displayed game exactly, the player is online, and the timestamp is valid. Stopped/paused sessions, unknown/unavailable sensors, and missing or invalid timestamps are excluded. The `™`/`®` suffix difference (e.g. "STAR WARS Zero Company™" vs "STAR WARS Zero Company") does **not** break artwork matching.

## Game Artwork

The card picks a background image for each player's game and falls back to the next candidate if an image fails to load.

**`image_source: auto` (default)**

1. Native artwork from Discord, Xbox, and Steam entities (in the existing Discord > Xbox > Steam priority)
2. Derived Steam hero images when a Steam `game_id` is available
3. **gaming_status artwork as backup** — any matching `sensor.gaming_status_*` with the same game, using its locally cached `game_hero_art`/`game_cover_art`

**`image_source: standard`**

Only the native sources above; gaming_status artwork is never used.

The card works **100% without gaming_status installed** — it simply skips the backup step and relies on native artwork plus Steam lookups. Card-generated Steam image URLs are stable (no changing cache-busting parameters), so your browser's HTTP cache reuses them across updates. Gaming status images are served locally by Home Assistant, making them fast to load.

## Discord Activity Display

The card shows rich Discord activity beyond just games:

- **Playing** — Game name with background image (from Discord, Steam, or gaming_status)
- **Watching** — TV/streaming activity (e.g., "Reacher - S04E05") with cover image
- **Listening** — Music activity (e.g., Spotify) with album art
- **Streaming** — Live streaming activity (e.g., Twitch/YouTube)

Activity priority: Game > Spotify > Watching > Streaming > Listening

## Player Details Popup

With the default `click_action: "popup"`, clicking a player opens a dialog with:

- Platform status per platform (Discord / Steam / Xbox), with each platform's game and last-online time
- The merged game and elapsed session time
- Voice channel, voice duration, and mute/deaf/screen-sharing/camera states
- Danish labels, native modal focus, keyboard activation (Enter/space), and Escape/backdrop close

`click_action_target` is ignored for `popup`. `navigate` and `toggle` require an explicit target; `none` does nothing.

## Voice Channel Features

### Voice Status Icons

Shows voice activity indicators on user avatars or inline after the username:

- **Mute** — Microphone off (`voice_self_mute`), icon `mdi:microphone-off`
- **Deaf** — Headset muted (`voice_self_deaf`), icon `mdi:volume-off`
- **Stream** — Screen sharing (`voice_streaming`), icon `mdi:monitor-shimmer`
- **Webcam** — Camera on (`voice_broadcasting_video`), icon `mdi:webcam`

### Voice Status Style

Control where voice status icons appear:

**Inline** (default) — Icons directly after the username:
```yaml
voice_status_style: inline
```

**Overlay** — Icons on avatar corners (left = mute/deaf, right = stream/webcam):
```yaml
voice_status_style: overlay
```

### Voice Channel Grouping

Users in voice channels are grouped by channel name with a divider separating them from other users, with gaming users shown first:

```
TALE 1 (5) · 3:38
├── User 1 · Teamfight Tactics
├── User 2 (in voice, muted)
└── User 3
─────────────
├── User 4 · Counter-Strike 2 (online, not in voice)
└── User 5 (idle)
```

### Voice Duration Tracking

Shows how long the voice call has been active. Updates every minute.

**Format:**
- Under 1 hour: `"45"` (minutes only)
- Over 1 hour: `"1:45"` (hours:minutes)

**Requires:** Modified `discord_game` integration with voice duration tracking (included in this repo as `discord_game_sensor.py`).

**New sensor:** `sensor.player_1<id>_voice_duration`

## Examples

### Basic

```yaml
type: custom:unified-gaming-card
title: "Gaming"
users:
  - name: "Player 1"
    discord: sensor.discord_user_123456789
    steam: sensor.steam_player_1
  - name: "Player 2"
    discord: sensor.discord_user_987654321
```

### Xbox support

Supports both the official [Xbox integration](https://www.home-assistant.io/integrations/xbox/) and [gaming_status](https://github.com/3rob3/gaming-steam-status) Xbox sensors:

```yaml
type: custom:unified-gaming-card
title: "Gaming"
users:
  - name: "Player 5"
    xbox: binary_sensor.xbox_player_1  # Official Xbox integration
  - name: "Player 1"
    xbox: sensor.gaming_status_player_1_xbox  # gaming_status integration
    discord: sensor.discord_user_123456789
```

**Official Xbox integration** (`binary_sensor.{gamertag}`):
- Automatically discovers `sensor.{gamertag}_now_playing`, `sensor.{gamertag}_status`, `image.{gamertag}_gamerpic`, and `image.{gamertag}_now_playing`
- Shows gamerpic as avatar and current game from now_playing sensor

**gaming_status** (`sensor.gaming_status_{username}_xbox`):
- Uses `current_game`, `game_cover_art`, `game_hero_art`, and `entity_picture` attributes

### Full featured

```yaml
type: custom:unified-gaming-card
title: "Gaming"
users:
  - name: "Player 1"
    discord: sensor.discord_user_123456789
    steam: sensor.steam_player_1
    session_entities:
      - sensor.gaming_status_player_1_steam
  - name: "Player 2"
    discord: sensor.discord_user_987654321
  - name: "Player 3"
    steam: sensor.steam_player_2
hide_offline: false
show_toggle: true
max_online: 10
sort_by: game
view_mode: grid
compact_mode: false
voice_highlight_color: "#ff5722"
voice_text_color: "#4081e4"
voice_status_style: inline
image_source: auto
```

### Compact mode with inline voice icons

```yaml
type: custom:unified-gaming-card
title: "Gaming"
compact_mode: true
sort_by: game
view_mode: list
voice_status_style: inline
users:
  - name: "Player 1"
    discord: sensor.discord_user_123456789
    steam: sensor.steam_player_1
```

### Gaming dashboard with voice grouping and session time

```yaml
type: custom:unified-gaming-card
title: "Gaming"
hide_offline: true
sort_by: game
view_mode: grid
voice_status_style: inline
image_source: auto
users:
  - name: "Player 6"
    discord: sensor.discord_user_111111111111111111
    steam: sensor.player_2
    session_entities:
      - sensor.gaming_status_player_2_steam
      - sensor.gaming_status_player_2_discord
  - name: "Player 7"
    discord: sensor.discord_user_111111111111111111
    steam: sensor.player_3
  - name: "Player 8"
    discord: sensor.discord_user_111111111111111111
    steam: sensor.player_4
```

## Requirements

- [Discord Game](https://github.com/3rob3/Discord-Game) custom component (for Discord users)
  - **Voice duration tracking**: Requires modified `sensor.player_5` (included in this repo as `discord_game_sensor.py`)
- [Steam](https://github.com/3rob3/gaming-steam-status) integration (for Steam users, optional)
- [gaming_status](https://github.com/3rob3/gaming-steam-status) (optional) — enables session times, locally cached artwork backup, and gaming_status Xbox sensors

## Voice Duration Tracking

To enable voice duration tracking, replace the `sensor.player_5` file in your `discord_game` custom component with the modified version from this repo (`discord_game_sensor.py`).

**Features:**
- Tracks when users join/leave voice channels
- Updates duration every minute
- Creates new sensor: `sensor.player_1<id>_voice_duration`
- Format: `"45"` (minutes) or `"1:45"` (hours:minutes)

**Installation:**
1. Copy `discord_game_sensor.py` to `custom_components/discord_game/sensor.player_5`
2. Restart Home Assistant
3. New sensors will be created automatically

## License

MIT