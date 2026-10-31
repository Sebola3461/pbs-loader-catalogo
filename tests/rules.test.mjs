import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { classifyPath, evaluateChanges, isWebp, MAX_COVER_BYTES, ownerKey } from '../scripts/lib/rules.mjs';
import { SITE_USER, context, json, sampleMod, webp } from './helpers.mjs';

const add = (mod, path = `mods/${mod.id}.json`) => ({ path, status: 'A', after: json(mod) });
const edit = (mod) => ({ path: `mods/${mod.id}.json`, status: 'M', after: json(mod) });
const del = (id) => ({ path: `mods/${id}.json`, status: 'D', after: null });
const existing = (...mods) => new Map(mods.map((m) => [m.id, m]));

describe('helpers', () => {
  test('classifyPath', () => {
    assert.deepEqual(classifyPath('mods/Abc.json'), { kind: 'mod', id: 'Abc' });
    assert.deepEqual(classifyPath('covers/Abc.webp'), { kind: 'cover', id: 'Abc' });
    assert.equal(classifyPath('mods/../x.json'), null);
    assert.equal(classifyPath('.github/workflows/pr.yml'), null);
  });

  test('ownerKey e isWebp', () => {
    assert.equal(ownerKey({ github: 'Fulano' }), 'github:fulano');
    assert.equal(ownerKey({ site: SITE_USER }), `site:${SITE_USER}`);
    assert.equal(ownerKey(undefined), null);
    assert.ok(isWebp(webp()));
    assert.ok(!isWebp(Buffer.from('nao e imagem nenhuma')));
    assert.ok(!isWebp(Buffer.alloc(4)));
  });
});

describe('formato do PR', () => {
  test('sem arquivos é recusado', async () => {
    const r = await evaluateChanges([], context());
    assert.equal(r.outcome, 'reject');
  });

  test('arquivo fora de mods/ e covers/ vai para revisão', async () => {
    const r = await evaluateChanges([add(sampleMod()), { path: 'scripts/x.mjs', status: 'M', after: Buffer.from('') }], context());
    assert.equal(r.outcome, 'review');
    assert.deepEqual(r.errors, ['scripts/x.mjs: fora de mods/ e covers/']);
  });

  test('um mod por PR', async () => {
    const r = await evaluateChanges([add(sampleMod()), add(sampleMod({ id: 'Outro' }))], context());
    assert.equal(r.outcome, 'reject');
    assert.match(r.errors[0], /um PR por mod/);
  });
});

