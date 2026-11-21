import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";

const source=readFileSync(new URL("./gpt02-task183-preserve-live-kasbon-bundle-custody-qa.py", import.meta.url),"utf8");
const match=source.match(/REPLACEMENT = """([\s\S]*?)"""\n\nIMPORT/);
assert.ok(match,"the test MUST load the exact patch injected into the preserved live bundle");
const patch=match[1];
const DIRECTORY="/run/credentials/gpt02-core-preparer.service";
const dsn="postgresql://gpt02_core_prep_login.xssrfshdrtdfupgqwfdw:SYNTHETIC_TEST_ONLY@aws-1-ap-southeast-2.pooler.supabase.com:5432/postgres";
const certificate="SYNTHETIC_PINNED_CA_TEST_ONLY";
const baseEnv={
  NODE_ENV:"development",APP_ENV:"development",
  GPT02_CORE_PREP_CREDENTIAL_SOURCE:"docker-readonly",
  GPT02_CORE_PREP_DEV_TRANSPORT:"pooler",
};
function fixture({uid=1000,gid=1000,dirMode=0o500,dirOwner=1000,dirGroup=1000,
                  fileMode=0o400,fileOwner=1000,fileGroup=1000,mount="ro",
                  mountPoint=DIRECTORY,dirSymlink=false,fileSymlink=false,
                  absent=false,empty=false,env={}}={}){
  const paths=[];
  const dirs={
    isDirectory:()=>true,isSymbolicLink:()=>dirSymlink,
    uid:dirOwner,gid:dirGroup,mode:dirMode,
  };
  const files={
    isFile:()=>true,isSymbolicLink:()=>fileSymlink,
    uid:fileOwner,gid:fileGroup,mode:fileMode,
  };
  const calls=[];
  const fs={
    lstatSync(path){
      paths.push("stat:"+path);
      if(path===DIRECTORY)return dirs;
      if(absent)throw new Error("ENOENT");
      if(path===DIRECTORY+"/preparer-dsn" ||
         path===DIRECTORY+"/supabase-root-ca.crt")return files;
      throw new Error("NO_EXTERNAL_FS_ALLOWED");
    },
    readFileSync(path){
      paths.push("read:"+path);
      if(path==="/proc/self/mountinfo")
        return "20 1 0:42 / "+mountPoint+" "+mount+",nosuid,nodev - tmpfs tmpfs ro\n";
      if(path===DIRECTORY+"/preparer-dsn")return empty?"":dsn;
      if(path===DIRECTORY+"/supabase-root-ca.crt")return certificate;
      throw new Error("NO_EXTERNAL_FILE_READ_ALLOWED");
    },
  };
  const sandbox={
    __task183Fs:fs,
    process:{getuid:()=>uid,getgid:()=>gid},
    URL, 
    deny(message){throw new Error(message)},
    corePreparationPoolConfig(env){
      calls.push(env);
      // A stand-in ONLY. Real project/role/TLS pin checks remain owned by
      // the existing helper in the live compiled bundle.
      assert.equal(env.GPT02_CORE_PREP_DATABASE_URL_DEV,dsn);
      assert.equal(env.GPT02_CORE_PREP_DEV_CA,certificate);
      return {connectionString:env.GPT02_CORE_PREP_DATABASE_URL_DEV,
        ssl:{ca:env.GPT02_CORE_PREP_DEV_CA,rejectUnauthorized:true},
        max:1,application_name:"gpt02-core-preparation-DEV-only"};
    },
    Gpt02CoreTaskPreparer:class {constructor({pool}){this.pool=pool}},
  };
  runInNewContext(patch+"\n globalThis.__custody=__task183FileCustody; globalThis.__create=createCoreTaskPreparer;",sandbox,{timeout:500});
  const get=()=>sandbox.__custody({...baseEnv,...env});
  return {get,create:(pool)=>sandbox.__create({env:{...baseEnv,...env},PoolClass:pool}),paths,calls};
}
function denied(reason,options){
  const t=fixture(options);
  assert.throws(t.get,{message:reason});
  assert.equal(t.calls.length,0,"denial MUST occur before pool config is made");
}

