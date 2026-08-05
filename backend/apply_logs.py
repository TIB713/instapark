import sys, re

filepath = r'd:\Admin\Desktop\InstaPark-Combined\instapark\backend\server.py'
with open(filepath, 'r', encoding='utf-8') as f:
    text = f.read()

def repl(old, new, count=1):
    global text
    if old not in text:
        print(f'FAILED TO FIND: {old[:60]}...')
    else:
        text = text.replace(old, new, count)
        print(f'Replaced {old[:30]}...')

# 1. After successful login (any role)
# Already partially done for auth_login and superadmin_login manually. Let's just ensure we don't break anything.
# ... I will skip 1 and 2 as I did them already.

# 3. After token refresh / /auth/me called successfully: [AUTH] auth/me ok user_id={} role={}
# Need to find auth/me. I will skip for now if I can't find it, or use regex.
# Actually let's just do it manually with multi-replace.
