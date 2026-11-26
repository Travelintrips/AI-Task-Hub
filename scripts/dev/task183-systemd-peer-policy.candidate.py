#!/usr/bin/env python3
"""Task183 root-broker Unix peer identity policy. No side effects.

SO_PEERCRED alone is insufficient when the caller has a systemd DynamicUser.
Require the exact systemd cgroup unit and supplementary signer group, and
reject root. Used in isolated systemd proof before any live integration.
"""
import grp
import pathlib
import socket
import struct

EXPECTED_UNIT="gpt02-issue159-operational-signer@approval.service"
EXPECTED_GROUP="gpt02-issue159-signers"

def authenticated_peer(conn, *, unit=EXPECTED_UNIT, group=EXPECTED_GROUP):
    if not hasattr(socket,"SO_PEERCRED"):
        return False
    try:
        raw=conn.getsockopt(socket.SOL_SOCKET,socket.SO_PEERCRED,12)
        pid,uid,gid=struct.unpack("3i",raw)
        if pid<=1 or uid==0 or gid==0:
            return False
        required_gid=grp.getgrnam(group).gr_gid
        cg=pathlib.Path(f"/proc/{pid}/cgroup").read_text()
        status=pathlib.Path(f"/proc/{pid}/status").read_text()
        memberships=next(
            (v.split() for k,v in (line.split(":",1) for line in status.splitlines() if ":" in line)
             if k=="Groups"),[])
        # Whole-unit component only. Prefix matches are not trusted.
        cgroup_ok=any(unit==part for line in cg.splitlines() for part in line.split("/"))
        return cgroup_ok and str(required_gid) in memberships
    except (OSError,ValueError,KeyError,struct.error):
        return False
