'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const installer=fs.readFileSync(path.join(__dirname,'../obsidian-plugin/wechat-inbox-sync/local-asr/install-local-asr.ps1'),'utf8');
assert.equal((installer.match(/function Complete-InstallerCleanup/g)||[]).length,1);
assert.ok(installer.includes('Complete-InstallerCleanup -TemporaryRoot $TempRoot -Mutex $installMutex'));
if(process.platform==='win32'){
 const script=String.raw`$ErrorActionPreference='Stop'
$source=[IO.File]::ReadAllText('SOURCE_PATH')
$tokens=$null;$parseErrors=$null
$ast=[Management.Automation.Language.Parser]::ParseInput($source,[ref]$tokens,[ref]$parseErrors)
if($parseErrors.Count){throw ($parseErrors|Out-String)}
$fn=$ast.Find({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Complete-InstallerCleanup'},$true)
Invoke-Expression $fn.Extent.Text
function Test-Path {param($LiteralPath) return $true}
function Get-Item {param($LiteralPath,[switch]$Force) return @{Attributes=$script:attributes}}
function Remove-Item {param($LiteralPath,[switch]$Recurse,[switch]$Force,$ErrorAction) $script:deletes++;if($script:deny){throw [UnauthorizedAccessException]::new('ffplay.exe denied')}}
function Start-Sleep {param($Milliseconds)}
function Release-InstallLock {param($Mutex) $script:released++;if($script:releaseFails){throw 'release denied'}}
$owned=Join-Path $env:TEMP ('wechat-inbox-local-asr-install-'+('a'*32))
foreach($deny in @($false,$true)){
 $script:deny=$deny;$script:attributes=0;$script:deletes=0;$script:released=0;$script:releaseFails=$false
 Complete-InstallerCleanup -TemporaryRoot $owned -Mutex $null 3>$null
 if($script:released -ne 1){throw 'lock not released'}
 if($script:deletes -ne $(if($deny){3}else{1})){throw 'retry mismatch'}
}
$script:deletes=0;$script:released=0
Complete-InstallerCleanup -TemporaryRoot $env:TEMP -Mutex $null 3>$null
if($script:deletes -ne 0 -or $script:released -ne 1){throw 'unsafe path deletion'}
$script:attributes=[IO.FileAttributes]::ReparsePoint;$script:released=0
Complete-InstallerCleanup -TemporaryRoot $owned -Mutex $null 3>$null
if($script:deletes -ne 0 -or $script:released -ne 1){throw 'reparse deletion'}
$script:attributes=0;$script:deny=$true;$script:releaseFails=$true
$seen=''
try{try{throw 'PRIMARY_INSTALL_FAILURE'}finally{Complete-InstallerCleanup -TemporaryRoot $owned -Mutex $null 3>$null}}catch{$seen=$_.Exception.Message}
if($seen -ne 'PRIMARY_INSTALL_FAILURE'){throw 'primary error replaced'}
Write-Output 'PowerShell AST and cleanup fault injection passed'
`.replace('SOURCE_PATH',path.join(__dirname,'../obsidian-plugin/wechat-inbox-sync/local-asr/install-local-asr.ps1').replaceAll("'","''"));
 const result=cp.spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{encoding:'utf8',windowsHide:true,timeout:30000});
 assert.equal(result.status,0,result.stdout+'\n'+result.stderr);console.log(result.stdout.trim());
}
console.log('Installer finalization checks passed');