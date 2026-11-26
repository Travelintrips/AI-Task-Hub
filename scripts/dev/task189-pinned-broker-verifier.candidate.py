#!/usr/bin/env python3
"""Exact Task189 recovery signature callback for a root-owned broker.

Requires the full claims supplied by same-connection Unix protocol. Reads
only pinned approval public key and trust fingerprint. Never signs.
"""
import importlib.util
from pathlib import Path
HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location("task189_verifier",HERE/"task189-pinned-approval-verifier.candidate.py")
v=importlib.util.module_from_spec(spec);spec.loader.exec_module(v)

def make_verifier(*,operational=True,key_path=None,manifest_path=None):
    if operational and (key_path is not None or manifest_path is not None):
        raise ValueError("OPERATIONAL_TRUST_OVERRIDE_DENIED")
    def callback(role,digest,request_id,evidence_sha256,claims,signature):
        kwargs=dict(role=role,digest=digest,request_id=request_id,
            evidence_sha256=evidence_sha256,claims=claims,signature=signature,
            operational=operational)
        if key_path is not None:kwargs["key_path"]=key_path
        if manifest_path is not None:kwargs["manifest_path"]=manifest_path
        return v.verify(**kwargs) is True
    return callback
