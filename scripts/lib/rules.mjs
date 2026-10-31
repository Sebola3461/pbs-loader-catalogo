import { schemaErrors } from './schema.mjs';

export const MAX_COVER_BYTES = 300 * 1024;
export const MAX_MOD_BYTES = 16 * 1024;

const MOD_PATH = /^mods\/([A-Za-z0-9][A-Za-z0-9_-]{1,63})\.json$/;
const COVER_PATH = /^covers\/([A-Za-z0-9][A-Za-z0-9_-]{1,63})\.webp$/;

/** Para que serve um caminho do repositório num PR da comunidade; null = fora do que a comunidade pode mexer. */
export function classifyPath(path) {
  let m = MOD_PATH.exec(path);
  if (m) return { kind: 'mod', id: m[1] };
  m = COVER_PATH.exec(path);
  if (m) return { kind: 'cover', id: m[1] };
  return null;
}

export function ownerKey(owner) {
  if (owner?.github) return `github:${owner.github.toLowerCase()}`;
  if (owner?.site) return `site:${owner.site}`;
  return null;
}

export function isWebp(bytes) {
  return (
    bytes.length >= 12 &&
    bytes.toString('latin1', 0, 4) === 'RIFF' &&
    bytes.toString('latin1', 8, 12) === 'WEBP'
  );
}

/**
 * O bot do site só mexe em mods de usuários do site (o site já conferiu a posse pela sessão); um autor do GitHub
 * só nos próprios; moderador em qualquer um.
 */
function canTouch(owner, actor, ctx) {
  const login = actor.toLowerCase();
  if (ctx.moderators.has(login)) return true;
  if (ctx.botLogin && login === ctx.botLogin.toLowerCase()) return Boolean(owner?.site);
  return owner?.github?.toLowerCase() === login;
}

function parseMod(bytes, path, errors) {
  if (bytes.length > MAX_MOD_BYTES) {
    errors.push(`${path}: o arquivo pode ter no máximo ${MAX_MOD_BYTES / 1024} KB`);
    return null;
  }
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch {
    errors.push(`${path}: não é um JSON válido`);
    return null;
  }
}

const isModerator = (ctx) => ctx.moderators.has(ctx.actor.toLowerCase());
const sameId = (a, b) => a.toLowerCase() === b.toLowerCase();
const findCurrent = (ctx, id) => [...ctx.currentMods.values()].find((m) => sameId(m.id, id)) ?? null;

/** O que o instalador consegue instalar de um mod da comunidade: plugin .dll vindo do GitHub e não oculto. */
export function isInstallablePlugin(mod) {
  return mod.tipo === 'plugin' && !mod.oculto && Boolean(mod.origem?.github?.arquivo?.toLowerCase().endsWith('.dll'));
}

function checkFileName(change, mod, errors) {
  if (mod.id !== change.id) errors.push(`${change.path}: o "id" (${mod.id}) tem de ser igual ao nome do arquivo (${change.id})`);
}

function checkIdIsFree(id, ctx, errors) {
  if (ctx.baseIds.some((b) => sameId(b, id))) errors.push(`o id "${id}" já é usado por um mod do catálogo base`);
  const clash = [...ctx.currentMods.keys()].find((c) => c !== id && sameId(c, id));
  if (clash) errors.push(`o id "${id}" só difere de "${clash}" em maiúsculas e minúsculas`);
}

// Quem já instalou um mod tem o id no registro do instalador: se outro autor pegasse o id, a DLL dele chegaria
// como "atualização", até no modo silencioso. Por isso um id removido continua sendo do último dono.
function checkReservedId(after, ctx, errors) {
  const former = ctx.formerOwners.get(after.id.toLowerCase());
  if (former && former !== ownerKey(after.dono) && !isModerator(ctx)) {
    errors.push(`o id "${after.id}" já foi de outro autor; escolha outro`);
  }
}

