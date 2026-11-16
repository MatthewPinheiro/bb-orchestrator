// Masking. Why it matters: CLI error text is shown on a page opened from another machine and printed into agent threads'
// transcripts; a token or key in it would leak there. Identity strings must survive, or the page can't say who you are.
import { test } from "node:test";
import assert from "node:assert/strict";
import { redact } from "../core/mask.ts";
import { list, makeCtx } from "../core/cloud.ts";
import { sandbox } from "./sandbox.ts";
import { readFileSync, writeFileSync } from "node:fs";

// The access key id and secret access key below are AWS's own published documentation examples, not real credentials.
const SECRETS = [
  "aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
  "aws_session_token=IQoJb3JpZ2luX2VjEXAMPLEtokenEXAMPLEtokenEXAMPLEtoken0123456789",
  '"accessToken": "aoaAAAAAGXEXAMPLEaccessTokenValue0123456789abcdefABCDEF"',
  "AKIAIOSFODNN7EXAMPLE",
  "ya29.a0AfB_byEXAMPLEgoogleAccessToken",
  "1//0gEXAMPLErefreshTokenEXAMPLEvalue",
  "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.c2lnbmF0dXJlc2lnbmF0dXJl",
  "Authorization: Bearer abc.def.ghi-EXAMPLE",
  "clientSecret-free: Q2xpZW50U2VjcmV0RVhBTVBMRVZhbHVlMDEyMzQ1Njc4OWFiY2RlZg==",
];
const VALUES = ["wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY", "IQoJb3JpZ2luX2Vj", "aoaAAAAAGXEXAMPLE", "AKIAIOSFODNN7EXAMPLE", "ya29.a0AfB", "1//0gEXAMPLE", "eyJhbGciOiJSUzI1NiJ9", "abc.def.ghi", "Q2xpZW50U2VjcmV0"];

test("redact removes every token, key and secret", () => {
  const out = redact(SECRETS.join("\n"));
  for (const v of VALUES) assert.ok(!out.includes(v), `leaked ${v} in: ${out}`);
});

test("redact keeps identities and the device-code link", () => {
  const keep = [
    "arn:aws:sts::111111111111:assumed-role/AWSReservedSSO_Engineers_0a1b2c3d/user@example.com",
    "principal://iam.googleapis.com/locations/global/workforcePools/fake-pool/subject/user@example.com",
    "https://device.sso.us-east-1.amazonaws.com/?user_code=ABCD-EFGH",
    "/home/someone/.aws/config",
    "222222222222",
  ];
  for (const k of keep) assert.equal(redact(k), k);
});

test("a secret in a CLI's error never reaches the listing", async () => {
  const box = sandbox();
  try {
    const state = JSON.parse(readFileSync(box.env.CLOUD_SWITCH_FAKE_STATE, "utf8"));
    state.aws["reports-prod"] = { error: "botocore debug: aws_session_token=IQoJb3JpZ2luX2VjEXAMPLEtokenEXAMPLEtokenEXAMPLEtoken0123456789 refused" };
    writeFileSync(box.env.CLOUD_SWITCH_FAKE_STATE, JSON.stringify(state));
    const l = await list(makeCtx(box.env), { aws: null, gcp: null }, "all");
    const json = JSON.stringify(l);
    assert.ok(!json.includes("IQoJb3JpZ2luX2Vj"), json);
    assert.match(l.targets.find((t) => t.name === "reports-prod")!.why!, /\[redacted\]/);
  } finally { box.done(); }
});
