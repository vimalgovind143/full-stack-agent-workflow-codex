[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$Destination = $(if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $env:USERPROFILE '.codex' }),
    [switch]$Force
)
$ErrorActionPreference = 'Stop'
$Destination = [IO.Path]::GetFullPath($Destination)
$sourceRoot = $PSScriptRoot
$sourceFiles = @(foreach ($folder in @('skills','agents')) {
    Get-ChildItem -LiteralPath (Join-Path $sourceRoot $folder) -File -Recurse |
        Where-Object { $_.FullName -notmatch '[\\/]data[\\/]' }
})
$conflicts = @()
foreach ($sourceFile in $sourceFiles) {
    $relative = $sourceFile.FullName.Substring($sourceRoot.Length + 1)
    $target = Join-Path $Destination $relative
    if (Test-Path -LiteralPath $target) {
        if ((Get-FileHash -LiteralPath $target).Hash -ne (Get-FileHash -LiteralPath $sourceFile.FullName).Hash) { $conflicts += $relative }
    }
}
if ($conflicts.Count -and -not $Force) {
    throw ('Different existing files found. Review them and rerun with -Force to back up and replace only these files: ' + ($conflicts -join ', '))
}
$backupRoot = Join-Path $Destination ('workflow-backups\' + [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss-fffffff'))
foreach ($sourceFile in $sourceFiles) {
    $relative = $sourceFile.FullName.Substring($sourceRoot.Length + 1)
    $target = Join-Path $Destination $relative
    if ((Test-Path -LiteralPath $target) -and ((Get-FileHash -LiteralPath $target).Hash -eq (Get-FileHash -LiteralPath $sourceFile.FullName).Hash)) { continue }
    if ($PSCmdlet.ShouldProcess($target, 'Install workflow file')) {
        if (Test-Path -LiteralPath $target) {
            $backup = Join-Path $backupRoot $relative
            New-Item -ItemType Directory -Path (Split-Path $backup -Parent) -Force | Out-Null
            Copy-Item -LiteralPath $target -Destination $backup
        }
        New-Item -ItemType Directory -Path (Split-Path $target -Parent) -Force | Out-Null
        Copy-Item -LiteralPath $sourceFile.FullName -Destination $target -Force
    }
}
Write-Output ('Workflow install processed for ' + $Destination + '. Start a fresh Codex task to load profiles.')
if ($conflicts.Count) { Write-Output ('Replaced-file backups: ' + $backupRoot) }