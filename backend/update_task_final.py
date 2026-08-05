with open('C:/Users/Admin/.gemini/antigravity-ide/brain/b16032b9-88a5-4fc7-b776-318a75c3d8f7/task.md', 'r') as f:
    content = f.read()

content = content.replace('- [ ] Wire self-service phone-number edit fields', '- [x] (Skipped per user request) Wire self-service phone-number edit fields')
content = content.replace('- [ ] Wire admin-managed driver/supervisor phone-number edit fields', '- [x] (Skipped per user request) Wire admin-managed driver/supervisor phone-number edit fields')
content = content.replace('- [ ] Update src/pages/owner/Login.jsx', '- [x] Update src/pages/owner/Login.jsx')
content = content.replace('- [ ] Delete erify/:token pages in web app.', '- [x] Delete erify/:token pages in web app.')

with open('C:/Users/Admin/.gemini/antigravity-ide/brain/b16032b9-88a5-4fc7-b776-318a75c3d8f7/task.md', 'w') as f:
    f.write(content)
