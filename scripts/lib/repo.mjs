import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

function git(cwd, args, encoding = 'utf8') {
  return execFileSync('git', args, { cwd, encoding, maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
}

/**
 * Nada do PR é executado: é isso que deixa rodar em pull_request_target com permissão de escrita.
 */
export function listChanges(cwd, baseRev, headRev) {
  const mergeBase = git(cwd, ['merge-base', baseRev, headRev]).trim();
  const out = git(cwd, ['diff', '--name-status', '--no-renames', '-z', mergeBase, headRev]);
  const parts = out.split('\0').filter(Boolean);
  const changes = [];
  for (let i = 0; i < parts.length; i += 2) {
    const status = parts[i][0];
    const path = parts[i + 1];
    changes.push({ path, status, after: status === 'D' ? null : git(cwd, ['show', `${headRev}:${path}`], 'buffer') });
  }
  return changes;
}

/**
 * Arquivo ilegível fica de fora, com aviso, e o id vai para broken: ele continua ocupado.
 */
export function loadMods(cwd, warn = () => {}, broken = new Set()) {
  const dir = join(cwd, 'mods');
  const mods = new Map();
  if (!existsSync(dir)) return mods;
  for (const name of readdirSync(dir).filter((n) => n.endsWith('.json')).sort()) {
    try {
      const mod = JSON.parse(readFileSync(join(dir, name), 'utf8'));
      mods.set(name.slice(0, -'.json'.length), mod);
    } catch (e) {
      broken.add(name.slice(0, -'.json'.length));
      warn(`mods/${name}: ${e.message}`);
    }
  }
  return mods;
}

/** Datas do primeiro e do último commit que tocaram o arquivo; o autor não consegue forjá-las no JSON. */
export function fileDates(cwd, path) {
  const lines = git(cwd, ['log', '--format=%cI', '--', path]).trim().split('\n').filter(Boolean);
  if (lines.length === 0) return { createdAt: null, updatedAt: null };
  return { createdAt: lines.at(-1), updatedAt: lines[0] };
}

/** Dono da última versão de cada mod já removido (id minúsculo -> ownerKey), lido do histórico da base. */
export function formerOwners(cwd, ownerKey) {
  const owners = new Map();
  const log = git(cwd, ['log', '--diff-filter=D', '--name-only', '--format=commit %H', '--', 'mods/']);
  let commit = null;
  for (const line of log.split('\n').filter(Boolean)) {
    if (line.startsWith('commit ')) {
      commit = line.slice('commit '.length);
      continue;
    }
    const id = /^mods\/(.+)\.json$/.exec(line)?.[1];
    // O log vem do mais novo para o mais antigo: vale a remoção mais recente.
    if (!id || owners.has(id.toLowerCase())) continue;
    try {
      owners.set(id.toLowerCase(), ownerKey(JSON.parse(git(cwd, ['show', `${commit}^:${line}`])).dono));
    } catch {
      // Versão removida ilegível: não há dono para reservar.
    }
  }
  return owners;
}

export function readJson(cwd, path) {
  return JSON.parse(readFileSync(join(cwd, path), 'utf8'));
}
