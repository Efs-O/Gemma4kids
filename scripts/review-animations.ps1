#Requires -Version 5.1
# review-animations.ps1 -- curate Samples HTML animations
# Keys: Enter=refresh preview  O=open browser  Delete=recycle  PgDn/Down=next  PgUp/Up=prev  ESC=quit

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName Microsoft.VisualBasic
Add-Type @"
using System;
using System.Runtime.InteropServices;

public static class Win32Focus
{
    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
}
"@

$SamplesRoot = Join-Path $PSScriptRoot "..\Samples"
$SamplesRoot = (Resolve-Path $SamplesRoot).Path
$script:UseWebView2 = $false
$script:WebView2AssemblyDir = $null

function Initialize-PreviewEngine {
    $candidateDirs = @(
        "C:\Program Files (x86)\Sony\PS Remote Play",
        "C:\Program Files\Sony\PS Remote Play",
        "C:\Program Files (x86)\Microsoft\EdgeWebView\Application",
        "C:\Program Files\Microsoft\EdgeWebView\Application"
    )

    foreach ($dir in $candidateDirs) {
        $winFormsDll = Join-Path $dir "Microsoft.Web.WebView2.WinForms.dll"
        $coreDll = Join-Path $dir "Microsoft.Web.WebView2.Core.dll"
        $loaderDll = Join-Path $dir "WebView2Loader.dll"
        if ((Test-Path $winFormsDll) -and (Test-Path $coreDll) -and (Test-Path $loaderDll)) {
            try {
                Add-Type -Path $coreDll
                Add-Type -Path $winFormsDll
                $script:UseWebView2 = $true
                $script:WebView2AssemblyDir = $dir
                return
            } catch {
                $script:UseWebView2 = $false
            }
        }
    }
}

Initialize-PreviewEngine

