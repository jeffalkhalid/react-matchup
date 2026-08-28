# =====================================================================
# Script de build/run du projet Connect IQ PagMatch (app montre).
# Localise le SDK installe, genere la cle de signature developpeur si besoin,
# force le JBR d'Android Studio (le `java` du PATH est un JRE 1.8 trop vieux
# pour le SDK Connect IQ), puis compile via monkeyc et, en option, lance le
# simulateur.
# Windows PowerShell 5.1 (pas de && ni de ternaire).
#
# Usage :
#   .\build.ps1 -ListDevices                 # que propose mon SDK ?
#   .\build.ps1 -SyncProducts                # recale manifest.xml sur le SDK
#   .\build.ps1 -All                         # compile TOUTES les cibles du SDK, recap OK/KO
#   .\build.ps1 -Device epix2 -Sim           # compile + lance dans le simulateur
#   .\build.ps1 -Device epix2                # compile seulement (.prg a sideloader)
# =====================================================================
param(
    [string] $Device = "",
    [switch] $Sim,
    [switch] $ListDevices,
    [switch] $SyncProducts,
    [switch] $All,
    [string] $SdkPath = ""
)

$ErrorActionPreference = "Stop"
$Root    = Split-Path -Parent $MyInvocation.MyCommand.Path
$CiqHome = Join-Path $env:APPDATA "Garmin\ConnectIQ"

# ---------------------------------------------------------------- SDK
function Resolve-Sdk {
    if ($SdkPath -ne "") { return $SdkPath }

    # Le SDK Manager ecrit le chemin du SDK actif dans current-sdk.cfg.
    $cfg = Join-Path $CiqHome "current-sdk.cfg"
    if (Test-Path $cfg) {
        $p = (Get-Content $cfg -Raw).Trim()
        if ($p -ne "" -and (Test-Path $p)) { return $p }
    }

    # Sinon : le SDK le plus recent dans Sdks\.
    $sdks = Join-Path $CiqHome "Sdks"
    if (Test-Path $sdks) {
        $latest = Get-ChildItem $sdks -Directory | Sort-Object Name -Descending | Select-Object -First 1
        if ($null -ne $latest) { return $latest.FullName }
    }

    throw "SDK Connect IQ introuvable. Installe-le via le SDK Manager Garmin (voir docs/superpowers/plans/2026-08-25-app-montre.md), ou passe -SdkPath <chemin>."
}

$Sdk = Resolve-Sdk
$Bin = Join-Path $Sdk "bin"
Write-Host "SDK       : $Sdk"

# ---------------------------------------------------------------- Java
# PIEGE MACHINE : le `java` du PATH est un JRE 1.8 (C:\Program Files\Java\
# jre1.8.0_291). Les SDK Connect IQ recents refusent de demarrer dessus
# ("UnsupportedClassVersionError" ou echec silencieux de monkeyc).
# Le JBR livre avec Android Studio est un OpenJDK 21 : on le prefere.
function Resolve-Java {
    $candidates = @(
        "C:\Program Files\Android\Android Studio\jbr",
        (Join-Path $env:LOCALAPPDATA "Programs\Android Studio\jbr")
    )
    foreach ($c in $candidates) {
        if (Test-Path (Join-Path $c "bin\java.exe")) { return $c }
    }
    return $null
}

$JavaHome = Resolve-Java
if ($null -ne $JavaHome) {
    $env:JAVA_HOME = $JavaHome
    $env:PATH = (Join-Path $JavaHome "bin") + ";" + $env:PATH
    Write-Host "Java      : $JavaHome (force, le JRE 1.8 du PATH est trop vieux)"
} else {
    Write-Host "Java      : PATH par defaut. Si monkeyc echoue avec une erreur de version de classe, installe un JDK 17+ et pointe JAVA_HOME dessus."
}

# --------------------------------------------------------- Devices SDK
$DevicesDir = Join-Path $CiqHome "Devices"

function Get-SdkDevices {
    if (-not (Test-Path $DevicesDir)) {
        throw "Aucun device installe ($DevicesDir). Dans le SDK Manager, onglet Devices, coche au moins ta montre."
    }
    # @(...) force un tableau meme s'il n'y a qu'un seul device installe :
    # [array]::Sort exige un vrai System.Object[], pas un scalaire.
    $names = @(Get-ChildItem $DevicesDir -Directory | ForEach-Object { $_.Name })
    # Tri ORDINAL explicite, pas Sort-Object par defaut (culture-aware) : sur
    # cette machine, le tri par culture place "vivoactive_hr" AVANT
    # "vivoactive3" (le "_" pese moins qu'un chiffre pour ce comparateur),
    # alors qu'un tri ordinal (celui qu'utilisent `sort` en bash et le
    # manifest tel qu'ecrit) le place apres. Deux tris differents => deux
    # sorties differentes pour -SyncProducts d'une machine a l'autre, meme
    # avec un SDK identique. Ordinal fixe l'ordre une fois pour toutes.
    [array]::Sort($names, [System.StringComparer]::Ordinal)
    return $names
}

