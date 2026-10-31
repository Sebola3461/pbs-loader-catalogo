import { writeFileSync } from 'node:fs';
import { fetchBaseCatalog, findRelease } from './lib/github.mjs';
import { checkPullRequest, EXIT, formatComment } from './lib/pr-check.mjs';

const { HEAD_SHA, BASE_REF = 'HEAD', PR_AUTHOR, BOT_LOGIN = '', GITHUB_TOKEN, RESULT_FILE = 'result.md' } = process.env;

try {
  if (!HEAD_SHA || !PR_AUTHOR) throw new Error('HEAD_SHA e PR_AUTHOR são obrigatórios');
  const result = await checkPullRequest({
    cwd: process.cwd(),
    baseRev: BASE_REF,
    headRev: HEAD_SHA,
    actor: PR_AUTHOR,
    botLogin: BOT_LOGIN,
    base: await fetchBaseCatalog(),
    findRelease: (origin) => findRelease(origin, { token: GITHUB_TOKEN }),
  });
  writeFileSync(RESULT_FILE, formatComment(result));
  console.log(JSON.stringify({ outcome: result.outcome, modId: result.modId, operation: result.operation, errors: result.errors }));
  process.exitCode = EXIT[result.outcome];
} catch (e) {
  console.error(e);
  process.exitCode = EXIT.upstream;
  writeFileSync(RESULT_FILE, '⚠️ Não consegui validar o PR agora. Um mantenedor vai rodar a validação de novo.');
}
