import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

const source = readFileSync(new URL('../unified-gaming-card.js', import.meta.url), 'utf8');
const template = (strings, ...values) => strings.reduce((out, str, i) => out + str + (Array.isArray(values[i]) ? values[i].join('') : typeof values[i] === 'function' ? '' : values[i] ?? ''), '');
function setup() {
  class Lit { requestUpdate() {} dispatchEvent(event) { this.event = event; } connectedCallback() {} disconnectedCallback() {} }
  const context = vm.createContext({ LitElement: Lit, html: template, css: template, URL, Date, Intl,
    window: { location: { origin: 'https://home.example' } }, AbortSignal,
    CustomEvent: class { constructor(type, options) { this.type = type; Object.assign(this, options); } },
    setInterval, clearInterval, fetch: async () => ({ ok: true, json: async () => ({ items: [] }) }) });
  vm.runInContext(source.slice(source.indexOf('class UnifiedGamingCard'), source.indexOf('customElements.define("unified-gaming-card-editor"')) + '\nglobalThis.Card = UnifiedGamingCard; globalThis.Editor = UnifiedGamingCardEditor;', context);
  const card = new context.Card(); card.setConfig({ users: [] });
  return { card, context };
}
const state = (value, attributes = {}) => ({ state: value, attributes });
const start = new Date(Date.now() - 3600000).toISOString();
const gsWith = (picture, game = 'ARK') => state(game, { current_game: game, play_start_time: start, timer_status: 'Running', game_hero_art: 'http://private-host/local/gaming_status_cache/ark.png?v=1', entity_picture: picture });
const gs = () => state('ARK', { current_game: 'ARK', play_start_time: start, timer_status: 'Running', game_hero_art: 'http://private-host/local/gaming_status_cache/ark.png?v=1' });
const steamAvatar = hash => `https://avatars.steamstatic.com/${hash}_full.jpg`;
const discordAvatar = (id, hash) => `https://cdn.discordapp.com/avatars/${id}/${hash}.png?size=1024`;
const entry = (index = 0) => ({ profile_index: index, name: 'Player', merged_status: { status: 'online' }, merged_game: { game: 'ARK' },
  discord_game: null, xbox_game: null, discord_game_images: {}, xbox_game_images: {}, steam_game_images: [], steam_games: [], steam_entities: [] });

