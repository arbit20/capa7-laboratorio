$ErrorActionPreference = 'Stop'
$labRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')).TrimEnd('\')
$labUrl = 'http://127.0.0.1:4173'
$labHealthUrl = "$labUrl/__health"

function Get-LabHealth {
  try { return Invoke-RestMethod -Uri $labHealthUrl -TimeoutSec 2 -ErrorAction Stop } catch { return $null }
}

try {
  if (-not (Test-Path -LiteralPath (Join-Path $labRoot 'dist\index.html'))) {
    throw 'Falta la compilación dist. Abre una terminal en esta carpeta y ejecuta npm install y npm run build.'
  }
  $existingLab = Get-LabHealth
  if ($null -ne $existingLab) {
    if ($existingLab.app -eq 'capa7-laboratorio' -and $existingLab.workspaceRoot.TrimEnd('\') -eq $labRoot) {
      Start-Process $labUrl
      Write-Host 'Se abrió el laboratorio que ya estaba iniciado.'
      exit 0
    }
    throw 'El puerto 4173 pertenece a otra aplicación o a otra copia del laboratorio. No se cerró ningún proceso.'
  }
  $labSocket = New-Object System.Net.Sockets.TcpClient
  try {
    $connection = $labSocket.BeginConnect('127.0.0.1', 4173, $null, $null)
    if ($connection.AsyncWaitHandle.WaitOne(400)) {
      try { $labSocket.EndConnect($connection) } catch { }
    }
    if ($labSocket.Connected) { throw 'El puerto 4173 está ocupado por otro servicio. No se cerró ningún proceso.' }
  } finally { $labSocket.Dispose() }
  $labNode = Get-Command node -ErrorAction SilentlyContinue
  if ($null -eq $labNode) { throw 'No se encontró Node.js. Instala Node.js 22.12 o posterior y vuelve a abrir este iniciador.' }
  $logDirectory = Join-Path $labRoot '.local'
  New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
  $labProcess = Start-Process -FilePath $labNode.Source -ArgumentList '"scripts/serve.mjs"' -WorkingDirectory $labRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logDirectory 'server.log') -RedirectStandardError (Join-Path $logDirectory 'server-error.log')
  $ready = $false
  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    Start-Sleep -Milliseconds 200
    if ($labProcess.HasExited) { throw 'El servidor no pudo iniciar. Consulta .local\server-error.log.' }
    $health = Get-LabHealth
    if ($health.app -eq 'capa7-laboratorio' -and $health.workspaceRoot.TrimEnd('\') -eq $labRoot) { $ready = $true; break }
  }
  if (-not $ready) { throw 'No se pudo confirmar el inicio. Consulta .local\server-error.log.' }
  Set-Content -LiteralPath (Join-Path $logDirectory 'server.pid') -Value $labProcess.Id -Encoding ascii
  Start-Process $labUrl
  Write-Host "Laboratorio iniciado en $labUrl"
} catch {
  Write-Host $_.Exception.Message -ForegroundColor Red
  exit 1
}