describe('publicar', () => {
  test('mod válido do próprio autor entra', async () => {
    const r = await evaluateChanges([add(sampleMod())], context());
    assert.deepEqual(r, { outcome: 'merge', errors: [], modId: 'MeuMod', operation: 'publish' });
  });

  test('bot do site publica mod de usuário do site', async () => {
    const r = await evaluateChanges([add(sampleMod({ dono: { site: SITE_USER } }))], context({ actor: 'pbs-loader-site[bot]' }));
    assert.equal(r.outcome, 'merge');
  });

  test('bot do site não publica em nome de conta do GitHub', async () => {
    const r = await evaluateChanges([add(sampleMod())], context({ actor: 'pbs-loader-site[bot]' }));
    assert.equal(r.outcome, 'reject');
  });

  test('dono diferente de quem abriu o PR', async () => {
    const r = await evaluateChanges([add(sampleMod({ dono: { github: 'outra' } }))], context());
    assert.deepEqual(r.errors, ['o campo "dono" precisa ser {"github": "fulano"}']);
  });

  test('id já existente', async () => {
    const r = await evaluateChanges([add(sampleMod())], context({ currentMods: existing(sampleMod()) }));
    assert.deepEqual(r.errors, ['já existe um mod com o id "MeuMod"']);
  });

  test('arquivo de mod grande demais', async () => {
    const r = await evaluateChanges([{ path: 'mods/MeuMod.json', status: 'A', after: Buffer.alloc(16 * 1024 + 1, 32) }], context());
    assert.deepEqual(r.errors, ['mods/MeuMod.json: o arquivo pode ter no máximo 16 KB']);
  });

  test('JSON inválido', async () => {
    const r = await evaluateChanges([{ path: 'mods/MeuMod.json', status: 'A', after: Buffer.from('{') }], context());
    assert.deepEqual(r.errors, ['mods/MeuMod.json: não é um JSON válido']);
  });

  test('erro de schema aparece com o caminho do arquivo', async () => {
    const r = await evaluateChanges([add(sampleMod({ tipo: 'carro' }))], context());
    assert.match(r.errors[0], /^mods\/MeuMod\.json \/tipo: precisa ser um destes/);
  });

  test('id diferente do nome do arquivo, colisão com a base e com maiúsculas', async () => {
    const r = await evaluateChanges([add(sampleMod({ id: 'meumod' }), 'mods/PbsLoaderCommonUtils.json')], context({ currentMods: existing(sampleMod({ id: 'PBSLOADERCOMMONUTILS' })) }));
    assert.equal(r.outcome, 'reject');
    assert.ok(r.errors.some((e) => e.includes('tem de ser igual ao nome do arquivo')));
    assert.ok(r.errors.some((e) => e.includes('catálogo base')));
    assert.ok(r.errors.some((e) => e.includes('maiúsculas e minúsculas')));
  });

  test('plugin precisa ser .dll, outros tipos .zip', async () => {
    let r = await evaluateChanges([add(sampleMod({ origem: { github: { repo: 'a/b', tag: 'v', arquivo: 'x.zip' } } }))], context());
    assert.ok(r.errors.some((e) => e.includes('distribuído como .dll')));
    r = await evaluateChanges([add(sampleMod({ tipo: 'onibus', origem: { github: { repo: 'a/b', tag: 'v', arquivo: 'x.dll' } } }))], context());
    assert.ok(r.errors.some((e) => e.includes('distribuído como .zip')));
  });

  test('repositório . ou .. é recusado', async () => {
    const r = await evaluateChanges([add(sampleMod({ origem: { github: { repo: 'a/..', tag: 'v', arquivo: 'x.dll' } } }))], context());
    assert.ok(r.errors.includes('mods/MeuMod.json: repositório inválido'));
  });

  test('dependências desconhecidas ou de si mesmo', async () => {
    const r = await evaluateChanges([add(sampleMod({ dependencias: ['MeuMod', 'Fantasma'] }))], context());
    assert.deepEqual(r.errors, ['o mod não pode depender de si mesmo', 'dependência desconhecida: "Fantasma"']);
  });

  test('depender de outro mod da comunidade vale', async () => {
    const r = await evaluateChanges([add(sampleMod({ dependencias: ['Base'] }))], context({ currentMods: existing(sampleMod({ id: 'Base', dono: { github: 'x' }, origem: { github: { repo: 'x/b', tag: 'v', arquivo: 'Base.dll' } } })) }));
    assert.equal(r.outcome, 'merge');
  });

  test('release inexistente recusa; release não é consultado se já houver erro', async () => {
    let calls = 0;
    const findRelease = async () => { calls++; return { ok: false, reason: 'sem release' }; };
    let r = await evaluateChanges([add(sampleMod())], context({ findRelease }));
    assert.deepEqual(r.errors, ['release: sem release']);
    r = await evaluateChanges([add(sampleMod({ dependencias: ['Fantasma'] }))], context({ findRelease }));
    assert.equal(calls, 1);
  });

  test('link externo não consulta release', async () => {
    const findRelease = async () => assert.fail('não devia consultar');
    const r = await evaluateChanges([add(sampleMod({ tipo: 'mapa', origem: { externa: { url: 'https://mega.nz/x' } } }))], context({ findRelease }));
    assert.equal(r.outcome, 'merge');
  });

  test('só moderador cria mod oculto', async () => {
    let r = await evaluateChanges([add(sampleMod({ oculto: true }))], context());
    assert.deepEqual(r.errors, ['só um moderador oculta ou reexibe um mod']);
    r = await evaluateChanges([add(sampleMod({ oculto: true }))], context({ actor: 'Moderadora' }));
    assert.equal(r.outcome, 'merge');
  });
});

