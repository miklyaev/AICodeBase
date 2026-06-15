import crypto from 'node:crypto';

export const makeId = () => crypto.randomUUID();

export const sha256 = (input: string) => crypto.createHash('sha256').update(input).digest('hex');
