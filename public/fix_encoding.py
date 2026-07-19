import codecs
import re
import sys

# Read the file with UTF-8 encoding
with open('index.html', 'r', encoding='utf-8') as f:
    content = f.read()

# Pattern mapping for double-encoded UTF-8 (mojibake)
# These are common patterns when UTF-8 is misinterpreted as Latin-1 twice
replacements = {
    # Cheese emoji
    'ÃƒÂ°Ã…Â¸Ã‚Â§Ã¢â€šÂ¬': '🧀',
    # Green circle
    'ÃƒÂ°Ã…Â¸Ã…Â¸Ã‚Â¢': '🟢',
    # Red circle
    'ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â´': '🔴',
    # Money bag
    'ÃƒÂ°Ã…Â¸Ã¢â‚¬â„¢Ã‚Â°': '💰',
    # Credit card
    'ÃƒÂ°Ã…Â¸Ã¢â‚¬â„¢Ã‚Â³': '💳',
    # Globe
    'ÃƒÂ°Ã…Â¸Ã…â€™Ã‚Â': '🌐',
    # Blue circle
    'ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Âµ': '🔵',
    # Diamond/gem
    'ÃƒÂ°Ã…Â¸Ã¢â‚¬â„¢Ã…Â½': '💎',
    # Bank
    'ÃƒÂ°Ã…Â¸Ã‚ÂÃ‚Â¦': '🏦',
    # Lock
    'ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ…â€™': '🔒',
    # Bridge
    'ÃƒÂ°Ã…Â¸Ã…â€™Ã¢â‚¬Â°': '🌉',
    # Plus sign
    'ÃƒÂ¢Ã…Â¾Ã¢â‚¬Â¢': '➕',
    # Money with wings
    'ÃƒÂ°Ã…Â¸Ã¢â‚¬â„¢Ã‚Â¸': '💸',
    # Warning 
    'ÃƒÂ¢Ã…Â¡Ã‚Â ÃƒÂ¯Ã‚Â¸Ã‚Â': '⚠️',
    # Gear
    'ÃƒÂ¢Ã…Â¡Ã¢â€žÂ¢ÃƒÂ¯Ã‚Â¸Ã‚Â': '⚙️',
    # Key
    'ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ¢â‚¬Ëœ': '🔐',
    # Inbox
    'ÃƒÂ°Ã…Â¸Ã¢â‚¬Å"Ã‚Â¥': '📥',
    # Unlock
    'ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ¢â‚¬â„¢': '🔓',
    # Trash
    'ÃƒÂ°Ã…Â¸Ã¢â‚¬â€Ã¢â‚¬ËœÃƒÂ¯Ã‚Â¸Ã‚Â': '🗑️',
    # Chart
    'ÃƒÂ°Ã…Â¸Ã¢â‚¬Å"Ã…Â ': '📠',
    # Refresh
    'ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ¢â‚¬Å¾': '🔄',
    # Copy
    'ÃƒÂ°Ã…Â¸Ã¢â‚¬Å"Ã¢â‚¬Â¹': '📋',
    # Share
    'ÃƒÂ°Ã…Â¸Ã¢â‚¬Å"Ã‚Â¤': '📤',
    # QR
    'ÃƒÂ°Ã…Â¸Ã¢â‚¬Å"Ã‚Â·': '📷',
    # Mining pick
    'ÃƒÂ¢Ã¢â‚¬ÂºÃ‚ÂÃƒÂ¯Ã‚Â¸Ã‚Â': '⛏️',
    # Rocket
    'ÃƒÂ°Ã…Â¸Ã…Â¡Ã¢â€šÂ¬': '🚀',
    # Stop
    'ÃƒÂ¢Ã‚ÂÃ‚Â¹ÃƒÂ¯Ã‚Â¸Ã‚Â': '⏹️',
    # Finger
    'ÃƒÂ°Ã…Â¸Ã¢â‚¬ËœÃ¢â‚¬Â ': '👆',
    # Approx
    'ÃƒÂ¢Ã¢â‚¬Â°Ã‹â€ ': '≈',
    # Down arrow
    'ÃƒÂ¢Ã¢â‚¬Â¡Ã¢â‚¬Â¦': '⇦',
    # Bullet
    'ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¢': '•',
    # Check
    'ÃƒÂ¢Ã…â€œÃ¢â‚¬Â¦': '✅',
    # Home
    'ÃƒÂ°Ã…Â¸Ã‚ÂÃ¢â€šÂ ': '🏠',
    # Wrench
    'ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â§': '🔧',
    # Link
    'ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ—': '🔗',
    # Purple circle
    'ÃƒÂ°Ã…Â¸Ã…Â¸Ã‚Â£': '🟣',
    # World/apps
    'ÃƒÂ°Ã…Â¸Ã…â€™Ã‚Â ': '🌐',
}

# Function to try decoding double-encoded UTF-8
def fix_mojibake(text):
    try:
        # Try to decode as if it was UTF-8 bytes interpreted as latin-1, then latin-1 again
        fixed = text.encode('latin-1').decode('utf-8')
        return fixed
    except:
        return text

# First, do direct replacements
for bad, good in replacements.items():
    content = content.replace(bad, good)

# Try to fix remaining mojibake patterns
# Pattern: Ã followed by other special characters typically indicates mojibake
def fix_remaining_mojibake(match):
    mojibake = match.group(0)
    try:
        # Attempt various decoding strategies
        fixed = mojibake.encode('latin-1').decode('utf-8')
        return fixed
    except:
        try:
            fixed = mojibake.encode('cp1252').decode('utf-8')
            return fixed
        except:
            return mojibake

# Find and fix patterns that look like mojibake
# This pattern matches sequences starting with Ã
pattern = r'Ã[^\s<>]{1,20}'
content = re.sub(pattern, fix_remaining_mojibake, content)

# Write the fixed content
with open('index.html', 'w', encoding='utf-8') as f:
    f.write(content)

print("Fixed index.html encoding issues")