# ------------------------------------------------- Plancher d'API reel
# Le plancher (aujourd'hui 2.4.0, cf. task-6-report.md : Application.Storage
# dans Api.mc/Queue.mc est la premiere API utilisee au-dela de 1.x) vit en
# UN SEUL endroit, l'attribut minSdkVersion de manifest.xml. Tout le reste
# (le recalage -SyncProducts, le recap -ListDevices) LIT cette valeur au lieu
# de la re-ecrire en dur : sans ca, les deux peuvent diverger silencieusement
# des que le plancher change dans manifest.xml sans qu'on pense a mettre a
# jour ce script.
function Get-ManifestMinSdk {
    $manifest = Join-Path $Root "manifest.xml"
    # -Encoding UTF8 explicite : manifest.xml est ecrit SANS BOM (cf. plus
    # bas). Sans cet indice, PowerShell 5.1 lit un fichier sans BOM avec
    # l'encodage ANSI par defaut de la machine, pas UTF-8 - inoffensif ici
    # (l'attribut est ASCII pur) mais indispensable dans -SyncProducts
    # ci-dessous, ou le fichier contient des accents.
    $text = Get-Content $manifest -Raw -Encoding UTF8
    $m = [regex]::Match($text, 'minSdkVersion="([\d\.]+)"')
    if (-not $m.Success) { throw "minSdkVersion introuvable dans manifest.xml." }
    return $m.Groups[1].Value
}

# "API level 2.4" (compiler.json) ou "2.4.0" (manifest) -> [version] a 3
# composantes, pour que la comparaison ne soit jamais faussee par un nombre
# de composantes different (System.Version compare "2.4" < "2.4.0" si on ne
# normalise pas : Build vaut -1 sur le premier, 0 sur le second).
function ConvertTo-ApiVersion {
    param([string] $Raw)
    $s = $Raw -replace '(?i)^\s*API level\s*', ''
    $s = $s.Trim()
    $parts = @($s -split '\.')
    while ($parts.Count -lt 3) { $parts += '0' }
    return [version]($parts[0..2] -join '.')
}

# deviceGroup de compiler.json = le plafond d'API du device (verifie sur les
# 57 devices installes localement lors de la task 6). $null si illisible :
# l'appelant doit alors EXCLURE le device plutot que de deviner.
function Get-DeviceApiLevel {
    param([string] $DeviceId)
    $cj = Join-Path $DevicesDir (Join-Path $DeviceId "compiler.json")
    if (-not (Test-Path $cj)) { return $null }
    $text = Get-Content $cj -Raw
    $m = [regex]::Match($text, '"deviceGroup"\s*:\s*"([^"]+)"')
    if (-not $m.Success) { return $null }
    return $m.Groups[1].Value
}

# Partitionne une liste de devices selon le plancher d'API du manifeste.
# Renvoie TOUJOURS les deux listes : un device exclu doit pouvoir etre
# nomme avec sa raison, jamais juste disparaitre d'un compte plus court.
function Split-DevicesByFloor {
    param([string[]] $Devices, [string] $FloorRaw)
    $floor = ConvertTo-ApiVersion $FloorRaw
    $included = @()
    $excluded = @()
    foreach ($d in $Devices) {
        $raw = Get-DeviceApiLevel $d
        if ($null -eq $raw) {
            $excluded += [pscustomobject]@{ Device = $d; Reason = "deviceGroup illisible (compiler.json absent ou malforme)" }
            continue
        }
        $ver = ConvertTo-ApiVersion $raw
        if ($ver -ge $floor) {
            $included += $d
        } else {
            $excluded += [pscustomobject]@{ Device = $d; Reason = "$raw < minSdkVersion $FloorRaw" }
        }
    }
    return [pscustomobject]@{ Included = $included; Excluded = $excluded }
}

