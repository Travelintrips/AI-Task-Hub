# CST AI Team DEV — bounded local Ollama QA collector.
# Runs ONLY against the existing loopback Ollama API on DELL.
# Output may be submitted as an UNATTESTED operator observation, never signed GPT02 evidence.
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)]
  [ValidatePattern('^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$')]
  [string]$Challenge,
  [Parameter(Mandatory=$true)]
  [ValidateSet('NO_PERSISTED_HANDOFF','REVIEW_COMPLETE')]
  [string]$CodingFinding,
  [Parameter(Mandatory=$true)]
  [ValidateSet('MISSING_WORKER_LEASE','DEV_READ_ONLY_GUARDS_OK')]
  [string]$InfrastructureFinding,
  [Parameter(Mandatory=$true)]
  [ValidateSet('MISSING_FINAL_ACK','DEV_READ_ONLY_GUARDS_OK')]
  [string]$SecurityFinding
)
$ErrorActionPreference = 'Stop'
$sourceKind='ollama-local'
$agentId='ollama-local-qa'
$hostName='DELL'
$model='qwen2.5:3b'
$proofLevel='DEV_OPERATOR_COLLECTED_UNATTESTED'
function Get-Sha256([string]$s) {
  $digest=[Security.Cryptography.SHA256]::Create()
  try {
    return [BitConverter]::ToString(
      $digest.ComputeHash([Text.Encoding]::UTF8.GetBytes($s))
    ).Replace('-','').ToLowerInvariant()
  } finally { $digest.Dispose() }
}
function Write-Fail([string]$reason) {
  [pscustomobject]@{
    status='BLOCKED'; reason=$reason; sourceKind=$sourceKind
    proofLevel=$proofLevel; signed=$false
    operationalVerified=$false; independentFinalAckVerified=$false
  } | ConvertTo-Json -Compress -Depth 5
}
if ($env:COMPUTERNAME -ne $hostName) {
  Write-Fail 'NOT_AUTHORIZED_DELL_HOST'
  exit 1
}
if ($CodingFinding -eq 'REVIEW_COMPLETE' -and
    $InfrastructureFinding -eq 'DEV_READ_ONLY_GUARDS_OK' -and
    $SecurityFinding -eq 'DEV_READ_ONLY_GUARDS_OK') {
  Write-Fail 'NO_VERIFIED_BLOCKER_INPUT'
  exit 1
}
$summaryCode='MISSING_WORKER_LEASE'
if ($CodingFinding -eq 'NO_PERSISTED_HANDOFF') { $summaryCode='NO_PERSISTED_HANDOFF' }
if ($SecurityFinding -eq 'MISSING_FINAL_ACK') { $summaryCode='MISSING_FINAL_ACK' }
$findings="CODING=$CodingFinding; INFRASTRUCTURE=$InfrastructureFinding; SECURITY=$SecurityFinding"
# Restrict the task to a tiny, deterministic QA classification. No raw user
# content, files, web browsing, database, tokens or external provider calls.
$prompt="CST DEV local QA diagnostic only. Review these operator-supplied observations: $findings. These observations are not signed and are not proof of real worker execution. If any required lease, handoff or Final ACK is missing, reply with exactly QA_BLOCKED. Do not claim verified completion."
$body=@{
  model=$model
  prompt=$prompt
  stream=$false
  options=@{num_ctx=512;num_predict=24;temperature=0}
} | ConvertTo-Json -Depth 6
$clock=[Diagnostics.Stopwatch]::StartNew()
try {
  $r=Invoke-RestMethod -Uri 'http://127.0.0.1:11434/api/generate' -Method Post -ContentType 'application/json' -Body $body -TimeoutSec 30
} catch {
  Write-Fail 'LOCAL_OLLAMA_UNAVAILABLE'
  exit 1
}
$clock.Stop()
if ($r.model -ne $model) {
  Write-Fail 'MODEL_MISMATCH'
  exit 1
}
$answer=([string]$r.response).Trim()
if ($answer -cne 'QA_BLOCKED') {
  Write-Fail 'QA_RESPONSE_NOT_ACCEPTED'
  exit 1
}
# This digest is an ephemeral QA run marker, not a cryptographic agent identity.
$nonce=[guid]::NewGuid().ToString('D')
$observation=[ordered]@{
  role='qa'
  host=$hostName
  agentId=$agentId
  challenge=$Challenge.ToLowerInvariant()
  result='BLOCKED'
  summaryCode=$summaryCode
  responseSha256=(Get-Sha256 $answer)
  sessionSha256=(Get-Sha256 "local-ollama-qa:$nonce")
}
[pscustomobject]@{
  status='PASS_LOCAL_DIAGNOSTIC'
  sourceKind=$sourceKind
  model=$model
  durationMs=[int][math]::Round($clock.Elapsed.TotalMilliseconds)
  proofLevel=$proofLevel
  observation=$observation
  signed=$false
  operationalVerified=$false
  independentFinalAckVerified=$false
  testData='OPERATOR_SUPPLIED_FINDINGS_NOT_SIGNED'
} | ConvertTo-Json -Compress -Depth 7