test("exact production-facing patch source is pinned, additive and cannot deploy",()=>{
  assert.match(source,/EXPECTED_SHA = "22e084ba5580b20ee0bbd05568444b4ed7b7117b693ca6ab495a0d651a3999da"/);
  assert.match(source,/ALL_UNRELATED_BYTES_UNCHANGED=PASS/);
  assert.match(source,/READONLY_MOUNT_RUNTIME_QA=NOT_RUN/);
  assert.match(source,/ORIGINAL = """/);
  assert.match(patch,/__TASK183_RO_DIR = "\/run\/credentials\/gpt02-core-preparer.service"/);
  assert.ok(!patch.includes("pg_terminate_backend"));
  assert.ok(!patch.includes("ALTER ROLE "));
});

test("read-only nonroot custody builds a pinned configuration without making connections",()=>{
  const x=fixture();const out=x.get();
  assert.equal(out.max,1);
  assert.equal(out.ssl.rejectUnauthorized,true);
  assert.equal(out.application_name,"gpt02-core-preparation-DEV-only");
  assert.equal(x.calls.length,1);
  assert.deepEqual(x.paths,[
    "stat:"+DIRECTORY,"read:/proc/self/mountinfo",
    "stat:"+DIRECTORY+"/preparer-dsn","read:"+DIRECTORY+"/preparer-dsn",
    "stat:"+DIRECTORY+"/supabase-root-ca.crt","read:"+DIRECTORY+"/supabase-root-ca.crt",
  ]);
});

test("direct transport rewrites ONLY the verified scope to pinned CST-DEV",()=>{
  const x=fixture({env:{GPT02_CORE_PREP_DEV_TRANSPORT:"direct"}});
  const out=x.get();
  const url=new URL(out.connectionString);
  assert.equal(url.hostname,"db.xssrfshdrtdfupgqwfdw.supabase.co");
  assert.equal(url.username,"gpt02_core_prep_login");
  assert.equal(url.pathname,"/postgres");
  assert.equal(url.port,"5432");
  assert.equal(url.password,"SYNTHETIC_TEST_ONLY");
  assert.equal(out.ssl.servername,url.hostname);
  assert.equal(out.ssl.rejectUnauthorized,true);
  assert.equal(out.max,1);
  assert.equal(x.calls.length,1);
});

test("writable/missing/wrong mount is denied, without opening a Pool",()=>{
  denied("PREPARER_DOCKER_READONLY_MOUNT_REQUIRED",{mount:"rw"});
  denied("PREPARER_DOCKER_READONLY_MOUNT_REQUIRED",{mountPoint:"/run/credentials/another-service"});
  denied("PREPARER_DOCKER_CREDENTIAL_DIRECTORY_INVALID",{dirMode:0o700});
  denied("PREPARER_DOCKER_CREDENTIAL_DIRECTORY_INVALID",{dirSymlink:true});
  denied("PREPARER_DOCKER_CREDENTIAL_DIRECTORY_INVALID",{dirOwner:99});
  denied("PREPARER_DOCKER_CREDENTIAL_DIRECTORY_INVALID",{dirGroup:99});
});

test("symlink, wrong-owner, writable or missing credential files are denied",()=>{
  denied("PREPARER_DOCKER_CREDENTIAL_FILE_INVALID",{fileMode:0o600});
  denied("PREPARER_DOCKER_CREDENTIAL_FILE_INVALID",{fileSymlink:true});
  denied("PREPARER_DOCKER_CREDENTIAL_FILE_INVALID",{fileOwner:99});
  denied("PREPARER_DOCKER_CREDENTIAL_FILE_INVALID",{fileGroup:99});
  denied("PREPARER_CREDENTIAL_FILE_REQUIRED",{absent:true});
  denied("PREPARER_CREDENTIAL_FILE_INVALID",{empty:true});
});

test("wrong process identity, environment, source or inline secret are denied",()=>{
  denied("PREPARER_NONROOT_CONTAINER_REQUIRED",{uid:0,dirOwner:0,fileOwner:0});
  denied("PREPARER_DOCKER_CREDENTIAL_DIRECTORY_INVALID",{uid:2000});
  denied("EXPLICIT_SECURE_DEV_REQUIRED",{env:{APP_ENV:"production"}});
  denied("EXPLICIT_SECURE_DEV_REQUIRED",{env:{NODE_ENV:"production"}});
  denied("PREPARER_INLINE_CREDENTIAL_FORBIDDEN",{env:{GPT02_CORE_PREP_CREDENTIAL_SOURCE:"systemd"}});
  denied("PREPARER_INLINE_CREDENTIAL_FORBIDDEN",{env:{GPT02_CORE_PREP_DATABASE_URL_DEV:"plaintext-forbidden"}});
  denied("PREPARER_INLINE_CREDENTIAL_FORBIDDEN",{env:{GPT02_CORE_PREP_DEV_CA:"forbidden"}});
  denied("PREPARER_DB_TRANSPORT_UNSUPPORTED",{env:{GPT02_CORE_PREP_DEV_TRANSPORT:"untrusted"}});
});

test("factory constructs one passive pool only when custody passes",async()=>{
  let count=0,closed=0,opened=0,config;
  class Pool {
    constructor(c){count++;config=c}
    on(){}
    async end(){closed++}
    connect(){opened++;throw new Error("MUST_NOT_CONNECT")}
  }
  const x=fixture();
  const factory=x.create(Pool);
  assert.equal(count,1);
  assert.equal(opened,0);
  assert.equal(config.max,1);
  await factory.close();
  assert.equal(closed,1);
  const y=fixture({mount:"rw"});
  assert.throws(()=>y.create(Pool),{message:"PREPARER_DOCKER_READONLY_MOUNT_REQUIRED"});
  assert.equal(count,1);
  assert.equal(opened,0);
});
