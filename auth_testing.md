# Auth Testing Playbook (Emergent Google OAuth)

## Setup Test User & Session
```
mongosh --eval "
use('test_database');
var userId = 'test-user-' + Date.now();
var sessionToken = 'test_session_' + Date.now();
db.users.insertOne({
  user_id: userId,
  email: 'test.user.' + Date.now() + '@example.com',
  name: 'Test User',
  role: 'doctor',
  picture: 'https://via.placeholder.com/150',
  created_at: new Date()
});
db.user_sessions.insertOne({
  user_id: userId,
  session_token: sessionToken,
  expires_at: new Date(Date.now() + 7*24*60*60*1000),
  created_at: new Date()
});
print('Session token: ' + sessionToken);
print('User ID: ' + userId);
"
```

## Test Backend
```
curl -X GET "$API_URL/api/auth/me" -H "Authorization: Bearer YOUR_SESSION_TOKEN"
curl -X GET "$API_URL/api/patients" -H "Authorization: Bearer YOUR_SESSION_TOKEN"
```

## Demo Doctor (no Google needed)
```
curl -X POST "$API_URL/api/auth/demo-doctor" -c cookies.txt
curl -b cookies.txt "$API_URL/api/auth/me"
```

## Browser
```python
await page.context.add_cookies([{
  "name": "session_token",
  "value": "YOUR_SESSION_TOKEN",
  "domain": "patient-care-121.preview.emergentagent.com",
  "path": "/",
  "httpOnly": True,
  "secure": True,
  "sameSite": "None"
}])
```

## Cleanup
```
mongosh --eval "use('test_database'); db.users.deleteMany({email: /test\\.user\\./}); db.user_sessions.deleteMany({session_token: /test_session/});"
```

## Checklist
- [ ] user_id is custom UUID, NOT _id
- [ ] session.user_id matches user.user_id
- [ ] All queries project {"_id": 0}
- [ ] Auth dep reads cookie OR Authorization: Bearer
- [ ] expires_at is timezone-aware
