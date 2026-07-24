#!/bin/bash

BACKUP_NAME="foodyzz-backup-$(date +%Y%m%d-%H%M%S).tar.gz"

echo "📦 Starting complete backup bids..."
echo "   Excluding: node_modules, ios, android, .expo, .git, Xcode artifacts, caches, logs, etc."
echo ""

# Check if we're in the right directory
if [ ! -f "package.json" ]; then
    echo "❌ ERROR: No package.json found in current directory!"
    echo "Please run this script from your project root"
    exit 1
fi

# Calculate approximate size (macOS compatible)
echo "📊 Calculating size of files to backup..."
# Use find to exclude patterns and pipe to du
SIZE=$(find . -type f \
    -not -path "*/node_modules/*" \
    -not -path "*/ios/*" \
    -not -path "*/android/*" \
    -not -path "*/.expo/*" \
    -not -path "*/.expo" \
    -not -path "*/.git/*" \
    -not -path "*/.git" \
    -not -name "*.log" \
    -not -name "*.bak" \
    -not -name "*.tmp" \
    -not -name "*.zip" \
    -not -name "*.tar.gz" \
    -not -name ".DS_Store" \
    -print0 2>/dev/null | du -ch -0 -s 2>/dev/null | tail -1 | cut -f1)
echo "   Approximately $SIZE to compress"
echo ""

echo "⏳ Creating backup: $BACKUP_NAME"
echo "   (This may take a few minutes...)"
echo ""

# Perform the backup with comprehensive exclusions (macOS tar compatible)
tar -X /dev/stdin -czvf "../$BACKUP_NAME" . << EOF
# Git exclusions
./.git
.git
*/.git
*/.git/*

# Expo exclusions
./.expo
.expo
*/.expo
*/.expo/*

# Build and dependency folders
node_modules
*/node_modules/*
ios
*/ios/*
android
*/android/*
.gradle
*/.gradle/*
.cache
*/.cache/*
coverage
*/coverage/*

# IDE folders
.idea
*/.idea/*
.vscode
*/.vscode/*

# Logs and temp files
*.log
*.bak
*.tmp
*.swp
*.swo
.DS_Store

# Sensitive files
.env.*.local
EOF

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Backup completed successfully!"
    echo "   Location: ../$BACKUP_NAME"
    echo "   Size: $(du -h "../$BACKUP_NAME" | cut -f1)"
    
    # List contents to verify (first 15 files)
    echo ""
    echo "📋 First few files in backup:"
    tar -tzf "../$BACKUP_NAME" 2>/dev/null | head -15
    
    # Quick check to ensure .git wasn't included
    if tar -tzf "../$BACKUP_NAME" 2>/dev/null | grep -q "\.git/"; then
        echo ""
        echo "⚠️  Warning: .git folder might still be in the backup!"
    else
        echo ""
        echo "✅ Verified: .git folder is excluded"
    fi
else
    echo ""
    echo "❌ Backup failed!"
    exit 1
fi
