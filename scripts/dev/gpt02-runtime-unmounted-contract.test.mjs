import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {join,relative} from 'node:path';

const ROOT=new URL('../../artifacts/api-server/src/',import.meta.url);
const FORBIDDEN=[
 'gpt02-reader-pools',
 'gpt02-trusted-facts-readonly',
 'gpt02-prepared-nonce-consumer',
 'gpt02-dev-trust-store',
 'gpt02-dev-trust-manifest'
];
const ALLOWED=new Set([
 'lib/gpt02-prepared-nonce-consumer.mjs',
 'lib/gpt02-dev-trust-store.mjs'
]);
async function walk(dir){
 const out=[];
 for(const e of await readdir(dir,{withFileTypes:true})){
  const p=join(dir,e.name);
  if(e.isDirectory())out.push(...await walk(p));
  else if(/\.(?:ts|js|mjs|cjs)$/.test(e.name))out.push(p);
 }
 return out;
}
test('GPT02 reader/trust candidates remain unmounted from live API routes/workers',async()=>{
 const rootPath=new URL('.',ROOT).pathname;
 const files=await walk(rootPath);
 const violations=[];
 for(const file of files){
  const rel=relative(rootPath,file).replaceAll('\\','/');
  if(ALLOWED.has(rel))continue;
  const text=await readFile(file,'utf8');
  for(const name of FORBIDDEN){
   if(text.includes(name))violations.push({rel,name});
  }
 }
 assert.deepEqual(violations,[]);
});