function checkFileKind(mod, path, errors) {
  const file = mod.origem.github?.arquivo;
  if (!file) return;
  const wanted = mod.tipo === 'plugin' ? '.dll' : '.zip';
  if (!file.toLowerCase().endsWith(wanted)) errors.push(`${path}: um mod do tipo "${mod.tipo}" é distribuído como ${wanted}`);
  const repoName = mod.origem.github.repo.split('/')[1];
  if (repoName === '.' || repoName === '..') errors.push(`${path}: repositório inválido`);
}

// Dois mods com o mesmo nome de arquivo se sobrescrevem em Mods/, e desinstalar um apaga o do outro.
function checkFileIsFree(mod, path, ctx, errors) {
  const file = mod.origem.github?.arquivo;
  if (!file) return;
  if (ctx.baseFiles.some((b) => sameId(b, file))) errors.push(`${path}: o arquivo ${file} já é de um mod do catálogo base`);
  const other = [...ctx.currentMods.values()].find((m) => m.id !== mod.id && sameId(m.origem?.github?.arquivo ?? '', file));
  if (other) errors.push(`${path}: o arquivo ${file} já é usado pelo mod "${other.id}"`);
}

function checkDependencies(mod, ctx, errors) {
  for (const dep of mod.dependencias ?? []) {
    if (sameId(dep, mod.id)) {
      errors.push('o mod não pode depender de si mesmo');
      continue;
    }
    if (ctx.baseIds.some((b) => sameId(b, dep))) continue;
    const target = findCurrent(ctx, dep);
    if (!target) errors.push(`dependência desconhecida: "${dep}"`);
    else if (mod.tipo === 'plugin' && !isInstallablePlugin(target)) {
      errors.push(`"${dep}" não serve de dependência para um plugin: o instalador só instala plugins .dll do GitHub`);
    }
  }
}

function checkOwnership(change, before, after, ctx, errors) {
  if (before && !canTouch(before.dono, ctx.actor, ctx)) {
    errors.push(`@${ctx.actor} não é dono do mod "${change.id}"`);
    return;
  }
  if (after && !canTouch(after.dono, ctx.actor, ctx)) {
    errors.push(`o campo "dono" precisa ser {"github": "${ctx.actor}"}`);
    return;
  }
  if (isModerator(ctx)) return;
  if (before && after && ownerKey(before.dono) !== ownerKey(after.dono)) {
    errors.push('só um moderador transfere um mod para outro dono');
  }
  if (after && Boolean(before?.oculto) !== Boolean(after.oculto)) errors.push('só um moderador oculta ou reexibe um mod');
}

function checkDependents(id, after, ctx, errors) {
  if (isModerator(ctx)) return;
  if (after && isInstallablePlugin(after)) return;
  const dependents = [...ctx.currentMods.values()].filter(
    (m) => m.id !== id && (after ? m.tipo === 'plugin' : true) && (m.dependencias ?? []).some((d) => sameId(d, id)),
  );
  if (dependents.length === 0) return;
  const names = dependents.map((m) => m.id).join(', ');
  errors.push(after ? `${names} depende(m) de "${id}" como plugin instalável; mantenha tipo, origem e arquivo` : `não dá para remover: ${names} depende(m) de "${id}"`);
}

async function checkRelease(mod, ctx, errors) {
  const origin = mod.origem.github;
  if (!origin) return;
  const result = await ctx.findRelease(origin);
  if (!result.ok) errors.push(`release: ${result.reason}`);
}

// Devolve o estado atual do mod, ou undefined se a mudança já foi recusada por não bater com ele.
function currentState(change, ctx, errors) {
  const before = ctx.currentMods.get(change.id) ?? null;
  if (!before && ctx.brokenIds.has(change.id)) {
    if (change.status === 'A') errors.push(`já existe um arquivo mods/${change.id}.json, ilegível`);
    else if (!isModerator(ctx)) errors.push(`o arquivo atual de "${change.id}" está ilegível; só um moderador corrige`);
    else return null;
    return undefined;
  }
  if (change.status === 'A' && before) errors.push(`já existe um mod com o id "${change.id}"`);
  else if (change.status !== 'A' && !before) errors.push(`o mod "${change.id}" não existe no catálogo atual`);
  else return before;
  return undefined;
}

