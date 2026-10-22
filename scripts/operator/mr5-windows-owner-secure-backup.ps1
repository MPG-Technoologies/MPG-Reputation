#requires -Version 5.1
<#
.SYNOPSIS
MR-5I22 Phase A: owner-workstation-only guarded backup wrapper.
Default PRECHECK ONLY; -Execute requires the private encrypted fixed disk,
restricted NTFS ACLs and the existing exact-project backup operator.
Never use in CI/cloud browsers or paste PgPass contents into chat.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$BackupDirectory,
  [Parameter(Mandatory=$true)][string]$PasswordFile,
  [switch]$Execute
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Stop-Safely {
  # Do not disclose local file paths, DB connection settings or credential values.
  Write-Error 'MR5I22_BACKUP_STOP: security requirements or private operator failed; no hosted schema change was attempted.'
  exit 1
}

function Assert-PrivateWindowsPath([string]$InputPath, [bool]$IsDirectory, [bool]$AllowInheritedAcl = $false) {
  if (-not [System.IO.Path]::IsPathRooted($InputPath)) { throw 'PRIVATE_ABSOLUTE_PATH_REQUIRED' }
  $item = Get-Item -LiteralPath $InputPath -Force -ErrorAction Stop
  if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw 'REPARSE_PATH_NOT_ALLOWED'
  }
  if ($IsDirectory -and -not $item.PSIsContainer) { throw 'DIRECTORY_REQUIRED' }
  if (-not $IsDirectory -and $item.PSIsContainer) { throw 'FILE_REQUIRED' }
  $full = $item.FullName
  # Reject directory junctions, symbolic links and reparse-point ancestors:
  # the apparent encrypted drive must be the drive actually holding the bytes.
  $probe = $full
  while ($probe) {
    $probeItem = Get-Item -LiteralPath $probe -Force -ErrorAction Stop
    if (($probeItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
      throw 'REPARSE_ANCESTOR_NOT_ALLOWED'
    }
    $parent = [System.IO.Path]::GetDirectoryName($probe.TrimEnd('\'))
    if (-not $parent -or $parent -eq $probe) { break }
    $probe = $parent
  }
  $root = [System.IO.Path]::GetPathRoot($full)
  if (-not $root -or $root.StartsWith('\\')) { throw 'NETWORK_PATH_FORBIDDEN' }
  if ($full.TrimEnd('\') -eq $root.TrimEnd('\')) { throw 'VOLUME_ROOT_FORBIDDEN' }
  $drive = [System.IO.DriveInfo]::new($root)
  if ($drive.DriveType -ne [System.IO.DriveType]::Fixed) { throw 'FIXED_LOCAL_DRIVE_REQUIRED' }
  if (-not (Get-Command Get-BitLockerVolume -ErrorAction SilentlyContinue)) {
    throw 'BITLOCKER_STATUS_UNAVAILABLE'
  }
  $volume = Get-BitLockerVolume -MountPoint ($root.TrimEnd('\')) -ErrorAction Stop
  if ($null -eq $volume -or
      [string]$volume.ProtectionStatus -ne 'On' -or
      [string]$volume.VolumeStatus -ne 'FullyEncrypted') {
    throw 'BITLOCKER_PROTECTION_NOT_VERIFIED'
  }

  $acl = Get-Acl -LiteralPath $full -ErrorAction Stop
  # Preexisting output root and password file MUST have protected ACLs.
  # Newly created archive/package children inherit ONLY the already checked
  # restricted parent ACL; allow inheritance but still inspect every allow ACE.
  if (-not $AllowInheritedAcl -and -not $acl.AreAccessRulesProtected) {
    throw 'INHERITED_ACL_NOT_PERMITTED'
  }
  $currentSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  $allowedSids = @($currentSid, 'S-1-5-18', 'S-1-5-32-544') # Current user, SYSTEM, Administrators.
  $ownerSid = $acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value
  if ($allowedSids -notcontains $ownerSid) { throw 'UNEXPECTED_FILE_OWNER' }
  foreach ($ace in $acl.Access) {
    if ($ace.AccessControlType -ne [System.Security.AccessControl.AccessControlType]::Allow) { continue }
    $sid = $ace.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value
    if ($allowedSids -notcontains $sid) { throw 'UNAPPROVED_NTFS_ACCESS_PRINCIPAL' }
  }
  return $full
}

try {
  if ([System.Environment]::OSVersion.Platform -ne [System.PlatformID]::Win32NT) {
    throw 'WINDOWS_WORKSTATION_ONLY'
  }
  foreach ($name in @('CI','GITHUB_ACTIONS','VERCEL','VERCEL_ENV','SUPABASE_ACCESS_TOKEN')) {
    if ([System.Environment]::GetEnvironmentVariable($name)) {
      throw 'CLOUD_OR_CI_ENVIRONMENT_FORBIDDEN'
    }
  }
  $scriptRoot = (Resolve-Path -LiteralPath $PSScriptRoot).Path
  $repoRoot = (Resolve-Path -LiteralPath (Join-Path $scriptRoot '..\..')).Path
  $nodeOperator = Join-Path $scriptRoot 'mr5-hosted-backup.mjs'
  $integrityOperator = Join-Path $scriptRoot 'mr5-offline-backup-integrity.mjs'
  if (-not (Test-Path -LiteralPath $nodeOperator -PathType Leaf) -or
      -not (Test-Path -LiteralPath $integrityOperator -PathType Leaf)) {
    throw 'GUARDED_OPERATOR_NOT_FOUND'
  }

  $privateOutput = Assert-PrivateWindowsPath $BackupDirectory $true
  $privatePassword = Assert-PrivateWindowsPath $PasswordFile $false
  $repoPrefix = $repoRoot.TrimEnd('\') + '\'
  if ($privateOutput.StartsWith($repoPrefix,[System.StringComparison]::OrdinalIgnoreCase) -or
      $privatePassword.StartsWith($repoPrefix,[System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'PRIVATE_FILES_WITHIN_CHECKOUT'
  }
  $env:PGPASSFILE = $privatePassword
  # No passwords in command line, in chat, or in environment variables.
  if ($env:PGPASSWORD -or $env:DATABASE_URL -or $env:SUPABASE_DB_URL) {
    throw 'UNSAFE_CONNECTION_CREDENTIALS_PRESENT'
  }
  $common = @($nodeOperator,
    '--project-ref','awvqtwkzprygsoyfspuz',
    '--confirm-project','awvqtwkzprygsoyfspuz',
    '--output-dir',$privateOutput)
  if (-not $Execute) {
    & node @common
    if ($LASTEXITCODE -ne 0) { throw 'OPERATOR_PREFLIGHT_FAILED' }
    Write-Output 'MR5I22_ENCRYPTION_AND_NTFS_PREFLIGHT_PASS'
    Write-Output 'NO_BACKUP_CREATED. To execute, separately add -Execute in this owner workstation.'
    exit 0
  }

  # Fail closed on unexpected concurrent additions: do not guess which archive
  # belongs to this invocation or scan its contents.
  $before = @((Get-ChildItem -LiteralPath $privateOutput -Directory -Force |
    ForEach-Object { $_.FullName }))
  & node @common '--execute'
  if ($LASTEXITCODE -ne 0) { throw 'GUARDED_BACKUP_EXECUTION_FAILED' }
  $newFolders = @((Get-ChildItem -LiteralPath $privateOutput -Directory -Force |
    Where-Object { $before -notcontains $_.FullName }))
  if ($newFolders.Count -ne 1) { throw 'EXPECTED_SINGLE_NEW_PRIVATE_BACKUP_PACKAGE' }
  $package = Assert-PrivateWindowsPath $newFolders[0].FullName $true $true
  $archive = Assert-PrivateWindowsPath (Join-Path $package 'postgresql-17.backup') $false $true
  $manifest = Assert-PrivateWindowsPath (Join-Path $package 'manifest.json') $false $true

  # Backup correctness remains distinct from actual RESTORABILITY.
  & node $integrityOperator '--backup-dir' $package '--verify'
  if ($LASTEXITCODE -ne 0) { throw 'OFFLINE_BACKUP_INTEGRITY_RECHECK_FAILED' }
  Write-Output 'MR5I22_OWNER_ENCRYPTED_VOLUME_BACKUP_INTEGRITY_PASS'
  Write-Output 'RESTORE_NOT_VERIFIED; no migrations or database restore were performed.'
  Write-Output 'KEEP_ARCHIVE_AND_MANIFEST_PRIVATE. Do not upload them to ChatGPT/GitHub/CI.'
}
catch {
  Stop-Safely
}
