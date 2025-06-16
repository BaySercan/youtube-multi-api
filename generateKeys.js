const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Create keys directory if it doesn't exist
const keysDir = path.join(__dirname, 'keys');
if (!fs.existsSync(keysDir)) {
  fs.mkdirSync(keysDir);
}

// Generate RSA key pair
crypto.generateKeyPair('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: {
    type: 'spki',
    format: 'pem'
  },
  privateKeyEncoding: {
    type: 'pkcs8',
    format: 'pem'
  }
}, (err, publicKey, privateKey) => {
  if (err) {
    console.error('Key generation failed:', err);
    process.exit(1);
  }

  // Save keys to files
  fs.writeFileSync(path.join(keysDir, 'private.key'), privateKey);
  fs.writeFileSync(path.join(keysDir, 'public.key'), publicKey);
  
  console.log('RSA keys generated successfully!');
});
