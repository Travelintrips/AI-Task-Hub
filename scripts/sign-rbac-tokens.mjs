import { createRequire } from 'module';
import { writeFileSync } from 'fs';
const req = createRequire(import.meta.url);
const jwt = req('jsonwebtoken');

const secret = process.env.SESSION_SECRET ?? "fallback-secret-change-in-production";
const roles = ["super_admin", "company_admin", "owner", "supervisor", "staff"];
const tokens = {};
for (const role of roles) {
  tokens[role] = jwt.sign(
    { id: 9000, email: `test_${role}@rbac.test`, role, companyId: "default", name: `Test ${role}` },
    secret,
    { expiresIn: "1h" }
  );
}
writeFileSync("/tmp/rbac_tokens.json", JSON.stringify(tokens));
console.log("✅ Tokens minted:", Object.keys(tokens).join(", "));
