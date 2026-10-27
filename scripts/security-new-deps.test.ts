// node scripts/security-new-deps.test.ts — the hallucinated-dependency guard's pure parts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cargoDeps, npmDeps, newDeps, judge } from './security-new-deps.ts';

const CARGO = `version = 4

[[package]]
name = "serde"
version = "1.0.200"
source = "registry+https://github.com/rust-lang/crates.io-index"

[[package]]
name = "campaign-core"
version = "0.1.0"

[[package]]
name = "evil"
version = "0.1.0"
source = "git+https://example.com/evil#abc"
`;

void test('cargo: registry and git packages are listed, workspace crates skipped', () => {
	assert.deepEqual(cargoDeps(CARGO).map(d => d.name), ['serde', 'evil']);
});

void test('npm: nested node_modules names, links skipped', () => {
	const lock = JSON.stringify({ packages: { '': {}, 'node_modules/a': { resolved: 'https://registry.npmjs.org/a/-/a-1.tgz' },
		'node_modules/a/node_modules/@s/b': { resolved: 'https://registry.npmjs.org/@s/b/-/b-1.tgz' }, 'node_modules/l': { link: true } } });
	assert.deepEqual(npmDeps(lock).map(d => d.name), ['a', '@s/b']);
});

void test('only names absent from the base are new; a version bump is not', () => {
	const base = cargoDeps(CARGO).filter(d => d.name === 'serde');
	assert.deepEqual(newDeps(cargoDeps(CARGO), base).map(d => d.name), ['evil']);
});

void test('a git-sourced crate is held without any network call', async () => {
	const why = await judge({ ecosystem: 'crates', name: 'evil', source: 'git+https://example.com/evil#abc' });
	assert.match(why, /non-crates\.io source/);
});

void test('npm: a lockfile key that resolves to a different package is held', async () => {
	const why = await judge({ ecosystem: 'npm', name: 'chalk', source: 'https://registry.npmjs.org/ch4lk/-/ch4lk-1.0.0.tgz' });
	assert.match(why, /name\/package mismatch/);
});

void test('npm: names outside the npm naming rule (path tricks) are held', async () => {
	assert.match(await judge({ ecosystem: 'npm', name: 'x/../express', source: 'https://registry.npmjs.org/express/-/express-4.0.0.tgz' }), /invalid npm name/);
});

void test('cargo: CRLF and loose spacing still parse; a nameless package refuses', () => {
	assert.deepEqual(cargoDeps('version = 4\r\n\r\n[[package]]\r\nname="x"\r\nversion = "1"\r\nsource="git+https://e.com/x#a"\r\n').map(d => d.source), ['git+https://e.com/x#a']);
	assert.throws(() => cargoDeps('version = 4\n\n[[package]]\nversion = "1"\n'));
});

void test('cargo: a source that only starts with the crates.io index URL is held', async () => {
	const why = await judge({ ecosystem: 'crates', name: 'serde', source: 'registry+https://github.com/rust-lang/crates.io-index.evil.example' });
	assert.match(why, /non-crates\.io source/);
});
