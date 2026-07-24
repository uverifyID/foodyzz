# Enhanced-Backup-Script.ps1

param(
    [Parameter(Mandatory=$false)]
    [string]$SourcePath,
    
    [Parameter(Mandatory=$false)]
    [string]$BackupPath,
    
    [switch]$Compress,
    
    [switch]$ShowProgress  # Changed from 'Verbose' to avoid conflict
)

# Configuration with defaults
if (-not $SourcePath) {
    $SourcePath = Read-Host "Enter source folder path"
}

if (-not $BackupPath) {
    $BackupPath = Read-Host "Enter backup destination path"
}

if (-not (Test-Path $SourcePath)) {
    Write-Host "Error: Source path does not exist!" -ForegroundColor Red
    exit 1
}

$foldersToExclude = @(
    "ios",
    "android", 
    "node_modules",
    "logs",
    ".git",
    "bin",
    "obj",
    "dist",
    "build",
    ".vs",
    ".vscode"
)

# Create timestamp and destination
$timestamp = Get-Date -Format "yyyy-MM-dd_HH-mm-ss"
$backupFolderName = "Backup_$timestamp"
$destination = Join-Path $BackupPath $backupFolderName

# Create destination
New-Item -ItemType Directory -Path $destination -Force -ErrorAction SilentlyContinue | Out-Null

# Build exclude parameters
$excludeParams = @()
foreach ($folder in $foldersToExclude) {
    $excludeParams += "/XD"
    $excludeParams += $folder
}

# Display backup info
Write-Host "`n" + "="*60 -ForegroundColor Cyan
Write-Host "BACKUP OPERATION" -ForegroundColor Cyan
Write-Host "="*60 -ForegroundColor Cyan
Write-Host "Source:      $SourcePath" -ForegroundColor White
Write-Host "Destination: $destination" -ForegroundColor White
Write-Host "Excluding:   $($foldersToExclude -join ', ')" -ForegroundColor Yellow
Write-Host "="*60 -ForegroundColor Cyan
Write-Host ""

# Confirmation
$confirm = Read-Host "Start backup? (Y/N)"
if ($confirm -ne 'Y' -and $confirm -ne 'y') {
    Write-Host "Backup cancelled." -ForegroundColor Red
    exit 0
}

# Perform backup
Write-Host "Starting backup..." -ForegroundColor Green

$robocopyParams = @(
    "`"$SourcePath`"",
    "`"$destination`"",
    "/MIR",
    "/COPY:DAT",
    "/DCOPY:T",
    "/R:3",
    "/W:5",
    "/NJH",  # No Job Header
    "/NJS"   # No Job Summary
) + $excludeParams

if (-not $ShowProgress) {  # Changed from -not $Verbose
    $robocopyParams += "/NP"  # No Progress
}

# Log file
$logFile = Join-Path $BackupPath "backup_$timestamp.log"
$robocopyParams += "/LOG:`"$logFile`""

# Execute
$result = robocopy @robocopyParams

# Display results
Write-Host "`n" + "="*60 -ForegroundColor Cyan
Write-Host "BACKUP COMPLETE" -ForegroundColor Cyan
Write-Host "="*60 -ForegroundColor Cyan

if ($result -ge 8) {
    Write-Host "Status: COMPLETED WITH ERRORS" -ForegroundColor Red
    Write-Host "Check log file: $logFile" -ForegroundColor Yellow
} else {
    Write-Host "Status: SUCCESSFUL" -ForegroundColor Green
    
    # Calculate backup size
    if (Test-Path $destination) {
        $size = (Get-ChildItem $destination -Recurse -ErrorAction SilentlyContinue | 
                 Measure-Object -Property Length -Sum -ErrorAction SilentlyContinue).Sum
        if ($size) {
            $sizeInMB = [math]::Round($size / 1MB, 2)
            Write-Host "Backup size: $sizeInMB MB" -ForegroundColor Cyan
        }
    }
}

Write-Host "Backup location: $destination" -ForegroundColor Cyan
Write-Host "Log file: $logFile" -ForegroundColor Cyan

# Optional: Compress the backup
if ($Compress) {
    Write-Host "`nCompressing backup..." -ForegroundColor Yellow
    $zipFile = Join-Path $BackupPath "Backup_$timestamp.zip"
    Compress-Archive -Path $destination -DestinationPath $zipFile -Force
    Write-Host "Compressed backup: $zipFile" -ForegroundColor Green
}