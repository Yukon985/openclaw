import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  __testing,
  getSessionBindingService,
  isSessionBindingError,
  registerSessionBindingAdapter,
  unregisterSessionBindingAdapter,
  type SessionBindingBindInput,
  type SessionBindingRecord,
} from "./session-binding-service.js";

function createRecord(input: SessionBindingBindInput): SessionBindingRecord {
  const conversationId =
    input.placement === "child"
      ? "thread-created"
      : input.conversation.conversationId.trim() || "thread-current";
  return {
    bindingId: `default:${conversationId}`,
    targetSessionKey: input.targetSessionKey,
    targetKind: input.targetKind,
    conversation: {
      channel: "discord",
      accountId: "default",
      conversationId,
      parentConversationId: input.conversation.parentConversationId?.trim() || undefined,
    },
    status: "active",
    boundAt: 1,
  };
}

describe("session binding service", () => {
  beforeEach(() => {
    __testing.resetSessionBindingAdaptersForTests();
  });

  it("normalizes conversation refs and infers current placement", async () => {
    const bind = vi.fn(async (input: SessionBindingBindInput) => createRecord(input));
    registerSessionBindingAdapter({
      channel: "discord",
      accountId: "default",
      bind,
      listBySession: () => [],
      resolveByConversation: () => null,
    });

    const result = await getSessionBindingService().bind({
      targetSessionKey: "agent:main:subagent:child-1",
      targetKind: "subagent",
      conversation: {
        channel: "Discord",
        accountId: "DEFAULT",
        conversationId: " thread-1 ",
      },
    });

    expect(result.conversation.channel).toBe("discord");
    expect(result.conversation.accountId).toBe("default");
    expect(bind).toHaveBeenCalledWith(
      expect.objectContaining({
        placement: "current",
        conversation: expect.objectContaining({
          channel: "discord",
          accountId: "default",
          conversationId: "thread-1",
        }),
      }),
    );
  });

  it("supports explicit child placement when adapter advertises it", async () => {
    registerSessionBindingAdapter({
      channel: "discord",
      accountId: "default",
      capabilities: { placements: ["child"] },
      bind: async (input) => createRecord(input),
      listBySession: () => [],
      resolveByConversation: () => null,
    });

    const result = await getSessionBindingService().bind({
      targetSessionKey: "agent:codex:acp:1",
      targetKind: "session",
      conversation: {
        channel: "discord",
        accountId: "default",
        conversationId: "thread-1",
      },
      placement: "child",
    });

    expect(result.conversation.conversationId).toBe("thread-created");
  });

  it("returns structured errors when adapter is unavailable", async () => {
    await expect(
      getSessionBindingService().bind({
        targetSessionKey: "agent:main:subagent:child-1",
        targetKind: "subagent",
        conversation: {
          channel: "discord",
          accountId: "default",
          conversationId: "thread-1",
        },
      }),
    ).rejects.toMatchObject({
      code: "BINDING_ADAPTER_UNAVAILABLE",
    });
  });

  it("returns structured errors for unsupported placement", async () => {
    registerSessionBindingAdapter({
      channel: "discord",
      accountId: "default",
      capabilities: { placements: ["current"] },
      bind: async (input) => createRecord(input),
      listBySession: () => [],
      resolveByConversation: () => null,
    });

    const rejected = await getSessionBindingService()
      .bind({
        targetSessionKey: "agent:codex:acp:1",
        targetKind: "session",
        conversation: {
          channel: "discord",
          accountId: "default",
          conversationId: "thread-1",
        },
        placement: "child",
      })
      .catch((error) => error);

    expect(isSessionBindingError(rejected)).toBe(true);
    expect(rejected).toMatchObject({
      code: "BINDING_CAPABILITY_UNSUPPORTED",
      details: {
        placement: "child",
      },
    });
  });

  it("returns structured errors when adapter bind fails", async () => {
    registerSessionBindingAdapter({
      channel: "discord",
      accountId: "default",
      bind: async () => null,
      listBySession: () => [],
      resolveByConversation: () => null,
    });

    await expect(
      getSessionBindingService().bind({
        targetSessionKey: "agent:main:subagent:child-1",
        targetKind: "subagent",
        conversation: {
          channel: "discord",
          accountId: "default",
          conversationId: "thread-1",
        },
      }),
    ).rejects.toMatchObject({
      code: "BINDING_CREATE_FAILED",
    });
  });

  it("reports adapter capabilities for command preflight messaging", () => {
    registerSessionBindingAdapter({
      channel: "discord",
      accountId: "default",
      capabilities: {
        placements: ["current", "child"],
      },
      bind: async (input) => createRecord(input),
      listBySession: () => [],
      resolveByConversation: () => null,
      unbind: async () => [],
    });

    const known = getSessionBindingService().getCapabilities({
      channel: "discord",
      accountId: "default",
    });
    const unknown = getSessionBindingService().getCapabilities({
      channel: "discord",
      accountId: "other",
    });

    expect(known).toEqual({
      adapterAvailable: true,
      bindSupported: true,
      unbindSupported: true,
      placements: ["current", "child"],
    });
    expect(unknown).toEqual({
      adapterAvailable: false,
      bindSupported: false,
      unbindSupported: false,
      placements: [],
    });
  });

  it("rejects duplicate adapter registration for the same channel account", () => {
    registerSessionBindingAdapter({
      channel: "discord",
      accountId: "default",
      bind: async (input) => createRecord(input),
      listBySession: () => [],
      resolveByConversation: () => null,
    });

    expect(() =>
      registerSessionBindingAdapter({
        channel: "Discord",
        accountId: "DEFAULT",
        bind: async (input) => createRecord(input),
        listBySession: () => [],
        resolveByConversation: () => null,
      }),
    ).toThrow("Session binding adapter already registered for discord:default");
  });

  it("unregisters adapter so re-registration succeeds", () => {
    registerSessionBindingAdapter({
      channel: "discord",
      accountId: "default",
      listBySession: () => [],
      resolveByConversation: () => null,
    });

    unregisterSessionBindingAdapter({ channel: "discord", accountId: "default" });

    expect(() =>
      registerSessionBindingAdapter({
        channel: "discord",
        accountId: "default",
        listBySession: () => [],
        resolveByConversation: () => null,
      }),
    ).not.toThrow();
  });

  it("listBySession aggregates records from all adapters and deduplicates", () => {
    const record1: SessionBindingRecord = {
      bindingId: "default:thread-1",
      targetSessionKey: "agent:main:subagent:child-1",
      targetKind: "subagent",
      conversation: { channel: "discord", accountId: "default", conversationId: "thread-1" },
      status: "active",
      boundAt: 1,
    };
    const record2: SessionBindingRecord = {
      bindingId: "bot:thread-2",
      targetSessionKey: "agent:main:subagent:child-1",
      targetKind: "subagent",
      conversation: { channel: "telegram", accountId: "bot", conversationId: "thread-2" },
      status: "active",
      boundAt: 2,
    };

    registerSessionBindingAdapter({
      channel: "discord",
      accountId: "default",
      listBySession: (key) => (key === "agent:main:subagent:child-1" ? [record1] : []),
      resolveByConversation: () => null,
    });
    registerSessionBindingAdapter({
      channel: "telegram",
      accountId: "bot",
      listBySession: (key) => (key === "agent:main:subagent:child-1" ? [record2] : []),
      resolveByConversation: () => null,
    });

    const results = getSessionBindingService().listBySession("agent:main:subagent:child-1");
    expect(results).toHaveLength(2);
    expect(results.map((r) => r.bindingId).toSorted()).toEqual([
      "bot:thread-2",
      "default:thread-1",
    ]);
  });

  it("listBySession deduplicates records with the same bindingId", () => {
    const record: SessionBindingRecord = {
      bindingId: "shared:thread-1",
      targetSessionKey: "agent:main:subagent:child-1",
      targetKind: "subagent",
      conversation: { channel: "discord", accountId: "default", conversationId: "thread-1" },
      status: "active",
      boundAt: 1,
    };

    registerSessionBindingAdapter({
      channel: "discord",
      accountId: "default",
      listBySession: () => [record, record],
      resolveByConversation: () => null,
    });

    const results = getSessionBindingService().listBySession("agent:main:subagent:child-1");
    expect(results).toHaveLength(1);
  });

  it("listBySession returns empty array for empty or whitespace-only key", () => {
    registerSessionBindingAdapter({
      channel: "discord",
      accountId: "default",
      listBySession: () => [
        {
          bindingId: "x",
          targetSessionKey: "",
          targetKind: "subagent",
          conversation: { channel: "discord", accountId: "default", conversationId: "c" },
          status: "active",
          boundAt: 1,
        },
      ],
      resolveByConversation: () => null,
    });

    expect(getSessionBindingService().listBySession("")).toEqual([]);
    expect(getSessionBindingService().listBySession("   ")).toEqual([]);
  });

  it("resolveByConversation delegates to correct adapter", () => {
    const record: SessionBindingRecord = {
      bindingId: "default:thread-1",
      targetSessionKey: "agent:main:subagent:child-1",
      targetKind: "subagent",
      conversation: { channel: "discord", accountId: "default", conversationId: "thread-1" },
      status: "active",
      boundAt: 1,
    };

    registerSessionBindingAdapter({
      channel: "discord",
      accountId: "default",
      listBySession: () => [],
      resolveByConversation: (ref) => (ref.conversationId === "thread-1" ? record : null),
    });

    const found = getSessionBindingService().resolveByConversation({
      channel: "Discord",
      accountId: "DEFAULT",
      conversationId: "thread-1",
    });
    expect(found).toBe(record);

    const missing = getSessionBindingService().resolveByConversation({
      channel: "discord",
      accountId: "default",
      conversationId: "unknown",
    });
    expect(missing).toBeNull();
  });

  it("resolveByConversation returns null when no adapter registered for channel/account", () => {
    const result = getSessionBindingService().resolveByConversation({
      channel: "discord",
      accountId: "default",
      conversationId: "thread-1",
    });
    expect(result).toBeNull();
  });

  it("resolveByConversation returns null for empty channel or conversationId", () => {
    registerSessionBindingAdapter({
      channel: "discord",
      accountId: "default",
      listBySession: () => [],
      resolveByConversation: () => ({
        bindingId: "x",
        targetSessionKey: "s",
        targetKind: "subagent",
        conversation: { channel: "discord", accountId: "default", conversationId: "c" },
        status: "active",
        boundAt: 1,
      }),
    });

    expect(
      getSessionBindingService().resolveByConversation({
        channel: "",
        accountId: "default",
        conversationId: "thread-1",
      }),
    ).toBeNull();

    expect(
      getSessionBindingService().resolveByConversation({
        channel: "discord",
        accountId: "default",
        conversationId: "",
      }),
    ).toBeNull();
  });

  it("touch forwards bindingId to all adapters that support it", () => {
    const touch1 = vi.fn();
    const touch2 = vi.fn();

    registerSessionBindingAdapter({
      channel: "discord",
      accountId: "default",
      listBySession: () => [],
      resolveByConversation: () => null,
      touch: touch1,
    });
    registerSessionBindingAdapter({
      channel: "telegram",
      accountId: "bot",
      listBySession: () => [],
      resolveByConversation: () => null,
      touch: touch2,
    });

    getSessionBindingService().touch("default:thread-1", 12345);

    expect(touch1).toHaveBeenCalledWith("default:thread-1", 12345);
    expect(touch2).toHaveBeenCalledWith("default:thread-1", 12345);
  });

  it("touch skips adapters that do not implement touch", () => {
    registerSessionBindingAdapter({
      channel: "discord",
      accountId: "default",
      listBySession: () => [],
      resolveByConversation: () => null,
      // no touch
    });

    expect(() => getSessionBindingService().touch("default:thread-1")).not.toThrow();
  });

  it("touch does nothing for empty or whitespace-only bindingId", () => {
    const touch = vi.fn();
    registerSessionBindingAdapter({
      channel: "discord",
      accountId: "default",
      listBySession: () => [],
      resolveByConversation: () => null,
      touch,
    });

    getSessionBindingService().touch("");
    getSessionBindingService().touch("   ");

    expect(touch).not.toHaveBeenCalled();
  });

  it("unbind collects results from all adapters and deduplicates", async () => {
    const record1: SessionBindingRecord = {
      bindingId: "default:thread-1",
      targetSessionKey: "agent:main:subagent:child-1",
      targetKind: "subagent",
      conversation: { channel: "discord", accountId: "default", conversationId: "thread-1" },
      status: "ended",
      boundAt: 1,
    };
    const record2: SessionBindingRecord = {
      bindingId: "bot:thread-2",
      targetSessionKey: "agent:main:subagent:child-1",
      targetKind: "subagent",
      conversation: { channel: "telegram", accountId: "bot", conversationId: "thread-2" },
      status: "ended",
      boundAt: 2,
    };

    registerSessionBindingAdapter({
      channel: "discord",
      accountId: "default",
      listBySession: () => [],
      resolveByConversation: () => null,
      unbind: async () => [record1],
    });
    registerSessionBindingAdapter({
      channel: "telegram",
      accountId: "bot",
      listBySession: () => [],
      resolveByConversation: () => null,
      unbind: async () => [record2],
    });

    const removed = await getSessionBindingService().unbind({
      targetSessionKey: "agent:main:subagent:child-1",
      reason: "test",
    });

    expect(removed).toHaveLength(2);
    expect(removed.map((r) => r.bindingId).toSorted()).toEqual([
      "bot:thread-2",
      "default:thread-1",
    ]);
  });

  it("unbind skips adapters that do not implement unbind", async () => {
    registerSessionBindingAdapter({
      channel: "discord",
      accountId: "default",
      listBySession: () => [],
      resolveByConversation: () => null,
      // no unbind
    });

    const removed = await getSessionBindingService().unbind({
      targetSessionKey: "agent:main:subagent:child-1",
      reason: "test",
    });

    expect(removed).toEqual([]);
  });

  it("reflects registered adapter state", () => {
    expect(__testing.getRegisteredAdapterKeys()).toEqual([]);

    registerSessionBindingAdapter({
      channel: "discord",
      accountId: "default",
      listBySession: () => [],
      resolveByConversation: () => null,
    });

    expect(__testing.getRegisteredAdapterKeys()).toEqual(["discord:default"]);
  });
});
