with open('C:/Users/Admin/.gemini/antigravity-ide/brain/b16032b9-88a5-4fc7-b776-318a75c3d8f7/task.md', 'r') as f:
    content = f.read()

content = content.replace('- [ ] Modify create_driver, create_provider, create_supervisor to not require password/pin.', '- [x] Modify create_driver, create_provider, create_supervisor to not require password/pin.')
content = content.replace('- [ ] Implement POST /auth/login for unified authentication.', '- [x] Implement POST /auth/login for unified authentication.')
content = content.replace('- [ ] Implement POST /auth/first-login/send-otp.', '- [x] Implement POST /auth/first-login/send-otp.')
content = content.replace('- [ ] Implement POST /auth/first-login/verify.', '- [x] Implement POST /auth/first-login/verify.')
content = content.replace('- [ ] Implement POST /auth/phone-change/send-otp (self-service & admin-managed).', '- [x] Implement POST /auth/phone-change/send-otp (self-service & admin-managed).')
content = content.replace('- [ ] Implement POST /auth/phone-change/verify.', '- [x] Implement POST /auth/phone-change/verify.')
content = content.replace('- [ ] Implement unified POST /auth/forgot-password and POST /auth/reset-password (keyed by phone).', '- [x] Implement unified POST /auth/forgot-password and POST /auth/reset-password (keyed by phone).')
content = content.replace('- [ ] Update is_email_taken/is_phone_taken usages to ensure global uniqueness.', '- [x] Update is_email_taken/is_phone_taken usages to ensure global uniqueness.')
content = content.replace('- [ ] Clean up retired endpoints and models.', '- [x] Clean up retired endpoints and models.')

with open('C:/Users/Admin/.gemini/antigravity-ide/brain/b16032b9-88a5-4fc7-b776-318a75c3d8f7/task.md', 'w') as f:
    f.write(content)
