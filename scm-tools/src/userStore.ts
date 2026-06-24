import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { scrypt, randomBytes, timingSafeEqual } from "crypto";
import { promisify } from "util";
import { createAdminRole } from "./roleStore.js";

const TOKENS_FILE = `${".auth"}/reset-tokens.json`;
const TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

interface ResetToken {
  email: string;
  token: string;
  expiresAt: string;
}

function loadTokens(): ResetToken[] {
  if (!existsSync(TOKENS_FILE)) return [];
  try {
    return JSON.parse(readFileSync(TOKENS_FILE, "utf-8")) as ResetToken[];
  } catch {
    return [];
  }
}

function saveTokens(tokens: ResetToken[]): void {
  if (!existsSync(".auth")) mkdirSync(".auth", { recursive: true });
  writeFileSync(TOKENS_FILE, JSON.stringify(tokens, null, 2), "utf-8");
}

export function createResetToken(email: string): string | null {
  const users = loadUsers();
  if (!users.find((u) => u.email.toLowerCase() === email.toLowerCase())) return null;
  const token = randomBytes(32).toString("hex");
  const tokens = loadTokens().filter((t) => t.email.toLowerCase() !== email.toLowerCase());
  tokens.push({ email: email.toLowerCase(), token, expiresAt: new Date(Date.now() + TOKEN_TTL_MS).toISOString() });
  saveTokens(tokens);
  return token;
}

export async function consumeResetToken(
  token: string,
  newPassword: string
): Promise<{ success: boolean; message: string }> {
  const tokens = loadTokens();
  const idx = tokens.findIndex((t) => t.token === token);
  if (idx === -1) return { success: false, message: "Invalid or expired reset link" };
  const record = tokens[idx];
  if (new Date(record.expiresAt) < new Date()) {
    tokens.splice(idx, 1);
    saveTokens(tokens);
    return { success: false, message: "Reset link has expired" };
  }
  const result = await setPassword(record.email, newPassword);
  tokens.splice(idx, 1);
  saveTokens(tokens);
  return result;
}

const scryptAsync = promisify(scrypt);
const USERS_DIR = ".auth";
const USERS_FILE = `${USERS_DIR}/users.json`;

export interface UserRecord {
  email: string;
  passwordHash: string;
  salt: string;
  createdAt: string;
  roles: string[];
}

export function loadUsers(): UserRecord[] {
  if (!existsSync(USERS_FILE)) return [];
  try {
    return JSON.parse(readFileSync(USERS_FILE, "utf-8")) as UserRecord[];
  } catch {
    return [];
  }
}

function saveUsers(users: UserRecord[]): void {
  if (!existsSync(USERS_DIR)) mkdirSync(USERS_DIR, { recursive: true });
  writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), "utf-8");
}

export async function createUser(
  email: string,
  password: string
): Promise<{ success: boolean; message: string }> {
  const users = loadUsers();
  if (users.find((u) => u.email.toLowerCase() === email.toLowerCase())) {
    return { success: false, message: "A user with that email already exists" };
  }
  const isFirstUser = users.length === 0;
  const salt = randomBytes(16).toString("hex");
  const hash = (await scryptAsync(password, salt, 64)) as Buffer;
  const roleIds: string[] = [];
  if (isFirstUser) {
    const adminRole = createAdminRole();
    roleIds.push(adminRole.id);
  }
  users.push({
    email: email.toLowerCase(),
    passwordHash: hash.toString("hex"),
    salt,
    createdAt: new Date().toISOString(),
    roles: roleIds,
  });
  saveUsers(users);
  return { success: true, message: "User created" };
}

export async function verifyPassword(
  email: string,
  password: string
): Promise<boolean> {
  const users = loadUsers();
  const user = users.find((u) => u.email.toLowerCase() === email.toLowerCase());
  if (!user) return false;
  const hash = (await scryptAsync(password, user.salt, 64)) as Buffer;
  const stored = Buffer.from(user.passwordHash, "hex");
  return timingSafeEqual(hash, stored);
}

export async function setPassword(
  email: string,
  newPassword: string
): Promise<{ success: boolean; message: string }> {
  const users = loadUsers();
  const idx = users.findIndex((u) => u.email.toLowerCase() === email.toLowerCase());
  if (idx === -1) return { success: false, message: "User not found" };
  const salt = randomBytes(16).toString("hex");
  const hash = (await scryptAsync(newPassword, salt, 64)) as Buffer;
  users[idx].passwordHash = hash.toString("hex");
  users[idx].salt = salt;
  saveUsers(users);
  return { success: true, message: "Password updated" };
}

export function addRoleToUser(email: string, roleId: string): { success: boolean; message: string } {
  const users = loadUsers();
  const idx = users.findIndex(u => u.email.toLowerCase() === email.toLowerCase());
  if (idx === -1) return { success: false, message: "User not found" };
  if (!users[idx].roles) users[idx].roles = [];
  if (users[idx].roles.includes(roleId)) return { success: false, message: "Role already assigned" };
  users[idx].roles.push(roleId);
  saveUsers(users);
  return { success: true, message: "Role assigned" };
}

export function removeRoleFromUser(email: string, roleId: string): { success: boolean; message: string } {
  const users = loadUsers();
  const idx = users.findIndex(u => u.email.toLowerCase() === email.toLowerCase());
  if (idx === -1) return { success: false, message: "User not found" };
  if (!users[idx].roles) users[idx].roles = [];
  users[idx].roles = users[idx].roles.filter(r => r !== roleId);
  saveUsers(users);
  return { success: true, message: "Role removed" };
}

export function deleteUser(email: string): { success: boolean; message: string } {
  const users = loadUsers();
  const idx = users.findIndex((u) => u.email.toLowerCase() === email.toLowerCase());
  if (idx === -1) return { success: false, message: "User not found" };
  users.splice(idx, 1);
  saveUsers(users);
  return { success: true, message: "User deleted" };
}
