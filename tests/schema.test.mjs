import assert from 'node:assert/strict';
import { test } from 'node:test';
import { schemaErrors } from '../scripts/lib/schema.mjs';
import { SITE_USER, sampleMod } from './helpers.mjs';

test('mod completo passa', () => {
  assert.deepEqual(schemaErrors(sampleMod()), []);
  assert.deepEqual(schemaErrors(sampleMod({ dono: { site: SITE_USER }, pagina: 'https://exemplo.com/mod' })), []);
  assert.deepEqual(schemaErrors(sampleMod({ tipo: 'onibus', origem: { externa: { url: 'https://drive.google.com/x' } } })), []);
  assert.deepEqual(
    schemaErrors(sampleMod({ imagens: ['https://raw.githubusercontent.com/fulano/mod/main/prints/a.png'] })),
    [],
  );
});

test('imagens da galeria: até 10, só raw.githubusercontent, sem repetição', () => {
  const imagem = 'https://raw.githubusercontent.com/fulano/mod/main/prints/a.png';
  assert.ok(schemaErrors(sampleMod({ imagens: Array(11).fill(imagem) })).some((e) => e.startsWith('/imagens')));
  assert.ok(
    schemaErrors(sampleMod({ imagens: ['https://exemplo.com/a.png'] })).some((e) => e.startsWith('/imagens/0')),
  );
  assert.ok(schemaErrors(sampleMod({ imagens: [imagem, imagem] })).some((e) => e.startsWith('/imagens')));
});

test('mensagens em português para os erros comuns', () => {
  const mod = sampleMod({ tipo: 'carro', extra: 1, nome: '', versoesDoJogo: ['307', '307'] });
  delete mod.autor;
  const errors = schemaErrors(mod);
  assert.ok(errors.includes('(raiz): falta o campo "autor"'));
  assert.ok(errors.includes('(raiz): campo desconhecido "extra"'));
  assert.ok(errors.some((e) => e.startsWith('/tipo: precisa ser um destes: plugin')));
  assert.ok(errors.includes('/nome: precisa ter ao menos 1 caractere(s)'));
  assert.ok(errors.includes('/versoesDoJogo: tem itens repetidos'));
});

test('no oneOf, mostra o erro da alternativa escolhida pela chave presente', () => {
  const errors = schemaErrors(sampleMod({ origem: { github: { repo: 'sem-barra', tag: 'v', arquivo: 'a.dll' } } }));
  assert.deepEqual(errors, ['/origem/github/repo: formato inválido']);
});

test('no oneOf sem chave reconhecida, resume com a mensagem do oneOf', () => {
  assert.deepEqual(schemaErrors(sampleMod({ dono: { gitlab: 'x' } })), ['/dono: não bate com nenhuma das formas aceitas']);
  assert.deepEqual(schemaErrors(sampleMod({ origem: 'texto' })), ['/origem: não bate com nenhuma das formas aceitas']);
});

test('recusa caracteres de controle, url sem https e versão que não é número', () => {
  const errors = schemaErrors(sampleMod({ nome: 'a\u0007b', pagina: 'http://x.com', versoesDoJogo: ['3.0'] }));
  assert.deepEqual(errors.sort(), ['/nome: formato inválido', '/pagina: formato inválido', '/versoesDoJogo/0: formato inválido']);
});

test('nome de campo inventado não injeta markdown no comentário', () => {
  const errors = schemaErrors({ ...sampleMod(), '![x](https://mal.com/a.png) @todos': 1, ['a'.repeat(60)]: 2 });
  assert.ok(errors.includes('(raiz): campo desconhecido "??x??https???mal?com?a?png???todos"'));
  assert.ok(errors.includes(`(raiz): campo desconhecido "${'a'.repeat(40)}…"`));
});

test('url precisa de domínio com ponto e é verificada em tempo linear', () => {
  assert.deepEqual(schemaErrors(sampleMod({ pagina: 'https://a.b.c/caminho?x=1' })), []);
  assert.ok(schemaErrors(sampleMod({ pagina: 'https://semponto' })).length > 0);
  assert.ok(schemaErrors(sampleMod({ pagina: 'https://a..b' })).length > 0);
  const start = performance.now();
  schemaErrors(sampleMod({ pagina: `https://${'a.'.repeat(200000)}!` }));
  assert.ok(performance.now() - start < 1000);
});

test('descrição aceita quebra de linha', () => {
  assert.deepEqual(schemaErrors(sampleMod({ descricao: 'linha 1\nlinha 2' })), []);
});

test('tipo errado e limites de tamanho', () => {
  const errors = schemaErrors(sampleMod({ oculto: 'sim', descricao: 'x'.repeat(2001), versoesDoJogo: [], dependencias: Array.from({ length: 21 }, (_, i) => `Dep${i}`) }));
  assert.ok(errors.includes('/oculto: precisa ser do tipo boolean'));
  assert.ok(errors.includes('/descricao: pode ter no máximo 2000 caracteres'));
  assert.ok(errors.includes('/versoesDoJogo: precisa ter ao menos 1 item(ns)'));
  assert.ok(errors.includes('/dependencias: pode ter no máximo 20 itens'));
});
