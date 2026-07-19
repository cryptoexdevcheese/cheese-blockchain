import ftfy

# Read the file
with open('index.html', 'r', encoding='utf-8') as f:
    content = f.read()

# Fix all mojibake using ftfy
fixed_content = ftfy.fix_text(content)

# Write fixed content
with open('index.html', 'w', encoding='utf-8') as f:
    f.write(fixed_content)

print("Fixed with ftfy!")

# Check how many Ã remain
count = fixed_content.count('Ã')
print(f"Remaining Ã count: {count}")
