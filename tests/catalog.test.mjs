import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildCatalog } from '../scripts/lib/catalog.mjs';
import { SITE_USER, sampleMod } from './helpers.mjs';

const dates = { createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-02T00:00:00Z' };

test('achata a origem do GitHub nos campos que o instalador lê', () => {
  const c = buildCatalog([{ mod: sampleMod(), ...dates, hasCover: true }], { trustedAuthors: new Set(), generatedAt: 'agora' });
  assert.equal(c.formato, 1);
  assert.equal(c.geradoEm, 'agora');
  assert.deepEqual(c.mods[0], {
    id: 'MeuMod',
    nome: 'Meu Mod',
    tipo: 'plugin',
    autor: 'fulano',
    dono: { github: 'fulano' },
    descricao: 'Faz alguma coisa útil.',
    versoesDoJogo: ['307'],
    dependencias: ['PBSLoaderCommonUtils'],
    origem: 'github',
    repo: 'fulano/meu-mod',
    tag: 'MeuMod-v',
    arquivo: 'MeuMod.dll',
    pagina: 'https://github.com/fulano/meu-mod',
    capa: 'covers/MeuMod.webp',
    confiavel: false,
    criadoEm: dates.createdAt,
    atualizadoEm: dates.updatedAt,
  });
});

test('link externo, oculto, confiável e ordem por id', () => {
  const externo = sampleMod({ id: 'b-mapa', tipo: 'mapa', dono: { site: SITE_USER }, origem: { externa: { url: 'https://mega.nz/x' } }, pagina: 'https://site.com', dependencias: undefined });
  const c = buildCatalog(
    [
      { mod: externo, ...dates, hasCover: false },
      { mod: sampleMod({ id: 'Oculto', oculto: true }), ...dates, hasCover: false },
      { mod: sampleMod({ id: 'A-plugin' }), ...dates, hasCover: false },
    ],
    { trustedAuthors: new Set([`site:${SITE_USER}`]), generatedAt: 'agora' },
  );
  assert.deepEqual(c.mods.map((m) => m.id), ['A-plugin', 'b-mapa']);
  const mapa = c.mods[1];
  assert.equal(mapa.origem, 'externa');
  assert.equal(mapa.url, 'https://mega.nz/x');
  assert.equal(mapa.repo, undefined);
  assert.equal(mapa.pagina, 'https://site.com');
  assert.deepEqual(mapa.dependencias, []);
  assert.equal(mapa.confiavel, true);
  assert.equal(mapa.capa, null);
});

test('na publicação, o mais antigo fica com id e arquivo repetidos', () => {
  const warnings = [];
  const old = { createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', hasCover: false };
  const recent = { createdAt: '2026-02-01T00:00:00Z', updatedAt: '2026-02-01T00:00:00Z', hasCover: false };
  const c = buildCatalog(
    [
      { mod: sampleMod({ id: 'meumod' }), ...recent },
      { mod: sampleMod({ id: 'Outro' }), ...recent },
      { mod: sampleMod(), ...old },
      { mod: sampleMod({ id: 'SemData', origem: { github: { repo: 'a/b', tag: 'v', arquivo: 'SemData.dll' } } }), createdAt: null, updatedAt: null, hasCover: false },
    ],
    { trustedAuthors: new Set(), generatedAt: 'agora', warn: (w) => warnings.push(w) },
  );
  assert.deepEqual(c.mods.map((m) => m.id), ['MeuMod', 'SemData']);
  assert.equal(warnings.length, 2);
});

test('na publicação, sai o plugin que depende de mod da comunidade indisponível, em cadeia', () => {
  const warnings = [];
  const dll = (id) => ({ github: { repo: `x/${id}`, tag: 'v', arquivo: `${id}.dll` } });
  const c = buildCatalog(
    [
      { mod: sampleMod({ id: 'Oculto', oculto: true, origem: dll('Oculto') }), ...dates, hasCover: false },
      { mod: sampleMod({ id: 'Meio', dependencias: ['oculto'], origem: dll('Meio') }), ...dates, hasCover: false },
      { mod: sampleMod({ id: 'Topo', dependencias: ['Meio'], origem: dll('Topo') }), ...dates, hasCover: false },
      { mod: sampleMod({ id: 'Livre', dependencias: ['PBSLoaderCommonUtils'], origem: dll('Livre') }), ...dates, hasCover: false },
    ],
    { trustedAuthors: new Set(), generatedAt: 'agora', warn: (w) => warnings.push(w) },
  );
  assert.deepEqual(c.mods.map((m) => m.id), ['Livre']);
  assert.equal(warnings.length, 2);
});

test('link externo sem página fica com página nula', () => {
  const c = buildCatalog([{ mod: sampleMod({ origem: { externa: { url: 'https://x.com/a' } } }), ...dates, hasCover: false }], { trustedAuthors: new Set(), generatedAt: 'agora' });
  assert.equal(c.mods[0].pagina, null);
});
