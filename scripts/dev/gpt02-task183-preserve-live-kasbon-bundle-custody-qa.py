#!/usr/bin/env python3
"""Source-only CST-DEV Task183 custody guard patch for the exact preserved Kasbon bundle.

This does NOT touch any running container/image, deploy, connect to PostgreSQL,
read credentials, create a task, issue a command, or enable preparation.
Input and output are fixed QA copies. Reject every unrecognized baseline SHA.
"""
from pathlib import Path
import hashlib
import subprocess

BASE = Path("/opt/ai-task-gpt02-preparer/qa-oauth-hotfix-preserve-kasbon")
INPUT = BASE / "live-index.mjs"
OUTPUT = BASE / "task183-custody-guarded-index.mjs"
EXPECTED_SHA = "22e084ba5580b20ee0bbd05568444b4ed7b7117b693ca6ab495a0d651a3999da"

ORIGINAL = """function createCoreTaskPreparer({ env, PoolClass }) {
  if (typeof PoolClass !== "function") deny("POSTGRES_POOL_CLASS_REQUIRED");
  const config4 = corePreparationPoolConfig(env);
  const pool2 = new PoolClass(config4);
  pool2.on("error", () => {
  });
  return { preparer: new Gpt02CoreTaskPreparer({ pool: pool2 }), close: () => pool2.end() };
}"""

REPLACEMENT = """// Task183 only: this exact mixed DEV build never accepts a preparer
// credential through the API environment, the normal Hub connection pool,
// or a writable/non-root credential path. Existing Kasbon code is untouched.
const __TASK183_RO_DIR = "/run/credentials/gpt02-core-preparer.service";
function __task183FileCustody(env) {
  if (env?.GPT02_CORE_PREP_CREDENTIAL_SOURCE !== "docker-readonly" ||
      env?.GPT02_CORE_PREP_DATABASE_URL_DEV !== undefined ||
      env?.GPT02_CORE_PREP_DEV_CA !== undefined)
    deny("PREPARER_INLINE_CREDENTIAL_FORBIDDEN");
  if (env?.NODE_ENV !== "development" || env?.APP_ENV !== "development")
    deny("EXPLICIT_SECURE_DEV_REQUIRED");
  const uid = process.getuid?.(), gid = process.getgid?.();
  if (!Number.isInteger(uid) || uid <= 0 || !Number.isInteger(gid))
    deny("PREPARER_NONROOT_CONTAINER_REQUIRED");
  let stat, mounts;
  try {
    stat = __task183Fs.lstatSync(__TASK183_RO_DIR);
    mounts = __task183Fs.readFileSync("/proc/self/mountinfo", "utf8");
  } catch { deny("PREPARER_DOCKER_READONLY_MOUNT_REQUIRED"); }
  if (!stat.isDirectory() || stat.isSymbolicLink() ||
      stat.uid !== uid || stat.gid !== gid || (stat.mode & 0o777) !== 0o500)
    deny("PREPARER_DOCKER_CREDENTIAL_DIRECTORY_INVALID");
  const mountedReadOnly = mounts.split("\\n").some(line => {
    const fields = line.split(" ");
    return fields[4] === __TASK183_RO_DIR &&
      fields[5]?.split(",").includes("ro");
  });
  if (!mountedReadOnly)
    deny("PREPARER_DOCKER_READONLY_MOUNT_REQUIRED");
  const read = (name) => {
    const path = __TASK183_RO_DIR + "/" + name;
    let f;
    try { f = __task183Fs.lstatSync(path); }
    catch { deny("PREPARER_CREDENTIAL_FILE_REQUIRED"); }
    if (!f.isFile() || f.isSymbolicLink() || f.uid !== uid ||
        f.gid !== gid || (f.mode & 0o777) !== 0o400)
      deny("PREPARER_DOCKER_CREDENTIAL_FILE_INVALID");
    let value;
    try { value = __task183Fs.readFileSync(path, "utf8"); }
    catch { deny("PREPARER_CREDENTIAL_FILE_REQUIRED"); }
    if (value.length < 1 || value.length > 8192)
      deny("PREPARER_CREDENTIAL_FILE_INVALID");
    return value;
  };
  // This existing function checks exact DEV pooler project, dedicated role,
  // port/database, and the SHA-256-pinned Supabase root certificate.
  const config = corePreparationPoolConfig({
    ...env,
    GPT02_CORE_PREP_DATABASE_URL_DEV: read("preparer-dsn").trim(),
    GPT02_CORE_PREP_DEV_CA: read("supabase-root-ca.crt"),
  });
  const transport = env?.GPT02_CORE_PREP_DEV_TRANSPORT ?? "pooler";
  if (transport !== "pooler" && transport !== "direct")
    deny("PREPARER_DB_TRANSPORT_UNSUPPORTED");
  if (transport === "direct") {
    const direct = new URL(config.connectionString);
    direct.hostname = "db.xssrfshdrtdfupgqwfdw.supabase.co";
    direct.username = "gpt02_core_prep_login";
    return {...config,
      connectionString: direct.toString(),
      ssl: {...config.ssl, servername: direct.hostname},
    };
  }
  return config;
}
function createCoreTaskPreparer({ env, PoolClass }) {
  if (typeof PoolClass !== "function") deny("POSTGRES_POOL_CLASS_REQUIRED");
  // No legacy inline-DSN fallback even if the readiness flag is switched on.
  const config4 = __task183FileCustody(env);
  const pool2 = new PoolClass(config4);
  pool2.on("error", () => {
  });
  return { preparer: new Gpt02CoreTaskPreparer({ pool: pool2 }), close: () => pool2.end() };
}"""

