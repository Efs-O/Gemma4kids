Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path

function New-Label($text, $x, $y, $w = 120, $h = 22) {
  $label = New-Object System.Windows.Forms.Label
  $label.Text = $text
  $label.Location = New-Object System.Drawing.Point($x, $y)
  $label.Size = New-Object System.Drawing.Size($w, $h)
  return $label
}

function New-TextBox($x, $y, $w, $h = 28) {
  $tb = New-Object System.Windows.Forms.TextBox
  $tb.Location = New-Object System.Drawing.Point($x, $y)
  $tb.Size = New-Object System.Drawing.Size($w, $h)
  return $tb
}

function New-Button($text, $x, $y, $w = 120, $h = 30) {
  $btn = New-Object System.Windows.Forms.Button
  $btn.Text = $text
  $btn.Location = New-Object System.Drawing.Point($x, $y)
  $btn.Size = New-Object System.Drawing.Size($w, $h)
  return $btn
}

function Append-Log($box, $text) {
  $box.AppendText($text)
  $box.SelectionStart = $box.TextLength
  $box.ScrollToCaret()
}

$form = New-Object System.Windows.Forms.Form
$form.Text = 'Gemma4kids Subtitle Tool'
$form.StartPosition = 'CenterScreen'
$form.Size = New-Object System.Drawing.Size(980, 760)
$form.MinimumSize = New-Object System.Drawing.Size(980, 760)
$form.BackColor = [System.Drawing.Color]::FromArgb(247, 241, 227)

$font = New-Object System.Drawing.Font('Segoe UI', 10)
$form.Font = $font

$title = New-Label 'Subtitle Tool' 24 20 400 34
$title.Font = New-Object System.Drawing.Font('Segoe UI', 20, [System.Drawing.FontStyle]::Bold)
$form.Controls.Add($title)

$subtitle = New-Label 'Standalone Gemma 4 E4B subtitle runner for the hackathon video.' 24 58 600 22
$subtitle.ForeColor = [System.Drawing.Color]::FromArgb(96, 96, 96)
$form.Controls.Add($subtitle)

$form.Controls.Add((New-Label 'Video' 24 110))
$videoBox = New-TextBox 24 134 760
$videoButton = New-Button 'Pick Video' 800 132 140
$form.Controls.Add($videoBox)
$form.Controls.Add($videoButton)

$form.Controls.Add((New-Label 'Cue Sheet (Optional)' 24 180 160 22))
$cueBox = New-TextBox 24 204 760
$cueButton = New-Button 'Pick JSON' 800 202 140
$form.Controls.Add($cueBox)
$form.Controls.Add($cueButton)

$form.Controls.Add((New-Label 'Glossary (Optional)' 24 250 160 22))
$glossaryBox = New-TextBox 24 274 760
$glossaryButton = New-Button 'Pick JSON' 800 272 140
$form.Controls.Add($glossaryBox)
$form.Controls.Add($glossaryButton)

$form.Controls.Add((New-Label 'Output Folder' 24 320 160 22))
$outputBox = New-TextBox 24 344 760
$outputButton = New-Button 'Pick Folder' 800 342 140
$form.Controls.Add($outputBox)
$form.Controls.Add($outputButton)

$form.Controls.Add((New-Label 'Auto Window Seconds' 24 390 180 22))
$windowBox = New-TextBox 24 414 100
$windowBox.Text = '30'
$form.Controls.Add($windowBox)

$runButton = New-Button 'Run Subtitles' 24 460 160 38
$openButton = New-Button 'Open Output Folder' 200 460 160 38
$form.Controls.Add($runButton)
$form.Controls.Add($openButton)

$status = New-Label 'Idle.' 24 512 400 24
$status.Font = New-Object System.Drawing.Font('Segoe UI', 10, [System.Drawing.FontStyle]::Bold)
$status.ForeColor = [System.Drawing.Color]::FromArgb(90, 50, 180)
$form.Controls.Add($status)

