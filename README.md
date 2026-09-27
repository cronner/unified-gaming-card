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
- **Gamers-first layout** — users currently playing a game are listed first within each voice channel and the non-voice list
- **Voice channel grouping** — users grouped by voice channel name (e.g., "Tale 1 (5) · 3:38")
- **Voice duration tracking** — shows how long voice call has been active (updates every minute)
- **Game sorting** — sort by activity with `sort_by: game`, without separate game headings
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
- Visual editor for players, image options, voice icons, layout, and custom artwork
- Current artwork source and image link in the player popup
- Shared entity indexing and skipped player rebuilds for unrelated HA updates

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

### Visual editor

Open **Edit dashboard → Edit card** to use the visual editor. Add/remove players,
select Discord/Xbox entity IDs, enter one or more Steam and session entity IDs,
choose artwork behavior and voice icon position, and set custom images per game.
Advanced YAML fields not shown in the editor are preserved.

### Upgrading from v1.3.0

Session discovery by game title was unsafe: two players playing the same game
could receive the same player's start time. Set `session_entities` for each player
whose session time you want to show. An explicitly configured Gaming Status Xbox
sensor can also provide its own session. Without a safe player link, the timer
is omitted; the card, platform status, and artwork still work normally.

### Users

All player names, account references, and repeated-digit Discord IDs below are
fictional placeholders. Replace them with your own entity IDs before use.

Define users manually with optional Discord, Steam, and Xbox entity references:

```yaml
type: custom:unified-gaming-card
title: "Gaming"
users:
  - name: "Player 1"
    discord: sensor.discord_user_111111111111111111
    steam: sensor.steam_player_1
  - name: "Player 2"
    discord: sensor.discord_user_222222222222222222
  - name: "Player 3"
    steam: sensor.steam_player_3
```

Multiple Steam accounts per user:

```yaml
users:
  - name: "Player 1"
    discord: sensor.discord_user_111111111111111111
    steam:
      - sensor.steam_player_1_secondary
      - sensor.steam_player_1
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
| `sort_by` | string | `"status"` | Sort by `status`, `name`, or `game`; gamers stay first within voice and non-voice groups |
| `click_action` | string | `"popup"` | Click action: `popup`, `navigate`, `toggle`, `more-info`, or `none` |
| `click_action_target` | string | `""` | Target for navigate/toggle |
| `compact_mode` | boolean | `false` | Minimal layout without background images |
| `view_mode` | string | `"grid"` | Layout: `grid` (2-column) or `list` (single-column) |
| `voice_highlight_color` | string | `""` | Custom color for voice user accent |
| `voice_text_color` | string | `""` | Custom color for voice channel text (default: `#4081e4`) |
| `voice_status_style` | string | `"inline"` | Voice status icon position: `inline` (after name) or `overlay` (on avatar) |
| `image_source` | string | `"auto"` | Artwork source priority: `auto` (native Discord/Xbox/Steam, then gaming_status as backup) or `standard` (never use gaming_status) |
| `game_images` | mapping | empty | Game title → custom image URL; tried before automatic artwork in either mode |

### User Profile

| Key | Type | Required | Description |
|-----|------|----------|-------------|
| `name` | string | Yes | Display name |
| `discord` | string | No | Discord entity ID (e.g. `sensor.discord_user_111111111111111111`) |
| `xbox` | string | No | Xbox entity ID — either official Xbox integration (`binary_sensor.gamertag`) or gaming_status (`sensor.gaming_status_username_xbox`) |
| `steam` | string/list | No | Steam entity ID or list of Steam entity IDs |
| `session_entities` | list | No | Explicit Gaming Status sensors belonging to this player, in priority order |

At least one of `discord`, `xbox`, or `steam` must be provided. `session_entities` is optional; no session is borrowed from other players by matching a game title.

## Session Time

The card shows each player's elapsed play time from [gaming_status](https://github.com/3rob3/gaming-steam-status) `play_start_time` attributes, shown next to the game name and in the details popup.

- Link the player's own Gaming Status sensors with `session_entities`.
- An explicitly configured `xbox: sensor.gaming_status_...` can supply its own session if no session list is set.
- If no valid linked session is available, no elapsed time is shown.

```yaml
users:
  - name: "Player 1"
    steam: sensor.steam_player_1
    session_entities:
      - sensor.gaming_status_player_1_steam
      - sensor.gaming_status_player_1_discord
```

Session time is only shown when the linked sensor reports `timer_status: Running`, its game matches the displayed game, the player is online, and its timestamp is valid. Title matching ignores case, extra whitespace, and `™`/`®`. Stopped/paused sessions, unknown/unavailable sensors, and invalid timestamps are excluded. The integration's recorded session start is not a guarantee of active play time.

## Game Artwork

The card picks a background image for each player's game and falls back to the next candidate if an image fails to load.

**`image_source: auto` (default)**

1. Native artwork from Discord, Xbox, and Steam entities (in the existing Discord > Xbox > Steam priority)
2. Derived Steam hero images when a Steam `game_id` is available
3. **gaming_status artwork as backup** — any matching `sensor.gaming_status_*` with the same game, using its locally cached `game_hero_art`/`game_cover_art`

