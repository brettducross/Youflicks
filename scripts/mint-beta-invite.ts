/**
 * Ops helper: mint an allowlist email or a single-use hashed invite code.
 * Usage:
 *   npx tsx scripts/mint-beta-invite.ts --email you@example.com
 *   npx tsx scripts/mint-beta-invite.ts --email you@example.com --code
 */
import { InviteService } from "@/server/services/invite";

async function main() {
  const args = process.argv.slice(2);
  const emailFlag = args.indexOf("--email");
  const email = emailFlag >= 0 ? args[emailFlag + 1] : undefined;
  const withCode = args.includes("--code");
  const invites = new InviteService();
  if (withCode) {
    const minted = await invites.mintCode({ email });
    console.log(JSON.stringify(minted, null, 2));
    return;
  }
  if (!email) {
    throw new Error("Pass --email <address> or --code");
  }
  const minted = await invites.mintAllowlistEmail(email);
  console.log(JSON.stringify(minted, null, 2));
}

void main();
