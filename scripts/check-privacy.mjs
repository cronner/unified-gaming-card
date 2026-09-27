import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Structural rules, not a list of people's names: the guard must not re-publish
// the personal information it is intended to remove. This is a bounded check,
// not a guarantee that arbitrary prose, images or history contain no personal data.
export function privacyFindings(text) {
  const findings = [];
  for (const match of text.matchAll(/\b(?:sensor\.)?(?:discord_user_|steam_)(\d{17,20})(?!\d)/g)) {
    if (!/^([1-9])\1+$/.test(match[1])) findings.push('Non-placeholder account ID');
  }
  for (const block of text.matchAll(/^```([^\n]*)\n([\s\S]*?)^```\s*$/gm)) {
    if (!["", "yaml", "yml"].includes(block[1].trim())) continue;
    for (const line of block[2].split('\n')) {
      const name = line.match(/^\s*-?\s*name:\s*["']?([^"'\n]+?)["']?\s*$/);
      if (name && !/^Player [1-9]\d*$/.test(name[1])) findings.push('Non-generic player name in example');
      for (const match of line.matchAll(/\b(?:sensor|binary_sensor)\.([a-z0-9_]+)/g)) {
        if (!/^(?:discord_user_([1-9])\1{16,19}|steam_player_[1-9]\d*(?:_secondary)?|xbox_player_[1-9]\d*|gaming_status_player_[1-9]\d*_(?:steam|discord|xbox|master|pc))$/.test(match[1])) {
          findings.push('Non-generic entity ID in example');
        }
      }
    }
  }
  return [...new Set(findings)];
}

function documentText(file) {
  const raw = readFileSync(file, 'utf8');
  if (!file.endsWith('.json')) return raw;
  // Decode escaped release-note Markdown before inspecting its examples.
  const strings = [];
  const collect = value => {
    if (typeof value === 'string') strings.push(value);
    else if (value && typeof value === 'object') Object.values(value).forEach(collect);
  };
  collect(JSON.parse(raw));
  return strings.join('\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const files = process.argv.length > 2 ? process.argv.slice(2) :
    execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(file => /\.(?:md|json|js|mjs|py|ya?ml)$/.test(file));
  let failed = false;
  for (const file of files) {
    const findings = privacyFindings(documentText(file));
    if (findings.length) {
      failed = true;
      // Do not reproduce the detected values in build logs.
      console.error(`${file}: ${findings.join('; ')}`);
    }
  }
  if (failed) process.exitCode = 1;
  else console.log(`Privacy checks passed (${files.length} files).`);
}