IMPORT = 'import * as __task183Fs from "node:fs";\n'

def main():
    if not BASE.is_dir() or INPUT.is_symlink() or OUTPUT.is_symlink():
        raise SystemExit("QA_BASELINE_LOCATION_INVALID")
    data = INPUT.read_bytes()
    if hashlib.sha256(data).hexdigest() != EXPECTED_SHA:
        raise SystemExit("QA_EXACT_LIVE_BUNDLE_HASH_MISMATCH")
    old = data.decode("utf-8")
    if old.count(ORIGINAL) != 1 or "corePreparationPoolConfigFromDockerReadonlyFiles" in old:
        raise SystemExit("QA_SOURCE_PATTERN_MISMATCH")
    if old.lower().count("kasbon") < 190 or "EMPLOYEE_KASBON_WA_POLL_ENABLED" not in old:
        raise SystemExit("QA_KASBON_BASELINE_NOT_PROVEN")
    new = IMPORT + old.replace(ORIGINAL, REPLACEMENT, 1)
    # Byte-for-byte original can be reconstructed, proving no incidental edits.
    assert new.removeprefix(IMPORT).replace(REPLACEMENT, ORIGINAL, 1) == old
    assert new.lower().count("kasbon") == old.lower().count("kasbon")
    assert "EMPLOYEE_KASBON_OWNER_PHONE" in new
    if OUTPUT.exists():
        if OUTPUT.read_bytes() != new.encode("utf-8"):
            raise SystemExit("QA_OUTPUT_ALREADY_EXISTS_DIFFERENT")
    else:
        OUTPUT.write_bytes(new.encode("utf-8"))
        OUTPUT.chmod(0o444)
    result = subprocess.run(["/usr/bin/node", "--check", str(OUTPUT)],
                            capture_output=True, timeout=20, check=False)
    if result.returncode:
        raise SystemExit("QA_PATCH_SYNTAX_FAILED")
    print("EXACT_LIVE_KASBON_BUNDLE_PRESERVED=PASS")
    print("CUSTODY_ADDITIVE_PATCH_SYNTAX=PASS")
    print("ALL_UNRELATED_BYTES_UNCHANGED=PASS")
    print("READONLY_MOUNT_RUNTIME_QA=NOT_RUN")
    print("TASK183_PREPARATION_ENABLED=FALSE")
    print("DISPATCH_PERMITTED=FALSE")

if __name__ == "__main__":
    main()
