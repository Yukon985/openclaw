import { describe, expect, it } from "vitest";
import type { OpenClawConfig } from "../config/config.js";
import {
  buildChannelAccountBindings,
  listBoundAccountIds,
  resolveDefaultAgentBoundAccountId,
  resolvePreferredAccountId,
} from "./bindings.js";

describe("listBoundAccountIds", () => {
  it("returns account ids bound to a channel", () => {
    const cfg: OpenClawConfig = {
      bindings: [
        { type: "route", agentId: "main", match: { channel: "discord", accountId: "default" } },
        { type: "route", agentId: "bot", match: { channel: "discord", accountId: "secondary" } },
        { type: "route", agentId: "main", match: { channel: "telegram", accountId: "bot" } },
      ],
    };

    const ids = listBoundAccountIds(cfg, "discord");
    expect(ids).toEqual(["default", "secondary"]);
  });

  it("returns sorted account ids", () => {
    const cfg: OpenClawConfig = {
      bindings: [
        { type: "route", agentId: "main", match: { channel: "discord", accountId: "zeta" } },
        { type: "route", agentId: "bot", match: { channel: "discord", accountId: "alpha" } },
      ],
    };

    expect(listBoundAccountIds(cfg, "discord")).toEqual(["alpha", "zeta"]);
  });

  it("deduplicates account ids bound to the same channel by multiple agents", () => {
    const cfg: OpenClawConfig = {
      bindings: [
        { type: "route", agentId: "main", match: { channel: "discord", accountId: "default" } },
        { type: "route", agentId: "bot", match: { channel: "discord", accountId: "default" } },
      ],
    };

    expect(listBoundAccountIds(cfg, "discord")).toEqual(["default"]);
  });

  it("returns empty array when no bindings match channel", () => {
    const cfg: OpenClawConfig = {
      bindings: [
        { type: "route", agentId: "main", match: { channel: "telegram", accountId: "bot" } },
      ],
    };

    expect(listBoundAccountIds(cfg, "discord")).toEqual([]);
  });

  it("returns empty array when bindings is absent", () => {
    expect(listBoundAccountIds({}, "discord")).toEqual([]);
  });

  it("returns empty array for empty channel id", () => {
    const cfg: OpenClawConfig = {
      bindings: [
        { type: "route", agentId: "main", match: { channel: "discord", accountId: "default" } },
      ],
    };

    expect(listBoundAccountIds(cfg, "")).toEqual([]);
  });

  it("skips bindings with wildcard or empty accountId", () => {
    const cfg: OpenClawConfig = {
      bindings: [
        { type: "route", agentId: "main", match: { channel: "discord", accountId: "*" } },
        { type: "route", agentId: "bot", match: { channel: "discord" } },
      ],
    };

    expect(listBoundAccountIds(cfg, "discord")).toEqual([]);
  });
});

describe("resolveDefaultAgentBoundAccountId", () => {
  it("returns account id for the default agent", () => {
    const cfg: OpenClawConfig = {
      agents: {
        list: [{ id: "main", default: true }, { id: "bot" }],
      },
      bindings: [
        { type: "route", agentId: "main", match: { channel: "discord", accountId: "default" } },
        { type: "route", agentId: "bot", match: { channel: "discord", accountId: "secondary" } },
      ],
    };

    expect(resolveDefaultAgentBoundAccountId(cfg, "discord")).toBe("default");
  });

  it("returns null when default agent has no binding for the channel", () => {
    const cfg: OpenClawConfig = {
      agents: { list: [{ id: "main", default: true }] },
      bindings: [
        { type: "route", agentId: "main", match: { channel: "telegram", accountId: "bot" } },
      ],
    };

    expect(resolveDefaultAgentBoundAccountId(cfg, "discord")).toBeNull();
  });

  it("returns null for empty channel id", () => {
    const cfg: OpenClawConfig = {
      bindings: [
        { type: "route", agentId: "main", match: { channel: "discord", accountId: "default" } },
      ],
    };

    expect(resolveDefaultAgentBoundAccountId(cfg, "")).toBeNull();
  });

  it("returns null when bindings is absent", () => {
    expect(resolveDefaultAgentBoundAccountId({}, "discord")).toBeNull();
  });
});

describe("buildChannelAccountBindings", () => {
  it("builds a channel -> agent -> accounts map", () => {
    const cfg: OpenClawConfig = {
      bindings: [
        { type: "route", agentId: "main", match: { channel: "discord", accountId: "default" } },
        { type: "route", agentId: "bot", match: { channel: "discord", accountId: "secondary" } },
        { type: "route", agentId: "main", match: { channel: "telegram", accountId: "tg-bot" } },
      ],
    };

    const map = buildChannelAccountBindings(cfg);

    const discordMap = map.get("discord");
    expect(discordMap).toBeDefined();
    expect(discordMap?.get("main")).toEqual(["default"]);
    expect(discordMap?.get("bot")).toEqual(["secondary"]);

    const telegramMap = map.get("telegram");
    expect(telegramMap).toBeDefined();
    expect(telegramMap?.get("main")).toEqual(["tg-bot"]);
  });

  it("accumulates multiple accounts per agent per channel", () => {
    const cfg: OpenClawConfig = {
      bindings: [
        { type: "route", agentId: "main", match: { channel: "discord", accountId: "default" } },
        { type: "route", agentId: "main", match: { channel: "discord", accountId: "secondary" } },
      ],
    };

    const map = buildChannelAccountBindings(cfg);
    expect(map.get("discord")?.get("main")).toEqual(["default", "secondary"]);
  });

  it("deduplicates duplicate account IDs for same agent", () => {
    const cfg: OpenClawConfig = {
      bindings: [
        { type: "route", agentId: "main", match: { channel: "discord", accountId: "default" } },
        { type: "route", agentId: "main", match: { channel: "discord", accountId: "default" } },
      ],
    };

    const map = buildChannelAccountBindings(cfg);
    expect(map.get("discord")?.get("main")).toEqual(["default"]);
  });

  it("returns empty map when bindings is absent", () => {
    const map = buildChannelAccountBindings({});
    expect(map.size).toBe(0);
  });

  it("skips bindings with wildcard or empty accountId", () => {
    const cfg: OpenClawConfig = {
      bindings: [
        { type: "route", agentId: "main", match: { channel: "discord", accountId: "*" } },
        { type: "route", agentId: "bot", match: { channel: "discord" } },
      ],
    };

    const map = buildChannelAccountBindings(cfg);
    expect(map.size).toBe(0);
  });
});

describe("resolvePreferredAccountId", () => {
  it("returns first bound account when available", () => {
    const result = resolvePreferredAccountId({
      accountIds: ["alpha", "beta"],
      defaultAccountId: "default",
      boundAccounts: ["alpha"],
    });
    expect(result).toBe("alpha");
  });

  it("falls back to defaultAccountId when no bound accounts", () => {
    const result = resolvePreferredAccountId({
      accountIds: ["alpha"],
      defaultAccountId: "default",
      boundAccounts: [],
    });
    expect(result).toBe("default");
  });
});
