export const SITE_USER = '01928c3e-7b2a-7c4d-8e9f-0123456789ab';

export function sampleMod(overrides = {}) {
  return {
    id: 'MeuMod',
    nome: 'Meu Mod',
    tipo: 'plugin',
    autor: 'fulano',
    dono: { github: 'fulano' },
    descricao: 'Faz alguma coisa útil.',
    versoesDoJogo: ['307'],
    dependencias: ['PBSLoaderCommonUtils'],
    origem: { github: { repo: 'fulano/meu-mod', tag: 'MeuMod-v', arquivo: 'MeuMod.dll' } },
    ...overrides,
  };
}

export function json(value) {
  return Buffer.from(JSON.stringify(value));
}

export function webp(size = 64) {
  const b = Buffer.alloc(size);
  b.write('RIFF', 0, 'latin1');
  b.write('WEBP', 8, 'latin1');
  return b;
}

export function context(overrides = {}) {
  return {
    actor: 'fulano',
    botLogin: 'pbs-loader-site[bot]',
    moderators: new Set(['moderadora']),
    baseIds: ['PBSLoaderCommonUtils', 'PBSLoaderCommonInterface'],
    baseFiles: ['PBSLoaderCommonUtils.dll', 'PBSLoaderCommonInterface.dll'],
    currentMods: new Map(),
    brokenIds: new Set(),
    formerOwners: new Map(),
    findRelease: async () => ({ ok: true, tag: 'MeuMod-v1.0.0' }),
    ...overrides,
  };
}