describe('conflitos entre mods', () => {
  test('arquivo de mod base ou de outro mod da comunidade', async () => {
    let r = await evaluateChanges([add(sampleMod({ origem: { github: { repo: 'a/b', tag: 'v', arquivo: 'pbsloadercommonutils.dll' } } }))], context());
    assert.ok(r.errors.includes('mods/MeuMod.json: o arquivo pbsloadercommonutils.dll já é de um mod do catálogo base'));
    r = await evaluateChanges([add(sampleMod())], context({ currentMods: existing(sampleMod({ id: 'Outro', dono: { github: 'x' } })) }));
    assert.ok(r.errors.includes('mods/MeuMod.json: o arquivo MeuMod.dll já é usado pelo mod "Outro"'));
  });

  test('editar o próprio mod mantendo o arquivo não conflita com ele mesmo', async () => {
    const r = await evaluateChanges([edit(sampleMod({ nome: 'X' }))], context({ currentMods: existing(sampleMod()) }));
    assert.equal(r.outcome, 'merge');
  });

  test('id removido continua do último dono', async () => {
    const formerOwners = new Map([['meumod', 'github:outra']]);
    let r = await evaluateChanges([add(sampleMod())], context({ formerOwners }));
    assert.deepEqual(r.errors, ['o id "MeuMod" já foi de outro autor; escolha outro']);
    r = await evaluateChanges([add(sampleMod({ dono: { github: 'outra' } }))], context({ actor: 'outra', formerOwners }));
    assert.equal(r.outcome, 'merge');
    r = await evaluateChanges([add(sampleMod())], context({ actor: 'moderadora', formerOwners }));
    assert.equal(r.outcome, 'merge');
  });

  test('plugin só depende de plugin instalável, sem diferenciar maiúsculas', async () => {
    const mapa = sampleMod({ id: 'Mapa', tipo: 'mapa', dono: { github: 'x' }, origem: { externa: { url: 'https://x.com/m' } } });
    const oculto = sampleMod({ id: 'Oculto', dono: { github: 'x' }, oculto: true, origem: { github: { repo: 'x/o', tag: 'v', arquivo: 'O.dll' } } });
    const plugin = sampleMod({ id: 'Lib', dono: { github: 'x' }, origem: { github: { repo: 'x/l', tag: 'v', arquivo: 'Lib.dll' } } });
    const currentMods = existing(mapa, oculto, plugin);
    let r = await evaluateChanges([add(sampleMod({ dependencias: ['mapa', 'OCULTO', 'lib', 'pbsloadercommonutils'] }))], context({ currentMods }));
    assert.deepEqual(r.errors, [
      '"mapa" não serve de dependência para um plugin: o instalador só instala plugins .dll do GitHub',
      '"OCULTO" não serve de dependência para um plugin: o instalador só instala plugins .dll do GitHub',
    ]);
    r = await evaluateChanges([add(sampleMod({ tipo: 'onibus', dependencias: ['Mapa'], origem: { externa: { url: 'https://x.com/o' } } }))], context({ currentMods }));
    assert.equal(r.outcome, 'merge');
  });

  test('editar um mod de que plugins dependem para algo não instalável', async () => {
    const currentMods = existing(sampleMod(), sampleMod({ id: 'Filho', dono: { github: 'x' }, dependencias: ['meumod'], origem: { github: { repo: 'x/f', tag: 'v', arquivo: 'F.dll' } } }));
    const r = await evaluateChanges([edit(sampleMod({ tipo: 'outro', origem: { externa: { url: 'https://x.com/a' } } }))], context({ currentMods }));
    assert.deepEqual(r.errors, ['Filho depende(m) de "MeuMod" como plugin instalável; mantenha tipo, origem e arquivo']);
  });

  test('arquivo ilegível na base ocupa o id e só moderador corrige', async () => {
    const brokenIds = new Set(['MeuMod']);
    let r = await evaluateChanges([add(sampleMod())], context({ brokenIds }));
    assert.deepEqual(r.errors, ['já existe um arquivo mods/MeuMod.json, ilegível']);
    r = await evaluateChanges([edit(sampleMod())], context({ brokenIds }));
    assert.deepEqual(r.errors, ['o arquivo atual de "MeuMod" está ilegível; só um moderador corrige']);
    r = await evaluateChanges([edit(sampleMod())], context({ actor: 'moderadora', brokenIds }));
    assert.deepEqual(r, { outcome: 'merge', errors: [], modId: 'MeuMod', operation: 'edit' });
  });
});

