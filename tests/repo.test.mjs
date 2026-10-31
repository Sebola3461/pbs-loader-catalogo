import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { checkPullRequest, EXIT, formatComment } from '../scripts/lib/pr-check.mjs';
import { fileDates, formerOwners, listChanges, loadMods } from '../scripts/lib/repo.mjs';
import { ownerKey } from '../scripts/lib/rules.mjs';
import { buildSite } from '../scripts/lib/site.mjs';
import { sampleMod, webp } from './helpers.mjs';

const ROOT = new URL('..', import.meta.url);

function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'catalogo-teste-'));
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'teste@exemplo.com');
  git('config', 'user.name', 'teste');
  git('config', 'commit.gpgsign', 'false');
  const write = (path, content) => {
    mkdirSync(join(dir, path, '..'), { recursive: true });
    writeFileSync(join(dir, path), content);
  };
  const commit = (message) => {
    git('add', '-A');
    git('commit', '-q', '-m', message);
    return git('rev-parse', 'HEAD');
  };
  write('moderators.json', JSON.stringify({ moderators: ['Moderadora'] }));
  write('trusted-authors.json', JSON.stringify({ authors: ['github:fulano'] }));
  write('schema/mod.schema.json', readFileSync(new URL('schema/mod.schema.json', ROOT)));
  return { dir, git, write, commit };
}

