/**
 * Vercel OAuth relay checks.
 *
 * These exercise the deployed serverless handlers with mock requests and a
 * mocked upstream, so they do not create a real GitHub device code.
 */

import configHandler from "../api/github/oauth/config.mjs";
import deviceHandler from "../api/github/oauth/device-code.mjs";
import tokenHandler from "../api/github/oauth/access-token.mjs";

let passed = 0;
const failures = [];
const check = (condition, message) => {
  if (condition) passed += 1;
  else failures.push(message);
};

const makeResponse = () => ({
  statusCode: 0,
  headers: {},
  body: null,
  setHeader(key, value) {
    this.headers[key] = value;
  },
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(value) {
    this.body = value;
    return this;
  },
  send(value) {
    this.body = value;
    return this;
  },
});

const request = (method, body) => ({ method, body });

const validClientId = "Ov23liTestClientId123";
const originalFetch = globalThis.fetch;

delete process.env.GITHUB_OAUTH_CLIENT_ID;
process.env.GITHUB_OAUTH_CLIENT_ID = validClientId;

// Config endpoint.
let response = makeResponse();
configHandler(request("GET"), response);
check(response.statusCode === 200, "config returns 200");
check(response.body.clientId === validClientId, "config returns env client id");
check(response.body.proxy === true, "config advertises the proxy");
check(response.headers["Cache-Control"] === "no-store", "config is not cached");

response = makeResponse();
configHandler(request("POST"), response);
check(response.statusCode === 405, "config rejects POST");

delete process.env.GITHUB_OAUTH_CLIENT_ID;
response = makeResponse();
configHandler(request("GET"), response);
check(response.statusCode === 200 && response.body.clientId === "", "config tolerates a missing env var");
process.env.GITHUB_OAUTH_CLIENT_ID = validClientId;

// Device-code validation.
delete process.env.GITHUB_OAUTH_CLIENT_ID;
response = makeResponse();
await deviceHandler(request("POST", "client_id=&scope=repo"), response);
check(response.statusCode === 500, "device code rejects a missing client id");
process.env.GITHUB_OAUTH_CLIENT_ID = validClientId;

response = makeResponse();
await deviceHandler(request("POST", "client_id=short&scope=repo"), response);
check(response.statusCode === 400, "device code rejects a malformed client id");

// Device-code forwarding.
let captured = null;
globalThis.fetch = async (url, init) => {
  captured = { url, init };
  return new Response(
    JSON.stringify({
      device_code: "device-123",
      user_code: "ABCD-EFGH",
      verification_uri: "https://github.com/login/device",
      expires_in: 900,
      interval: 5,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
};
response = makeResponse();
await deviceHandler(
  request("POST", `client_id=${validClientId}&scope=repo`),
  response,
);
check(captured?.url === "https://github.com/login/device/code", "device code calls GitHub");
check(captured?.init?.method === "POST", "device code uses POST");
check(
  captured?.init?.body?.toString().includes(`client_id=${validClientId}`),
  "device code forwards the client id",
);
check(
  captured?.init?.body?.toString().includes("scope=repo"),
  "device code requests repo scope",
);
check(response.statusCode === 200, "device code passes through GitHub status");
check(JSON.parse(response.body).user_code === "ABCD-EFGH", "device code passes through JSON");

// Access-token validation.
response = makeResponse();
await tokenHandler(request("POST", `client_id=${validClientId}`), response);
check(response.statusCode === 400, "token relay requires a device code");

// Access-token forwarding.
captured = null;
globalThis.fetch = async (url, init) => {
  captured = { url, init };
  return new Response(JSON.stringify({ error: "authorization_pending" }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
response = makeResponse();
await tokenHandler(
  request("POST", `client_id=${validClientId}&device_code=device-123`),
  response,
);
check(
  captured?.url === "https://github.com/login/oauth/access_token",
  "token relay calls GitHub",
);
check(
  captured?.init?.body?.toString().includes("grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Adevice_code"),
  "token relay sends the device grant type",
);
check(JSON.parse(response.body).error === "authorization_pending", "token relay passes pending state");

globalThis.fetch = originalFetch;
delete process.env.GITHUB_OAUTH_CLIENT_ID;

if (failures.length > 0) {
  console.error(`OAuth relay checks failed (${failures.length}).`);
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  process.exit(1);
}
console.log(`OAuth relay checks passed (${passed} assertions).`);
