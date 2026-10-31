# Catálogo da comunidade do PBS Loader

Lista dos mods da comunidade do Proton Bus Simulator. O site e o instalador do PBS Loader leem este catálogo; os arquivos dos mods ficam no GitHub de cada autor ou num link externo.

O catálogo publicado fica em `https://sebola3461.github.io/pbs-loader-catalogo/community-catalog.json`.

## Enviar um mod

O jeito mais fácil é pelo site. Se você prefere o GitHub:

1. Publique um release no repositório do seu mod com o arquivo anexado (`.dll` para plugin, `.zip` para o resto). A tag começa com um prefixo fixo e termina na versão, por exemplo `MeuMod-v1.0.0`.
2. Faça um fork deste repositório e crie `mods/<id>.json`:

```json
{
  "$schema": "../schema/mod.schema.json",
  "id": "MeuMod",
  "nome": "Meu Mod",
  "tipo": "plugin",
  "autor": "seu apelido",
  "dono": { "github": "seu-login-do-github" },
  "descricao": "O que o mod faz.",
  "versoesDoJogo": ["307"],
  "dependencias": ["PBSLoaderCommonUtils"],
  "origem": { "github": { "repo": "seu-login/meu-mod", "tag": "MeuMod-v", "arquivo": "MeuMod.dll" } }
}
```

3. Opcional: uma capa em `covers/<id>.webp`, de até 300 KB.
4. Abra o pull request. A validação comenta no PR e, se estiver tudo certo, faz o merge sozinha.

Versão nova não precisa de PR: publique outro release com o mesmo prefixo de tag e o instalador encontra.

Mod com arquivo fora do GitHub usa `"origem": { "externa": { "url": "https://..." } }`. Ele aparece no site, mas o instalador não instala.

Tipos aceitos: `plugin`, `onibus`, `mapa`, `skin`, `destino`, `som`, `outro`. Por enquanto o instalador só instala `plugin`; os outros aparecem no site.

## O que a validação confere

- Um mod por PR, e só arquivos em `mods/` e `covers/`. PR que mexe em outra coisa espera revisão de um mantenedor.
- O JSON segue o [schema](schema/mod.schema.json) e o `id` é igual ao nome do arquivo.
- O `id` não é usado por outro mod, nem do catálogo base, nem com outra combinação de maiúsculas.
- O `dono` é quem abre o PR. Só o dono (ou um moderador) edita ou remove o mod.
- O release existe, tem o arquivo e o GitHub calculou o sha256 dele.
- As dependências existem, e um mod de que outros dependem não pode ser removido.

## Moderação

Moderadores estão em [moderators.json](moderators.json). Eles podem editar qualquer mod e ocultá-lo com `"oculto": true`; mod oculto sai do catálogo publicado. Autores em [trusted-authors.json](trusted-authors.json) têm os mods marcados como confiáveis, e o instalador os instala sem pedir confirmação.

Para denunciar um mod, abra uma issue.

## Desenvolvimento

```
npm ci --ignore-scripts
npm test
node scripts/publish.mjs _site
```
