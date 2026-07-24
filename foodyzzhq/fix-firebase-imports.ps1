# Fix ES module imports in @react-native-firebase packages

$packages = @('auth', 'firestore', 'functions')

foreach ($pkg in $packages) {
    $libPath = "node_modules\@react-native-firebase\$pkg\lib"
    
    if (Test-Path $libPath) {
        Write-Host "Fixing imports in @react-native-firebase/$pkg..."
        
        Get-ChildItem -Path $libPath -Filter "*.js" -Recurse | ForEach-Object {
            $file = $_.FullName
            $content = Get-Content $file -Raw
            $modified = $false
            
            # Fix directory imports to include index.js
            if ($content -match "@react-native-firebase/app/lib/common['\`"]") {
                $content = $content -replace "from\s+(['\`"])@react-native-firebase/app/lib/common\1", "from `$1@react-native-firebase/app/lib/common/index.js`$1"
                $modified = $true
            }
            
            if ($content -match "@react-native-firebase/app/lib/internal/nativeModule['\`"]") {
                $content = $content -replace "from\s+(['\`"])@react-native-firebase/app/lib/internal/nativeModule\1", "from `$1@react-native-firebase/app/lib/internal/nativeModule.js`$1"
                $modified = $true
            }
            
            if ($content -match "@react-native-firebase/app/lib/internal(['\`"])") {
                $content = $content -replace "from\s+(['\`"])@react-native-firebase/app/lib/internal\1", "from `$1@react-native-firebase/app/lib/internal/index.js`$1"
                $modified = $true
            }
            
            if ($modified) {
                Set-Content -Path $file -Value $content -NoNewline
                Write-Host "  Fixed: $($_.Name)"
            }
        }
    }
}

Write-Host "Done! Now creating patches..."
