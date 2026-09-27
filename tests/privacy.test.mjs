import test from 'node:test';
import assert from 'node:assert/strict';
import { privacyFindings } from '../scripts/check-privacy.mjs';

const fenced = lines => ['```yaml', ...lines, '```'].join('\n');
test('accepts generic player examples', () => {
  const text = fenced(['users:', '  - name: "Player 1"', '    discord: sensor.discord_user_' + '1'.repeat(18), '    steam: sensor.steam_player_1', '    xbox: binary_sensor.xbox_player_1', '    session_entities:', '      - sensor.gaming_status_player_1_steam']);
  assert.deepEqual(privacyFindings(text), []);
});
test('rejects personal-looking example names and entity IDs without logging values', () => {
  const findings = privacyFindings(fenced(['  - name: "ExamplePerson"', '    steam: sensor.example_person', '    xbox: binary_sensor.example_account']));
  assert.equal(findings.length, 2);
  assert.ok(findings.every(message => !message.includes('ExamplePerson') && !message.includes('example_account')));
});
test('rejects non-placeholder account numbers, including outside examples', () => {
  const syntheticId = ['123456', '789012', '345678'].join('');
  assert.ok(privacyFindings('sensor.discord_user_' + syntheticId).length);
  assert.ok(privacyFindings('sensor.steam_' + syntheticId).length);
});
test('allows normal project ownership links and templated entity documentation', () => {
  assert.deepEqual(privacyFindings('https://github.com/example/project\n`binary_sensor.{gamertag}`'), []);
});