$logBox = New-Object System.Windows.Forms.TextBox
$logBox.Location = New-Object System.Drawing.Point(24, 548)
$logBox.Size = New-Object System.Drawing.Size(916, 150)
$logBox.Multiline = $true
$logBox.ScrollBars = 'Vertical'
$logBox.ReadOnly = $true
$logBox.Font = New-Object System.Drawing.Font('Consolas', 10)
$form.Controls.Add($logBox)

$videoDialog = New-Object System.Windows.Forms.OpenFileDialog
$videoDialog.Filter = 'Video Files|*.mov;*.mp4;*.m4v;*.webm|All Files|*.*'

$jsonDialog = New-Object System.Windows.Forms.OpenFileDialog
$jsonDialog.Filter = 'JSON Files|*.json|All Files|*.*'

$folderDialog = New-Object System.Windows.Forms.FolderBrowserDialog

$videoButton.Add_Click({
  if ($videoDialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
    $videoBox.Text = $videoDialog.FileName
    if ([string]::IsNullOrWhiteSpace($outputBox.Text)) {
      $outputBox.Text = Join-Path (Split-Path $videoDialog.FileName -Parent) 'subtitle-output'
    }
  }
})

$cueButton.Add_Click({
  if ($jsonDialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
    $cueBox.Text = $jsonDialog.FileName
  }
})

$glossaryButton.Add_Click({
  if ($jsonDialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
    $glossaryBox.Text = $jsonDialog.FileName
  }
})

$outputButton.Add_Click({
  if ($folderDialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
    $outputBox.Text = $folderDialog.SelectedPath
  }
})

$openButton.Add_Click({
  if ([string]::IsNullOrWhiteSpace($outputBox.Text) -or -not (Test-Path $outputBox.Text)) {
    $status.Text = 'Output folder does not exist yet.'
    return
  }
  Invoke-Item $outputBox.Text
})

$runButton.Add_Click({
  if ([string]::IsNullOrWhiteSpace($videoBox.Text)) {
    $status.Text = 'Pick a video first.'
    return
  }
  if ([string]::IsNullOrWhiteSpace($outputBox.Text)) {
    $status.Text = 'Pick an output folder first.'
    return
  }

  $status.Text = 'Running...'
  $logBox.Clear()
  $runButton.Enabled = $false
  $openButton.Enabled = $false

  $args = @('scripts/generate-subtitles.mjs', '--video', $videoBox.Text, '--out-dir', $outputBox.Text)
  if (-not [string]::IsNullOrWhiteSpace($cueBox.Text)) {
    $args += @('--cues', $cueBox.Text)
  }
  if (-not [string]::IsNullOrWhiteSpace($glossaryBox.Text)) {
    $args += @('--glossary', $glossaryBox.Text)
  }
  if (-not [string]::IsNullOrWhiteSpace($windowBox.Text)) {
    $args += @('--window-seconds', $windowBox.Text)
  }

  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = 'node'
  $psi.WorkingDirectory = $root
  $psi.UseShellExecute = $false
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.CreateNoWindow = $true
  foreach ($arg in $args) {
    [void]$psi.ArgumentList.Add($arg)
  }

  $proc = New-Object System.Diagnostics.Process
  $proc.StartInfo = $psi
  $proc.EnableRaisingEvents = $true

  $proc.add_OutputDataReceived({
    param($sender, $event)
    if ($null -ne $event.Data) {
      $form.BeginInvoke([Action]{
        Append-Log $logBox ($event.Data + [Environment]::NewLine)
      }) | Out-Null
    }
  })

  $proc.add_ErrorDataReceived({
    param($sender, $event)
    if ($null -ne $event.Data) {
      $form.BeginInvoke([Action]{
        Append-Log $logBox ($event.Data + [Environment]::NewLine)
      }) | Out-Null
    }
  })

  $proc.add_Exited({
    $exitCode = $proc.ExitCode
    $form.BeginInvoke([Action]{
      $runButton.Enabled = $true
      $openButton.Enabled = $true
      if ($exitCode -eq 0) {
        $status.Text = 'Done.'
      } else {
        $status.Text = "Run failed with exit code $exitCode."
      }
    }) | Out-Null
    $proc.Dispose()
  })

  [void]$proc.Start()
  $proc.BeginOutputReadLine()
  $proc.BeginErrorReadLine()
})

[void]$form.ShowDialog()
