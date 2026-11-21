#!/usr/bin/env python3
"""Read-only live systemd DynamicUser peer authentication fixture for Task183.
Starts TWO transient synthetic services, never the operational signer.
No credentials, approval, real broker store or signing.
"""
import os,socket,struct,threading,tempfile,subprocess,grp,pathlib,importlib.util
UNIT="cst-task183-dynamic-peer-fixture.service"
BAD_UNIT="cst-task183-impostor-peer-fixture.service"
GROUP="gpt02-issue159-signers"
GID=grp.getgrnam(GROUP).gr_gid
spec=importlib.util.spec_from_file_location("policy",pathlib.Path(__file__).with_name("task183-systemd-peer-policy.candidate.py"))
policy=importlib.util.module_from_spec(spec);spec.loader.exec_module(policy)
n=0
def check(label,condition):
 global n
 assert condition,label
 n+=1
 print("PASS:"+label,flush=True)
def inspect(c):
 raw=c.getsockopt(socket.SOL_SOCKET,socket.SO_PEERCRED,12)
 pid,uid,gid=struct.unpack("3i",raw)
 cgroup=pathlib.Path(f"/proc/{pid}/cgroup").read_text()
 status=pathlib.Path(f"/proc/{pid}/status").read_text()
 groups=next((line.split(":",1)[1].split() for line in status.splitlines() if line.startswith("Groups:")),[])
 # UID is unpredictable on DynamicUser; never hard-code it.
 return dict(pid=pid,uid=uid,gid=gid,
    unit=(f"/{UNIT}" in cgroup or f"/{UNIT}/" in cgroup),
    group=(str(GID) in groups),root=(uid==0))
with tempfile.TemporaryDirectory(prefix="task183-peer-runtime-",dir="/run") as td:
 # /run is visible to DynamicUser services; /tmp may be isolated implicitly.
 os.chmod(td,0o755)
 sockpath=td+"/proof.sock"
 listener=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM)
 listener.bind(sockpath);os.chown(sockpath,0,GID);os.chmod(sockpath,0o660)
 listener.listen(3);listener.settimeout(15)
 received=[]
 def serve():
  try:
   for _ in range(3):
    conn,_=listener.accept()
    with conn:
     data=inspect(conn)
     received.append(data)
     allowed=policy.authenticated_peer(conn,unit=UNIT,group=GROUP)
     conn.sendall(b"ACCEPT" if allowed else b"REJECT")
  except Exception as e:
   received.append({"error":str(e)})
 t=threading.Thread(target=serve,daemon=True);t.start()
 with socket.socket(socket.AF_UNIX,socket.SOCK_STREAM) as c:
  c.connect(sockpath)
  check("ROOT_NON_UNIT_PEER_REJECTED",c.recv(20)==b"REJECT")
 cmd=["systemd-run","--quiet","--wait","--collect","--unit="+UNIT,
      "-p","DynamicUser=yes","-p","SupplementaryGroups="+GROUP,
      "-p","NoNewPrivileges=yes","-p","ProtectSystem=strict",
      "-p","PrivateNetwork=yes","-p","PrivateTmp=no",
      "/usr/bin/python3","-c",
      "import socket,sys; s=socket.socket(socket.AF_UNIX); s.connect(sys.argv[1]); print('DYNAMIC_PEER_BROKER_REPLY='+s.recv(20).decode()); s.close()",
      sockpath]
 run=subprocess.run(cmd,text=True,capture_output=True,timeout=25)
 bad_cmd=["--unit="+BAD_UNIT if v=="--unit="+UNIT else v for v in cmd]
 bad_run=subprocess.run(bad_cmd,text=True,capture_output=True,timeout=25)
 t.join(timeout=5);listener.close()
 check("TRANSIENT_SYSTEMD_SERVICE_SUCCESS",run.returncode==0)
 check("TRANSIENT_DYNAMIC_PEER_ACCEPTED",len(received)==3 and received[1].get("unit") and received[1].get("group") and not received[1].get("root"))
 check("ROOT_PEER_CANNOT_IMPERSONATE_SERVICE",received[0].get("unit") is False)
 check("OTHER_DYNAMIC_UNIT_COMMAND_COMPLETES",bad_run.returncode==0)
 check("SAME_GROUP_OTHER_UNIT_DENIED",len(received)==3 and received[2].get("group") and received[2].get("unit") is False)
 check("NO_OPERATIONAL_SIGNER_STARTED",subprocess.run(["systemctl","is-active","gpt02-issue159-operational-signer@approval.service"],capture_output=True,text=True).stdout.strip()=="inactive")
 check("NO_ISSUER_STARTED",subprocess.run(["systemctl","is-active","gpt02-issue159-issuer-reader.service"],capture_output=True,text=True).stdout.strip()=="inactive")
 print("SYSTEMD_EXIT="+str(run.returncode))
 print("DYNAMIC_RESULT="+run.stdout.strip()[:160])
 if run.returncode!=0:print("SYSTEMD_ERROR="+run.stderr.strip()[:400])
 print("PEER_DETAILS="+str(received))
 print(f"RESULT={n}/{n} PASS")
 print("LIVE_SIGNING=FALSE")
 print("PROD_CHANGED=FALSE")
