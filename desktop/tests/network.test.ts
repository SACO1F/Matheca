import { it, expect, vi, afterEach } from "vitest";
import https from "node:https";
import { EventEmitter } from "node:events";
import { complete } from "../src/main/network";
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});
function request(image?: string | string[]) {
  vi.useFakeTimers();
  const req = Object.assign(new EventEmitter(), {
    destroy: vi.fn(),
    end: vi.fn(),
  });
  let response: (r: unknown) => void = () => {};
  vi.spyOn(https, "request").mockImplementation((...args: any[]) => {
    response = args[2];
    return req as any;
  });
  const controller = new AbortController();
  const promise = complete(
    {
      endpoint: "https://localhost/v1/chat/completions",
      model: "test",
      key: "secret",
    },
    "prompt",
    image,
    controller.signal,
  );
  return { req, controller, promise, response: (r: unknown) => response(r) };
}
it("sends adjacent page images in reading order in one request", async () => {
  const t = request([
    "data:image/jpeg;base64,first",
    "data:image/jpeg;base64,second",
  ]);
  const payload = JSON.parse(t.req.end.mock.calls[0][0].toString());
  expect(
    payload.messages[0].content.slice(1).map((p: any) => p.image_url.url),
  ).toEqual(["data:image/jpeg;base64,first", "data:image/jpeg;base64,second"]);
  const rejected = expect(t.promise).rejects.toThrow("任务已停止");
  t.controller.abort();
  await rejected;
});
it("connect timeout aborts and produces a safe message", async () => {
  const t = request(),
    rejected = expect(t.promise).rejects.toThrow("连接服务超时");
  await vi.advanceTimersByTimeAsync(20000);
  await rejected;
  expect(t.req.destroy).toHaveBeenCalledOnce();
});
it("write timeout is measured after TLS connects", async () => {
  const t = request(),
    socket = new EventEmitter(),
    rejected = expect(t.promise).rejects.toThrow("上传超时");
  t.req.emit("socket", socket);
  socket.emit("secureConnect");
  await vi.advanceTimersByTimeAsync(45000);
  await rejected;
});
it("total timeout remains active after upload completes", async () => {
  const t = request(),
    socket = new EventEmitter(),
    rejected = expect(t.promise).rejects.toThrow("接口请求超时");
  t.req.emit("socket", socket);
  socket.emit("secureConnect");
  t.req.emit("finish");
  await vi.advanceTimersByTimeAsync(150000);
  await rejected;
});
it("read timeout stops a stalled response", async () => {
  const t = request(),
    res = Object.assign(new EventEmitter(), {
      statusCode: 200,
      resume: vi.fn(),
      setTimeout: vi.fn(),
    });
  const rejected = expect(t.promise).rejects.toThrow("读取接口响应超时");
  t.response(res);
  res.setTimeout.mock.calls[0][1]();
  await rejected;
});
it("cancellation and connection errors never echo service secrets", async () => {
  const t = request(),
    rejected = expect(t.promise).rejects.toThrow("任务已停止");
  t.controller.abort();
  await rejected;
  const u = request(),
    failure = expect(u.promise).rejects.toThrow("无法连接服务");
  u.req.emit("error", Error("secret remote data"));
  await failure;
});
it("HTTP errors do not expose the body and redirects are refused", async () => {
  const t = request(),
    rejected = expect(t.promise).rejects.toThrow("重定向");
  t.response({ statusCode: 302, resume: vi.fn() });
  await rejected;
});
