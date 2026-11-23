"""Build the fixed CST-DEV install or rollback statement from versioned sources."""
import argparse
import hashlib
from pathlib import Path
import subprocess

HERE = Path(__file__).resolve().parent
SCRIPTS = HERE.parent
BINDING = "GPT02 DEV prepare-only task 189 request 1bdbed20-ac8d-4e63-898e-6a94b729c018"
WRAPPER_OLD = "a759ab94ab38e0f0fcf0b42bc14dbbf30308274344a14ade666e1bae38a1c456"
WRAPPER_NEW = "2d0461518f6992c1b404bc44f14c5556f172a1dace2f3bd37ffafe123285f0c3"
GUARD_OLD = "7651f9b031d7c6b8f70edb61efd4fe2bab4c2a62bb82b12435da24ae100485d2"
GUARD_NEW = "b096bd1a8258d685f0053e528b35e729ecb4eccc459aea05679e25939800cb33"


def checked_ddl(source, delimiter, expected):
    ddl = source[source.index("CREATE OR REPLACE FUNCTION "):].strip()
    parts = ddl.split(delimiter)
    if len(parts) != 3 or parts[2].strip() != ";" or hashlib.sha256(parts[1].encode()).hexdigest() != expected:
        raise ValueError("function source differs from release")
    return ddl


def render(direction):
    if direction not in ("install", "rollback"):
        raise ValueError("unknown release direction")
    up = direction == "install"
    previous = HERE / "relock-baseline.sql"
    guard = subprocess.run(["patch", "--quiet", "--batch", "--fuzz=0", "--output=-",
                           str(previous), str(HERE / "relock-189.patch")],
                          check=True, capture_output=True, text=True).stdout if up else previous.read_text()
    wrapper = (SCRIPTS / ("gpt02-preparer-task-lease-wrapper.sql" if up else
                          "gpt02-preparer-instruction-bound-wrapper-candidate.sql")).read_text()
    values = {"UP": "true" if up else "false", "BINDING": BINDING,
              "WRAPPER_OLD": WRAPPER_OLD, "WRAPPER_NEW": WRAPPER_NEW,
              "GUARD_OLD": GUARD_OLD, "GUARD_NEW": GUARD_NEW,
              "COMMENT_SQL": "'" + BINDING + "'" if up else "NULL",
              "WRAPPER_SQL": checked_ddl(wrapper, "$gpt02_preparer_guard$", WRAPPER_NEW if up else WRAPPER_OLD),
              "GUARD_SQL": checked_ddl(guard, "$relock$", GUARD_NEW if up else GUARD_OLD)}
    query = (HERE / "pair.sql.in").read_text()
    for key, value in values.items():
        query = query.replace("@" + key + "@", value)
    return query


def transition_supervisor():
    # During an atomic DB cutover the timer can see either reviewed guard.
    # The installed steady-state module has only the new pin and no runtime override.
    source = (HERE / "gpt02_issue159_relock_catalog_supervisor.mjs").read_text()
    strict = f"IN ('{GUARD_NEW}')"
    if source.count(strict) != 1 or GUARD_OLD in source:
        raise ValueError("unexpected steady-state supervisor source")
    return source.replace(strict, f"IN ('{GUARD_OLD}', '{GUARD_NEW}')")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("direction", choices=("install", "rollback", "transition-supervisor"))
    direction = parser.parse_args().direction
    if direction == "transition-supervisor":
        print(transition_supervisor(), end="")
    else:
        print(render(direction))
