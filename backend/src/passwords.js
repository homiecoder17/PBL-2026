import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
const scrypt = promisify(scryptCallback);
const options = { N: 32768, r: 8, p: 1, maxmem: 128 * 1024 * 1024 };
export function validatePassword(password) {
  if (
    typeof password !== "string" ||
    password.length < 12 ||
    password.length > 256
  )
    throw new Error("Choose a password between 12 and 256 characters.");
}
export async function hashPassword(password) {
  validatePassword(password);
  const salt = randomBytes(16).toString("base64url");
  const derived = await scrypt(password, salt, 64, options);
  return `scrypt:32768:8:1$${salt}$${derived.toString("hex")}`;
}
export async function verifyPassword(hash, password) {
  // Also supports the original Flask/Werkzeug default scrypt hashes.
  if (
    typeof hash !== "string" ||
    typeof password !== "string" ||
    password.length > 256
  )
    return false;
  const parts = hash.split("$");
  if (
    parts.length !== 3 ||
    !/^scrypt:(16384|32768):8:1$/.test(parts[0]) ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(parts[1]) ||
    !/^[a-f0-9]{128}$/i.test(parts[2])
  )
    return false;
  const N = Number(parts[0].split(":")[1]);
  const derived = await scrypt(password, parts[1], 64, { ...options, N });
  return timingSafeEqual(derived, Buffer.from(parts[2], "hex"));
}
