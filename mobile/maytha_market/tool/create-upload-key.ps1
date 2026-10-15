# Creates the Google Play upload key for MAYTHA MARKET, once, on the owner's own computer.
#
# - The keystore is written OUTSIDE the repository: %USERPROFILE%\.maytha\maytha-upload.jks
# - You type the password yourself; it is never printed or stored in the repository.
# - android\key.properties (gitignored) is written so release builds are signed with this key.
# - Back up the .jks file and the password somewhere safe (e.g. a password manager). If you lose
#   them you must ask Google Play support to reset the upload key.
#
# Run from mobile\maytha_market:   powershell -ExecutionPolicy Bypass -File tool\create-upload-key.ps1

$ErrorActionPreference = "Stop"

$keytool = (Get-Command keytool -ErrorAction SilentlyContinue).Source
if (-not $keytool -and $env:JAVA_HOME) { $keytool = Join-Path $env:JAVA_HOME "bin\keytool.exe" }
if (-not $keytool -or -not (Test-Path $keytool)) {
  throw "keytool not found. Install a JDK (17 or newer) or set JAVA_HOME."
}

$dir = Join-Path $env:USERPROFILE ".maytha"
$store = Join-Path $dir "maytha-upload.jks"
$props = Join-Path $PSScriptRoot "..\android\key.properties"

if (Test-Path $store) { throw "An upload key already exists at $store. Keep using it; do not create a second one." }
New-Item -ItemType Directory -Force -Path $dir | Out-Null

$secure = Read-Host "Choose a strong keystore password (at least 8 characters)" -AsSecureString
$again = Read-Host "Type it again" -AsSecureString
$plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
$check = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($again))
if ($plain -ne $check) { throw "The passwords do not match." }
if ($plain.Length -lt 8) { throw "The password must have at least 8 characters." }

# The password reaches keytool through an environment variable, not the command line.
$env:MAYTHA_KEY_PASSWORD = $plain
try {
  & $keytool -genkeypair -v -keystore $store -storetype PKCS12 -alias upload `
    -keyalg RSA -keysize 2048 -validity 10000 `
    -storepass:env MAYTHA_KEY_PASSWORD -keypass:env MAYTHA_KEY_PASSWORD `
    -dname "CN=MAYTHA MARKET, O=MAYTHA MARKET, L=Maythaloun, C=PS"
  if ($LASTEXITCODE -ne 0) { throw "keytool failed." }

  $storeForGradle = $store -replace '\\', '/'
  @(
    "storePassword=$plain",
    "keyPassword=$plain",
    "keyAlias=upload",
    "storeFile=$storeForGradle"
  ) | Set-Content -Path $props -Encoding ascii

  Write-Host ""
  Write-Host "Upload key created: $store"
  Write-Host "Signing settings written to android\key.properties (gitignored)."
  Write-Host ""
  Write-Host "SHA-256 fingerprint of the upload key (for Play Console and ANDROID_APP_CERT_SHA256):"
  & $keytool -list -v -keystore $store -alias upload -storepass:env MAYTHA_KEY_PASSWORD |
    Select-String "SHA256:" | ForEach-Object { $_.Line.Trim() }
}
finally {
  Remove-Item Env:MAYTHA_KEY_PASSWORD -ErrorAction SilentlyContinue
}

Write-Host ""
Write-Host "Next: flutter build appbundle --release  (output: build\app\outputs\bundle\release\app-release.aab)"
Write-Host "Back up $store and the password now."
