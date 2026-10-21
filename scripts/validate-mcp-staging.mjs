import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = process.env;
const required = [
  "MCP_STAGING_SUPABASE_URL", "MCP_STAGING_SUPABASE_ANON_KEY",
  "MCP_STAGING_USER_A_EMAIL", "MCP_STAGING_USER_A_PASSWORD",
  "MCP_STAGING_USER_B_EMAIL", "MCP_STAGING_USER_B_PASSWORD",
  "MCP_STAGING_OAUTH_ACCESS_TOKEN_A",
];
assert.equal(env.MCP_STAGING_CONFIRM, "isolated-synthetic-only", "Staging confirmation required.");
for (const name of required) assert.ok(env[name], `${name} is required.`);

const stagingUrl = new URL(env.MCP_STAGING_SUPABASE_URL);
assert.match(stagingUrl.hostname, /^[a-z0-9]+\.supabase\.co$/);
assert.equal(stagingUrl.protocol, "https:");
const localEnv = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const currentProjectUrl = /^NEXT_PUBLIC_SUPABASE_URL=(.*)$/m.exec(localEnv)?.[1]?.trim().replace(/^['"]|['"]$/g, "");
assert.ok(currentProjectUrl, "Current project URL could not be checked; refusing to run.");
assert.notEqual(stagingUrl.origin, new URL(currentProjectUrl).origin, "Staging must not be the current Hub project.");
assert.notEqual(env.MCP_STAGING_USER_A_EMAIL, env.MCP_STAGING_USER_B_EMAIL);

const options = { auth: { autoRefreshToken: false, persistSession: false } };
const clientA = createClient(stagingUrl.origin, env.MCP_STAGING_SUPABASE_ANON_KEY, options);
const clientB = createClient(stagingUrl.origin, env.MCP_STAGING_SUPABASE_ANON_KEY, options);
const loginA = await clientA.auth.signInWithPassword({ email: env.MCP_STAGING_USER_A_EMAIL, password: env.MCP_STAGING_USER_A_PASSWORD });
const loginB = await clientB.auth.signInWithPassword({ email: env.MCP_STAGING_USER_B_EMAIL, password: env.MCP_STAGING_USER_B_PASSWORD });
assert.ifError(loginA.error);
assert.ifError(loginB.error);
const userA = loginA.data.user;
const userB = loginB.data.user;
assert.ok(userA && userB && userA.id !== userB.id);

const oauthA = createClient(stagingUrl.origin, env.MCP_STAGING_SUPABASE_ANON_KEY, {
  ...options, global: { headers: { Authorization: `Bearer ${env.MCP_STAGING_OAUTH_ACCESS_TOKEN_A}` } },
});
const oauthIdentity = await oauthA.auth.getUser(env.MCP_STAGING_OAUTH_ACCESS_TOKEN_A);
assert.ifError(oauthIdentity.error);
assert.equal(oauthIdentity.data.user?.id, userA.id);
const oauthClaims = JSON.parse(Buffer.from(env.MCP_STAGING_OAUTH_ACCESS_TOKEN_A.split(".")[1], "base64url").toString("utf8"));
assert.ok(oauthClaims.client_id, "The bypass test needs a real OAuth client token, not a web JWT.");

const suffix = crypto.randomUUID();
const title = `MCP staging ${suffix}`;
const created = await clientA.from("planned_purchases").insert({ user_id: userA.id, title, estimated_amount: 1 }).select("id").single();
assert.ifError(created.error);
const purchaseId = created.data.id;
const crossRead = await clientB.from("planned_purchases").select("id").eq("id", purchaseId);
assert.ifError(crossRead.error);
assert.equal(crossRead.data.length, 0, "User B read user A's purchase.");
const crossUpdate = await clientB.from("planned_purchases").update({ title: "Cross-user edit" }).eq("id", purchaseId).select("id");
assert.ifError(crossUpdate.error);
assert.equal(crossUpdate.data.length, 0, "User B edited user A's purchase.");
console.log("PASS: two-user isolation");

const oauthInsert = await oauthA.from("planned_purchases").insert({ user_id: userA.id, title: `Blocked ${suffix}` });
assert.ok(oauthInsert.error, "OAuth client inserted directly through Data API.");
const oauthUpdate = await oauthA.from("planned_purchases").update({ title: "Blocked edit" }).eq("id", purchaseId).select("id");
assert.ok(oauthUpdate.error || oauthUpdate.data.length === 0, "OAuth client edited directly through Data API.");
const oauthDelete = await oauthA.from("planned_purchases").delete().eq("id", purchaseId).select("id");
assert.ok(oauthDelete.error || oauthDelete.data.length === 0, "OAuth client deleted directly through Data API.");
console.log("PASS: OAuth Data API write bypass blocked");

const existingConnection = await clientA.from("routine_google_connections").select("id").eq("user_id", userA.id);
assert.ifError(existingConnection.error);
assert.equal(existingConnection.data.length, 0, "Use a fresh synthetic user without a Google connection.");
const fakeConnection = await clientA.from("routine_google_connections").insert({
  user_id: userA.id, status: "disconnected", encrypted_refresh_token: `synthetic-${suffix}`,
}).select("id").single();
assert.ifError(fakeConnection.error);
const oauthConnections = await oauthA.from("routine_google_connections").select("id,encrypted_refresh_token").eq("id", fakeConnection.data.id);
assert.ifError(oauthConnections.error);
assert.equal(oauthConnections.data.length, 0, "OAuth client read Google connection secrets.");
console.log("PASS: OAuth Data API cannot read Google connection tokens");

const audioPath = `${userA.id}/mcp-synthetic-${suffix}.wav`;
const syntheticAudio = new Uint8Array([82, 73, 70, 70, 0, 0, 0, 0, 87, 65, 86, 69]);
const webUpload = await clientA.storage.from("voice-captures").upload(audioPath, syntheticAudio, { contentType: "audio/wav" });
assert.ifError(webUpload.error);
const oauthDownload = await oauthA.storage.from("voice-captures").download(audioPath);
assert.ok(oauthDownload.error, "OAuth client downloaded a private voice capture.");
const oauthUpload = await oauthA.storage.from("voice-captures").upload(`${userA.id}/mcp-blocked-${suffix}.wav`, syntheticAudio, { contentType: "audio/wav" });
assert.ok(oauthUpload.error, "OAuth client uploaded to private voice captures.");
console.log("PASS: OAuth Storage access blocked");

const signature = "a".repeat(64);
const createProposal = async (argumentsValue, expiresAt = new Date(Date.now() + 60_000).toISOString()) => {
  const inserted = await oauthA.from("mcp_action_requests").insert({
    user_id: userA.id, tool_name: "hub_create_planned_purchase", arguments: argumentsValue,
    intent_signature: signature, expires_at: expiresAt,
  }).select("id").single();
  assert.ifError(inserted.error);
  return inserted.data.id;
};
const decide = (client, id) => client.rpc("mcp_decide_planning_action", {
  p_request_id: id, p_intent_signature: signature, p_decision: "approve",
});

const proposalTitle = `Approved MCP staging ${suffix}`;
const proposalId = await createProposal({ title: proposalTitle, estimatedAmount: 2, _version: null });
assert.ok((await decide(oauthA, proposalId)).error, "OAuth bearer approved its own proposal.");
assert.ok((await decide(clientB, proposalId)).error, "User B approved user A's proposal.");
const approved = await decide(clientA, proposalId);
assert.ifError(approved.error);
const repeated = await decide(clientA, proposalId);
assert.ifError(repeated.error);
assert.deepEqual(repeated.data, approved.data);
const createdOnce = await clientA.from("planned_purchases").select("id").eq("title", proposalTitle);
assert.ifError(createdOnce.error);
assert.equal(createdOnce.data.length, 1, "Repeat approval duplicated the purchase.");
const approvedAudit = await clientA.from("audit_logs").select("id").contains("metadata", { confirmation_id: proposalId });
assert.ifError(approvedAudit.error);
assert.equal(approvedAudit.data.length, 1, "Approved write did not have exactly one audit entry.");
console.log("PASS: independent approval, cross-user denial and replay");

const failedTitle = `Failed MCP staging ${suffix}`;
const failedId = await createProposal({ title: failedTitle, estimatedAmount: 2, categoryId: crypto.randomUUID(), _version: null });
assert.ok((await decide(clientA, failedId)).error, "Invalid category should abort the transaction.");
const failedRequest = await clientA.from("mcp_action_requests").select("status").eq("id", failedId).single();
assert.ifError(failedRequest.error);
assert.equal(failedRequest.data.status, "pending", "Failed transaction changed request state.");
const failedPurchase = await clientA.from("planned_purchases").select("id").eq("title", failedTitle);
assert.ifError(failedPurchase.error);
assert.equal(failedPurchase.data.length, 0, "Failed transaction inserted a purchase.");
const failedAudit = await clientA.from("audit_logs").select("id").contains("metadata", { confirmation_id: failedId });
assert.ifError(failedAudit.error);
assert.equal(failedAudit.data.length, 0, "Failed transaction inserted an audit entry.");
console.log("PASS: failed transaction rolled back proposal, record and audit");

const expiredId = await createProposal({ title: `Expired MCP staging ${suffix}`, _version: null }, new Date(Date.now() + 1500).toISOString());
await new Promise((resolve) => setTimeout(resolve, 2000));
assert.ok((await decide(clientA, expiredId)).error, "Expired proposal was approved.");
console.log("PASS: expiration");
