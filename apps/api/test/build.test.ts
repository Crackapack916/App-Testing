import { describe, expect, it } from "vitest";
import { appFromEnv } from "../src/build";

const base = { DATABASE_URL: "postgres://unused@127.0.0.1:1/x", JWT_SECRET: "s" };

describe("production configuration", () => {
  it("refuses pilot sign in, the test clock, or a missing Clerk key in production", () => {
    expect(() => appFromEnv({ ...base, CRACKAPACK_ENV: "production", CLERK_JWT_KEY: "k", DEV_LOGIN: "1" })).toThrow(/not allowed/);
    expect(() => appFromEnv({ ...base, CRACKAPACK_ENV: "production", CLERK_JWT_KEY: "k", TEST_CLOCK: "1" })).toThrow(/not allowed/);
    expect(() => appFromEnv({ ...base, CRACKAPACK_ENV: "production" })).toThrow(/CLERK_JWT_KEY/);
    expect(() => appFromEnv({ ...base, CRACKAPACK_ENV: "production", CLERK_JWT_KEY: "k" })).not.toThrow();
    // A Vercel preview runs with NODE_ENV=production but is still a pilot.
    expect(() => appFromEnv({ ...base, NODE_ENV: "production", CRACKAPACK_ENV: "preview", DEV_LOGIN: "1" })).not.toThrow();
  });

  it("needs every Mux setting once Mux is on", () => {
    expect(() => appFromEnv({ ...base, MUX_TOKEN_ID: "id" })).toThrow(/MUX_TOKEN_SECRET/);
  });
});