async function checkModChange(change, ctx, errors) {
  const before = currentState(change, ctx, errors);
  if (before === undefined) return null;
  if (change.status === 'D') {
    checkOwnership(change, before, null, ctx, errors);
    checkDependents(change.id, null, ctx, errors);
    return 'remove';
  }

  const after = parseMod(change.after, change.path, errors);
  if (!after) return null;
  const invalid = schemaErrors(after);
  if (invalid.length) {
    errors.push(...invalid.map((m) => `${change.path} ${m}`));
    return null;
  }
  checkFileName(change, after, errors);
  checkIdIsFree(change.id, ctx, errors);
  if (!before) checkReservedId(after, ctx, errors);
  checkFileKind(after, change.path, errors);
  checkFileIsFree(after, change.path, ctx, errors);
  checkDependencies(after, ctx, errors);
  checkOwnership(change, before, after, ctx, errors);
  if (before) checkDependents(change.id, after, ctx, errors);
  if (errors.length === 0) await checkRelease(after, ctx, errors);
  return before || change.status === 'M' ? 'edit' : 'publish';
}

function checkCoverChange(change, modChange, ctx, errors) {
  const mod = ctx.currentMods.get(change.id) ?? null;
  const willExist = modChange ? modChange.status !== 'D' : Boolean(mod);
  if (change.status !== 'D') {
    if (!willExist) errors.push(`${change.path}: não há mod "${change.id}" para essa capa`);
    if (change.after.length > MAX_COVER_BYTES) errors.push(`${change.path}: a capa pode ter no máximo ${MAX_COVER_BYTES / 1024} KB`);
    if (!isWebp(change.after)) errors.push(`${change.path}: a capa tem de ser uma imagem WebP`);
  }
  // Com o JSON do mod no mesmo PR, a posse já foi conferida nele.
  if (!modChange && mod && !canTouch(mod.dono, ctx.actor, ctx)) errors.push(`@${ctx.actor} não é dono do mod "${change.id}"`);
}

/**
 * changes: [{ path, status: 'A'|'M'|'D', after: Buffer|null }] (renomear chega como D + A).
 * ctx: { actor, botLogin, moderators: Set<login minúsculo>, baseIds, baseFiles: string[],
 *        currentMods: Map<id, mod>, brokenIds: Set<id> (arquivo ilegível na base), formerOwners: Map<id minúsculo, ownerKey>,
 *        findRelease: ({repo, tag, arquivo}) => Promise<{ok, reason?}> }
 *
 * outcome: 'merge' (pode entrar), 'reject' (erros para o autor corrigir) ou 'review' (mexe fora de mods/ e
 * covers/: um mantenedor revisa à mão).
 */
export async function evaluateChanges(changes, ctx) {
  if (changes.length === 0) return { outcome: 'reject', errors: ['o PR não muda nenhum arquivo'], modId: null, operation: null };

  const classified = changes.map((c) => ({ ...c, ...classifyPath(c.path) }));
  const outside = classified.filter((c) => !c.kind);
  if (outside.length) {
    return { outcome: 'review', errors: outside.map((c) => `${c.path}: fora de mods/ e covers/`), modId: null, operation: null };
  }

  const ids = [...new Set(classified.map((c) => c.id))];
  if (ids.length > 1) {
    return { outcome: 'reject', errors: [`um PR por mod; este mexe em: ${ids.join(', ')}`], modId: null, operation: null };
  }

  const errors = [];
  const modChange = classified.find((c) => c.kind === 'mod') ?? null;
  const coverChange = classified.find((c) => c.kind === 'cover') ?? null;
  let operation = 'cover';
  if (modChange) operation = await checkModChange(modChange, ctx, errors);
  if (coverChange) checkCoverChange(coverChange, modChange, ctx, errors);

  return { outcome: errors.length ? 'reject' : 'merge', errors, modId: ids[0], operation };
}
