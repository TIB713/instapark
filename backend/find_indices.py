import re

with open('d:/Admin/Desktop/InstaPark-Combined/instapark/backend/server.py', 'r', encoding='utf-8') as f:
    lines = f.readlines()

start_idx = -1
end_idx = -1

for i, line in enumerate(lines):
    if line.startswith('class LoginEmail(BaseModel):'):
        start_idx = i
        break

for i in range(start_idx, len(lines)):
    if line.startswith('@api_router.get("/auth/me")'):
        end_idx = i
        break
    line = lines[i]

if start_idx != -1 and end_idx != -1:
    print(f"Start: {start_idx}, End: {end_idx}")
