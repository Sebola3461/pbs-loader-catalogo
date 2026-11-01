import { isInstallablePlugin, ownerKey } from './rules.mjs';

export const CATALOG_FORMAT = 1;

const key = (text) => text.toLowerCase();

function enforceInvariants(entries, warn) {
  const communityIds = new Set(entries.map((e) => key(e.mod.id)));
  const byAge = entries
    .filter((e) => !e.mod.oculto)
    .sort((a, b) => (a.createdAt ?? '\uffff').localeCompare(b.createdAt ?? '\uffff'));

  const ids = new Set();
  const files = new Set();
  let kept = byAge.filter(({ mod }) => {
    const file = mod.origem.github?.arquivo;
    if (ids.has(key(mod.id)) || (file && files.has(key(file)))) {
      warn(`mods/${mod.id}.json fora do catálogo: id ou arquivo já usado por um mod mais antigo`);
      return false;
    }
    ids.add(key(mod.id));
    if (file) files.add(key(file));
    return true;
  });

  for (;;) {
    const installable = new Set(kept.filter((e) => isInstallablePlugin(e.mod)).map((e) => key(e.mod.id)));
    const broken = kept.filter(
      ({ mod }) => mod.tipo === 'plugin' && (mod.dependencias ?? []).some((d) => communityIds.has(key(d)) && !installable.has(key(d))),
    );
    if (broken.length === 0) return kept;
    for (const { mod } of broken) warn(`mods/${mod.id}.json fora do catálogo: depende de mod que não está disponível`);
    kept = kept.filter((e) => !broken.includes(e));
  }
}

/**
 * A origem do GitHub vira os campos repo/tag/arquivo que o instalador já entende. Mods ocultos por moderador
 * ficam de fora.
 *
 * entries: [{ mod, createdAt, updatedAt, hasCover }]; trustedAuthors: Set de ownerKey.
 */
export function buildCatalog(entries, { trustedAuthors, generatedAt, warn = () => {} }) {
  const mods = enforceInvariants(entries, warn)
    .map(({ mod, createdAt, updatedAt, hasCover }) => {
      const github = mod.origem.github;
      return {
        id: mod.id,
        nome: mod.nome,
        tipo: mod.tipo,
        autor: mod.autor,
        dono: mod.dono,
        descricao: mod.descricao,
        versoesDoJogo: mod.versoesDoJogo,
        dependencias: mod.dependencias ?? [],
        imagens: mod.imagens ?? [],
        origem: github ? 'github' : 'externa',
        ...(github ? { repo: github.repo, tag: github.tag, arquivo: github.arquivo } : { url: mod.origem.externa.url }),
        pagina: mod.pagina ?? (github ? `https://github.com/${github.repo}` : null),
        capa: hasCover ? `covers/${mod.id}.webp` : null,
        confiavel: trustedAuthors.has(ownerKey(mod.dono)),
        criadoEm: createdAt,
        atualizadoEm: updatedAt,
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id, 'en', { sensitivity: 'base' }));
  return { formato: CATALOG_FORMAT, geradoEm: generatedAt, mods };
}
