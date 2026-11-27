import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const route = readFileSync(new URL("../../artifacts/api-server/src/routes/customers-crm.ts", import.meta.url), "utf8");
const start = route.indexOf("function isApprovedLegacyCrmProfile(");
const end = route.indexOf("// Current profile and Auth pin", start);
assert.ok(start >= 0 && end > start);
const fn = route.slice(start, end).replace(
  "function isApprovedLegacyCrmProfile(user: AuthUser | undefined, env: Record<string, string | undefined> = process.env, nowMs: number = Date.now()): boolean",
  "function isApprovedLegacyCrmProfile(user, env = process.env, nowMs = Date.now())",
).replace(
  "function resolveCrmCreateCompany(user: AuthUser | undefined, requestedCompany: unknown, body: Record<string, unknown>, env: Record<string, string | undefined> = process.env, nowMs: number = Date.now()): number | null",
  "function resolveCrmCreateCompany(user, requestedCompany, body, env = process.env, nowMs = Date.now())",
);
const resolve = runInNewContext(fn + "\nresolveCrmCreateCompany", { process: { env: {} } });
const user = { id: "fixture-profile", role: "company_admin", email: "fixture@example.invalid", companyId: "1" };
test("numeric signed company resolves without trusting form ownership", () => {
  assert.equal(resolve(user, undefined, {}), 1);
  assert.equal(resolve({...user, companyId: 3}, undefined, {}), 3);
  assert.equal(resolve({...user, role: "super_admin"}, "1", {}), 1);
});
test("default, absent, malformed and overflow company scopes fail closed", () => {
  for (const companyId of [null, undefined, "", "default", "01", "1.5", "0", "-1", "2147483648", "1 OR 1=1"]) {
    assert.equal(resolve({...user, companyId}, undefined, {}), null);
  }
});
test("foreign company query, repeated query, body override, and unbound super admin denied", () => {
  assert.equal(resolve(user, "3", {}), null);
  assert.equal(resolve(user, ["1","3"], {}), null);
  assert.equal(resolve(user, undefined, {companyId: 3}), null);
  assert.equal(resolve(user, undefined, {company_id: 1}), null);
  assert.equal(resolve({...user, role:"super_admin",companyId:"default"}, "1", {}), null);
});
test("only management profiles with identity can create", () => {
  for (const role of ["staff", "supervisor", "vendor", "customer", "unknown"]) {
    assert.equal(resolve({...user,role},undefined,{}),null);
  }
  assert.equal(resolve(undefined, undefined, {}), null);
  assert.equal(resolve({...user, id:null},undefined,{}),null);
  assert.equal(resolve({...user, email:""},undefined,{}),null);
});
test("real insert statement binds active current profile and numeric company; audit is atomic", () => {
  const post = route.split('router.post("/crm/customers", requireAuth,')[1].split('// PATCH /api/crm/customers/:id')[0];
  assert.match(post, /resolveCrmCreateCompany\(req\.user, req\.query\.companyId, body\)/);
  assert.match(post, /if \(companyId === null \|\|/);
  assert.match(post, /isApprovedLegacyCrmProfile\(req\.user\) && req\.query\.companyId !== "1"/);
  assert.match(post, /const profileCompany = crmProfileCompanyPredicate\(req\.user!\)/);
  assert.match(post, /JOIN public\.users u ON \$\{profileCompany\}/);
  assert.match(post, /WHERE co\.id = \$\{companyId\} AND co\.is_active IS TRUE/);
  assert.match(post, /u\.id::text = \$\{String\(req\.user!\.id\)\}/);
  assert.match(post, /u\.role = \$\{req\.user!\.role\}/);
  assert.match(post, /u\.is_active IS TRUE AND u\.status = 'active'/);
  assert.match(post, /INSERT INTO public\.customers\s+\(name, company_name, company_id,/);
  assert.match(post, /FROM eligible\s+RETURNING id, company_id/);
  assert.match(post, /INSERT INTO public\.audit_logs[\s\S]+FROM created[\s\S]+SELECT created\.\* FROM created JOIN logged/);
  assert.doesNotMatch(post, /companyId.*\?\?\s*"default"/);
  assert.doesNotMatch(post, /\.catch\(\(\) => \{\}\)/);
});

test("company picker reuses create authority and cannot grant access", () => {
  const routeBody = route.split('router.get("/crm/customer-create-companies", requireAuth,')[1].split("// POST /api/crm/customers")[0];
  assert.match(routeBody, /resolveCrmCreateCompany\(req\.user, undefined, \{\}\)/);
  assert.match(routeBody, /const profileCompany = crmProfileCompanyPredicate\(req\.user!\)/);
  assert.match(routeBody, /JOIN public\.users u ON \$\{profileCompany\}/);
  assert.match(routeBody, /u\.id::text = \$\{String\(req\.user!\.id\)\}/);
  assert.match(routeBody, /u\.is_active IS TRUE AND u\.status = 'active'/);
  assert.match(routeBody, /co\.is_active IS TRUE/);
  assert.match(routeBody, /rows\.length !== 1/);
  assert.match(routeBody, /companies: \[\], status: "no_authorized_company"/);
  assert.match(routeBody, /Cache-Control", "private, no-store"/);
  assert.doesNotMatch(routeBody, /req\.query|req\.body|INSERT INTO|UPDATE |DELETE FROM|signToken/);
});
test("CRM form requires a server-provided selection without writing a tenant field", () => {
  const ui = readFileSync(new URL("../../artifacts/ai-task-center/src/pages/customers-crm.tsx", import.meta.url), "utf8");
  assert.match(ui, /apiFetch\("\/crm\/customer-create-companies"\)/);
  assert.match(ui, /queryKey: \["crm-create-companies", user\?\.id, user\?\.companyId, user\?\.role\]/);
  assert.match(ui, /scopes\.find\(c => String\(c\.id\) === createCompanyId\)/);
  assert.match(ui, /if \(!selectedCreateScope\) return;/);
  assert.match(ui, /createMut\.mutate\(\{ companyId: selectedCreateScope\.id, data: form \}\)/);
  assert.match(ui, /body: JSON\.stringify\(data\)/);
  assert.match(ui, /disabled=\{!scopes\.length\}/);
});

const now = Date.UTC(2026, 10, 27, 6, 0, 0);
const dev = {
  NODE_ENV: "development",
  PUBLIC_APP_BASE_URL: "https://dev-ai-task.cstlogistic.co.id",
  SUPABASE_URL_DEV: "https://xssrfshdrtdfupgqwfdw.supabase.co",
  SESSION_SECRET: "fixture-only-not-a-real-secret-32chars",
};
const approved = {
  id: "google_103728868378401731050", email: "fixture@example.invalid", role: "super_admin",
  companyId: null, authSource: "supabase_google_identity",
  authSupabaseId: "75a7c311-3f6e-4c95-8a66-9b98f6dd26ad", authVerifiedAt: now - 60_000,
};
test("Owner-approved Google profile can discover and explicitly select only CST", () => {
  assert.equal(resolve(approved, undefined, {}, dev, now), 1);
  assert.equal(resolve(approved, "1", {}, dev, now), 1);
  assert.equal(resolve({...approved, companyId:"default"}, "1", {}, dev, now), 1);
  for (const target of ["2","3","4","5",1,["1","3"]]) assert.equal(resolve(approved,target,{},dev,now),null);
  assert.equal(resolve(approved,"1",{company_id:1},dev,now),null);
});
test("wrong project, origin, mode, or missing strong session key cannot enable approval", () => {
  for (const env of [
    {...dev, NODE_ENV:"production"}, {...dev, NODE_ENV:"test"},
    {...dev, APP_ENV:"production"}, {...dev, APP_ENV:""},
    {...dev, SUPABASE_URL_DEV:"https://wrong.supabase.co"}, {...dev,PUBLIC_APP_BASE_URL:"https://other.invalid"},
    {...dev, SESSION_SECRET:"short"}, {...dev, SESSION_SECRET:"fallback-secret-change-in-production"},
    {...dev, SESSION_SECRET:undefined},
  ]) assert.equal(resolve(approved,"1",{},env,now),null);
});
test("wrong Google identity, role, profile, stale or absent OAuth evidence denied", () => {
  for (const candidate of [
    {...approved,id:"other"}, {...approved,role:"owner"}, {...approved,role:"staff"},
    {...approved,authSource:undefined}, {...approved,authSupabaseId:"other"},
    {...approved,authVerifiedAt:undefined}, {...approved,authVerifiedAt:now+30_001},
    {...approved,authVerifiedAt:now-7*24*60*60_000-1}, {...approved,companyId:undefined},
    {...approved,email:""},
  ]) assert.equal(resolve(candidate,"1",{},dev,now),null);
});
test("current Auth admin pin and active CST are required in the same SQL join", () => {
  const predicate = route.split("function crmProfileCompanyPredicate(")[1].split("function isCstCrmDevRuntime(")[0];
  assert.ok(predicate.includes("u.company_id = co.id"));
  assert.match(predicate, /co\.id = 1 AND co\.code = 'CST' AND u\.company_id IS NULL/);
  assert.match(predicate, /FROM auth\.users a/);
  assert.match(predicate, /a\.id = \$\{user\.authSupabaseId\}::uuid/);
  assert.match(predicate, /a\.deleted_at IS NULL AND \(a\.banned_until IS NULL OR a\.banned_until <= now\(\)\)/);
  assert.match(predicate, /a\.raw_app_meta_data->>'ai_task_user_id' = u\.id::text/);
  assert.match(predicate, /a\.raw_app_meta_data->>'ai_task_role' = 'super_admin'/);
  assert.match(predicate, /a\.raw_app_meta_data->>'ai_task_company_id' = '@NULL@'/);
  assert.doesNotMatch(predicate, /raw_user_meta_data|UPDATE |INSERT INTO/);
  const patch = route.split("// PATCH /api/crm/customers/:id")[1];
  assert.doesNotMatch(patch,/isApprovedLegacyCrmProfile|crmProfileCompanyPredicate/);
});
test("legacy create and approved list use explicit permission and confirm returned ownership", () => {
  const ui = readFileSync(new URL("../../artifacts/ai-task-center/src/pages/customers-crm.tsx", import.meta.url), "utf8");
  assert.match(ui, /const canList = !!user && !authLoading && \(!unbound \|\| legacyReadOnly\)/);
  assert.match(ui, /enabled: canList/);
  assert.match(ui, /Number\(created\.company_id\) !== variables\.companyId/);
  assert.match(ui, /createdReceipt\.actor === String\(user\?\.id \?\? ""\)/);
});

const accessStart = route.indexOf("function isCstCrmDevRuntime(");
const accessEnd = route.indexOf('router.use("/crm/customers"', accessStart);
assert.ok(accessStart > 0 && accessEnd > accessStart);
const accessFn = route.slice(accessStart, accessEnd)
  .replace("function isCstCrmDevRuntime(env: Record<string, string | undefined> = process.env): boolean", "function isCstCrmDevRuntime(env = process.env)")
  .replace('function resolveCrmSubtreeAccess(user: AuthUser | undefined, method: string, path: string, requestedCompany: unknown, env: Record<string, string | undefined> = process.env, nowMs: number = Date.now()): "bound" | "legacy_collection" | "deny" | "unchanged"', "function resolveCrmSubtreeAccess(user, method, path, requestedCompany, env = process.env, nowMs = Date.now())");
const access = runInNewContext(fn + "\n" + accessFn + "\nresolveCrmSubtreeAccess", { process: { env: {} } });
test("approved legacy Google profile can list CST and create only on collection", () => {
  assert.equal(access(approved,"GET","/","1",dev,now),"legacy_collection");
  assert.equal(access(approved,"GET","/",undefined,dev,now),"legacy_collection");
  assert.equal(access(approved,"POST","/","1",dev,now),"legacy_collection");
  for (const target of ["2","3","4","5",["1","3"],1]) assert.equal(access(approved,"GET","/",target,dev,now),"deny");
  for (const path of ["/35","/35/memory","/35/ai-context","/35/preferences","/35/documents","/35/aggregates"]) for (const method of ["GET","POST","PATCH","PUT","DELETE"]) assert.equal(access(approved,method,path,"1",dev,now),"deny");
  for (const method of ["PATCH","PUT","DELETE"]) assert.equal(access(approved,method,"/","1",dev,now),"deny");
  assert.equal(access(approved,"POST","/",undefined,dev,now),"deny");
  assert.equal(access({...approved,authSupabaseId:"other"},"GET","/","1",dev,now),"deny");
  assert.equal(access({...approved,authSource:undefined},"GET","/","1",dev,now),"deny");
});
test("numeric bound profiles cannot override company across CRM subtree; other runtimes unchanged", () => {
  for (const method of ["GET","POST","PATCH","DELETE"]) {
    assert.equal(access(user,method,"/35","1",dev,now),"bound");
    assert.equal(access(user,method,"/35","3",dev,now),"deny");
    assert.equal(access({...user,role:"super_admin"},method,"/35","3",dev,now),"deny");
  }
  assert.equal(access({...user,companyId:"3"},"GET","/","3",dev,now),"bound");
  assert.equal(access({...user,companyId:"default"},"GET","/","1",dev,now),"deny");
  assert.equal(access(undefined,"GET","/","1",dev,now),"deny");
  assert.equal(access(approved,"GET","/","1",{...dev,NODE_ENV:"production"},now),"unchanged");
});
test("CRM subtree guard executes before detail and memory; list SQL rechecks current authority and projects only list fields", () => {
  const guard = route.split('router.use("/crm/customers", requireAuth,')[1].split("// GET /api/crm/customers")[0];
  assert.match(guard,/resolveCrmSubtreeAccess\(req\.user, req\.method, req\.path, req\.query\.companyId\)/);
  assert.match(guard,/access === "deny"/);
  assert.match(guard,/current\.rows\.length !== 1/);
  const list = route.split('router.get("/crm/customers", requireAuth,')[1].split("// GET /api/crm/customers/:id")[0];
  assert.match(list,/isApprovedLegacyCrmProfile\(req\.user\)/);
  assert.match(list,/companyId !== 1/);
  assert.match(list,/JOIN public\.users u ON \$\{profileCompany\}/);
  assert.match(list,/FROM public\.customers c JOIN eligible e ON e\.id = c\.company_id/);
  assert.match(list,/EXISTS\(SELECT 1 FROM eligible\) AS authorized/);
  assert.match(list,/row\?\.authorized !== true/);
  assert.match(list,/Cache-Control", "private, no-store"/);
  assert.doesNotMatch(list,/INSERT INTO|UPDATE public|DELETE FROM/);
  const ui = readFileSync(new URL("../../artifacts/ai-task-center/src/pages/customers-crm.tsx", import.meta.url), "utf8");
  assert.match(ui,/scope\.data\?\.canList === true/);
  assert.match(ui,/query\.set\("companyId", "1"\)/);
  assert.match(ui,/row\.company_id !== 1/);
  assert.match(ui,/canManageExisting && <div/);
  assert.match(ui,/else if \(canManageExisting && editTarget\)/);
  assert.match(ui,/listError \?/);
});
