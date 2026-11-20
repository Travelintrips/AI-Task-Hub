import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolveOnboardingCustomerCompanyId } from "../../artifacts/api-server/src/lib/onboarding-customer-company-scope.ts";

const scope = { companyId: "default", nodeEnv: "development", appEnv: "development", supabaseDevUrl: "https://xssrfshdrtdfupgqwfdw.supabase.co" };

test("only exact CST-DEV default tenant resolves to company id 1", () => {
  assert.equal(resolveOnboardingCustomerCompanyId(scope), 1);
  assert.equal(resolveOnboardingCustomerCompanyId({ ...scope, supabaseDevUrl: scope.supabaseDevUrl + "/" }), 1);
  for (const changes of [
    { nodeEnv: "production" },
    { appEnv: "production" },
    { supabaseDevUrl: "https://nzdweipzckfszczzqtuw.supabase.co" },
    { supabaseDevUrl: undefined },
    { companyId: "default " },
  ]) assert.equal(resolveOnboardingCustomerCompanyId({ ...scope, ...changes }), null);
});

test("numeric tenant IDs retain exact, independent company identity", () => {
  for (const id of ["1", "2", "3", "4", "5", "100"]) {
    assert.equal(resolveOnboardingCustomerCompanyId({ ...scope, companyId: id }), Number(id));
  }
  for (const id of ["", "0", "-1", "01", "1.0", "1e0", "2 OR true", "CST", "9999999999999999999999"]) {
    assert.equal(resolveOnboardingCustomerCompanyId({ ...scope, companyId: id }), null);
  }
});

test("customer count uses only owned rows and verified company code, not NULL ownership", () => {
  const src = readFileSync("artifacts/api-server/src/routes/system.ts", "utf8");
  const segment = src.split("// Customers: exact numeric tenant ownership only;")[1]?.split("// Fleet units")[0];
  assert.ok(segment, "Customer onboarding scope must remain a distinct bounded query");
  assert.ok(segment.includes("JOIN companies company ON company.id = c.company_id"));
  assert.ok(segment.includes("WHERE c.company_id = ${customerCompanyId}"));
  assert.ok(segment.includes("company.is_active = true"));
  assert.ok(segment.includes("company.code = 'CST'"));
  assert.ok(segment.includes("customerCompanyId === null"));
  assert.doesNotMatch(segment, /company_id IS NULL OR|UPDATE\s+customers|INSERT\s+INTO\s+customers/i);
});
