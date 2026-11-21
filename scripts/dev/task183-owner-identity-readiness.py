#!/usr/bin/env python3
"""Signed Task Center Super Admin -> existing GPT02 Owner mapping, read-only.

Never records approval or creates a role. The app session is verified by the
existing one-click broker; this module pins the root-owned approval DB and
checks the separate live enabled operator mapping. All statuses are NO-GO.
"""
import os,re,sqlite3,stat,time
from pathlib import Path

APPROVAL_DB=Path('/opt/ai-coding-standalone-dev/tasks.db')
HUB_ID=re.compile(r'^google_[A-Za-z0-9_-]{6,120}$')
UUID=re.compile(r'^[0-9a-fA-F]{8}-(?:[0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}$')

def validate_actor(actor,now_ms=None):
    now_ms=int(time.time()*1000) if now_ms is None else int(now_ms)
    if (type(actor) is not dict or actor.get('role')!='super_admin'
        or actor.get('companyId') not in (None,'default')
        or type(actor.get('id')) is not str or not HUB_ID.fullmatch(actor['id'])
        or type(actor.get('authSupabaseId')) is not str
        or not UUID.fullmatch(actor['authSupabaseId'])
        or actor.get('authSource')!='supabase_google_identity'
        or type(actor.get('email')) is not str or
        not re.fullmatch(r'[^@\s]+@[^@\s]+',actor['email'])
        or type(actor.get('authVerifiedAt')) is not int
        or actor['authVerifiedAt']>now_ms+30000
        or actor['authVerifiedAt']<now_ms-8*86400000):
        raise ValueError('SIGNED_SUPER_ADMIN_GOOGLE_SESSION_REQUIRED')
    return True

def eligible_owner(actor,db_path=APPROVAL_DB,operational=True,now_ms=None):
    validate_actor(actor,now_ms)
    p=Path(db_path)
    if operational and p!=APPROVAL_DB:raise ValueError('APPROVAL_DB_NOT_PINNED')
    st=os.lstat(p)
    if (not stat.S_ISREG(st.st_mode) or stat.S_ISLNK(st.st_mode) or
        (operational and (st.st_uid!=0 or st.st_gid!=0 or stat.S_IMODE(st.st_mode)!=0o600))):
        raise ValueError('APPROVAL_DB_CUSTODY_DENIED')
    con=sqlite3.connect('file:'+str(p)+'?mode=ro',uri=True,timeout=3)
    try:
        con.execute('PRAGMA query_only=ON')
        rows=con.execute('''
          SELECT l.hub_operator_id,a.role,a.enabled,l.enabled
          FROM gpt02_issue159_admin_operator_links l
          JOIN admin_identities a ON a.user_id=l.auth_user_id
          WHERE l.auth_user_id=? AND lower(l.email)=lower(?)
            AND l.hub_operator_id=?
        ''',(actor['authSupabaseId'],actor['email'],actor['id'])).fetchall()
        if len(rows)!=1 or rows[0]!=(actor['id'],'super_admin',1,1):
            raise ValueError('EXACT_OWNER_OPERATOR_LINK_REQUIRED')
        return {'eligible':True,'taskId':183,'companyId':'default',
            'scope':'SUPERADMIN_OWNER_IDENTITY_READ_ONLY',
            'ownerSubject':'owner:'+actor['id'],
            'googleSessionVerified':True,'enabledOperatorLinkVerified':True,
            'approvalDecisionCreated':False,'cryptographicOwnerSignatureVerified':False,
            'issuerAuthorized':False,'dispatchPermitted':False,'readOnly':True}
    finally:con.close()
