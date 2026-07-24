#!/bin/bash

# Create IOS directory if it doesn't exist
#mkdir -p IOS

# Convert all .wav files to .caf and place them in IOS folder
for file in *.wav; do
    if [ -f "$file" ]; then
        # Get the filename without extension
        filename=$(basename "$file" .wav)
        
        # Convert to CAF format and place in IOS folder
        echo "Converting $file to IOS/${filename}.caf..."
        afconvert -f caff -d LEI16@44100 "$file" "IOS/${filename}.caf"
        
        if [ $? -eq 0 ]; then
            echo "✓ Successfully converted $file"
        else
            echo "✗ Failed to convert $file"
        fi
    fi
done

echo "Conversion complete! CAF files are in the IOS folder."
