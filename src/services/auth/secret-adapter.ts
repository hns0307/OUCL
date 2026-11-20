
/** Platform key storage is injected by the Electron owner. Ciphertext is the only persisted representation. */
export interface SecretAdapter {
  encrypt(plainText: string): Promise<Buffer>;
  decrypt(cipherText: Buffer): Promise<string>;
}
