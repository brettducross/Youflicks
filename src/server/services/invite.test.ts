import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { hashInviteCode, InviteService } from "@/server/services/invite";

describe("InviteService W1.1", () => {
  const suffix = Date.now();
  const invitedEmail = `invited-${suffix}@example.com`;
  const strangerEmail = `stranger-${suffix}@example.com`;
  let allowlistId = "";
  let codeInviteId = "";
  let code = "";

  const invites = new InviteService(() => true);

  beforeAll(async () => {
    const allowlist = await invites.mintAllowlistEmail(invitedEmail, "wave1");
    allowlistId = allowlist.id;
    const minted = await invites.mintCode({ email: `code-${suffix}@example.com` });
    codeInviteId = minted.id;
    code = minted.code!;
  });

  afterAll(async () => {
    await prisma.betaInvite.deleteMany({
      where: { id: { in: [allowlistId, codeInviteId] } },
    });
  });

  it("rejects an uninvited email when the invite gate is on", async () => {
    await expect(
      invites.assertCanRegister({ email: strangerEmail }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("allows an allowlisted email without a code", async () => {
    const decision = await invites.assertCanRegister({ email: invitedEmail });
    expect(decision.allowed).toBe(true);
    expect(decision.inviteId).toBe(allowlistId);
    expect(decision.preVerifyEmail).toBe(true);
  });

  it("rejects a hashed invite code bound to a different email", async () => {
    await expect(
      invites.assertCanRegister({ email: strangerEmail, inviteCode: code }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("allows the bound email with the plaintext code and stores only the hash", async () => {
    const decision = await invites.assertCanRegister({
      email: `code-${suffix}@example.com`,
      inviteCode: code,
    });
    expect(decision.allowed).toBe(true);
    const row = await prisma.betaInvite.findUniqueOrThrow({ where: { id: codeInviteId } });
    expect(row.codeHash).toBe(hashInviteCode(code));
    expect(row.codeHash).not.toBe(code);
  });

  it("does not gate registration when invite-only is off", async () => {
    const open = new InviteService(() => false);
    const decision = await open.assertCanRegister({ email: strangerEmail });
    expect(decision).toEqual({ allowed: true, inviteId: null, preVerifyEmail: false });
  });

  it("consumes a single-use code and Path-B pre-verifies the user", async () => {
    const userId = `invite-user-${suffix}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: "Invited",
        email: `user-${suffix}@example.com`,
        emailVerified: false,
      },
    });
    const minted = await invites.mintCode({ email: `user-${suffix}@example.com` });
    const decision = await invites.assertCanRegister({
      email: `user-${suffix}@example.com`,
      inviteCode: minted.code!,
    });
    await invites.consumeForUser({
      userId,
      email: `user-${suffix}@example.com`,
      inviteId: decision.inviteId,
    });
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.emailVerified).toBe(true);
    await expect(
      invites.assertCanRegister({
        email: `user-${suffix}@example.com`,
        inviteCode: minted.code!,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await prisma.betaInvite.deleteMany({ where: { id: minted.id } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });
});
