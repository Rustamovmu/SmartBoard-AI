/** Explicit synthetic connection for HTTP tests; never contacts MongoDB. */
export function createConnectionStub() {
  const models: Record<string, object> = {};
  const hello = jest.fn().mockResolvedValue({
    setName: 'synthetic-replica',
    logicalSessionTimeoutMinutes: 30,
    maxWireVersion: 17,
  });
  const ping = jest.fn().mockResolvedValue({ ok: 1 });
  return {
    readyState: 0,
    models,
    model: (name: string) => (models[name] ??= {}),
    db: { command: ping, admin: () => ({ command: hello }) },
    close: jest.fn().mockResolvedValue(undefined),
    ping,
    hello,
  };
}
