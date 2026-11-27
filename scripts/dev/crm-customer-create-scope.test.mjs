import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const route = readFileSync(new URL("../../artifacts/api-server/src/routes/customers-crm.ts", import.meta.url), "utf8");
const start = route.indexOf("function resolveCrmCreateCompany(");
const end = route.indexOf("// GET /api/crm/customers", start);
assert.ok(start >= 0 && end > start);
const fn = route.slice(start, end).replace(
  "function resolveCrmCreateCompany(user: AuthUser | undefined, requestedCompany: unknown, body: Record<string, unknown>): number | null",
  "function resolveCrmCreateCompany(user, requestedCompany, body)",
);
const resolve = runInNewContext(fn + "\nresolveCrmCreateCompany");
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
  assert.match(post, /if \(companyId === null\)/);
  assert.match(post, /JOIN public\.users u ON u\.company_id = co\.id/);
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
  assert.match(routeBody, /JOIN public\.users u ON u\.company_id = co\.id/);
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
