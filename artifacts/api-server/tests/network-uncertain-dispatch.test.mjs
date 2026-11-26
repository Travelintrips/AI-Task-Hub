import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
const src=readFileSync(new URL('../src/routes/executions.ts',import.meta.url),'utf8');
const body=src.split('function isRetryableChatGptDispatchError(message: string): boolean {')[1].split('\n}')[0];
const classifier=new Function('message',body);
test('timeouts, transport errors, rate limits and server errors are uncertain',()=>{
 for(const reason of ['TimeoutError','The operation was aborted due to timeout','fetch failed','ECONNRESET','AI_CORE_CHATGPT_COMMAND_HTTP_429','AI_CORE_CHATGPT_COMMAND_HTTP_500','AI_CORE_CHATGPT_COMMAND_HTTP_502','AI_CORE_CHATGPT_COMMAND_HTTP_503','AI_CORE_CHATGPT_COMMAND_HTTP_504']) assert.equal(classifier(reason),true,reason);
});
test('explicit instruction validation 400/422 is not a transport uncertainty',()=>{
 for(const reason of ['DEV_CHATGPT_WAKE_INSTRUCTION_INVALID','AI_CORE_CHATGPT_COMMAND_HTTP_400','AI_CORE_CHATGPT_COMMAND_HTTP_422']) assert.equal(classifier(reason),false,reason);
});