if ($ListDevices) {
    # $allDevices, PAS $all : $all et $All designent la MEME variable en
    # PowerShell (noms de variable insensibles a la casse) - $all ecraserait
    # silencieusement le switch -All et ferait planter la conversion de type.
    $allDevices = Get-SdkDevices
    Write-Host ""
    Write-Host "Devices installes dans le SDK ($($allDevices.Count)) :"
    $allDevices | ForEach-Object { Write-Host "  $_" }
    Write-Host ""
    $floor = Get-ManifestMinSdk
    $split = Split-DevicesByFloor -Devices $allDevices -FloorRaw $floor
    Write-Host "Cibles reelles (API >= minSdkVersion $floor, $($split.Included.Count) device(s)) :"
    $split.Included | ForEach-Object { Write-Host "  $_" }
    if ($split.Excluded.Count -gt 0) {
        Write-Host ""
        Write-Host "Exclus (API < minSdkVersion $floor, $($split.Excluded.Count) device(s)) :"
        $split.Excluded | ForEach-Object { Write-Host ("  {0} - {1}" -f $_.Device, $_.Reason) }
    }
    exit 0
}

# --------------------------------------- Recalage du manifest sur le SDK
if ($SyncProducts) {
    $manifest   = Join-Path $Root "manifest.xml"
    $floor      = Get-ManifestMinSdk
    # $allDevices, PAS $all : cf. l'avertissement dans le bloc -ListDevices
    # ci-dessus, meme piege de casse avec le switch -All.
    $allDevices = Get-SdkDevices
    if ($allDevices.Count -eq 0) {
        throw "Aucun device installe dans le SDK. Ajoute-en via le SDK Manager."
    }
    $split   = Split-DevicesByFloor -Devices $allDevices -FloorRaw $floor
    $targets = $split.Included
    if ($targets.Count -eq 0) {
        throw "Aucun device installe ne satisfait minSdkVersion $floor."
    }
    $lines = ($targets | ForEach-Object { '            <iq:product id="' + $_ + '"/>' }) -join "`r`n"
    $block = "<iq:products>`r`n$lines`r`n        </iq:products>"
    # -Encoding UTF8 explicite ICI EST CRITIQUE, pas cosmetique : sans lui,
    # PowerShell 5.1 lit ce fichier SANS BOM avec l'encodage ANSI de la
    # machine, pas UTF-8. manifest.xml contient des accents (le commentaire
    # sur Communications/makeWebRequest) : lu en ANSI puis reecrit en UTF-8
    # (WriteAllText ci-dessous), chaque accent se corrompait en mojibake
    # ("échoue" -> "Ã©choue"), a CHAQUE execution de -SyncProducts - un bug
    # reel decouvert en verifiant que ce bloc reproduit le manifeste commite.
    $xml = Get-Content $manifest -Raw -Encoding UTF8
    $xml = [regex]::Replace($xml, '<iq:products>.*?</iq:products>', $block, 'Singleline')
    # UTF-8 SANS BOM : Set-Content -Encoding utf8 en PS 5.1 ecrit un BOM, et un
    # BOM place avant la declaration <?xml ...?> peut faire echouer le parseur.
    [System.IO.File]::WriteAllText($manifest, $xml, (New-Object System.Text.UTF8Encoding($false)))
    Write-Host "manifest.xml recale sur $($targets.Count) device(s) (API >= $floor) : $($targets -join ', ')"
    if ($split.Excluded.Count -gt 0) {
        Write-Host "Exclus (API < $floor) :"
        $split.Excluded | ForEach-Object { Write-Host ("  {0} - {1}" -f $_.Device, $_.Reason) }
    }
    exit 0
}

# ------------------------------------------------------- Cle developpeur
$KeyDer = Join-Path $Root "developer_key.der"
if (-not (Test-Path $KeyDer)) {
    Write-Host "Cle developpeur absente, generation..."
    $openssl = $null
    $cmd = Get-Command openssl -ErrorAction SilentlyContinue
    if ($null -ne $cmd) { $openssl = $cmd.Source }
    if ($null -eq $openssl) {
        $gitSsl = "C:\Program Files\Git\usr\bin\openssl.exe"
        if (Test-Path $gitSsl) { $openssl = $gitSsl }
    }
    if ($null -eq $openssl) {
        throw "openssl introuvable. Installe Git for Windows, ou genere la cle depuis l'extension VS Code Monkey C (commande 'Monkey C: Generate a Developer Key')."
    }
    $KeyPem = Join-Path $Root "developer_key.pem"
    & $openssl genrsa -out $KeyPem 4096
    & $openssl pkcs8 -topk8 -inform PEM -outform DER -in $KeyPem -out $KeyDer -nocrypt
    Write-Host "Cle generee : $KeyDer  (ne pas commiter)"
}

