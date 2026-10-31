import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';

const schema = JSON.parse(readFileSync(new URL('../../schema/mod.schema.json', import.meta.url), 'utf8'));
const validate = new Ajv2020({ allErrors: true }).compile(schema);

/**
 * Texto escolhido pelo autor do PR que vai parar no comentário do bot: só letras, números, _ e -, e no máximo 40
 * caracteres. Assim não dá para injetar link, imagem ou menção em massa assinados pelo github-actions.
 */
export function quoteUserText(text) {
  const safe = String(text).replace(/[^\p{L}\p{N}_-]/gu, '?');
  return safe.length > 40 ? `${safe.slice(0, 40)}…` : safe;
}

const MESSAGES = {
  required: (e) => `falta o campo "${e.params.missingProperty}"`,
  additionalProperties: (e) => `campo desconhecido "${quoteUserText(e.params.additionalProperty)}"`,
  pattern: () => 'formato inválido',
  minLength: (e) => `precisa ter ao menos ${e.params.limit} caractere(s)`,
  maxLength: (e) => `pode ter no máximo ${e.params.limit} caracteres`,
  minItems: (e) => `precisa ter ao menos ${e.params.limit} item(ns)`,
  maxItems: (e) => `pode ter no máximo ${e.params.limit} itens`,
  uniqueItems: () => 'tem itens repetidos',
  enum: (e) => `precisa ser um destes: ${e.params.allowedValues.join(', ')}`,
  type: (e) => `precisa ser do tipo ${e.params.type}`,
  oneOf: () => 'não bate com nenhuma das formas aceitas',
};

function resolvePointer(root, pointer) {
  return pointer
    .split('/')
    .slice(1)
    .reduce((node, part) => node?.[part.replaceAll('~1', '/').replaceAll('~0', '~')], root);
}

// Cada oneOf do schema tem alternativas que se distinguem por uma chave obrigatória (github | site | externa).
// Com a chave presente, os erros daquela alternativa explicam o problema melhor que "não bate com nenhuma".
function chosenBranchPath(oneOfError, data) {
  const branches = resolvePointer(schema, oneOfError.schemaPath.slice(1));
  const value = resolvePointer(data, oneOfError.instancePath);
  if (value === null || typeof value !== 'object') return null;
  const index = branches.findIndex((b) => b.required?.length === 1 && b.required[0] in value);
  return index < 0 ? null : `${oneOfError.schemaPath}/${index}/`;
}

function relevantErrors(errors, data) {
  const failedOneOfs = errors.filter((e) => e.keyword === 'oneOf');
  return errors.filter((e) => {
    if (e.keyword === 'oneOf') return chosenBranchPath(e, data) === null;
    const parent = failedOneOfs.find((o) => e.schemaPath.startsWith(`${o.schemaPath}/`));
    if (!parent) return true;
    const chosen = chosenBranchPath(parent, data);
    return chosen !== null && e.schemaPath.startsWith(chosen);
  });
}

export function schemaErrors(mod) {
  if (validate(mod)) return [];
  return relevantErrors(validate.errors, mod).map(
    (e) => `${e.instancePath || '(raiz)'}: ${(MESSAGES[e.keyword] ?? (() => e.message))(e)}`,
  );
}
