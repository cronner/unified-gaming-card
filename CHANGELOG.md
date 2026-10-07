# Changelog

## v1.4.1

- Restore session time for every player without configuration: a Gaming Status sensor is
  now matched to a player by account, not by game title. Discord and Steam account
  pictures name the account, so a shared avatar is a reliable link where a shared game
  title was not.
- Once one platform of an account is matched, every platform of that same account is
  used, so an active Xbox session is found even when only the Steam or Discord sensor
  carries a comparable picture.
- Any `session_entities` you already set are kept exactly as written; matching only adds
  platforms the list left out.
- Never guess: an avatar shared by two accounts or claimed by two players is ignored,
  Xbox gamerpic and Discord default avatars carry no identity, and game titles are never
  used to attribute a session.

### Migration

None. Nothing to change in your configuration.

## v1.4.0

- Fix session attribution: only explicitly linked player sensors supply session time;
  game-title-only discovery no longer borrows another player's session.
- Match linked session game titles across case, whitespace, and trademark differences.
- Handle Steam busy/looking-to-play/looking-to-trade presence correctly.
- Allow the offline toggle to override its configured initial value.
- Cache unsuccessful Steam searches for ten minutes, enforce a ten-second timeout,
  and require a unique normalized title match. Successful results expire after one day.
- Show gamers first within each voice group as well as the non-voice list.
- Add current artwork source and image link to the player details popup.
- Add optional `game_images` overrides, with normal image-error fallback.
- Add a visual editor for players, image options, voice icons, layout, and artwork overrides.
- Share entity indexing and skip player rebuilds on unrelated state changes.
- Add regression tests and update configuration/migration documentation.

### Migration

Set `session_entities` for each player requiring session time. Directly configured
Gaming Status Xbox sensors can still provide their own session. Missing a safe
link hides only the timer, not the player. Gaming Status remains optional.
