param(
    [string]$SdkPath = $env:ANDROID_HOME,
    [switch]$SkipBuild
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($SdkPath)) { $SdkPath = Join-Path $env:LOCALAPPDATA 'Android\Sdk' }
$adb = Join-Path $SdkPath 'platform-tools\adb.exe'
if (!(Test-Path -LiteralPath $adb)) { throw 'Set -SdkPath to an installed Android SDK.' }
if ([string]::IsNullOrWhiteSpace($env:JAVA_HOME)) {
    $bundledJava = Join-Path $env:ProgramFiles 'Android\Android Studio\jbr'
    if (Test-Path -LiteralPath $bundledJava) { $env:JAVA_HOME = $bundledJava }
}
Push-Location $projectRoot
try {
    if (!$SkipBuild) {
        & .\gradlew.bat :app:assembleDebug :app:testDebugUnitTest :app:assembleDebugAndroidTest --console=plain
        if ($LASTEXITCODE -ne 0) { throw 'Android build failed.' }
    }
    & $adb install -r app\build\outputs\apk\debug\app-debug.apk
    if ($LASTEXITCODE -ne 0) { throw 'Application installation failed.' }
    & $adb install -r app\build\outputs\apk\androidTest\debug\app-debug-androidTest.apk
    if ($LASTEXITCODE -ne 0) { throw 'Test installation failed.' }
    New-Item -ItemType Directory -Path artifacts -Force | Out-Null
    $testOutput = & $adb shell am instrument -w com.matheca.app.test/androidx.test.runner.AndroidJUnitRunner
    $testOutput | Tee-Object -FilePath artifacts\instrumentation-results.txt
    if (($testOutput -join "`n") -notmatch '(?m)^OK \(\d+ tests?\)') { throw 'Device tests failed; inspect artifacts/instrumentation-results.txt.' }
} finally { Pop-Location }
