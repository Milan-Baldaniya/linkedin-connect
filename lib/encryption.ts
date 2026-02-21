import crypto from 'crypto';

const ALGORITHM = 'aes-256-cbc';
const SECRET_KEY = process.env.COOKIE_SECRET || 'default-secret-key-change-it-32chars'; // Fallback for dev
const IV_LENGTH = 16;

if (Buffer.from(SECRET_KEY).length < 32) {
    // Pad if necessary for this demo, though essentially user should provide 32 char key
    console.warn("Encryption key is short. Using padded key for demo purposes.");
}

// Ensure key is 32 bytes
const key = crypto.scryptSync(SECRET_KEY, 'salt', 32);

export function encrypt(text: string): string {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    let encrypted = cipher.update(text);
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    return iv.toString('hex') + ':' + encrypted.toString('hex');
}

export function decrypt(text: string): string {
    const textParts = text.split(':');
    const ivPart = textParts.shift();
    if (!ivPart) throw new Error('Invalid encrypted text format');

    const iv = Buffer.from(ivPart, 'hex');
    const encryptedText = Buffer.from(textParts.join(':'), 'hex');
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    let decrypted = decipher.update(encryptedText);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString();
}
