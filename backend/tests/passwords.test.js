import { test } from "node:test";
import assert from "node:assert/strict";
import {
  hashPassword,
  verifyPassword,
  validatePassword,
} from "../src/passwords.js";
test("Passwords use salted scrypt hashes and correct/wrong verification", async () => {
  const p = "Test-only-long-passphrase!";
  const a = await hashPassword(p),
    b = await hashPassword(p);
  assert.notEqual(a, p);
  assert.notEqual(a, b);
  assert.equal(await verifyPassword(a, p), true);
  assert.equal(await verifyPassword(a, "wrong"), false);
});
test("Weak passwords and malformed hashes are rejected", async () => {
  assert.throws(() => validatePassword("short"));
  assert.equal(await verifyPassword("plaintext", "plaintext"), false);
  assert.equal(
    await verifyPassword("scrypt:999999999:8:1$salt$bad", "password"),
    false,
  );
});

test("Original Werkzeug scrypt hashes verify without password resets", async () => {
  const legacy =
    "scrypt:32768:8:1$LegacySaltExample$de1c8e8dff4d05b38cc4c4ae7b0775488532d905693ba0395e05693f7d39834b17b174a61ee818e37498598ce9e7d8456d3778a7a79ea8c693773beb0933f074";
  assert.equal(
    await verifyPassword(legacy, "Legacy-Werkzeug-Test-Only!"),
    true,
  );
  assert.equal(await verifyPassword(legacy, "wrong"), false);
});