# -- Collect files -----------------------------------------------------------
function Get-AnimationFiles {
    param([string]$Root)
    $items = [System.Collections.Generic.List[hashtable]]::new()
    Get-ChildItem -Path $Root -Recurse -Filter "*.html" | Sort-Object FullName | ForEach-Object {
        $html = $_.FullName
        $parentFolder = $_.DirectoryName
        if ($_.Name -eq "output.html") {
            $display = [System.IO.Path]::GetFileName($parentFolder)
            $deleteTarget = $parentFolder
        } else {
            $display = $_.BaseName
            $deleteTarget = $html
        }
        $relPath = $html.Replace($Root, "Samples").Replace("\", " > ")
        $items.Add(@{
            Display      = $display
            HtmlPath     = $html
            DeleteTarget = $deleteTarget
            RelPath      = $relPath
        }) | Out-Null
    }
    return (, $items)
}

$script:AllItems = Get-AnimationFiles -Root $SamplesRoot

if ($AllItems.Count -eq 0) {
    [System.Windows.Forms.MessageBox]::Show("No HTML files found under:`n$SamplesRoot", "Nothing to review")
    exit
}

$script:Idx = 0
$script:IsSyncingListSelection = $false
$script:refocusAttemptsRemaining = 0

# -- Form --------------------------------------------------------------------
$form = New-Object System.Windows.Forms.Form
$form.Text = "Gemma4kids - Animation Reviewer"
$form.Size = New-Object System.Drawing.Size(1200, 820)
$form.MinimumSize = New-Object System.Drawing.Size(900, 600)
$form.StartPosition = "CenterScreen"
$form.BackColor = [System.Drawing.Color]::FromArgb(18, 18, 28)
$form.ForeColor = [System.Drawing.Color]::White
$form.KeyPreview = $true

# -- Split layout ------------------------------------------------------------
$splitContainer = New-Object System.Windows.Forms.SplitContainer
$splitContainer.Location = New-Object System.Drawing.Point(10, 10)
$splitContainer.Size = New-Object System.Drawing.Size(1160, 760)
$splitContainer.Anchor = "Top,Left,Right,Bottom"
$splitContainer.Orientation = "Vertical"
$splitContainer.SplitterWidth = 8
$splitContainer.SplitterDistance = 400
$splitContainer.IsSplitterFixed = $false
$splitContainer.BackColor = [System.Drawing.Color]::FromArgb(18, 18, 28)
$splitContainer.Panel1MinSize = 250
$splitContainer.Panel2MinSize = 380
$splitContainer.Panel1.BackColor = [System.Drawing.Color]::FromArgb(18, 18, 28)
$splitContainer.Panel2.BackColor = [System.Drawing.Color]::FromArgb(18, 18, 28)

# -- Left panel: list --------------------------------------------------------
$listBox = New-Object System.Windows.Forms.ListBox
$listBox.Dock = "Fill"
$listBox.BackColor = [System.Drawing.Color]::FromArgb(26, 26, 40)
$listBox.ForeColor = [System.Drawing.Color]::FromArgb(210, 210, 230)
$listBox.Font = New-Object System.Drawing.Font("Consolas", 18)
$listBox.SelectionMode = "One"
$listBox.BorderStyle = "FixedSingle"
$listBox.ScrollAlwaysVisible = $true
$listBox.IntegralHeight = $false

foreach ($item in $AllItems) {
    $listBox.Items.Add($item.Display) | Out-Null
}

# -- Right panel -------------------------------------------------------------
$panelRight = New-Object System.Windows.Forms.Panel
$panelRight.Dock = "Fill"
$panelRight.BackColor = [System.Drawing.Color]::FromArgb(18, 18, 28)

$lblCount = New-Object System.Windows.Forms.Label
$lblCount.Font = New-Object System.Drawing.Font("Segoe UI", 26, [System.Drawing.FontStyle]::Bold)
$lblCount.ForeColor = [System.Drawing.Color]::FromArgb(90, 180, 255)
$lblCount.AutoSize = $true
$lblCount.Location = New-Object System.Drawing.Point(0, 0)

$lblName = New-Object System.Windows.Forms.Label
$lblName.Font = New-Object System.Drawing.Font("Consolas", 24, [System.Drawing.FontStyle]::Bold)
$lblName.ForeColor = [System.Drawing.Color]::White
$lblName.Size = New-Object System.Drawing.Size(740, 200)
$lblName.Location = New-Object System.Drawing.Point(0, 55)
$lblName.AutoEllipsis = $true

$lblPath = New-Object System.Windows.Forms.Label
$lblPath.Font = New-Object System.Drawing.Font("Segoe UI", 18)
$lblPath.ForeColor = [System.Drawing.Color]::FromArgb(120, 120, 150)
$lblPath.Size = New-Object System.Drawing.Size(740, 60)
$lblPath.Location = New-Object System.Drawing.Point(0, 265)
$lblPath.AutoEllipsis = $true

$lblStatus = New-Object System.Windows.Forms.Label
$lblStatus.Font = New-Object System.Drawing.Font("Segoe UI", 20, [System.Drawing.FontStyle]::Italic)
$lblStatus.ForeColor = [System.Drawing.Color]::FromArgb(255, 120, 80)
$lblStatus.Size = New-Object System.Drawing.Size(740, 45)
$lblStatus.Location = New-Object System.Drawing.Point(0, 335)

function New-HintButton([string]$label, [string]$key, [int]$x, [int]$y) {
    $btn = New-Object System.Windows.Forms.Button
    $btn.Text = "$key   $label"
    $btn.Size = New-Object System.Drawing.Size(280, 52)
    $btn.Location = New-Object System.Drawing.Point($x, $y)
    $btn.FlatStyle = "Flat"
    $btn.FlatAppearance.BorderColor = [System.Drawing.Color]::FromArgb(60, 60, 90)
    $btn.BackColor = [System.Drawing.Color]::FromArgb(32, 32, 50)
    $btn.ForeColor = [System.Drawing.Color]::FromArgb(200, 200, 220)
    $btn.Font = New-Object System.Drawing.Font("Segoe UI", 20)
    $btn.Cursor = [System.Windows.Forms.Cursors]::Hand
    $btn.TabStop = $false
    return $btn
}

$btnPreview = New-HintButton "Refresh preview" "Enter"  0   395
$btnOpen    = New-HintButton "Open in browser" "O"      300 395
$btnDelete  = New-HintButton "Recycle"         "Delete" 0   457
$btnRefresh = New-HintButton "Refresh list"    "F5"     300 457
$btnNext    = New-HintButton "Next"            "PgDn"   0   519
$btnPrev    = New-HintButton "Previous"        "PgUp"   300 519

$lblKeys = New-Object System.Windows.Forms.Label
$lblKeys.Text = "Enter = preview   O = browser   F5 = refresh   ESC = close"
$lblKeys.Font = New-Object System.Drawing.Font("Segoe UI", 18)
$lblKeys.ForeColor = [System.Drawing.Color]::FromArgb(80, 80, 100)
$lblKeys.AutoSize = $true
$lblKeys.Location = New-Object System.Drawing.Point(0, 580)

$lblPreviewEngine = New-Object System.Windows.Forms.Label
$lblPreviewEngine.Font = New-Object System.Drawing.Font("Segoe UI", 12)
$lblPreviewEngine.ForeColor = [System.Drawing.Color]::FromArgb(120, 120, 150)
$lblPreviewEngine.AutoSize = $true
$lblPreviewEngine.Location = New-Object System.Drawing.Point(0, 610)

if ($script:UseWebView2) {
    $previewBrowser = New-Object Microsoft.Web.WebView2.WinForms.WebView2
    $previewBrowser.CreationProperties = New-Object Microsoft.Web.WebView2.WinForms.CoreWebView2CreationProperties
    $previewBrowser.CreationProperties.UserDataFolder = Join-Path $env:TEMP "Gemma4kidsReviewWebView2"
    $previewBrowser.Location = New-Object System.Drawing.Point(0, 635)
    $previewBrowser.Size = New-Object System.Drawing.Size(740, 125)
    $previewBrowser.MinimumSize = New-Object System.Drawing.Size(200, 120)
    $previewBrowser.Anchor = "Top,Left,Right,Bottom"
    $lblPreviewEngine.Text = "Preview engine: WebView2 (Edge)"
} else {
    $previewBrowser = New-Object System.Windows.Forms.WebBrowser
    $previewBrowser.Location = New-Object System.Drawing.Point(0, 635)
    $previewBrowser.Size = New-Object System.Drawing.Size(740, 125)
    $previewBrowser.MinimumSize = New-Object System.Drawing.Size(200, 120)
    $previewBrowser.Anchor = "Top,Left,Right,Bottom"
    $previewBrowser.ScriptErrorsSuppressed = $true
    $previewBrowser.WebBrowserShortcutsEnabled = $false
    $previewBrowser.IsWebBrowserContextMenuEnabled = $false
    $previewBrowser.AllowWebBrowserDrop = $false
    $lblPreviewEngine.Text = "Preview engine: Legacy WebBrowser"
}

$panelRight.Controls.AddRange(@($lblCount, $lblName, $lblPath, $lblStatus, $btnPreview, $btnOpen, $btnDelete, $btnRefresh, $btnNext, $btnPrev, $lblKeys, $lblPreviewEngine, $previewBrowser))

# -- Status timer (clears after 2 s) -----------------------------------------
$statusTimer = New-Object System.Windows.Forms.Timer
$statusTimer.Interval = 2000
$statusTimer.Add_Tick({ $lblStatus.Text = ""; $statusTimer.Stop() })

# -- Refocus timer (fires once after browser launch) -------------------------
$script:refocusTimer = New-Object System.Windows.Forms.Timer
$script:refocusTimer.Interval = 200
$script:refocusTimer.Add_Tick({
    if ($script:refocusAttemptsRemaining -le 0) {
        $script:refocusTimer.Stop()
        $form.TopMost = $false
        return
    }

    $script:refocusAttemptsRemaining--
    [Win32Focus]::ShowWindowAsync($form.Handle, 9) | Out-Null
    $form.WindowState = [System.Windows.Forms.FormWindowState]::Normal
    $form.BringToFront()
    $form.Activate()
    [Win32Focus]::SetForegroundWindow($form.Handle) | Out-Null
    Focus-List
})

function Show-Status([string]$msg, [string]$color = "255,120,80") {
    $rgb = $color -split ","
    $lblStatus.ForeColor = [System.Drawing.Color]::FromArgb([int]$rgb[0],[int]$rgb[1],[int]$rgb[2])
    $lblStatus.Text = $msg
    $statusTimer.Stop(); $statusTimer.Start()
}

function Focus-List {
    if ($listBox.Items.Count -gt 0) {
        $splitContainer.Panel1.Select() | Out-Null
        $listBox.Select()
        $listBox.Focus() | Out-Null
    } else {
        $form.Select()
        $form.Focus() | Out-Null
    }
}

function Load-Preview([bool]$showStatus = $false) {
    if ($AllItems.Count -eq 0) {
        if ($script:UseWebView2) {
            $previewBrowser.Source = [System.Uri]::new("about:blank")
        } else {
            $previewBrowser.DocumentText = "<html><body style='background:#12121c;color:#ddd;font-family:Segoe UI;padding:24px;'>No files to preview.</body></html>"
        }
        return
    }

    $path = $AllItems[$script:Idx].HtmlPath
    if (-not (Test-Path $path)) {
        if ($script:UseWebView2) {
            $previewBrowser.Source = [System.Uri]::new("about:blank")
        } else {
            $previewBrowser.DocumentText = "<html><body style='background:#12121c;color:#ff8c66;font-family:Segoe UI;padding:24px;'>Preview unavailable. File not found.</body></html>"
        }
        if ($showStatus) {
            Show-Status "Preview unavailable" "255,140,102"
        }
        return
    }

    $uri = [System.Uri]::new($path)
    if ($script:UseWebView2) {
        $previewBrowser.Source = $uri
    } else {
        $previewBrowser.Navigate($uri.AbsoluteUri)
    }
    if ($showStatus) {
        Show-Status "Preview refreshed" "90,200,90"
    }
}

# -- Update display ----------------------------------------------------------
function Update-Display {
    if ($AllItems.Count -eq 0) {
        $lblCount.Text = "0 / 0"
        $lblName.Text  = "No files left"
        $lblPath.Text  = ""
        return
    }
    $item = $AllItems[$script:Idx]
    $lblCount.Text = "$($script:Idx + 1) / $($AllItems.Count)"
    $lblName.Text  = $item.Display
    $lblPath.Text  = $item.RelPath

    $script:IsSyncingListSelection = $true
    $listBox.SelectedIndex = $script:Idx
    $listBox.TopIndex = [Math]::Max(0, $script:Idx - 5)
    $script:IsSyncingListSelection = $false
    Load-Preview
}

# -- Actions -----------------------------------------------------------------
function Refresh-Items {
    $previousHtmlPath = $null
    if ($AllItems.Count -gt 0 -and $script:Idx -ge 0 -and $script:Idx -lt $AllItems.Count) {
        $previousHtmlPath = $AllItems[$script:Idx].HtmlPath
    }

    $script:IsSyncingListSelection = $true
    $script:AllItems = Get-AnimationFiles -Root $SamplesRoot
    $listBox.Items.Clear()
    foreach ($item in $AllItems) {
        $listBox.Items.Add($item.Display) | Out-Null
    }

    if ($AllItems.Count -eq 0) {
        $script:Idx = 0
        $script:IsSyncingListSelection = $false
        Show-Status "No HTML files found" "255,180,80"
        Update-Display
        return
    }

    $matchedIndex = -1
    if ($previousHtmlPath) {
        for ($i = 0; $i -lt $AllItems.Count; $i++) {
            if ($AllItems[$i].HtmlPath -eq $previousHtmlPath) {
                $matchedIndex = $i
                break
            }
        }
    }

    if ($matchedIndex -ge 0) {
        $script:Idx = $matchedIndex
    } elseif ($script:Idx -ge $AllItems.Count) {
        $script:Idx = $AllItems.Count - 1
    }

    $script:IsSyncingListSelection = $false
    Update-Display
    Show-Status "Refreshed file list" "90,200,90"
    Focus-List
}

function Open-Current {
    if ($AllItems.Count -eq 0) { return }
    Start-Process $AllItems[$script:Idx].HtmlPath
    Show-Status "Opened in browser" "90,200,90"
    $script:refocusTimer.Stop()
    $script:refocusAttemptsRemaining = 8
    $form.TopMost = $true
    $script:refocusTimer.Start()
}

function Preview-Current {
    if ($AllItems.Count -eq 0) { return }
    Load-Preview $true
    Focus-List
}

function Remove-Current {
    if ($AllItems.Count -eq 0) { return }
    $item   = $AllItems[$script:Idx]
    $target = $item.DeleteTarget

    if (Test-Path $target) {
        if ([System.IO.Directory]::Exists($target)) {
            [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory(
                $target, "OnlyErrorDialogs", "SendToRecycleBin")
        } else {
            [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile(
                $target, "OnlyErrorDialogs", "SendToRecycleBin")
            $stem = [System.IO.Path]::GetFileNameWithoutExtension($target)
            $dir  = [System.IO.Path]::GetDirectoryName($target)
            foreach ($ext in @(".txt", ".json", ".md", ".prompt")) {
                $comp = Join-Path $dir "$stem$ext"
                if (Test-Path $comp) {
                    [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile(
                        $comp, "OnlyErrorDialogs", "SendToRecycleBin")
                }
            }
        }
    }

    $deleted = $item.Display
    $AllItems.RemoveAt($script:Idx)
    $listBox.Items.RemoveAt($script:Idx)
    if ($script:Idx -ge $AllItems.Count -and $script:Idx -gt 0) { $script:Idx-- }

    Show-Status "Recycled: $deleted"
    Update-Display
    Focus-List
}

function Move-Next {
    if ($script:Idx -lt $AllItems.Count - 1) {
        $script:Idx++
        Update-Display
    }
    Focus-List
}

function Move-Prev {
    if ($script:Idx -gt 0) {
        $script:Idx--
        Update-Display
    }
    Focus-List
}

function Handle-KeyPress {
    param($e)

    switch ($e.KeyCode) {
        "Return" {
            Preview-Current
            $e.Handled = $true
            $e.SuppressKeyPress = $true
        }
        "O" {
            Open-Current
            $e.Handled = $true
            $e.SuppressKeyPress = $true
        }
        "Delete" {
            Remove-Current
            $e.Handled = $true
            $e.SuppressKeyPress = $true
        }
        "F5" {
            Refresh-Items
            $e.Handled = $true
            $e.SuppressKeyPress = $true
        }
        "Next" {
            Move-Next
            $e.Handled = $true
            $e.SuppressKeyPress = $true
        }
        "Prior" {
            Move-Prev
            $e.Handled = $true
            $e.SuppressKeyPress = $true
        }
        "Down" {
            Move-Next
            $e.Handled = $true
            $e.SuppressKeyPress = $true
        }
        "Up" {
            Move-Prev
            $e.Handled = $true
            $e.SuppressKeyPress = $true
        }
        "Escape" {
            $form.Close()
        }
    }
}

# -- Event handlers ----------------------------------------------------------
$listBoxHandler = [System.EventHandler]{
    if (-not $script:IsSyncingListSelection -and $listBox.SelectedIndex -ge 0 -and $listBox.SelectedIndex -ne $script:Idx) {
        $script:Idx = $listBox.SelectedIndex
        Update-Display
    }
}
$listBox.Add_SelectedIndexChanged($listBoxHandler)
$listBox.Add_DoubleClick({ Open-Current })

foreach ($control in @($form, $listBox, $panelRight, $btnPreview, $btnOpen, $btnDelete, $btnRefresh, $btnNext, $btnPrev)) {
    $control.Add_KeyDown({
        param($s, $e)
        Handle-KeyPress $e
    })
}

foreach ($control in @($listBox, $btnPreview, $btnOpen, $btnDelete, $btnRefresh, $btnNext, $btnPrev)) {
    $control.Add_PreviewKeyDown({
        param($s, $e)
        if ($e.KeyCode -in @("Up", "Down", "Prior", "Next", "Delete", "Return", "Escape", "F5", "O")) {
            $e.IsInputKey = $true
        }
    })
}

$btnPreview.Add_Click({ Preview-Current; Focus-List })
$btnOpen.Add_Click({   Open-Current; Focus-List })
$btnDelete.Add_Click({ Remove-Current; Focus-List })
$btnRefresh.Add_Click({ Refresh-Items; Focus-List })
$btnNext.Add_Click({   Move-Next; Focus-List })
$btnPrev.Add_Click({   Move-Prev; Focus-List })

$form.Add_Click({ $form.Activate(); Focus-List })
$panelRight.Add_Click({ $form.Activate(); Focus-List })
$form.Add_Activated({
    $null = $form.BeginInvoke([System.Action]{
        Focus-List
    })
})

# -- Resize ------------------------------------------------------------------
$form.Add_Resize({
    $lblName.Width   = $panelRight.Width - 10
    $lblPath.Width   = $panelRight.Width - 10
    $lblStatus.Width = $panelRight.Width - 10
    $previewBrowser.Width = $panelRight.Width - 10
    $previewBrowser.Height = [Math]::Max(120, $panelRight.Height - 635)
})

# -- Run ---------------------------------------------------------------------
$splitContainer.Panel1.Controls.Add($listBox)
$splitContainer.Panel2.Controls.Add($panelRight)
$form.Controls.Add($splitContainer)
Update-Display
Focus-List
$form.ShowDialog() | Out-Null
