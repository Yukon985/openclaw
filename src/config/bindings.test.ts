import { describe, expect, it } from "vitest";
import {
  isAcpBinding,
  isRouteBinding,
  listAcpBindings,
  listConfiguredBindings,
  listRouteBindings,
} from "./bindings.js";
import type { OpenClawConfig } from "./config.js";
import type { AgentAcpBinding, AgentRouteBinding } from "./types.agents.js";

const routeBinding: AgentRouteBinding = {
  type: "route",
  agentId: "main",
  match: { channel: "discord", accountId: "default" },
};

const acpBinding: AgentAcpBinding = {
  type: "acp",
  agentId: "coding",
  match: { channel: "discord", accountId: "default", peer: { kind: "channel", id: "c1" } },
  acp: { mode: "persistent" },
};

// Route binding without explicit type (backward compat)
const implicitRouteBinding: AgentRouteBinding = {
  agentId: "main",
  match: { channel: "telegram", accountId: "bot" },
};

describe("isRouteBinding", () => {
  it("returns true for explicit route binding", () => {
    expect(isRouteBinding(routeBinding)).toBe(true);
  });

  it("returns true for binding without explicit type (backward compat)", () => {
    expect(isRouteBinding(implicitRouteBinding)).toBe(true);
  });

  it("returns false for acp binding", () => {
    expect(isRouteBinding(acpBinding)).toBe(false);
  });
});

describe("isAcpBinding", () => {
  it("returns true for acp binding", () => {
    expect(isAcpBinding(acpBinding)).toBe(true);
  });

  it("returns false for explicit route binding", () => {
    expect(isAcpBinding(routeBinding)).toBe(false);
  });

  it("returns false for binding without explicit type", () => {
    expect(isAcpBinding(implicitRouteBinding)).toBe(false);
  });
});

describe("listConfiguredBindings", () => {
  it("returns all bindings when present", () => {
    const cfg: OpenClawConfig = { bindings: [routeBinding, acpBinding] };
    expect(listConfiguredBindings(cfg)).toEqual([routeBinding, acpBinding]);
  });

  it("returns empty array when bindings is absent", () => {
    const cfg: OpenClawConfig = {};
    expect(listConfiguredBindings(cfg)).toEqual([]);
  });

  it("returns empty array when bindings is not an array", () => {
    // Force an invalid shape via type cast to test defensive guard
    const cfg = { bindings: null } as unknown as OpenClawConfig;
    expect(listConfiguredBindings(cfg)).toEqual([]);
  });
});

describe("listRouteBindings", () => {
  it("returns only route bindings", () => {
    const cfg: OpenClawConfig = {
      bindings: [routeBinding, acpBinding, implicitRouteBinding],
    };
    const result = listRouteBindings(cfg);
    expect(result).toHaveLength(2);
    expect(result).toContain(routeBinding);
    expect(result).toContain(implicitRouteBinding);
  });

  it("returns empty array when no route bindings exist", () => {
    const cfg: OpenClawConfig = { bindings: [acpBinding] };
    expect(listRouteBindings(cfg)).toEqual([]);
  });

  it("returns empty array when bindings is absent", () => {
    const cfg: OpenClawConfig = {};
    expect(listRouteBindings(cfg)).toEqual([]);
  });
});

describe("listAcpBindings", () => {
  it("returns only acp bindings", () => {
    const cfg: OpenClawConfig = {
      bindings: [routeBinding, acpBinding, implicitRouteBinding],
    };
    const result = listAcpBindings(cfg);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(acpBinding);
  });

  it("returns empty array when no acp bindings exist", () => {
    const cfg: OpenClawConfig = { bindings: [routeBinding] };
    expect(listAcpBindings(cfg)).toEqual([]);
  });

  it("returns empty array when bindings is absent", () => {
    const cfg: OpenClawConfig = {};
    expect(listAcpBindings(cfg)).toEqual([]);
  });
});
