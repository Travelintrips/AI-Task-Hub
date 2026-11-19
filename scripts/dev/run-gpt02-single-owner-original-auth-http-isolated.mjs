/**
 * Reproducible DEV-only real-auth HTTP fixture.
 * Compiles the EXACT pinned PR196 TypeScript middleware with esbuild and
 * executes the unmounted HTTP adapter with real 7-day JWT verification.
 * No public listener, live DB, credentials, browser or dispatch.
 */
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(fileURLToPath(new URL('../..',import.meta.url)));
const ref=process.env.GPT02_PINNED_PR196_ROOT ||
  join(root,'pr196-verifier-reference');
const authSource=join(ref,'artifacts/api-server/src/middleware/auth.ts');
const authGate=join(root,'artifacts/api-server/src/lib/gpt02-google-auth-gate.mjs');
const candidate=join(root,'artifacts/api-server/src/lib/gpt02-single-owner-approval-http-candidate.mjs');
if(![authSource,authGate,candidate].every(existsSync))throw Error('PINNED_PR196_AUTH_SOURCES_REQUIRED');
const require=createRequire(join(root,'artifacts/api-server/package.json'));
const esbuild=require('esbuild');
const tmp=mkdtempSync(join(tmpdir(),'gpt02-real-auth-http-'));
try{
 const bundled=join(tmp,'pr196-auth-middleware.cjs');
 await esbuild.build({entryPoints:[authSource],bundle:true,platform:'node',
  format:'cjs',target:'node22',outfile:bundled,logLevel:'silent',
  nodePaths:[join(root,'artifacts/api-server/node_modules'),
   join(ref,'artifacts/api-server/node_modules')]});
 execFileSync(process.execPath,['--test',
   join(root,'scripts/dev/gpt02-single-owner-original-auth-http.integration.test.mjs')],{
   cwd:root,stdio:'inherit',timeout:20000,
   env:{...process.env,NODE_ENV:'development',APP_ENV:'development',
    SESSION_SECRET:'DISPOSABLE_ONLY_pr196_JWT_7_days_test_secret_random_synthetic',
    GPT02_DISPOSABLE_AUTH_HTTP_ONLY:'1',
    GPT02_PR196_AUTH_BUNDLE_PATH:bundled},
 });
 console.log('PR196_ORIGINAL_JWT_MIDDLEWARE_HTTP_APPROVAL_INTEGRATION_PASS');
}finally{rmSync(tmp,{recursive:true,force:true})}
