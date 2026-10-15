import test from 'node:test';
import assert from 'node:assert/strict';
import { makeFcmSender } from './fcm-sender.mjs';

const args={token:'sample_fcm_device_token',priority:'high',data:{type:'android_job_available',jobId:'e9203104-0938-4f58-9fea-0872b37e12d8'}};
test('POST to FCM v1 with minimal data and Android high priority',async()=>{
 let request;const send=makeFcmSender({projectId:'sample-dev-project',getAccessToken:async()=> 'sample_oauth_token_long',fetchImpl:async(url,options)=>{request={url,options};return {ok:true,status:200};}});
 assert.deepEqual(await send(args),{acceptedByFcm:true});
 assert.equal(request.url,'https://fcm.googleapis.com/v1/projects/sample-dev-project/messages:send');
 const body=JSON.parse(request.options.body);
 assert.deepEqual(body.message.data,args.data);
 assert.equal(body.message.android.priority,'HIGH');
 assert.equal(body.message.android.ttl,'60s');
 assert.equal(body.message.notification,undefined);
});
test('rejects failed delivery without leaking secrets',async()=>{
 const send=makeFcmSender({projectId:'sample-dev-project',getAccessToken:async()=> 'sample_oauth_token_long',fetchImpl:async()=>({ok:false,status:503})});
 await assert.rejects(send(args),e=>e.message==='fcm_delivery_failed'&&e.status===503&&!e.message.includes('token'));
});
test('rejects arbitrary push payload',async()=>{
 const send=makeFcmSender({projectId:'sample-dev-project',getAccessToken:async()=> 'sample_oauth_token_long',fetchImpl:async()=>({ok:true})});
 await assert.rejects(send({...args,data:{type:'run_shell',jobId:args.data.jobId}}),/invalid_push_payload/);
});