describe('editar', () => {
  test('dono edita', async () => {
    const r = await evaluateChanges([edit(sampleMod({ nome: 'Novo nome' }))], context({ currentMods: existing(sampleMod()) }));
    assert.deepEqual(r, { outcome: 'merge', errors: [], modId: 'MeuMod', operation: 'edit' });
  });

  test('editar mod que não existe', async () => {
    const r = await evaluateChanges([edit(sampleMod())], context());
    assert.deepEqual(r.errors, ['o mod "MeuMod" não existe no catálogo atual']);
  });

  test('outra pessoa não edita', async () => {
    const r = await evaluateChanges([edit(sampleMod())], context({ actor: 'intrusa', currentMods: existing(sampleMod()) }));
    assert.deepEqual(r.errors, ['@intrusa não é dono do mod "MeuMod"']);
  });

  test('bot não edita mod de conta do GitHub', async () => {
    const r = await evaluateChanges([edit(sampleMod({ dono: { site: SITE_USER } }))], context({ actor: 'pbs-loader-site[bot]', currentMods: existing(sampleMod()) }));
    assert.equal(r.outcome, 'reject');
  });

  test('transferir dono e reexibir exigem moderador', async () => {
    const before = sampleMod({ dono: { site: SITE_USER }, oculto: true });
    const after = sampleMod({ dono: { site: '01928c3e-7b2a-7c4d-8e9f-ffffffffffff' } });
    let r = await evaluateChanges([edit(after)], context({ actor: 'pbs-loader-site[bot]', currentMods: existing(before) }));
    assert.deepEqual(r.errors, ['só um moderador transfere um mod para outro dono', 'só um moderador oculta ou reexibe um mod']);
    r = await evaluateChanges([edit(after)], context({ actor: 'moderadora', currentMods: existing(before) }));
    assert.equal(r.outcome, 'merge');
  });
});

describe('remover', () => {
  test('dono remove', async () => {
    const r = await evaluateChanges([del('MeuMod')], context({ currentMods: existing(sampleMod()) }));
    assert.deepEqual(r, { outcome: 'merge', errors: [], modId: 'MeuMod', operation: 'remove' });
  });

  test('outra pessoa não remove', async () => {
    const r = await evaluateChanges([del('MeuMod')], context({ actor: 'intrusa', currentMods: existing(sampleMod()) }));
    assert.equal(r.outcome, 'reject');
  });

  test('não remove mod de que outros dependem, a não ser moderador', async () => {
    const mods = existing(sampleMod(), sampleMod({ id: 'Filho', dependencias: ['MeuMod'] }));
    let r = await evaluateChanges([del('MeuMod')], context({ currentMods: mods }));
    assert.deepEqual(r.errors, ['não dá para remover: Filho depende(m) de "MeuMod"']);
    r = await evaluateChanges([del('MeuMod')], context({ actor: 'moderadora', currentMods: mods }));
    assert.equal(r.outcome, 'merge');
  });
});

describe('capa', () => {
  const cover = (bytes, status = 'A') => ({ path: 'covers/MeuMod.webp', status, after: status === 'D' ? null : bytes });

  test('capa junto com o mod novo', async () => {
    const r = await evaluateChanges([add(sampleMod()), cover(webp())], context());
    assert.equal(r.outcome, 'merge');
  });

  test('trocar só a capa do próprio mod', async () => {
    const r = await evaluateChanges([cover(webp(), 'M')], context({ currentMods: existing(sampleMod()) }));
    assert.deepEqual(r, { outcome: 'merge', errors: [], modId: 'MeuMod', operation: 'cover' });
  });

  test('capa grande, que não é WebP ou de mod inexistente', async () => {
    const r = await evaluateChanges([cover(Buffer.alloc(MAX_COVER_BYTES + 1))], context());
    assert.deepEqual(r.errors, [
      'covers/MeuMod.webp: não há mod "MeuMod" para essa capa',
      'covers/MeuMod.webp: a capa pode ter no máximo 300 KB',
      'covers/MeuMod.webp: a capa tem de ser uma imagem WebP',
    ]);
  });

  test('capa de mod removido no mesmo PR', async () => {
    const r = await evaluateChanges([del('MeuMod'), cover(webp())], context({ currentMods: existing(sampleMod()) }));
    assert.ok(r.errors.includes('covers/MeuMod.webp: não há mod "MeuMod" para essa capa'));
  });

  test('capa de mod alheio', async () => {
    const r = await evaluateChanges([cover(null, 'D')], context({ actor: 'intrusa', currentMods: existing(sampleMod()) }));
    assert.deepEqual(r.errors, ['@intrusa não é dono do mod "MeuMod"']);
  });
});
