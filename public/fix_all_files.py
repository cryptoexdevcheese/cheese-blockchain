import ftfy
import os
import glob

# Fix all JS and HTML files
files_to_fix = glob.glob('*.js') + glob.glob('*.html') + glob.glob('*.css')

total_fixed = 0

for filepath in files_to_fix:
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            content = f.read()
        
        # Count Ã before fixing
        before_count = content.count('Ã')
        
        # Fix with ftfy
        fixed_content = ftfy.fix_text(content)
        
        # Count Ã after fixing
        after_count = fixed_content.count('Ã')
        
        if before_count > 0:
            print(f"{filepath}: {before_count} -> {after_count}")
            total_fixed += (before_count - after_count)
            
            # Write fixed content
            with open(filepath, 'w', encoding='utf-8') as f:
                f.write(fixed_content)
    except Exception as e:
        print(f"Error with {filepath}: {e}")

print(f"\nTotal patterns fixed: {total_fixed}")
