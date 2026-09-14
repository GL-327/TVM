package com.tvm.privateclient

import java.net.URI
import java.util.Locale

class ClientException(message: String) : Exception(message)

data class Connection(
    val origin: URI,
    val token: String,
    val allowLocalHttp: Boolean,
) {
    val sessionUrl: URI
        get() = origin.resolve("api/lan/session")

    fun isSameOrigin(url: URI): Boolean {
        if (url.userInfo != null) return false
        return origin.scheme.equals(url.scheme, ignoreCase = true) &&
            origin.host.equals(url.host, ignoreCase = true) &&
            defaultPort(origin) == defaultPort(url)
    }

    companion object {
        fun validated(address: String, token: String, allowLocalHttp: Boolean): Connection {
            val trimmed = address.trim()
            val parts = try {
                URI(trimmed)
            } catch (_: Exception) {
                throw ClientException("Enter only your TVM host address and port, with no path, password or query.")
            }
            val host = parts.host
            if (host.isNullOrEmpty() ||
                parts.userInfo != null ||
                parts.query != null ||
                parts.fragment != null ||
                !(parts.path.isNullOrEmpty() || parts.path == "/") ||
                (parts.port != -1 && parts.port !in 1..65535)
            ) {
                throw ClientException("Enter only your TVM host address and port, with no path, password or query.")
            }
            val scheme = parts.scheme?.lowercase(Locale.US)
            if (!(scheme == "https" || (scheme == "http" && allowLocalHttp && isPrivateIPv4(host)))) {
                throw ClientException(
                    "Use HTTPS, or enable private LAN HTTP and enter a private IPv4 address such as http://192.168.1.20:7345.",
                )
            }
            val cleanToken = token.trim()
            if (cleanToken.length !in 32..4096 || cleanToken.any { it.code < 33 || it.code > 126 }) {
                throw ClientException("Paste a LAN token with at least 32 printable characters and no spaces.")
            }
            val origin = URI(scheme, null, host, parts.port, "/", null, null)
            return Connection(origin, cleanToken, allowLocalHttp)
        }

        fun isPrivateIPv4(host: String): Boolean {
            val parts = host.split('.')
            if (parts.size != 4) return false
            val octets = parts.map { part ->
                val value = part.toIntOrNull() ?: return false
                if (value !in 0..255 || value.toString() != part) return false
                value
            }
            return octets[0] == 10 ||
                (octets[0] == 172 && octets[1] in 16..31) ||
                (octets[0] == 192 && octets[1] == 168)
        }

        fun defaultPort(uri: URI): Int {
            if (uri.port != -1) return uri.port
            return if (uri.scheme.equals("https", ignoreCase = true)) 443 else 80
        }
    }
}
