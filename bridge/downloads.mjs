import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";

export function createDownloadHandler({
  ApiError,
  artifactsRoot,
  mimeTypes,
  resolveWorkspacePath,
}) {
  return async function handleDownload(request, response, url) {
    if (request.method === "GET" && url.pathname === "/api/remote/files/download") {
      const filePath = resolveWorkspacePath(url.searchParams.get("path"), { allowRoot: false });
      const info = await stat(filePath);
      if (!info.isFile()) throw new ApiError(404, "workspace file was not found");
      const originalName = basename(filePath);
      const safeName = originalName.replace(/[\r\n"]/g, "_");
      const disposition = url.searchParams.get("inline") === "1" ? "inline" : "attachment";
      response.writeHead(200, {
        "Cache-Control": "no-store",
        "Content-Disposition": `${disposition}; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(originalName)}`,
        "Content-Length": info.size,
        "Content-Type": mimeTypes[extname(filePath).toLowerCase()] || "application/octet-stream",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
      });
      createReadStream(filePath).pipe(response);
      return true;
    }

    if (request.method !== "GET" || url.pathname !== "/api/remote/artifacts/download") {
      return false;
    }
    const artifactId = url.searchParams.get("id");
    if (
      typeof artifactId !== "string"
      || !artifactId
      || artifactId.length > 200
      || /[\\/\u0000-\u001f]/.test(artifactId)
    ) throw new ApiError(400, "artifact id is invalid");

    let canonicalRoot;
    let canonicalIndex;
    try {
      [canonicalRoot, canonicalIndex] = await Promise.all([
        realpath(artifactsRoot),
        realpath(resolve(artifactsRoot, artifactId, "index.html")),
      ]);
    } catch (error) {
      if (error?.code === "ENOENT") throw new ApiError(404, "artifact was not found");
      throw error;
    }
    if (canonicalIndex !== canonicalRoot && !canonicalIndex.startsWith(`${canonicalRoot}/`)) {
      throw new ApiError(403, "artifact path is outside the artifact store");
    }
    const info = await stat(canonicalIndex);
    if (!info.isFile() || extname(canonicalIndex).toLowerCase() !== ".html") {
      throw new ApiError(404, "artifact HTML was not found");
    }
    const downloadName = `${artifactId}.html`;
    response.writeHead(200, {
      "Cache-Control": "no-store",
      "Content-Disposition": `attachment; filename="artifact.html"; filename*=UTF-8''${encodeURIComponent(downloadName)}`,
      "Content-Length": info.size,
      "Content-Type": "text/html; charset=utf-8",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    });
    createReadStream(canonicalIndex).pipe(response);
    return true;
  };
}
