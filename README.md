# Unified Gaming Card

Custom [Home Assistant](https://www.home-assistant.io/) Lovelace card that combines [Discord Game](https://github.com/3rob3/Discord-Game) and [Steam](https://github.com/3rob3/gaming-steam-status) users into one unified card with platform indicators.

## Features

- Combines Discord and Steam users in a single card
- Dynamic platform icons — only shows Discord/Steam icon when user is actually online on that platform
- Multiple Steam accounts per user
- Discord status prioritized over Steam
- Game activity from both platforms (Discord prioritized)
- **Rich Discord activity support** — shows Watching (TV/streaming), Listening (Spotify), and Streaming activities with images
- **Game details** — shows subtitle under game name (e.g., "Ranked Match" under "Escape from Tarkov")
- **Voice channel grouping** — users grouped by voice channel name (e.g., "Tale 1 (5) · 3:38")
- **Voice duration tracking** — shows how long voice call has been active (updates every minute)
- **Game grouping** — groups users playing the same game when `sort_by: game`
- Voice status icons — mute, deaf, stream, and webcam indicators on avatars
- Voice channel fallback — reads from base entity attributes when sub-entity is unknown
- Offline users in voice calls get red avatar highlight
- Automatic Steam image lookup fallback
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

Define users manually with optional Discord and/or Steam entity references:

```yaml
type: custom:unified-gaming-card
title: "Gaming"
users:
  - name: "Mikkel"
    discord: sensor.discord_user_123456789
    steam: sensor.steam_mikkel123
  - name: "Anders"
    discord: sensor.discord_user_987654321
  - name: "Lars"
    steam: sensor.steam_larsgaming
```

Multiple Steam accounts per user:

```yaml
users:
  - name: "Charlie"
    discord: sensor.discord_user_123456789
    steam:
      - sensor.steam_charlieboy_second
      - sensor.steam_charlieboy123
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
| `click_action` | string | `"popup"` | Click action: `popup`, `navigate`, or `toggle` |
| `click_action_target` | string | `""` | Target for navigate/toggle |
| `compact_mode` | boolean | `false` | Minimal layout without background images |
| `view_mode` | string | `"grid"` | Layout: `grid` (2-column) or `list` (single-column) |
| `voice_highlight_color` | string | `""` | Custom color for voice user accent |
| `voice_text_color` | string | `""` | Custom color for voice channel text (default: `#4081e4`) |
| `voice_status_style` | string | `"overlay"` | Voice status icon position: `overlay` (on avatar) or `inline` (after name) |

### User Profile

| Key | Type | Required | Description |
|-----|------|----------|-------------|
| `name` | string | Yes | Display name |
| `discord` | string | No | Discord entity ID (e.g. `sensor.discord_user_123456789`) |
| `steam` | string/list | No | Steam entity ID or list of Steam entity IDs |

At least one of `discord` or `steam` must be provided.

## Discord Activity Display

The card shows rich Discord activity beyond just games:

- **Playing** — Game name with background image (from Discord or Steam)
- **Watching** — TV/streaming activity (e.g., "Reacher - S04E05") with cover image
- **Listening** — Music activity (e.g., Spotify) with album art
- **Streaming** — Live streaming activity (e.g., Twitch/YouTube)

Activity priority: Game > Spotify > Watching > Streaming > Listening

## Voice Channel Features

### Voice Status Icons

Shows voice activity indicators on user avatars:

- 🎤 **Mute** — Microphone off (`voice_self_mute`)
-  **Deaf** — Headset muted (`voice_self_deaf`)
- 📺 **Stream** — Screen sharing (`voice_self_stream`)
-  **Webcam** — Camera on (`voice_self_video`)

### Voice Status Style

Control where voice status icons appear:

**Overlay** (default) — Icons on avatar corners:
```yaml
voice_status_style: overlay
```

**Inline** — Icons after username:
```yaml
voice_status_style: inline
```

### Voice Channel Grouping

Users in voice channels are grouped by channel name with a divider separating them from other users:

```
TALE 1 (5) · 3:38
├── User 1
├── User 2
└── User 3
─────────────
├── User 4 (online, not in voice)
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
  - name: "Mikkel"
    discord: sensor.discord_user_123456789
    steam: sensor.steam_mikkel123
  - name: "Anders"
    discord: sensor.discord_user_987654321
```

### Full featured

```yaml
type: custom:unified-gaming-card
title: "Gaming"
users:
  - name: "Mikkel"
    discord: sensor.discord_user_123456789
    steam: sensor.steam_mikkel123
  - name: "Anders"
    discord: sensor.discord_user_987654321
  - name: "Lars"
    steam: sensor.steam_larsgaming
hide_offline: false
show_toggle: true
max_online: 10
sort_by: game
view_mode: grid
compact_mode: false
voice_highlight_color: "#ff5722"
voice_text_color: "#4081e4"
voice_status_style: overlay
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
  - name: "Mikkel"
    discord: sensor.discord_user_123456789
    steam: sensor.steam_mikkel123
```

### Gaming dashboard with voice grouping

```yaml
type: custom:unified-gaming-card
title: "Gaming"
hide_offline: true
sort_by: game
view_mode: grid
voice_status_style: overlay
users:
  - name: "Cronner"
    discord: sensor.discord_user_669490307423010837
    steam: sensor.cronnerdk
  - name: "Lise"
    discord: sensor.discord_user_574224915083952137
    steam: sensor.lisemadsen1995
  - name: "Oliver"
    discord: sensor.discord_user_422547481298206720
    steam: sensor.mindofeagledk
```

## Requirements

- [Discord Game](https://github.com/3rob3/Discord-Game) custom component (for Discord users)
  - **Voice duration tracking**: Requires modified `sensor.py` (included in this repo as `discord_game_sensor.py`)
- [Steam](https://github.com/3rob3/gaming-steam-status) integration (for Steam users, optional)

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

## License

MIT