# $BinDir/$monkeyc sont definis ICI (avant le balayage -All comme avant la
# compilation -Device) : le bloc -All ci-dessous en a besoin, tout comme la
# compilation simple plus bas.
$BinDir = Join-Path $Root "bin"
if (-not (Test-Path $BinDir)) { New-Item -ItemType Directory -Path $BinDir | Out-Null }

$monkeyc = Join-Path $Bin "monkeyc.bat"
if (-not (Test-Path $monkeyc)) { $monkeyc = Join-Path $Bin "monkeyc" }

# ---------------------------------------------------- Balayage des cibles
# Compile CHAQUE device declare dans le SDK local (pas seulement ceux du
# manifest) : un succes ici ne garantit pas que le device est dans
# manifest.xml, mais un echec ici est un vrai signal, quel que soit le
# manifest. On utilise Get-SdkDevices (comme -SyncProducts) pour balayer
# exactement le meme ensemble que celui qui alimente le manifest.
#
# PIEGE PS 5.1 : `2>&1 | Out-Null` sur un executable natif enveloppe chaque
# ligne de stderr dans un NativeCommandError et met $? a false, meme a code
# de sortie 0. Avec $ErrorActionPreference = "Stop" (regle en haut du
# script), CA ARRETE LE BALAYAGE ENTIER au premier device qui ecrit sur
# stderr (observe sur `epix`, en echec attendu). On passe donc par
# Start-Process avec -RedirectStandardOutput/-RedirectStandardError (la
# redirection est geree par le processus, jamais par le pipeline
# PowerShell) et on relache temporairement $ErrorActionPreference pour la
# duree du balayage. Chaque sortie de monkeyc est aussi journalisee par
# device, pour que l'echec rapporte la VRAIE raison au lieu d'un silence.
if ($All) {
    $devs = Get-SdkDevices
    $ok = 0; $ko = @()
    $logDir = Join-Path $BinDir "sweep-logs"
    if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }
    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    $jungle = Join-Path $Root "monkey.jungle"
    foreach ($d in $devs) {
        $out = Join-Path $BinDir ("PagMatch-" + $d + ".prg")
        $log = Join-Path $logDir ($d + ".log")
        $errLog = Join-Path $logDir ($d + ".err.log")
        # Start-Process avec redirection de flux : contrairement a `2>&1` dans
        # le pipeline PowerShell, ceci ne transforme jamais stderr en erreur
        # terminante.
        $p = Start-Process -FilePath $monkeyc `
            -ArgumentList @('-f', $jungle, '-o', $out, '-y', $KeyDer, '-d', $d) `
            -NoNewWindow -Wait -PassThru `
            -RedirectStandardOutput $log -RedirectStandardError $errLog
        if ($p.ExitCode -eq 0) { $ok = $ok + 1 } else { $ko += $d }
    }
    $ErrorActionPreference = $prevEap
    Write-Host "Compilation : $ok/$($devs.Count) OK"
    if ($ko.Count -gt 0) { Write-Host "ECHECS : $($ko -join ', ')  (details : $logDir)"; exit 1 }
    exit 0
}

# ------------------------------------------------------------- Compilation
if ($Device -eq "") {
    throw "Precise la montre cible : .\build.ps1 -Device <id>  (liste : .\build.ps1 -ListDevices)"
}

$Prg = Join-Path $BinDir ("PagMatch-" + $Device + ".prg")

Write-Host "Compilation pour $Device ..."
& $monkeyc -f (Join-Path $Root "monkey.jungle") -o $Prg -y $KeyDer -d $Device
if ($LASTEXITCODE -ne 0) { throw "Echec de compilation (code $LASTEXITCODE)." }
Write-Host "OK -> $Prg"

# --------------------------------------------------------------- Simulateur
if ($Sim) {
    $connectiq = Join-Path $Bin "connectiq.bat"
    if (-not (Test-Path $connectiq)) { $connectiq = Join-Path $Bin "connectiq" }
    $monkeydo = Join-Path $Bin "monkeydo.bat"
    if (-not (Test-Path $monkeydo)) { $monkeydo = Join-Path $Bin "monkeydo" }

    Write-Host "Lancement du simulateur (laisse-le ouvert entre deux builds)..."
    Start-Process -FilePath $connectiq
    Start-Sleep -Seconds 6
    & $monkeydo $Prg $Device
}
