# Preview by default. Add -Execute only after reviewing the listed paths.
[CmdletBinding()]
param([switch]$Execute)
$ErrorActionPreference = 'Stop'
$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$releaseParent = Join-Path $workspace 'releases\v0.1.0'
$latestFile = Join-Path $workspace 'releases\latest.txt'
$latestLine = Get-Content -LiteralPath $latestFile | Where-Object { $_ -like 'SHA256: *' }
if (!$latestLine) { throw 'Missing current release record; cleanup aborted.' }
$latest = [IO.Path]::GetFullPath((Split-Path $latestLine.Substring(8)))
if (!$latest.StartsWith($releaseParent + '\', [StringComparison]::OrdinalIgnoreCase) -or !(Test-Path -LiteralPath $latest -PathType Container)) { throw 'Current release path is invalid; cleanup aborted.' }
$releases = @(Get-ChildItem -LiteralPath $releaseParent -Directory | Where-Object { $_.Name -match '^\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}-\d+$' } | Sort-Object Name -Descending)
$previous = $releases | Where-Object { $_.FullName -ne $latest } | Select-Object -First 1
$protected = @($latest)
if ($previous) { $protected += $previous.FullName }
$targets = [Collections.Generic.List[string]]::new()
foreach ($name in @('out', 'build-out', '.vite', 'coverage')) {
  $candidate = Join-Path $workspace $name
  if (Test-Path -LiteralPath $candidate) { $targets.Add($candidate) }
}
foreach ($release in $releases) { if ($release.FullName -notin $protected) { $targets.Add($release.FullName) } }
$evidence = Join-Path $workspace 'test-output'
$keepEvidence = @('api-guide-check.log', 'api-guide-quick-help.png', 'cleanup-report.txt', 'cleanup-preview.txt')
if (Test-Path -LiteralPath $evidence) {
  Get-ChildItem -LiteralPath $evidence -Force | Where-Object { $_.Name -notin $keepEvidence } | ForEach-Object { $targets.Add($_.FullName) }
}
# Validate every final absolute path before any mutation. Never follow links.
$safe = [Collections.Generic.List[string]]::new()
foreach ($target in $targets) {
  $resolved = [IO.Path]::GetFullPath((Resolve-Path -LiteralPath $target).Path)
  if (!$resolved.StartsWith($workspace + '\', [StringComparison]::OrdinalIgnoreCase)) { throw ('Path escapes workspace: ' + $resolved) }
  foreach ($keep in $protected) {
    if ($resolved -eq $keep -or $keep.StartsWith($resolved + '\', [StringComparison]::OrdinalIgnoreCase)) { throw ('Path contains retained release: ' + $resolved) }
  }
  $item = Get-Item -LiteralPath $resolved -Force
  if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { Write-Warning ('Preserving link: ' + $resolved); continue }
  if ($item.PSIsContainer -and @(Get-ChildItem -LiteralPath $resolved -Recurse -Force -Attributes ReparsePoint).Count) { Write-Warning ('Preserving directory containing links: ' + $resolved); continue }
  $safe.Add($resolved)
}
$bytes = [long]0; $fileCount = [long]0; $count = 0
foreach ($target in $safe) {
  # Refresh before each target; never terminate a running application.
  $live = @(Get-CimInstance Win32_Process -Filter "Name = 'Matheca.exe' OR Name = 'Mathector.exe'" | ForEach-Object { $_.ExecutablePath } | Where-Object { $_ })
  if (@($live | Where-Object { $_ -eq $target -or $_.StartsWith($target + '\', [StringComparison]::OrdinalIgnoreCase) }).Count) { Write-Warning ('Preserving running application: ' + $target); continue }
  $item = Get-Item -LiteralPath $target -Force
  if ($item.PSIsContainer) {
    $measure = Get-ChildItem -LiteralPath $target -Recurse -File -Force | Measure-Object -Property Length -Sum
    $size = [long]$measure.Sum; $files = [long]$measure.Count
  } else { $size = [long]$item.Length; $files = 1 }
  if ($Execute) { Remove-Item -LiteralPath $target -Recurse -Force -ErrorAction Stop }
  $label = if ($Execute) { 'Removed: ' } else { 'Preview: ' }
  Write-Output ($label + $target)
  $bytes += $size; $fileCount += $files; $count++
}
Write-Output ('Retain current release: ' + $latest)
if ($previous) { Write-Output ('Retain previous release: ' + $previous.FullName) }
Write-Output ('Targets: ' + $count + '; files: ' + $fileCount + '; GiB: ' + [Math]::Round($bytes / 1GB, 2))
if (!$Execute) { Write-Output 'No files were deleted. Review this list, then rerun with -Execute if desired.' }
