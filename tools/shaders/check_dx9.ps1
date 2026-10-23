# Compila o HLSL gerado por tools/shaders/check.sh com o compilador da Microsoft (fxc.exe do
# Windows SDK), nos perfis do DirectX 9: vs_3_0 para o vertex shader e ps_3_0 para os passes.
# Uso: pwsh tools/shaders/check_dx9.ps1 <pasta com os .hlsl>
param([Parameter(Mandatory = $true)][string]$Dir)
$ErrorActionPreference = "Stop"

$fxc = Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin\*\x64\fxc.exe" -ErrorAction SilentlyContinue |
  Sort-Object FullName -Descending | Select-Object -First 1
if (-not $fxc) { throw "fxc.exe (Windows SDK) não encontrado" }
Write-Host "usando $($fxc.FullName)"

$files = Get-ChildItem $Dir -Filter *.hlsl
if ($files.Count -eq 0) { throw "nenhum .hlsl em $Dir" }
$failed = @()
foreach ($f in $files) {
  $entry = ($f.BaseName -split "__", 2)[1]
  $target = if ($entry -like "*_VS") { "vs_3_0" } else { "ps_3_0" }
  $out = & $fxc.FullName /nologo /O3 /T $target /E "E__$entry" /Fo "$($f.FullName).cso" $f.FullName 2>&1
  if ($LASTEXITCODE -ne 0) {
    $failed += $f.Name
    $msg = ($out | Out-String) -replace "%", "%25" -replace "`r", "" -replace "`n", "%0A"
    Write-Host "::error title=DX9 $($f.Name)::$msg"
  } else {
    Write-Host "ok  $target  $($f.Name)"
  }
}
if ($failed.Count -gt 0) { throw "$($failed.Count) passe(s) não compilam para DirectX 9" }
Write-Host "todos os $($files.Count) passes compilam para Shader Model 3"
