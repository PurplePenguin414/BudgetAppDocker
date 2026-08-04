// Run this once to generate a password hash for your .env file:
//   node hash-password.js "yourActualPassword"
// Then copy the printed hash into APP_PASSWORD_HASH in your .env file.

const bcrypt = require('bcryptjs');

const pw = process.argv[2];
if (!pw) {
  console.log('Usage: node hash-password.js "yourPassword"');
  process.exit(1);
}

const hash = bcrypt.hashSync(pw, 10);
console.log('\nAdd this to your .env file as APP_PASSWORD_HASH:\n');
console.log(hash);
console.log('');
