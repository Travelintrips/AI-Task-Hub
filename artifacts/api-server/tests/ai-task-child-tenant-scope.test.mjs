import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const src=readFileSync(new URL("../src/routes/ai-tasks.ts",import.meta.url),"utf8");
const section=(from,to)=>src.slice(src.indexOf(from),src.indexOf(to,src.indexOf(from)+from.length));
test("task child guard scopes parent by JWT-derived company before accessing child tables",()=>{
 const guard=section("async function accessibleTaskId","// ─── POST /ai-tasks/:id/comments");
 assert.match(guard,/getCompanyId\(req\)/);
 assert.match(guard,/eq\(aiTasksTable\.id, taskId\)/);
 assert.match(guard,/if \(companyId\) conditions\.push\(eq\(aiTasksTable\.companyId, companyId\)\)/);
 assert.match(guard,/\.from\(aiTasksTable\)\.where\(and\(\.\.\.conditions\)\)\.limit\(1\)/);
});
test("comment insertion requires accessible parent first",()=>{
 const code=section("router.post(\"/ai-tasks/:id/comments\"","// ─── GET /ai-tasks/:id/messages");
 assert.ok(code.indexOf("await accessibleTaskId(req, taskId)")<code.indexOf(".insert(taskCommentsTable)"));
 assert.match(code,/res\.status\(404\)\.json\(\{ error: "AI task not found" \}\)/);
 assert.match(code,/Number\.isSafeInteger\(taskId\)/);
});
test("WhatsApp messages read requires accessible parent first",()=>{
 const code=section("router.get(\"/ai-tasks/:id/messages\"","// ─── Stub endpoints");
 assert.ok(code.indexOf("await accessibleTaskId(req, id)")<code.indexOf(".from(whatsappMessagesTable)"));
 assert.match(code,/res\.status\(404\)\.json\(\{ error: "AI task not found" \}\)/);
 assert.match(code,/Number\.isSafeInteger\(id\)/);
});
test("PIC WhatsApp recipient lookup is scoped by the task company",()=>{
 const code=section("if (assignedTo && assignedTo !== current.assignedTo)","res.json(updated)");
 assert.match(code,/eq\(teamMembersTable\.companyId, eventCompanyId\)/);
});