describe('repositório git', () => {
  let repo;
  before(() => {
    repo = makeRepo();
    repo.write('mods/Velho.json', JSON.stringify(sampleMod({ id: 'Velho', dependencias: [] })));
    repo.write('mods/Apagar.json', JSON.stringify(sampleMod({ id: 'Apagar', dependencias: [] })));
    repo.commit('base');
  });
  after(() => rmSync(repo.dir, { recursive: true, force: true }));

  test('listChanges lê A, M e D do PR como dados', () => {
    repo.git('checkout', '-q', '-b', 'pr');
    repo.write('mods/Velho.json', JSON.stringify(sampleMod({ id: 'Velho', nome: 'Novo', dependencias: [] })));
    repo.write('covers/Velho.webp', webp());
    rmSync(join(repo.dir, 'mods/Apagar.json'));
    const head = repo.commit('pr');
    repo.git('checkout', '-q', 'main');

    const changes = listChanges(repo.dir, 'main', head).sort((a, b) => a.path.localeCompare(b.path));
    assert.deepEqual(changes.map((c) => [c.path, c.status]), [['covers/Velho.webp', 'A'], ['mods/Apagar.json', 'D'], ['mods/Velho.json', 'M']]);
    assert.equal(changes[1].after, null);
    assert.equal(JSON.parse(changes[2].after.toString()).nome, 'Novo');
  });

  test('loadMods avisa e pula JSON ilegível; pasta ausente vira mapa vazio', () => {
    const outro = makeRepo();
    try {
      assert.equal(loadMods(outro.dir).size, 0);
      outro.write('mods/Ruim.json', '{');
      outro.write('mods/Bom.json', JSON.stringify(sampleMod({ id: 'Bom' })));
      outro.write('mods/leia.txt', 'x');
      const warnings = [];
      const broken = new Set();
      const mods = loadMods(outro.dir, (w) => warnings.push(w), broken);
      assert.deepEqual([...mods.keys()], ['Bom']);
      assert.deepEqual([...broken], ['Ruim']);
      assert.equal(warnings.length, 1);
      assert.match(warnings[0], /^mods\/Ruim\.json:/);
    } finally {
      rmSync(outro.dir, { recursive: true, force: true });
    }
  });

  test('fileDates usa o histórico; arquivo sem commit fica sem data', () => {
    const d = fileDates(repo.dir, 'mods/Velho.json');
    assert.match(d.createdAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.ok(d.updatedAt >= d.createdAt);
    assert.deepEqual(fileDates(repo.dir, 'mods/Nada.json'), { createdAt: null, updatedAt: null });
  });
});

describe('donos anteriores', () => {
  test('formerOwners guarda o dono da remoção mais recente e ignora versão ilegível', () => {
    const repo = makeRepo();
    try {
      repo.write('mods/A.json', JSON.stringify(sampleMod({ id: 'A', dono: { github: 'primeira' } })));
      repo.write('mods/Ruim.json', '{');
      repo.write('mods/Fica.json', JSON.stringify(sampleMod({ id: 'Fica' })));
      repo.commit('cria');
      rmSync(join(repo.dir, 'mods/A.json'));
      rmSync(join(repo.dir, 'mods/Ruim.json'));
      repo.commit('remove');
      repo.write('mods/A.json', JSON.stringify(sampleMod({ id: 'A', dono: { github: 'Segunda' } })));
      repo.commit('recria');
      rmSync(join(repo.dir, 'mods/A.json'));
      repo.commit('remove de novo');

      const owners = formerOwners(repo.dir, ownerKey);
      assert.deepEqual([...owners], [['a', 'github:segunda']]);
    } finally {
      rmSync(repo.dir, { recursive: true, force: true });
    }
  });
});

describe('validação de ponta a ponta', () => {
  test('PR válido sai com merge e comentário de sucesso', async () => {
    const repo = makeRepo();
    try {
      repo.commit('base');
      repo.git('checkout', '-q', '-b', 'pr');
      repo.write('mods/MeuMod.json', JSON.stringify(sampleMod()));
      const head = repo.commit('pr');
      repo.git('checkout', '-q', 'main');

      const result = await checkPullRequest({
        cwd: repo.dir,
        baseRev: 'main',
        headRev: head,
        actor: 'fulano',
        botLogin: '',
        base: { ids: ['PBSLoaderCommonUtils'], files: ['PBSLoaderCommonUtils.dll'] },
        findRelease: async () => ({ ok: true }),
      });
      assert.equal(EXIT[result.outcome], 0);
      assert.match(formatComment(result), /Tudo certo para publicar \*\*MeuMod\*\*/);
    } finally {
      rmSync(repo.dir, { recursive: true, force: true });
    }
  });

  test('comentários de recusa e de revisão listam os motivos', () => {
    assert.match(formatComment({ outcome: 'reject', errors: ['a', 'b'] }), /não pode entrar ainda[\s\S]*- a\n- b/);
    assert.match(formatComment({ outcome: 'review', errors: ['x: fora'] }), /Um mantenedor vai revisar[\s\S]*- x: fora/);
  });
});

describe('publicação', () => {
  test('buildSite gera catálogo, capas e schema, e pula mod inválido', () => {
    const repo = makeRepo();
    const out = mkdtempSync(join(tmpdir(), 'catalogo-site-'));
    try {
      repo.write('mods/MeuMod.json', JSON.stringify(sampleMod()));
      repo.write('covers/MeuMod.webp', webp());
      repo.write('mods/Quebrado.json', JSON.stringify({ id: 'Quebrado' }));
      repo.write('mods/Trocado.json', JSON.stringify(sampleMod({ id: 'OutroId' })));
      repo.commit('mods');

      const warnings = [];
      const catalog = buildSite(repo.dir, out, { now: new Date('2026-10-30T00:00:00Z'), warn: (w) => warnings.push(w) });
      assert.deepEqual(catalog.mods.map((m) => m.id), ['MeuMod']);
      assert.equal(catalog.mods[0].confiavel, true);
      assert.equal(warnings.length, 2);
      assert.ok(warnings.some((w) => w.includes('id diferente do nome do arquivo')));

      const written = JSON.parse(readFileSync(join(out, 'community-catalog.json'), 'utf8'));
      assert.equal(written.geradoEm, '2026-10-30T00:00:00.000Z');
      assert.ok(existsSync(join(out, 'covers', 'MeuMod.webp')));
      assert.ok(existsSync(join(out, 'schema', 'mod.schema.json')));
    } finally {
      rmSync(repo.dir, { recursive: true, force: true });
      rmSync(out, { recursive: true, force: true });
    }
  });
});