**`image_source: standard`**

Only the native sources above; gaming_status artwork is never used.

Gaming Status is optional. Without it, native artwork and Steam lookups remain available. Card-generated Steam image URLs are stable, allowing normal browser HTTP caching (subject to the server's cache headers). This is not a shared server-side cache. No source can guarantee an image for every game.

Steam search runs when no image candidate exists. It accepts only a unique matching title, caches failures/empty/ambiguous results for ten minutes, times out after ten seconds, and caches successes for one day. A retry can occur on a later relevant update after expiry. Browser CORS restrictions or network problems can prevent Steam search; native image URLs continue to work independently.

### Custom game images

```yaml
game_images:
  "ARK: Survival Ascended": "/local/game-art/ark.jpg"
  "STAR WARS Zero Company": "https://example.com/zero-company.jpg"
```

Upload local files yourself under `www/` or use an HTTP(S) image URL. The card
does not download or write files on the server. Custom images are tried first;
failed images fall through to the normal candidates. Open the player popup to
see the source and link of the currently selected candidate. In compact mode,
the popup describes the available background candidate, which is not rendered
behind the compact player row.

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
- Current image source (including custom images and Gaming Status) and an **Open image** link
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

**New sensor:** `sensor.discord_user_<id>_voice_duration`

## Examples

### Basic

```yaml
type: custom:unified-gaming-card
title: "Gaming"
users:
  - name: "Player 1"
    discord: sensor.discord_user_111111111111111111
    steam: sensor.steam_player_1
  - name: "Player 2"
    discord: sensor.discord_user_222222222222222222
```

### Xbox support

Supports both the official [Xbox integration](https://www.home-assistant.io/integrations/xbox/) and [gaming_status](https://github.com/3rob3/gaming-steam-status) Xbox sensors:

```yaml
type: custom:unified-gaming-card
title: "Gaming"
users:
  - name: "Player 1"
    xbox: binary_sensor.xbox_player_1  # Official Xbox integration
  - name: "Player 2"
    xbox: sensor.gaming_status_player_2_xbox  # Gaming Status integration
    discord: sensor.discord_user_222222222222222222
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
    discord: sensor.discord_user_111111111111111111
    steam: sensor.steam_player_1
    session_entities:
      - sensor.gaming_status_player_1_steam
  - name: "Player 2"
    discord: sensor.discord_user_222222222222222222
  - name: "Player 3"
    steam: sensor.steam_player_3
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
    discord: sensor.discord_user_111111111111111111
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
  - name: "Player 1"
    discord: sensor.discord_user_111111111111111111
    steam: sensor.steam_player_1
    session_entities:
      - sensor.gaming_status_player_1_steam
      - sensor.gaming_status_player_1_discord
  - name: "Player 2"
    discord: sensor.discord_user_222222222222222222
    steam: sensor.steam_player_2
  - name: "Player 3"
    discord: sensor.discord_user_333333333333333333
    steam: sensor.steam_player_3
```

## Requirements

- [Discord Game](https://github.com/3rob3/Discord-Game) custom component (for Discord users)
  - **Voice duration tracking**: Requires modified `sensor.py` (included in this repo as `discord_game_sensor.py`)
- [Steam](https://github.com/3rob3/gaming-steam-status) integration (for Steam users, optional)
- [gaming_status](https://github.com/3rob3/gaming-steam-status) (optional) — enables session times, locally cached artwork backup, and gaming_status Xbox sensors

## Voice Duration Tracking

To enable voice duration tracking, replace the `sensor.py` file in your `discord_game` custom component with the modified version from this repo (`discord_game_sensor.py`).

**Features:**
- Tracks when users join/leave voice channels
- Updates duration every minute
- Creates new sensor: `sensor.discord_user_<id>_voice_duration`
- Format: `"45"` (minutes) or `"1:45"` (hours:minutes)

**Installation:**
1. Copy `discord_game_sensor.py` to `custom_components/discord_game/sensor.py`
2. Restart Home Assistant
3. New sensors will be created automatically

## Development checks

```sh
node --check unified-gaming-card.js
node --test tests/*.test.mjs
node scripts/check-privacy.mjs
```

Tests cover player-safe session association, Steam presence, offline toggling,
artwork fallback and provenance, Steam lookup throttling/title matching,
voice-group sorting, update filtering, and editor config preservation.

Before publishing, run the privacy check. Documentation and release examples must
use `Player 1`, `sensor.steam_player_1`, `binary_sensor.xbox_player_1`, and similar
generic entity IDs. Discord IDs must be repeated-digit placeholders. The checker
also accepts explicit file paths, for example an exported release JSON file.
It reports categories without printing detected values. These checks cover known
example patterns, not arbitrary prose, screenshots, Git history, or remote releases
unless their text is supplied explicitly.

For an optional real-browser smoke test, serve the repository with
`python3 -m http.server 8000` and open `http://localhost:8000/tests/browser.html`.
The isolated test page imports Lit from esm.sh; this development-only test needs
internet access and does not connect to Home Assistant or save dashboard changes.

## License

MIT
