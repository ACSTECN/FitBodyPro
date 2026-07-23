const crypto = require('crypto');

const TOKEN_VERSION = 'v1';
const ENCRYPTION_ALGORITHM = 'aes-256-gcm';

function getRecoverySecret() {
    return (
        process.env.SIGNUP_RECOVERY_SECRET ||
        process.env.LANDING_SIGNUP_TOKEN ||
        process.env.ASAAS_WEBHOOK_TOKEN ||
        null
    );
}

function getEncryptionKey() {
    const secret = getRecoverySecret();

    if (!secret) {
        return null;
    }

    return crypto.createHash('sha256').update(String(secret)).digest();
}

function createRecoveryToken(payload) {
    const key = getEncryptionKey();

    if (!key || !payload) {
        return null;
    }

    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, key, iv);
    const plaintext = JSON.stringify(payload);
    const encrypted = Buffer.concat([
        cipher.update(plaintext, 'utf8'),
        cipher.final()
    ]);
    const authTag = cipher.getAuthTag();

    return [
        TOKEN_VERSION,
        iv.toString('base64url'),
        authTag.toString('base64url'),
        encrypted.toString('base64url')
    ].join('.');
}

function decodeRecoveryToken(token) {
    const key = getEncryptionKey();

    if (!key || !token) {
        return null;
    }

    const parts = String(token).split('.');

    if (parts.length !== 4 || parts[0] !== TOKEN_VERSION) {
        return null;
    }

    const [, ivPart, authTagPart, encryptedPart] = parts;
    const decipher = crypto.createDecipheriv(
        ENCRYPTION_ALGORITHM,
        key,
        Buffer.from(ivPart, 'base64url')
    );

    decipher.setAuthTag(Buffer.from(authTagPart, 'base64url'));

    const decrypted = Buffer.concat([
        decipher.update(Buffer.from(encryptedPart, 'base64url')),
        decipher.final()
    ]);

    return JSON.parse(decrypted.toString('utf8'));
}

module.exports = {
    createRecoveryToken,
    decodeRecoveryToken
};