test('session does not borrow a different player playing the same game', () => {
  const { card } = setup();
  assert.equal(card._sessionStart({}, entry(), { states: { 'sensor.gaming_status_other_steam': gs() } }), null);
});
test('explicit session mapping matches trademark spelling and excludes paused/wrong games', () => {
  const { card } = setup(), sensor = gs(), profile = { session_entities: ['sensor.gaming_status_me_steam'] };
  const hass = { states: { 'sensor.gaming_status_me_steam': sensor } };
  const player = entry(); player.merged_game.game = 'ARK™';
  assert.equal(card._sessionStart(profile, player, hass), Date.parse(start));
  sensor.attributes.timer_status = 'Paused'; assert.equal(card._sessionStart(profile, player, hass), null);
  sensor.attributes.timer_status = 'Running'; player.merged_game.game = 'Other'; assert.equal(card._sessionStart(profile, player, hass), null);
});
test('direct Gaming Status Xbox mapping remains usable without discovery', () => {
  const { card } = setup();
  assert.equal(card._sessionStart({ xbox: 'sensor.gaming_status_me_xbox' }, entry(), { states: { 'sensor.gaming_status_me_xbox': gs() } }), Date.parse(start));
});
test('session is discovered by matching account avatar, not by game title', () => {
  const { card } = setup(); card.config = { users: [{ name: 'Me', steam: 'sensor.me' }] };
  const mine = 'a'.repeat(40), theirs = 'b'.repeat(40);
  const hass = { states: { 'sensor.me': state('in-game', { entity_picture: steamAvatar(mine) }),
    'sensor.gaming_status_me_steam': gsWith(steamAvatar(mine)),
    'sensor.gaming_status_other_steam': gsWith(steamAvatar(theirs)) } };
  assert.equal(card._sessionStart({ steam: 'sensor.me' }, entry(), hass), Date.parse(start));
  card._sessionCache = null;
  assert.equal(card._sessionStart({ steam: 'sensor.me' }, { ...entry(), profile_index: 1 }, hass), null);
});
test('discovered session covers the whole account family, including Xbox', () => {
  const { card } = setup(); card.config = { users: [{ name: 'Me', discord: 'sensor.discord_user_1' }] };
  const hash = 'c'.repeat(32);
  const discord = state('online', { entity_picture: discordAvatar('123456789012345678', hash) });
  const xbox = gsWith('/api/image_proxy/image.me_gamerpic?token=abc', 'ARK');
  xbox.attributes.timer_status = 'Running';
  const hass = { states: { 'sensor.discord_user_1': discord, 'sensor.gaming_status_me_discord': gsWith(discordAvatar('123456789012345678', hash).replace('.png', '.webp')),
    'sensor.gaming_status_me_xbox': xbox, 'sensor.gaming_status_me_master': gsWith(null) } };
  assert.equal(card._sessionStart({ discord: 'sensor.discord_user_1' }, entry(), hass), Date.parse(start));
});
test('explicit mapping is kept and account matching only adds what it omitted', () => {
  const { card } = setup(); card.config = { users: [{ name: 'Me', steam: 'sensor.me' }] };
  const mine = 'd'.repeat(40);
  const profile = { steam: 'sensor.me', session_entities: ['sensor.gaming_status_me_steam'] };
  const idle = { states: { 'sensor.me': state('in-game', { entity_picture: steamAvatar(mine) }),
    'sensor.gaming_status_me_steam': gsWith(steamAvatar(mine), 'ARK'), 'sensor.gaming_status_me_xbox': gsWith('/api/image_proxy/image.me_gamerpic?token=abc') } };
  idle.states['sensor.gaming_status_me_steam'].attributes.timer_status = 'Stopped (Offline)';
  // The listed sensor is idle, but the same account's Xbox sensor is running.
  assert.equal(card._sessionStart(profile, entry(), idle), Date.parse(start));
  // An explicit list alone keeps working exactly as written.
  const listed = { states: { 'sensor.gaming_status_me_discord': gs() } };
  assert.equal(card._sessionStart({ session_entities: ['sensor.gaming_status_me_discord'] }, entry(), listed), Date.parse(start));
});
test('an avatar shared by two accounts or two players never yields a session', () => {
  const shared = 'e'.repeat(40);
  const ambiguous = { states: { 'sensor.gaming_status_a_steam': gsWith(steamAvatar(shared)), 'sensor.gaming_status_b_steam': gsWith(steamAvatar(shared)) } };
  const { card } = setup(); card.config = { users: [{ name: 'Me', steam: 'sensor.me' }] };
  const hass = { ...ambiguous, states: { ...ambiguous.states, 'sensor.me': state('in-game', { entity_picture: steamAvatar(shared) }) } };
  assert.equal(card._sessionStart({ steam: 'sensor.me' }, entry(), hass), null);
  const { card: second } = setup(); second.config = { users: [{ name: 'A', steam: 'sensor.a' }, { name: 'B', steam: 'sensor.b' }] };
  const distinct = { states: { 'sensor.a': state('in-game', { entity_picture: steamAvatar(shared) }),
    'sensor.b': state('in-game', { entity_picture: steamAvatar(shared) }), 'sensor.gaming_status_a_steam': gsWith(steamAvatar(shared)) } };
  assert.equal(second._sessionStart({ steam: 'sensor.a' }, entry(0), distinct), null);
  assert.equal(second._sessionStart({ steam: 'sensor.b' }, entry(1), distinct), null);
});
test('only real account pictures produce an identity', () => {
  const { card } = setup();
  assert.equal(card._avatarIdentity('/api/image_proxy/image.me_gamerpic?token=abc'), null);
  assert.equal(card._avatarIdentity('https://avatars.steamstatic.com/' + 'a'.repeat(40) + '_full.jpg'), 'steam:' + 'a'.repeat(40));
  assert.equal(card._avatarIdentity('https://example.com/' + 'a'.repeat(40) + '.png'), null);
  assert.equal(card._avatarIdentity(null), null);
});
test('all Steam presence modes are mapped', () => {
  const { card } = setup(); card.config = { users: [{ steam: 'sensor.me' }] };
  for (const [input, output] of Object.entries({ online: 'online', busy: 'dnd', looking_to_play: 'online', looking_to_trade: 'online', away: 'idle', snooze: 'dnd', offline: 'offline' })) {
    assert.equal(card._buildEntities({ states: { 'sensor.me': state(input) } })[0].merged_status.status, output);
  }
});
test('offline button overrides initial hide setting in both directions', () => {
  const { card } = setup(); card.setConfig({ users: [], hide_offline: true });
  const offline = { merged_status: { status: 'offline' } };
  assert.equal(card._filterByStatus([offline]).length, 0);
  card._toggleOffline(); assert.equal(card._filterByStatus([offline]).length, 1);
  card._toggleOffline(); assert.equal(card._filterByStatus([offline]).length, 0);
});
test('custom art, Steam, derived hero, Gaming Status form a working fallback chain', () => {
  const { card } = setup(), player = entry();
  card.config.game_images = { ' ARK™ ': '/local/my-ark.jpg' };
  player.steam_games = ['ARK']; player.steam_game_images = [{ header: 'https://steam.example/header.jpg', hero: 'https://steam.example/hero.jpg' }];
  player.merged_images = card._mergeImages(player, { states: { 'sensor.gaming_status_other': gs() } });
  const fallback = card._backgroundImage(player);
  const expected = ['custom', 'steam', 'steam', 'gaming_status'];
  for (const name of expected) {
    const url = fallback.candidates[fallback.index];
    assert.equal(player.merged_images.sources[url], name);
    card._imageError(player, fallback, url);
  }
  assert.equal(fallback.index, 4);
  assert.equal(card._backgroundImage(player).index, 4);
  player.merged_game.game = 'Other'; assert.equal(card._backgroundImage(player).index, 0);
});
test('standard skips GS and works when GS is absent', () => {
  const { card } = setup(); card.config.image_source = 'standard';
  assert.equal(card._mergeImages(entry(), { states: { 'sensor.gaming_status_other': gs() } }), null);
  assert.equal(card._mergeImages(entry(), { states: {} }), null);
});
test('unsafe image URLs rejected, local cache normalized, native cache versions preserved', () => {
  const { card } = setup();
  for (const url of ['javascript:alert(1)', 'unknown', 'unavailable', 'https://user:pass@example.com/a']) assert.equal(card._imageUrl(url), null);
  assert.equal(card._imageUrl('http://private/local/gaming_status_cache/a.png?v=1'), '/local/gaming_status_cache/a.png?v=1');
  assert.equal(card._imageUrl('https://cdn.example/a.jpg?v=4'), 'https://cdn.example/a.jpg?v=4');
});
test('Steam hero derives only valid IDs and remains stable', () => {
  const { card } = setup();
  assert.equal(card._steamHero({ game_id: '2399830' }), card._steamHero({ game_id: '2399830' }));
  assert.equal(card._steamHero({ game_image_header: 'https://evil.example/steam/apps/1/header.jpg' }), null);
});
test('HTTP and empty Steam lookups are negatively cached', async () => {
  for (const ok of [true, false]) {
    const { card, context } = setup(); let calls = 0;
    context.fetch = async () => { calls++; return { ok, json: async () => ({ items: [] }) }; };
    await card._fetchSteamImages('ARK', 'ark');
    card._checkSteamFallbacks([entry()]); card._checkSteamFallbacks([entry()]);
    assert.equal(calls, 1);
    assert.equal(context.Card._steamCache.get('ark').url, null);
  }
});
test('Steam lookup rejects incorrect and ambiguous titles', async () => {
  for (const items of [[{ id: 1, name: 'ARK DLC' }], [{ id: 1, name: 'ARK' }, { id: 2, name: 'ARK™' }]]) {
    const { card, context } = setup(); context.fetch = async () => ({ ok: true, json: async () => ({ items }) });
    await card._fetchSteamImages('ARK', 'ark'); assert.equal(context.Card._steamCache.get('ark').url, null);
  }
});
test('Steam lookup accepts a unique title match instead of first search result', async () => {
  const { card, context } = setup(); context.fetch = async () => ({ ok: true, json: async () => ({ items: [{ id: 1, name: 'ARK DLC' }, { id: 2, name: 'ARK™' }] }) });
  await card._fetchSteamImages('ARK', 'ark'); assert.match(context.Card._steamCache.get('ark').url, /\/2$/);
});
test('unrelated HA changes do not rebuild; relevant new/changed/removed entities do', () => {
  const { card } = setup(); card.setConfig({ users: [{ steam: 'sensor.me' }] }); let builds = 0;
  const build = card._buildEntities.bind(card); card._buildEntities = hass => { builds++; return build(hass); };
  const me = state('online');
  card.hass = { states: { 'sensor.me': me, 'sensor.temp': state('20') } };
  card.hass = { states: { 'sensor.me': me, 'sensor.temp': state('21') } }; assert.equal(builds, 1);
  card.hass = { states: { 'sensor.me': state('busy') } }; assert.equal(builds, 2);
  card.hass = { states: {} }; assert.equal(builds, 3);
});
test('voice group sorts players gaming first', () => {
  const { card } = setup(); card._hass = { states: {} }; card.config.users = [];
  card._entities = [ { ...entry(), name: 'Idle', merged_game: null, discord_voice: 'Room' }, { ...entry(), name: 'Gamer', discord_voice: 'Room' } ];
  card._renderUserItem = e => `[${e.name}]`;
  const output = card.render(); assert.ok(output.indexOf('[Gamer]') < output.indexOf('[Idle]'));
});
test('popup shows source of current candidate after fallback', () => {
  const { card } = setup(), player = entry();
  player.merged_images = { source: 'steam', candidates: ['https://cdn.example/a', '/local/b'], sources: { 'https://cdn.example/a': 'steam', '/local/b': 'gaming_status' } };
  card._entities = [player]; card._selectedPlayer = 0;
  const f = card._backgroundImage(player); card._imageError(player, f, f.candidates[0]);
  assert.match(card._renderDetails(), /Gaming Status/); assert.match(card._renderDetails(), /href=\/local\/b/);
});
test('editor edits preserve unknown card and profile options and emit HA event', () => {
  const { context } = setup(), editor = new context.Editor();
  editor.setConfig({ type: 'custom:unified-gaming-card', future_option: 'keep', users: [{ name: 'A', custom_option: 42, steam: 'sensor.a' }] });
  editor._user(0, 'name', 'B'); assert.equal(editor._config.users[0].custom_option, 42);
  editor._field('image_source', 'standard'); assert.equal(editor._config.future_option, 'keep');
  assert.equal(editor.event.type, 'config-changed'); assert.equal(editor.event.composed, true);
  assert.match(editor.render(), /Spillere/);
});
test('editor rejects duplicate game keys without losing either image', () => {
  const { context } = setup(), editor = new context.Editor();
  editor.setConfig({ users: [], game_images: { ARK: '/local/ark.jpg', Doom: '/local/doom.jpg' } });
  editor._image(1, 0, 'ARK');
  assert.equal(editor._config.game_images.Doom, '/local/doom.jpg');
  assert.equal(editor._config.game_images.ARK, '/local/ark.jpg');
  assert.ok(editor._error);
});
test('expired negative search cache allows a new lookup', async () => {
  const { card, context } = setup(); let calls = 0;
  context.fetch = async () => { calls++; throw new Error('network'); };
  context.Card._steamCache.set('ark', { url: null, expires: Date.now() - 1 });
  card._checkSteamFallbacks([entry()]);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 1);
  assert.ok(context.Card._steamCache.get('ark').expires > Date.now());
});
