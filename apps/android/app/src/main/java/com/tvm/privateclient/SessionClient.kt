package com.tvm.privateclient

import java.net.HttpURLConnection
import java.net.URI
import java.util.Locale

data class SessionCookie(
    val name: String,
    val value: String,
) {
    val requestHeader: String get() = "$name=$value"

    fun webViewCookie(secure: Boolean): String {
        val base = "$name=$value; Path=/; HttpOnly; SameSite=Strict"
        return if (secure) "$base; Secure" else base
    }
}

/**
 * Sessions are ephemeral. Never follow a redirect with the bearer or session cookie.
 * Contract matches apps/ios/TVM/SessionClient.swift and apps/core/src/lanSessions.ts:
 * POST /api/lan/session with Authorization: Bearer <TVM_LAN_TOKEN>,
 * cookie name tvm_lan_session, HttpOnly, Path=/, Secure when HTTPS.
 */
object SessionClient {
    const val COOKIE_NAME = "tvm_lan_session"

    fun connect(connection: Connection): SessionCookie {
        val conn = open(connection.sessionUrl, "POST")
        try {
            conn.setRequestProperty("Authorization", "Bearer ${connection.token}")
            conn.setRequestProperty("Content-Type", "application/json")
            conn.doOutput = true
            conn.outputStream.use { it.write("{}".toByteArray(Charsets.UTF_8)) }
            val code = conn.responseCode
            if (code == 401 || code == 403) {
                throw ClientException("The host rejected this token or address. Check the host LAN settings.")
            }
            val body = readBody(conn, code)
            if (code !in 200..299 || !OK_TRUE.containsMatchIn(body)) {
                throw ClientException(
                    "This host does not support TVM mobile sessions. Update and restart Core, then retry.",
                )
            }
            val headers = conn.headerFields.entries
                .firstOrNull { it.key != null && it.key.equals("Set-Cookie", ignoreCase = true) }
                ?.value
                .orEmpty()
            return headers.firstNotNullOfOrNull { parseSetCookie(it, connection) }
                ?: throw ClientException(
                    "The host did not issue a valid secure session. Check the Core version and HTTPS configuration.",
                )
        } finally {
            conn.disconnect()
        }
    }

    fun disconnect(connection: Connection, cookie: SessionCookie) {
        val conn = open(connection.sessionUrl, "DELETE")
        try {
            conn.setRequestProperty("Content-Type", "application/json")
            conn.setRequestProperty("Cookie", cookie.requestHeader)
            runCatching { conn.responseCode }
        } finally {
            conn.disconnect()
        }
    }

    fun parseSetCookie(header: String, connection: Connection): SessionCookie? {
        val parts = header.split(';').map { it.trim() }.filter { it.isNotEmpty() }
        if (parts.isEmpty()) return null
        val nv = parts[0].split('=', limit = 2)
        if (nv.size != 2) return null
        val name = nv[0]
        val value = nv[1]
        if (name != COOKIE_NAME || value.isEmpty()) return null
        val attrs = linkedMapOf<String, String>()
        var httpOnly = false
        var secure = false
        for (part in parts.drop(1)) {
            val eq = part.indexOf('=')
            if (eq < 0) {
                val flag = part.lowercase(Locale.US)
                if (flag == "httponly") httpOnly = true
                if (flag == "secure") secure = true
            } else {
                attrs[part.substring(0, eq).trim().lowercase(Locale.US)] = part.substring(eq + 1).trim()
            }
        }
        if (!httpOnly) return null
        if (attrs["path"] != "/") return null
        val domain = attrs["domain"]
        if (domain != null) {
            val host = connection.origin.host ?: return null
            val stripped = domain.trimStart('.')
            if (!stripped.equals(host, ignoreCase = true)) return null
        }
        val https = connection.origin.scheme.equals("https", ignoreCase = true)
        if (https && !secure) return null
        return SessionCookie(name, value)
    }

    private fun open(url: URI, method: String): HttpURLConnection {
        val conn = url.toURL().openConnection() as HttpURLConnection
        conn.requestMethod = method
        conn.instanceFollowRedirects = false
        conn.connectTimeout = 15_000
        conn.readTimeout = 20_000
        conn.useCaches = false
        return conn
    }

    private fun readBody(conn: HttpURLConnection, code: Int): String {
        val stream = if (code in 200..299) conn.inputStream else conn.errorStream
        return stream?.bufferedReader(Charsets.UTF_8)?.readText().orEmpty()
    }

    private val OK_TRUE = Regex("\"ok\"\\s*:\\s*true")
}
