export const BASE_CATALOG_URL = 'https://raw.githubusercontent.com/Sebola3461/pbsu-loader/main/catalogo.json';

const DIGEST = /^sha256:[0-9a-f]{64}$/;

/** Falha do GitHub que não é culpa do PR: o workflow falha e roda de novo, em vez de recusar o mod. */
export class UpstreamError extends Error {}

function headers(token) {
  const h = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'pbs-loader-catalogo' };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

/** Porte de Versoes.Ler do instalador: "v1.2.0-beta" vira [1, 2, 0]; texto sem número vira null. */
export function parseVersion(text) {
  const digits = /^[\d.]*/.exec(text.replace(/^[vV]+/, ''))[0].replace(/^\.+|\.+$/g, '');
  if (!digits) return null;
  const parts = (digits.includes('.') ? digits : `${digits}.0`).split('.');
  if (parts.length > 4 || parts.some((p) => p === '' || Number(p) > 2147483647)) return null;
  return parts.map(Number);
}

function compareVersions(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    // System.Version trata componente ausente como menor que zero: 1.0 < 1.0.0.
    const x = a[i] ?? -1;
    const y = b[i] ?? -1;
    if (x !== y) return x - y;
  }
  return 0;
}

/**
 * Porte de Rede.UltimoLancamento: entre os releases (não rascunho) com a tag no prefixo e o arquivo, comparando sem
 * diferenciar maiúsculas, fica o primeiro da lista e só é trocado por uma versão maior.
 */
export function pickRelease(releases, { tag, arquivo }, acceptPrerelease) {
  const prefix = tag.toLowerCase();
  const file = arquivo.toLowerCase();
  let best = null;
  for (const r of releases) {
    if (r.draft || (r.prerelease && !acceptPrerelease)) continue;
    if (!r.tag_name.toLowerCase().startsWith(prefix)) continue;
    const asset = r.assets.find((a) => a.name.toLowerCase() === file);
    if (!asset) continue;
    const version = parseVersion(r.tag_name.slice(tag.length));
    if (best && (!version || (best.version && compareVersions(version, best.version) <= 0))) continue;
    best = { tag: r.tag_name, version, asset };
  }
  return best;
}

/**
 * Confere o release que o instalador escolheria, com e sem "versões de teste". O asset precisa do "digest" sha256
 * que o GitHub calcula, porque é ele que o instalador confere ao baixar.
 */
export async function findRelease(origin, { fetchImpl = fetch, token } = {}) {
  const { repo, tag, arquivo } = origin;
  const res = await fetchImpl(`https://api.github.com/repos/${repo}/releases?per_page=50`, { headers: headers(token) });
  if (res.status === 404) return { ok: false, reason: `repositório ${repo} não existe ou é privado` };
  if (!res.ok) throw new UpstreamError(`GitHub respondeu ${res.status} ao listar os releases de ${repo}`);

  const releases = await res.json();
  const stable = pickRelease(releases, origin, false);
  if (!stable) return { ok: false, reason: `nenhum release estável de ${repo} com tag começando por "${tag}" tem o arquivo ${arquivo}` };
  for (const picked of [stable, pickRelease(releases, origin, true)]) {
    if (!DIGEST.test(picked.asset.digest ?? '')) {
      return { ok: false, reason: `o arquivo ${arquivo} do release ${picked.tag} está sem sha256 no GitHub; publique o release de novo` };
    }
  }
  return { ok: true, tag: stable.tag };
}

/** Ids e nomes de arquivo do catálogo base (pbsu-loader): a comunidade não pode reaproveitar nenhum dos dois. */
export async function fetchBaseCatalog({ fetchImpl = fetch, url = BASE_CATALOG_URL } = {}) {
  const res = await fetchImpl(url, { headers: { 'User-Agent': 'pbs-loader-catalogo' } });
  if (!res.ok) throw new UpstreamError(`não consegui ler o catálogo base (${res.status})`);
  const mods = (await res.json()).mods ?? [];
  const texts = (key) => mods.map((m) => m[key]).filter((v) => typeof v === 'string');
  return { ids: texts('id'), files: texts('arquivo') };
}
