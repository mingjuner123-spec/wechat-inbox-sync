param(
  [Parameter(Mandatory = $true)][string]$SourceRoot,
  [Parameter(Mandatory = $true)][string]$EvidenceRoot
)

$ErrorActionPreference = 'Stop'
$sourceCommit = '86c40c3bd6fc86f1187fb751d111b49e0fc18e84'
$whisperSource = Join-Path $SourceRoot 'src\whisper.cpp'
$speechSource = Join-Path $SourceRoot 'examples\vad-speech-segments\speech.cpp'
$whisper = [System.IO.File]::ReadAllText($whisperSource)
$speech = [System.IO.File]::ReadAllText($speechSource)

if ((git -C $SourceRoot rev-parse HEAD).Trim() -ne $sourceCommit) { throw 'whisper_source_commit_mismatch' }
$modelPathPattern = '(?s)#ifdef _MSC_VER\s+std::wstring_convert\s*<\s*std::codecvt_utf8\s*<\s*wchar_t\s*>\s*>\s+converter;\s+std::wstring\s+path_model_wide\s*=\s*converter\.from_bytes\(path_model\);\s+auto\s+fin\s*=\s*std::ifstream\(path_model_wide,\s*std::ios::binary\);'
$modelPathMatches = [regex]::Matches($whisper, $modelPathPattern)
if ($modelPathMatches.Count -ne 1) { throw 'pinned_utf8_model_open_source_pattern_mismatch' }

$mainPattern = 'int main\(int argc, char \*\* argv\)\s*\{'
if ([regex]::Matches($speech, $mainPattern).Count -ne 1) { throw 'pinned_vad_main_signature_mismatch' }
if ([regex]::Matches($speech, '(?m)^#include <string>\s*$').Count -ne 1) { throw 'pinned_vad_string_include_mismatch' }
if ($speech.Contains('windows_wide_arg_to_utf8') -or $speech.Contains('int wmain(')) { throw 'pinned_vad_source_already_patched' }

$windowsIncludes = @'
#include <string>
#ifdef _WIN32
#ifndef NOMINMAX
#define NOMINMAX
#endif
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
#include <cstddef>
#include <vector>
#endif
'@
$patched = [regex]::Replace($speech, '(?m)^#include <string>\s*$', $windowsIncludes.TrimEnd(), 1)
$patched = [regex]::Replace($patched, $mainPattern, 'static int run_vad_cli(int argc, char ** argv) {', 1)
if (-not $patched.TrimEnd().EndsWith('}')) { throw 'pinned_vad_source_end_mismatch' }

$entryPoint = @'

#ifdef _WIN32
static bool windows_wide_arg_to_utf8(const wchar_t * source, std::string & target) {
    if (source == nullptr) return false;
    const int requiredBytes = WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, source, -1, nullptr, 0, nullptr, nullptr);
    if (requiredBytes <= 0) return false;
    std::vector<char> buffer(static_cast<std::size_t>(requiredBytes));
    const int convertedBytes = WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, source, -1, buffer.data(), requiredBytes, nullptr, nullptr);
    if (convertedBytes != requiredBytes) return false;
    target.assign(buffer.data(), static_cast<std::size_t>(convertedBytes - 1));
    return true;
}

int wmain(int argc, wchar_t ** wideArgv) {
    if (argc < 1 || wideArgv == nullptr) {
        fprintf(stderr, "error: invalid Windows command line\n");
        return 10;
    }
    std::vector<std::string> utf8Storage;
    std::vector<char *> utf8Argv;
    utf8Storage.reserve(static_cast<std::size_t>(argc));
    utf8Argv.reserve(static_cast<std::size_t>(argc) + 1);
    for (int i = 0; i < argc; ++i) {
        std::string converted;
        if (!windows_wide_arg_to_utf8(wideArgv[i], converted)) {
            fprintf(stderr, "error: Windows command-line argument is not valid Unicode\n");
            return 10;
        }
        utf8Storage.push_back(converted);
        utf8Argv.push_back(const_cast<char *>(utf8Storage.back().c_str()));
    }
    utf8Argv.push_back(nullptr);
    return run_vad_cli(argc, utf8Argv.data());
}
#else
int main(int argc, char ** argv) {
    return run_vad_cli(argc, argv);
}
#endif
'@
$patched = $patched.TrimEnd() + $entryPoint + "`n"

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($speechSource, $patched, $utf8NoBom)
$sourceLine = ($whisper.Substring(0, $modelPathMatches[0].Index).Split("`n").Length)
$patchScriptHash = (Get-FileHash -LiteralPath $PSCommandPath -Algorithm SHA256).Hash.ToLowerInvariant()
$report = @(
  "status=PASS",
  "upstream=ggml-org/whisper.cpp@$sourceCommit",
  "model_open_file=src/whisper.cpp:$sourceLine; MSVC UTF-8 bytes converted to wide path before ifstream",
  "entrypoint=Windows wmain receives UTF-16 argv and converts each argument to UTF-8",
  "conversion=WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS), length queried with terminator included",
  "non_windows_entrypoint=unchanged main(int,char**) wrapper",
  "ggml_or_cpu_settings_changed=false",
  "patchScriptSha256=$patchScriptHash"
) -join "`n"
New-Item -ItemType Directory -Force -Path $EvidenceRoot | Out-Null
Set-Content -LiteralPath (Join-Path $EvidenceRoot 'windows-vad-utf8-source-evidence.txt') -Value $report -Encoding utf8
Write-Output 'PASS applied Windows UTF-8 argv patch to pinned VAD example'
