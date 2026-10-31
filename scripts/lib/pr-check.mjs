import { evaluateChanges, ownerKey } from './rules.mjs';
import { formerOwners, listChanges, loadMods, readJson } from './repo.mjs';

export const EXIT = { merge: 0, reject: 1, upstream: 2, review: 3 };

const OPERATION_LABEL = { publish: 'publicar', edit: 'editar', remove: 'remover', cover: 'trocar a capa' };

/** Avalia o PR (headRev) contra a base que está checada em cwd. */
export async function checkPullRequest({ cwd, baseRev, headRev, actor, botLogin, base, findRelease }) {
  const moderators = new Set(readJson(cwd, 'moderators.json').moderators.map((m) => m.toLowerCase()));
  const brokenIds = new Set();
  const currentMods = loadMods(cwd, () => {}, brokenIds);
  const ctx = {
    actor,
    botLogin,
    moderators,
    baseIds: base.ids,
    baseFiles: base.files,
    currentMods,
    brokenIds,
    formerOwners: formerOwners(cwd, ownerKey),
    findRelease,
  };
  return evaluateChanges(listChanges(cwd, baseRev, headRev), ctx);
}

export function formatComment(result) {
  if (result.outcome === 'merge') {
    return `✅ Tudo certo para ${OPERATION_LABEL[result.operation]} **${result.modId}**. O merge é automático e o catálogo é republicado em alguns minutos.`;
  }
  const list = result.errors.map((e) => `- ${e}`).join('\n');
  if (result.outcome === 'review') {
    return `👀 Este PR mexe em arquivos fora de \`mods/\` e \`covers/\`, então não entra sozinho. Um mantenedor vai revisar.\n\n${list}`;
  }
  return `❌ O PR não pode entrar ainda. Corrija e envie um novo commit, que eu confiro de novo:\n\n${list}`;
}
