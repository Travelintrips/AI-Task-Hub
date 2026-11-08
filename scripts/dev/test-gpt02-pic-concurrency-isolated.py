#!/usr/bin/env python3
"""Two interleavings of the DEV GPT02 PIC/first-execution admission fence.

Run: python3 scripts/dev/test-gpt02-pic-concurrency-isolated.py
Requires Docker with a locally available postgres:16-alpine image. Uses a fresh
--network none PostgreSQL instance with synthetic rows only; no app credentials,
no real task/command, no external dispatch. This checks the shared PostgreSQL
transaction/advisory-lock SQL protocol; it does not replace live API E2E.
"""
import os
import subprocess
import threading
import time

NAME = f"gpt02-pic-race-isolated-{os.getpid()}"
IMAGE = "postgres:16-alpine"
KEY = "SELECT pg_advisory_xact_lock(hashtextextended('default' || ':' || 1::text, 0));"


def command(*args, input=None, check=True):
    return subprocess.run(args, input=input, text=True, check=check,
                          stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=25)


def sql(statement):
    result = command("docker", "exec", "-i", NAME, "psql", "-X", "-A", "-t",
                     "-v", "ON_ERROR_STOP=1", "-U", "postgres", input=statement)
    return result.stdout.strip()


def race(first, second):
    results = {}
    def run(label, body):
        try:
            results[label] = sql(body)
        except Exception as exc:
            results[label] = f"ERROR:{exc}"
    a = threading.Thread(target=run, args=("first", first))
    b = threading.Thread(target=run, args=("second", second))
    a.start()
    time.sleep(.2)
    b.start()
    a.join()
    b.join()
    assert not any(v.startswith("ERROR:") for v in results.values()), results


def main():
    command("docker", "run", "-d", "--network", "none", "--name", NAME,
            "-e", "POSTGRES_PASSWORD=isolated-test-only", IMAGE)
    try:
        for _ in range(25):
            if command("docker", "exec", NAME, "pg_isready", "-U", "postgres", check=False).returncode == 0:
                break
            time.sleep(.3)
        else:
            raise RuntimeError("Isolated postgres did not become ready")
        # pg_isready may transiently succeed against bootstrap postmaster.
        # Retry only synthetic schema setup while PostgreSQL finishes startup.
        schema = """
        CREATE TABLE tasks(id integer PRIMARY KEY, company_id text NOT NULL,
                           assigned_to_id integer, status text NOT NULL);
        CREATE TABLE executions(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                                task_id integer NOT NULL, company_id text NOT NULL);
        CREATE TABLE audits(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                            task_id integer NOT NULL, member_id integer NOT NULL);
        INSERT INTO tasks VALUES(1,'default',1,'new_inquiry');
        """
        for attempt in range(12):
            try:
                sql(schema)
                break
            except subprocess.CalledProcessError:
                if attempt == 11:
                    raise
                time.sleep(.5)
        assignment = f"""
        BEGIN; {KEY}
        UPDATE tasks SET assigned_to_id=2 WHERE id=1 AND company_id='default'
          AND status NOT IN ('completed','cancelled')
          AND NOT EXISTS (SELECT 1 FROM executions WHERE task_id=1 AND company_id='default');
        SELECT pg_sleep(1);
        INSERT INTO audits(task_id,member_id) VALUES(1,2);
        COMMIT;"""
        execution = f"""
        BEGIN; {KEY}
        INSERT INTO executions(task_id,company_id)
          SELECT id,company_id FROM tasks
          WHERE id=1 AND assigned_to_id=1 AND company_id='default';
        COMMIT;"""
        race(assignment, execution)
        observed = sql("""SELECT (SELECT assigned_to_id FROM tasks WHERE id=1),
           (SELECT count(*) FROM executions), (SELECT count(*) FROM audits);""").splitlines()[-1]
        print("PIC_FIRST", observed)
        assert observed == "2|0|1", observed

        sql("TRUNCATE audits,executions RESTART IDENTITY; UPDATE tasks SET assigned_to_id=1 WHERE id=1;")
        execution = f"""BEGIN; {KEY}
           INSERT INTO executions(task_id,company_id) VALUES(1,'default');
           SELECT pg_sleep(1); COMMIT;"""
        assignment = f"""BEGIN; {KEY}
           WITH u AS (UPDATE tasks SET assigned_to_id=2
               WHERE id=1 AND company_id='default'
               AND NOT EXISTS (SELECT 1 FROM executions WHERE task_id=1 AND company_id='default')
               RETURNING id)
           INSERT INTO audits(task_id,member_id) SELECT id,2 FROM u;
           COMMIT;"""
        race(execution, assignment)
        observed = sql("""SELECT (SELECT assigned_to_id FROM tasks WHERE id=1),
           (SELECT count(*) FROM executions), (SELECT count(*) FROM audits);""").splitlines()[-1]
        print("EXECUTION_FIRST", observed)
        assert observed == "1|1|0", observed
        print("ISOLATED_POSTGRES_16_RACE_PROTOCOL_2_OF_2_PASS")
    finally:
        command("docker", "rm", "-f", NAME, check=False)


if __name__ == "__main__":
    main()
