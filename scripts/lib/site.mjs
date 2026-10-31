import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildCatalog } from './catalog.mjs';
import { fileDates, loadMods, readJson } from './repo.mjs';
import { schemaErrors } from './schema.mjs';

export const CATALOG_FILE = 'community-catalog.json';

/**
 * Gera em outDir o que vai para o GitHub Pages: o catálogo agregado, as capas e o schema (para o "$schema" dos
 * arquivos de mod funcionar no editor). Um mod que não passa no schema fica de fora em vez de derrubar a
 * publicação dos outros.
 */
export function buildSite(cwd, outDir, { now = new Date(), warn = console.warn } = {}) {
  const trustedAuthors = new Set(readJson(cwd, 'trusted-authors.json').authors);
  const entries = [];
  for (const [id, mod] of loadMods(cwd, warn)) {
    const errors = schemaErrors(mod);
    if (errors.length || mod.id !== id) {
      warn(`mods/${id}.json ignorado: ${errors.join('; ') || 'id diferente do nome do arquivo'}`);
      continue;
    }
    const cover = join(cwd, 'covers', `${id}.webp`);
    entries.push({ mod, ...fileDates(cwd, `mods/${id}.json`), hasCover: existsSync(cover) });
  }

  const catalog = buildCatalog(entries, { trustedAuthors, generatedAt: now.toISOString(), warn });
  mkdirSync(join(outDir, 'covers'), { recursive: true });
  mkdirSync(join(outDir, 'schema'), { recursive: true });
  writeFileSync(join(outDir, CATALOG_FILE), `${JSON.stringify(catalog, null, 2)}\n`);
  for (const m of catalog.mods.filter((m) => m.capa)) copyFileSync(join(cwd, m.capa), join(outDir, m.capa));
  copyFileSync(join(cwd, 'schema', 'mod.schema.json'), join(outDir, 'schema', 'mod.schema.json'));
  return catalog;
}
