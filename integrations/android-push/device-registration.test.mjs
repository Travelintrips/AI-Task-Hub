import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { authorizeDevicePushRegistration } from './device-registration.mjs';
const credential='test-device-credential-123456789';
const hash=crypto.createHash('sha256').update(credential).digest('hex');
const registry={ 'zfold4-paired-dev-04': { active:true,hash } };
const request={ deviceId:'zfold4-paired-dev-04', credential,pushToken:'fcm_device_token_for_testing_123456',registry };
test('valid registered device may attach push token',()=>{
 const result=authorizeDevicePushRegistration(request);
 assert.equal(result.deviceId,request.deviceId);
 assert.equal(result.pushToken,request.pushToken);
 assert.ok(result.registeredAt);
});
test('wrong credentials, inactive devices, invalid tokens rejected',()=>{
 assert.throws(()=>authorizeDevicePushRegistration({...request,credential:'invalid-credential-12345'}),/device_not_authorized/);
 assert.throws(()=>authorizeDevicePushRegistration({...request,registry:{'zfold4-paired-dev-04':{active:false,hash}}}),/device_not_authorized/);
 assert.throws(()=>authorizeDevicePushRegistration({...request,pushToken:'abc'}),/invalid_push_token/);
});
