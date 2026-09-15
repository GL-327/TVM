package com.tvm.privateclient

import java.io.BufferedOutputStream
import java.io.IOException
import java.io.InputStream
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.URLDecoder
import java.util.Locale
import java.util.concurrent.Executors
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit

/**
 * The on-device HTTP server, bound to loopback only.
 *
 * Port of apps/ios/TVM/TVMLocalServer.swift. The WebView loads this origin, so
 * the interface gets a real http:// origin with a working same-origin API and
 * ES module loading — neither of which works from file://.
 *
 * Loopback-only is a security property, not a detail: the bound address is
 * 127.0.0.1, so nothing on the Wi-Fi network can reach this server even though
 * it needs no token. Do NOT change the bind address without adding auth.
 */
class TvmLocalServer(
    private val core: TvmLocalCore,
    private val assets: AssetReader,
) {
    /** Supplies the bundled interface. Kept as an interface so this is testable off-device. */
    fun interface AssetReader {
        /** Bytes for a path like "index.html" or "assets/index-abc.js", or null when absent. */
        fun read(path: String): ByteArray?
    }

    @Volatile
    private var socket: ServerSocket? = null

    @Volatile
    private var running = false

    private var workers: ThreadPoolExecutor? = null

    var port: Int = 0
        private set

    val origin: String get() = StandalonePolicy.localOrigin(port)

    fun start() {
        if (running) return
        val loopback = InetAddress.getByName("127.0.0.1")
        // Prefer the same port the desktop core uses so saved URLs line up; fall
        // back to any free port rather than refusing to start.
        val bound = try {
            ServerSocket(7345, 64, loopback)
        } catch (_: IOException) {
            ServerSocket(0, 64, loopback)
        }
        socket = bound
        port = bound.localPort
        running = true
        val pool = Executors.newFixedThreadPool(8) as ThreadPoolExecutor
        workers = pool
        Thread({ acceptLoop(bound, pool) }, "tvm-local-server").apply {
            isDaemon = true
            start()
        }
    }

    fun stop() {
        running = false
        runCatching { socket?.close() }
        socket = null
        workers?.shutdownNow()
        workers = null
        port = 0
    }

    private fun acceptLoop(server: ServerSocket, pool: ThreadPoolExecutor) {
        while (running && !server.isClosed) {
            val client = try {
                server.accept()
            } catch (_: IOException) {
                if (running) continue else return
            }
            try {
                pool.execute { serve(client) }
            } catch (_: Exception) {
                runCatching { client.close() }
            }
        }
    }

    private fun serve(client: Socket) {
        client.use { connection ->
            connection.soTimeout = 15_000
            runCatching {
                val input = connection.getInputStream()
                val request = readRequest(input) ?: run {
                    write(connection, HttpReply.json(400, Json.obj("error" to "bad request")))
                    return@runCatching
                }
                val reply = route(request)
                write(connection, reply)
            }
        }
    }

    private data class Request(
        val method: String,
        val path: String,
        val query: String,
        val body: ByteArray,
        val headers: Map<String, String>,
    )

    /**
     * Reads one request. Only the request line, Content-Length and the body
     * matter here; this server answers exactly one origin and one client.
     */
    private fun readRequest(input: InputStream): Request? {
        val head = StringBuilder()
        var last4 = 0
        while (head.length < 16_384) {
            val byte = input.read()
            if (byte < 0) return null
            head.append(byte.toChar())
            last4 = (last4 shl 8) or byte
            if ((last4 and 0xFFFFFFFF.toInt()) == 0x0D0A0D0A) break
        }
        val lines = head.toString().split("\r\n")
        val requestLine = lines.firstOrNull()?.split(' ') ?: return null
        if (requestLine.size < 2) return null
        val method = requestLine[0].uppercase(Locale.US)
        val target = requestLine[1]
        val split = target.indexOf('?')
        val rawPath = if (split >= 0) target.substring(0, split) else target
        val query = if (split >= 0) target.substring(split + 1) else ""
        val path = runCatching { URLDecoder.decode(rawPath, "UTF-8") }.getOrDefault(rawPath)

        var length = 0
        val headers = mutableMapOf<String, String>()
        for (line in lines.drop(1)) {
            val colon = line.indexOf(':')
            if (colon <= 0) continue
            val name = line.substring(0, colon).trim().lowercase(Locale.US)
            val value = line.substring(colon + 1).trim()
            headers[name] = value
            if (name == "content-length") length = value.toIntOrNull() ?: 0
        }
        if (length > 2_000_000) return null
        val body = ByteArray(length)
        var read = 0
        while (read < length) {
            val n = input.read(body, read, length - read)
            if (n < 0) break
            read += n
        }
        return Request(method, path, query, if (read == length) body else body.copyOf(read), headers)
    }

    private fun route(request: Request): HttpReply {
        if (request.path.startsWith("/api/")) {
            return core.handle(request.method, request.path, request.query, request.body, request.headers)
        }
        return serveAsset(request.path)
    }

    /**
     * Static interface files. Unknown non-asset paths fall through to
     * index.html so the client-side router owns navigation, which is the same
     * contract the desktop core serves.
     */
    private fun serveAsset(path: String): HttpReply {
        val clean = path.trimStart('/').ifEmpty { "index.html" }
        // No traversal out of the asset folder.
        if (clean.contains("..")) return HttpReply.json(403, Json.obj("error" to "forbidden"))
        val direct = assets.read(clean)
        if (direct != null) return HttpReply.bytes(200, contentType(clean), direct)
        if (clean.startsWith("assets/") || clean.contains('.')) {
            return HttpReply.json(404, Json.obj("error" to "not_found"))
        }
        val index = assets.read("index.html")
            ?: return HttpReply.json(500, Json.obj("error" to "interface missing from this build"))
        return HttpReply.bytes(200, "text/html; charset=utf-8", index)
    }

    private fun contentType(path: String): String = when {
        path.endsWith(".html") -> "text/html; charset=utf-8"
        path.endsWith(".js") || path.endsWith(".mjs") -> "text/javascript; charset=utf-8"
        path.endsWith(".css") -> "text/css; charset=utf-8"
        path.endsWith(".json") -> "application/json; charset=utf-8"
        path.endsWith(".svg") -> "image/svg+xml"
        path.endsWith(".png") -> "image/png"
        path.endsWith(".jpg") || path.endsWith(".jpeg") -> "image/jpeg"
        path.endsWith(".webp") -> "image/webp"
        path.endsWith(".avif") -> "image/avif"
        path.endsWith(".ico") -> "image/x-icon"
        path.endsWith(".woff2") -> "font/woff2"
        path.endsWith(".woff") -> "font/woff"
        path.endsWith(".ttf") -> "font/ttf"
        path.endsWith(".txt") -> "text/plain; charset=utf-8"
        else -> "application/octet-stream"
    }

    private fun write(client: Socket, reply: HttpReply) {
        val out = BufferedOutputStream(client.getOutputStream())
        val header = StringBuilder()
        header.append("HTTP/1.1 ").append(reply.status).append(' ').append(statusText(reply.status)).append("\r\n")
        header.append("Content-Length: ").append(reply.body.size).append("\r\n")
        header.append("Connection: close\r\n")
        // The interface is served from loopback and is never cached across runs:
        // a stale bundle after an app update is far worse than a re-read.
        header.append("Cache-Control: no-store\r\n")
        for ((key, value) in reply.headers) header.append(key).append(": ").append(value).append("\r\n")
        header.append("\r\n")
        out.write(header.toString().toByteArray(Charsets.US_ASCII))
        out.write(reply.body)
        out.flush()
        runCatching { client.shutdownOutput() }
        runCatching { client.close() }
    }

    private fun statusText(status: Int): String = when (status) {
        200 -> "OK"
        204 -> "No Content"
        400 -> "Bad Request"
        403 -> "Forbidden"
        404 -> "Not Found"
        413 -> "Payload Too Large"
        500 -> "Internal Server Error"
        else -> "OK"
    }

    fun awaitStopped(timeoutMs: Long) {
        workers?.awaitTermination(timeoutMs, TimeUnit.MILLISECONDS)
    }
}
