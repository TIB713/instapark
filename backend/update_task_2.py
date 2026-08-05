with open('C:/Users/Admin/.gemini/antigravity-ide/brain/b16032b9-88a5-4fc7-b776-318a75c3d8f7/task.md', 'r') as f:
    content = f.read()

content = content.replace('- [ ] Create lib/routeForRole.js helper.', '- [x] Create lib/routeForRole.js helper.')
content = content.replace('- [ ] Update pp/(auth)/login.jsx (Unified login form).', '- [x] Update pp/(auth)/login.jsx (Unified login form).')
content = content.replace('- [ ] Implement inline first-login OTP + new credential flow in login.jsx.', '- [x] Implement inline first-login OTP + new credential flow in login.jsx.')
content = content.replace('- [ ] Refactor "Forgot password" modal in login.jsx.', '- [x] Refactor "Forgot password" modal in login.jsx.')
content = content.replace('- [ ] Update pp/index.tsx to use outeForRole helper.', '- [x] Update pp/index.tsx to use outeForRole helper.')

with open('C:/Users/Admin/.gemini/antigravity-ide/brain/b16032b9-88a5-4fc7-b776-318a75c3d8f7/task.md', 'w') as f:
    f.write(content)
