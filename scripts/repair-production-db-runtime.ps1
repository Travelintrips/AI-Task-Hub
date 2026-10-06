param(
  [string]$ProjectRef = "nzdweipzckfszczzqtuw",
  [string]$Repository = "Travelintrips/AI-Task-Hub",
  [string]$Environment = "production",
  [string]$PoolerHost = "aws-1-ap-southeast-2.pooler.supabase.com"
)

$ErrorActionPreference = "Stop"

if (-not (Get-Command npx -ErrorAction SilentlyContinue)) { throw "npx is required" }
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) { throw "GitHub CLI (gh) is required" }

$bytes = New-Object byte[] 32
$rng = [Security.Cryptography.RandomNumberGenerator]::Create()
try {
  $rng.GetBytes($bytes)
} finally {
  $rng.Dispose()
}
$password = (($bytes | ForEach-Object { $_.ToString("x2") }) -join "")

try {
  $sql = "alter role ai_task_runtime_login with login password '$password' valid until 'infinity';"
  & npx -y supabase@latest db query --project-ref $ProjectRef --linked $sql *> $null
  if ($LASTEXITCODE -ne 0) { throw "Supabase database role rotation failed" }

  $databaseUrl = "postgresql://ai_task_runtime_login.${ProjectRef}:${password}@${PoolerHost}:5432/postgres"
  $databaseUrl | gh secret set SUPABASE_DATABASE_URL --env $Environment -R $Repository
  if ($LASTEXITCODE -ne 0) { throw "Failed to store SUPABASE_DATABASE_URL in GitHub environment" }

  Write-Output "AI Task production database credential rotated and GitHub environment secret updated."
} finally {
  $password = $null
  $databaseUrl = $null
}
