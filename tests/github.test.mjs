import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fetchBaseCatalog, findRelease, parseVersion, pickRelease, UpstreamError } from '../scripts/lib/github.mjs';

const origin = { repo: 'fulano/meu-mod', tag: 'MeuMod-v', arquivo: 'MeuMod.dll' };
const DIGEST = `sha256:${'a'.repeat(64)}`;
const release = (tag, { prerelease = false, draft = false, name = 'MeuMod.dll', digest = DIGEST } = {}) => ({
  tag_name: tag,
  prerelease,
  draft,
  assets: [{ name, digest }],
});

function fakeFetch(status, body, seen = []) {
  return async (url, init) => {
    seen.push({ url, init });
    return { status, ok: status >= 200 && status < 300, json: async () => body };
  };
}

test('parseVersion segue Versoes.Ler do instalador', () => {
  assert.deepEqual(parseVersion('1.2.0-beta'), [1, 2, 0]);
  assert.deepEqual(parseVersion('vv3'), [3, 0]);
  assert.deepEqual(parseVersion('.1.2.'), [1, 2]);
  assert.equal(parseVersion('beta'), null);
  assert.equal(parseVersion(''), null);
  assert.equal(parseVersion('1..2'), null);
  assert.equal(parseVersion('1.2.3.4.5'), null);
  assert.equal(parseVersion('99999999999'), null);
});

test('pickRelease fica com a maior versão, como o instalador', () => {
  const releases = [
    release('MeuMod-v1.0'),
    release('MeuMod-v1.0.0'),
    release('meumod-V2.0', { name: 'meumod.DLL' }),
    release('MeuMod-v3.0', { draft: true }),
    release('MeuMod-v4.0', { prerelease: true }),
    release('MeuMod-vbeta'),
    release('Outro-v9'),
    release('MeuMod-v5.0', { name: 'Outro.dll' }),
  ];
  assert.equal(pickRelease(releases, origin, false).tag, 'meumod-V2.0');
  assert.equal(pickRelease(releases, origin, true).tag, 'MeuMod-v4.0');
  assert.equal(pickRelease([release('MeuMod-v1.0'), release('MeuMod-v1.0.0')], origin, false).tag, 'MeuMod-v1.0.0');
  assert.equal(pickRelease([release('MeuMod-vbeta'), release('MeuMod-v1')], origin, false).tag, 'MeuMod-v1');
  assert.equal(pickRelease([release('MeuMod-v1'), release('MeuMod-vbeta')], origin, false).tag, 'MeuMod-v1');
  assert.equal(pickRelease([], origin, false), null);
});

test('acha o release estável e manda o token', async () => {
  const seen = [];
  const r = await findRelease(origin, { fetchImpl: fakeFetch(200, [release('MeuMod-v1.0')], seen), token: 't0k' });
  assert.deepEqual(r, { ok: true, tag: 'MeuMod-v1.0' });
  assert.equal(seen[0].url, 'https://api.github.com/repos/fulano/meu-mod/releases?per_page=50');
  assert.equal(seen[0].init.headers.Authorization, 'Bearer t0k');
});

test('sem token não manda Authorization', async () => {
  const seen = [];
  await findRelease(origin, { fetchImpl: fakeFetch(200, [], seen) });
  assert.equal(seen[0].init.headers.Authorization, undefined);
});

test('repositório inexistente ou privado', async () => {
  const r = await findRelease(origin, { fetchImpl: fakeFetch(404, {}) });
  assert.deepEqual(r, { ok: false, reason: 'repositório fulano/meu-mod não existe ou é privado' });
});

test('erro do GitHub vira UpstreamError', async () => {
  await assert.rejects(findRelease(origin, { fetchImpl: fakeFetch(502, {}) }), UpstreamError);
});

test('só pré-lançamento não basta', async () => {
  const r = await findRelease(origin, { fetchImpl: fakeFetch(200, [release('MeuMod-v1', { prerelease: true })]) });
  assert.equal(r.ok, false);
  assert.match(r.reason, /nenhum release estável/);
});

test('o release escolhido precisa de digest, estável ou de teste', async () => {
  let r = await findRelease(origin, { fetchImpl: fakeFetch(200, [release('MeuMod-v1', { digest: DIGEST }), release('MeuMod-v2', { digest: null })]) });
  assert.match(r.reason, /MeuMod-v2 está sem sha256/);
  r = await findRelease(origin, { fetchImpl: fakeFetch(200, [release('MeuMod-v1'), release('MeuMod-v2', { prerelease: true, digest: 'md5:x' })]) });
  assert.match(r.reason, /MeuMod-v2 está sem sha256/);
});

test('ids e arquivos do catálogo base', async () => {
  const base = await fetchBaseCatalog({ fetchImpl: fakeFetch(200, { mods: [{ id: 'A', arquivo: 'A.dll' }, { id: 7 }, { id: 'B', arquivo: 'B.zip' }] }) });
  assert.deepEqual(base, { ids: ['A', 'B'], files: ['A.dll', 'B.zip'] });
  assert.deepEqual(await fetchBaseCatalog({ fetchImpl: fakeFetch(200, {}) }), { ids: [], files: [] });
  await assert.rejects(fetchBaseCatalog({ fetchImpl: fakeFetch(500, {}) }), UpstreamError);
});
