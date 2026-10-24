// GET /dl/windows —— 让 Windows 安装包有一个 matheca.pages.dev 上的地址。
//
// Pages 的单个静态资产上限是 25 MiB（官方 Limits 文档），而这个 Setup 有
// 189.9 MiB，所以它不会被上传进站点，也没法 commit 进仓库（GitHub 拒收
// 单文件超过 100 MB）。这里改为在边缘把 GitHub 的 release 资产流式转发：
// 浏览器看到的是本站域名，实际字节由 Cloudflare 从 GitHub 取回。
//
// 透传 Range，断点续传与下载器分片照常工作；不确定的请求头一律不猜。
const SOURCE =
  "https://github.com/SACO1F/Matheca/releases/download/desktop-v0.1.0/Matheca-0.1.0-Setup.exe";
const FILENAME = "Matheca-0.1.0-Setup.exe";

export async function onRequest(context: { request: Request }): Promise<Response> {
  const range = context.request.headers.get("range");
  const headers: Record<string, string> = {};
  if (range) headers.range = range;

  let upstream: Response;
  try {
    upstream = await fetch(SOURCE, {
      headers,
      redirect: "follow",
      // 同一个版本号的内容不会变，边缘缓存一天；换包时改 SOURCE 的路径即可。
      cf: { cacheEverything: true, cacheTtl: 86400 },
    } as RequestInit);
  } catch (error) {
    return new Response(`无法连接上游：${(error as Error).message}`, {
      status: 502,
    });
  }

  if (upstream.status !== 200 && upstream.status !== 206) {
    return new Response(`上游取包失败：HTTP ${upstream.status}`, {
      status: 502,
    });
  }

  const forwarded = new Headers();
  for (const name of [
    "content-length",
    "content-range",
    "accept-ranges",
    "etag",
    "last-modified",
  ]) {
    const value = upstream.headers.get(name);
    if (value) forwarded.set(name, value);
  }
  // 上游给的是 application/octet-stream，这里显式声明附件，别让浏览器内联打开。
  forwarded.set("content-type", "application/octet-stream");
  forwarded.set("content-disposition", `attachment; filename="${FILENAME}"`);
  forwarded.set("cache-control", "public, max-age=3600");

  return new Response(upstream.body, {
    status: upstream.status,
    headers: forwarded,
  });
}
