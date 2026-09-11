import { afterEach, describe, expect, it } from "vitest";
import {
  getSlackRegiChannelIds,
  getSlackRegiProjectSlug,
  getSlackSocketModeProcess,
  getSlackUserMap,
  isSlackAppToken,
  isSlackConfigured,
  isSlackSocketModeConfigured,
} from "@/lib/env";

const KEYS = [
  "SLACK_BOT_TOKEN",
  "SLACK_SIGNING_SECRET",
  "SLACK_APP_TOKEN",
  "SLACK_SOCKET_MODE",
  "SLACK_REGI_PROJECT_SLUG",
  "SLACK_REGI_CHANNEL_IDS",
  "SLACK_USER_MAP",
] as const;

const prior: Record<string, string | undefined> = {};

describe("Slack env helpers", () => {
  afterEach(() => {
    for (const key of KEYS) {
      if (prior[key] === undefined) delete process.env[key];
      else process.env[key] = prior[key];
    }
  });

  it("is unconfigured without token + signing secret", () => {
    for (const key of KEYS) {
      prior[key] = process.env[key];
      delete process.env[key];
    }
    expect(isSlackConfigured()).toBe(false);
    expect(isSlackSocketModeConfigured()).toBe(false);
    expect(getSlackSocketModeProcess()).toBe("in-process");
    expect(getSlackRegiProjectSlug()).toBe("regi");
    expect(getSlackUserMap()).toEqual({});
  });

  it("parses the user map and channel allowlist", () => {
    for (const key of KEYS) prior[key] = process.env[key];
    process.env.SLACK_BOT_TOKEN = "xoxb-test";
    process.env.SLACK_SIGNING_SECRET = "secret";
    process.env.SLACK_REGI_CHANNEL_IDS = "C1, C2";
    process.env.SLACK_USER_MAP = "U012ABC:adam, U034DEF:derek";
    expect(isSlackConfigured()).toBe(true);
    expect(getSlackRegiChannelIds()).toEqual(["C1", "C2"]);
    expect(getSlackUserMap()).toEqual({
      U012ABC: "adam",
      U034DEF: "derek",
    });
    expect(isSlackSocketModeConfigured()).toBe(false);
  });

  it("enables Socket Mode only for an xapp- app token", () => {
    for (const key of KEYS) prior[key] = process.env[key];
    process.env.SLACK_BOT_TOKEN = "xoxb-test";
    process.env.SLACK_SIGNING_SECRET = "secret";
    process.env.SLACK_APP_TOKEN = "xapp-1-regi";
    expect(isSlackAppToken("xapp-1-regi")).toBe(true);
    expect(isSlackSocketModeConfigured()).toBe(true);
    process.env.SLACK_APP_TOKEN = "xoxb-nope";
    expect(isSlackSocketModeConfigured()).toBe(false);
    process.env.SLACK_SOCKET_MODE = "standalone";
    expect(getSlackSocketModeProcess()).toBe("standalone");
    process.env.SLACK_SOCKET_MODE = "off";
    expect(getSlackSocketModeProcess()).toBe("off");
  });
});
