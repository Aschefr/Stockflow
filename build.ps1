# Script de build et de déploiement automatisé pour StockFlow
# Ce script compile l'application et copie les livrables dans release_bin/

$ErrorActionPreference = "Stop"

Write-Host "=============================================" -ForegroundColor Cyan
Write-Host " Commencer le build de StockFlow (Tauri v2) " -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Cyan

# 0. Arrêter l'application si elle est en cours d'exécution pour libérer les fichiers
Write-Host "Vérification et arrêt des processus en cours..." -ForegroundColor Gray
Stop-Process -Name "tauri-app", "StockFlow" -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1

# 1. Compilation
Write-Host "`n[1/3] Compilation de l'application..." -ForegroundColor Yellow
npm run tauri build

# 2. Vérification/Création du dossier de release
Write-Host "`n[2/3] Préparation du dossier de release..." -ForegroundColor Yellow
$ReleaseDir = Join-Path $PSScriptRoot "release_bin"
if (!(Test-Path $ReleaseDir)) {
    New-Item -ItemType Directory -Path $ReleaseDir | Out-Null
    Write-Host "Dossier release_bin créé." -ForegroundColor Gray
}

# 3. Copie et renommage des livrables
Write-Host "`n[3/3] Copie et renommage des fichiers compilés..." -ForegroundColor Yellow

# Chemins cibles
$TargetPortable = Join-Path $ReleaseDir "StockFlow.exe"
$TargetSetup = Join-Path $ReleaseDir "StockFlow_Setup_x64.exe"
$TargetMsi = Join-Path $ReleaseDir "StockFlow_x64.msi"

# Source - Exécutable Portable (binaire brut)
$SourcePortable = Join-Path $PSScriptRoot "src-tauri\target\release\tauri-app.exe"
if (Test-Path $SourcePortable) {
    Copy-Item -Path $SourcePortable -Destination $TargetPortable -Force
    Write-Host "Copie réussie : Portable -> release_bin/StockFlow.exe" -ForegroundColor Green
} else {
    Write-Warning "Binaire portable introuvable à l'adresse : $SourcePortable"
}

# Source - Installateur NSIS
$NsisFolder = Join-Path $PSScriptRoot "src-tauri\target\release\bundle\nsis"
if (Test-Path $NsisFolder) {
    $SourceSetup = Get-ChildItem -Path $NsisFolder -Filter "*setup.exe" | Select-Object -First 1
    if ($SourceSetup) {
        Copy-Item -Path $SourceSetup.FullName -Destination $TargetSetup -Force
        Write-Host "Copie réussie : Installateur NSIS -> release_bin/StockFlow_Setup_x64.exe" -ForegroundColor Green
    } else {
        Write-Warning "Fichier setup NSIS introuvable dans : $NsisFolder"
    }
} else {
    Write-Warning "Dossier NSIS introuvable."
}

# Source - Installateur MSI
$MsiFolder = Join-Path $PSScriptRoot "src-tauri\target\release\bundle\msi"
if (Test-Path $MsiFolder) {
    $SourceMsi = Get-ChildItem -Path $MsiFolder -Filter "*.msi" | Select-Object -First 1
    if ($SourceMsi) {
        Copy-Item -Path $SourceMsi.FullName -Destination $TargetMsi -Force
        Write-Host "Copie réussie : Installateur MSI -> release_bin/StockFlow_x64.msi" -ForegroundColor Green
    } else {
        Write-Warning "Fichier MSI introuvable dans : $MsiFolder"
    }
} else {
    Write-Warning "Dossier MSI introuvable."
}

Write-Host "`n=============================================" -ForegroundColor Cyan
Write-Host " Build terminé avec succès ! " -ForegroundColor Green
Write-Host " Les binaires sont à jour dans release_bin/ " -ForegroundColor Gray
Write-Host "=============================================" -ForegroundColor Cyan
