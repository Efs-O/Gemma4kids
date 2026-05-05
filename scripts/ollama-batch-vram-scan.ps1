# Measure GPU memory around a long gemma4:e4b /api/generate with varying num_batch.
# Requires: Ollama on localhost:11434, nvidia-smi, model gemma4:e4b pulled.

param(
    [string] $Model = 'gemma4:e4b',
    [string] $BaseUrl = 'http://localhost:11434'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-GpuMiBUsed {
    $line = & nvidia-smi -i 0 --query-gpu=memory.used --format=csv,noheader,nounits 2>$null
    return [int](($line | Select-Object -First 1).ToString().Trim())
}

function Invoke-OllamaUnload {
    param([string] $M)
    $unload = @{ model = $M; prompt = 'x'; stream = $false; keep_alive = 0; options = @{ num_predict = 1 } } |
        ConvertTo-Json -Depth 5 -Compress
    try {
        Invoke-RestMethod -Uri "$BaseUrl/api/generate" -Method Post -Body $unload -ContentType 'application/json; charset=utf-8' |
            Out-Null
    } catch {
        Write-Warning "Unload keep_alive=0 request warning: $($_.Exception.Message)"
    }
    Start-Sleep -Seconds 6
}

$batches = @(64, 128, 256, 512, 1024)
# Short filler (~4--6k chars total) — enough to exercise prefill, keeps runs snappy.
$sentence = 'The quick brown fox jumps over the lazy dog numbered ' + "$(Get-Random).`n"
$unit = $sentence * 85

$longPrompt = @"
You must output exactly one ASCII letter Z and nothing else. No preamble.
Repeated reference material follows (IGNORE for content):

$unit
"@

foreach ($nb in $batches) {
    Write-Host "`n======== num_batch=$nb ========"
    Invoke-OllamaUnload -M $Model
    Start-Sleep -Seconds 2
    $baseline = Get-GpuMiBUsed
    Write-Host "Baseline (after unload): $baseline MiB"

    $peakJob = Start-Job -ScriptBlock {
        param($GpuIndex)
        $max = 0
        for ($i = 0; $i -lt 200; $i++) {
            try {
                $line = & nvidia-smi -i $GpuIndex --query-gpu=memory.used --format=csv,noheader,nounits 2>$null
                $v = [int](($line | Select-Object -First 1).ToString().Trim())
                if ($v -gt $max) { $max = $v }
            } catch {}
            Start-Sleep -Milliseconds 100
        }
        return $max
    } -ArgumentList (0)

    Start-Sleep -Milliseconds 400

    $body = @{
        model    = $Model
        prompt   = $longPrompt
        stream   = $false
        keep_alive = '45s'
        options  = @{
            num_batch    = $nb
            num_predict  = 2
            num_ctx      = 65536
        }
    } | ConvertTo-Json -Depth 6 -Compress

    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $ok = $true
    $err = ''
    try {
        $resp = Invoke-RestMethod -Uri "$BaseUrl/api/generate" -Method Post -Body $body -ContentType 'application/json; charset=utf-8'
    } catch {
        $ok = $false
        $err = $_.Exception.Message
        $resp = $null
    }
    $sw.Stop()

    Wait-Job $peakJob -Timeout 20 | Out-Null
    $peak = Receive-Job $peakJob -ErrorAction SilentlyContinue
    Remove-Job $peakJob -Force -ErrorAction SilentlyContinue

    Start-Sleep -Seconds 3
    $after = Get-GpuMiBUsed

    Write-Host "Request ms: $($sw.ElapsedMilliseconds)  prompt_eval_count: $($resp.prompt_eval_count)  eval_count: $($resp.eval_count)"
    if (-not $ok) { Write-Host "REQUEST FAILED: $err" -ForegroundColor Red }
    Write-Host "Sampled peak (100ms polling, max ~20s window): $peak MiB"
    Write-Host "GPU memory.used ~3s after request: $after MiB"
    Write-Host "Delta peak vs baseline: $($peak - $baseline) MiB | Delta after vs baseline: $($after - $baseline) MiB"
}

Invoke-OllamaUnload -M $Model
Write-Host "`nDone. Final GPU memory.used: $(Get-GpuMiBUsed) MiB"
