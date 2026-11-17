const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const envPath = path.resolve(__dirname, '../.env');
if (!fs.existsSync(envPath)) throw new Error('Create apps/api/.env before generating an admin credential.');
const current = fs.readFileSync(envPath, 'utf8');
const token = crypto.randomBytes(48).toString('hex');
const line = `ADMIN_API_TOKEN="${token}"`;
const updated = /^ADMIN_API_TOKEN=.*$/m.test(current) ? current.replace(/^ADMIN_API_TOKEN=.*$/m, line) : `${current.trimEnd()}\n${line}\n`;
fs.writeFileSync(envPath, updated, { mode: 0o600 });
console.log('Generated a new API admin credential in apps/api/.env. Copy it privately into the admin sign-in field when needed.');
